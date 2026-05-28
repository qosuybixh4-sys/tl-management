import React, { useState, useEffect, useRef } from "react";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, addDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";
import { db } from "./firebase";
import "./App.css";

const TL_SPECS = ["7.8m급", "10m급", "12m급", "기타"];
const TL_FLOORS = ["B2F", "B1F", "1F", "2F", "3F", "4F", "5F"];
const BLS = ["1BL", "2BL"];
const WORK_HOURS = 8; // 일일 기준 작업시간

const SYSTEM_ACCOUNTS = [
  { id: "소장", pw: "1234", role: "sojangnm", label: "소장", bl: null },
  { id: "1BL공사관리자", pw: "1234", role: "admin_construction", label: "1BL 공사관리자", bl: "1BL" },
  { id: "1BL안전관리자", pw: "1234", role: "admin_safety", label: "1BL 안전관리자", bl: "1BL" },
  { id: "2BL공사관리자", pw: "1234", role: "admin_construction", label: "2BL 공사관리자", bl: "2BL" },
  { id: "2BL안전관리자", pw: "1234", role: "admin_safety", label: "2BL 안전관리자", bl: "2BL" },
];

// ── 역할별 네비게이션 ─────────────────────────────────────────────────────
const NAV_TABS = {
  sojangnm: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "approval", icon: "✅", label: "결재" },
    { id: "history", icon: "📈", label: "가동률" },
    { id: "teams", icon: "👥", label: "팀관리" },
  ],
  admin: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "today", icon: "📅", label: "금일사용" },
    { id: "approval", icon: "✅", label: "결재" },
    { id: "history", icon: "📈", label: "가동률" },
  ],
  admin_construction: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "approval", icon: "✅", label: "결재" },
    { id: "history", icon: "📈", label: "가동률" },
  ],
  admin_safety: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "today", icon: "📅", label: "금일사용" },
    { id: "approval", icon: "✅", label: "결재" },
    { id: "history", icon: "📈", label: "가동률" },
  ],
  team: [
    { id: "tl", icon: "🏗", label: "내 장비" },
    { id: "today", icon: "📅", label: "금일사용" },
    { id: "rental", icon: "🔄", label: "대여" },
    { id: "request", icon: "📨", label: "승인요청" },
  ],
  guide: [
    { id: "driver", icon: "⏱", label: "작업기록" },
  ],
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [tls, setTls] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);

  // 온/오프라인 감지
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // 자동 로그인
  useEffect(() => {
    const saved = localStorage.getItem("tl_user");
    if (saved) { try { setCurrentUser(JSON.parse(saved)); } catch {} }
  }, []);

  // Firestore 실시간 구독
  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, "accounts"), snap => setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "teams"), snap => setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "tls"), snap => setTls(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.sn||"").localeCompare(b.sn||"")))),
      onSnapshot(query(collection(db, "approvals"), orderBy("createdAt", "desc")), snap => setApprovals(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, "workLogs"), orderBy("startedAt", "desc")), snap => setWorkLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, "rentals"), orderBy("createdAt", "desc")), snap => setRentals(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
    ];
    initSystemAccounts().then(() => setLoading(false));
    return () => unsubs.forEach(u => u());
  }, []);

  async function initSystemAccounts() {
    const snap = await getDocs(collection(db, "accounts"));
    const existing = snap.docs.map(d => d.id);
    for (const acc of SYSTEM_ACCOUNTS) {
      if (!existing.includes(acc.id)) {
        await setDoc(doc(db, "accounts", acc.id), { pw: acc.pw, role: acc.role, label: acc.label, bl: acc.bl });
      }
    }
  }

  // 로그인
  async function doLogin(accountId, pw) {
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return "존재하지 않는 계정입니다.";
    if (acc.pw !== pw) return "비밀번호가 올바르지 않습니다.";
    const user = { id: accountId, role: acc.role, label: acc.label || accountId, team: acc.team || null, bl: acc.bl || null, teamName: acc.teamName || null };
    // admin_construction, admin_safety도 admin처럼 처리
    setCurrentUser(user);
    localStorage.setItem("tl_user", JSON.stringify(user));
    setActiveTab(NAV_TABS[acc.role][0].id);
    return null;
  }

  function doLogout() {
    if (!window.confirm("로그아웃 하시겠습니까?")) return;
    setCurrentUser(null);
    localStorage.removeItem("tl_user");
    setActiveTab("");
  }

  // 팀 CRUD
  async function addTeam(name, leader, pw, bl) {
    if (!name || !pw) return "팀 이름과 비밀번호를 입력해주세요.";
    if (accounts.find(a => a.id === name)) return "이미 존재하는 이름입니다.";
    await setDoc(doc(db, "teams", name), { name, leader, pw, bl });
    await setDoc(doc(db, "accounts", name), { pw, role: "team", label: name, team: name, bl });
    return null;
  }

  async function editTeam(oldName, newName, leader, pw, bl) {
    if (!newName) return "팀 이름을 입력해주세요.";
    if (oldName !== newName) {
      const oldPw = pw || teams.find(t => t.id === oldName)?.pw;
      await setDoc(doc(db, "teams", newName), { name: newName, leader, pw: oldPw, bl });
      await deleteDoc(doc(db, "teams", oldName));
      await setDoc(doc(db, "accounts", newName), { pw: oldPw, role: "team", label: newName, team: newName, bl });
      await deleteDoc(doc(db, "accounts", oldName));
      for (const tl of tls.filter(t => t.team === oldName)) {
        await updateDoc(doc(db, "tls", tl.id), { team: newName });
      }
    } else {
      const updates = { name: newName, leader, bl };
      if (pw) updates.pw = pw;
      await updateDoc(doc(db, "teams", oldName), updates);
      if (pw) await updateDoc(doc(db, "accounts", oldName), { pw, bl });
      else await updateDoc(doc(db, "accounts", oldName), { bl });
    }
    return null;
  }

  async function deleteTeam(name) {
    await deleteDoc(doc(db, "teams", name));
    await deleteDoc(doc(db, "accounts", name));
    for (const tl of tls.filter(t => t.team === name)) {
      await updateDoc(doc(db, "tls", tl.id), { team: "미배정" });
    }
  }

  // TL CRUD
  async function addTL(data) {
    await addDoc(collection(db, "tls"), { ...data, todayUse: false, todayPurpose: "", createdAt: serverTimestamp() });
  }
  async function updateTL(id, data) { await updateDoc(doc(db, "tls", id), data); }
  async function deleteTL(id) { await deleteDoc(doc(db, "tls", id)); }
  async function toggleTodayUse(id, current) {
    await updateDoc(doc(db, "tls", id), { todayUse: !current, todayPurpose: "", notUsedReason: "" });
  }
  async function setTodayPurpose(id, purpose) { await updateDoc(doc(db, "tls", id), { todayPurpose: purpose }); }
  async function setNotUsedReason(id, reason) { await updateDoc(doc(db, "tls", id), { notUsedReason: reason }); }

  // 결재
  async function submitApproval(data) {
    await addDoc(collection(db, "approvals"), { ...data, status: "대기", createdAt: serverTimestamp() });
  }
  async function cancelApproval(id) {
    await deleteDoc(doc(db, "approvals", id));
  }
  async function decideApproval(id, status, approval) {
    await updateDoc(doc(db, "approvals", id), { status });
    if (status === "승인" && approval.type === "이관") {
      const tl = tls.find(t => t.id === approval.tlId);
      if (tl) await updateDoc(doc(db, "tls", approval.tlId), { team: approval.to });
    }
    if (status === "승인" && approval.type === "반입") {
      await addDoc(collection(db, "tls"), {
        sn: approval.newSn || "미정",
        spec: approval.newSpec || "",
        location: approval.newLocation || "",
        inDate: approval.newInDate || new Date().toISOString().slice(0, 10),
        team: approval.from,
        bl: approval.bl || "",
        status: "정상",
        todayUse: false,
        todayPurpose: "",
        createdAt: serverTimestamp(),
      });
    }
    if (status === "승인" && approval.type === "반출") {
      const tl = tls.find(t => t.id === approval.tlId);
      if (tl) await updateDoc(doc(db, "tls", approval.tlId), { team: "반출", status: "반출" });
    }
  }

  // 비밀번호 변경
  async function changePassword(accountId, newPw) {
    await updateDoc(doc(db, "accounts", accountId), { pw: newPw });
    if (teams.find(t => t.id === accountId)) {
      await updateDoc(doc(db, "teams", accountId), { pw: newPw });
    }
  }

  // 운전원 계정 추가/삭제
  async function addDriver(name, pw, bl, teamName) {
    if (!name || !pw) return "이름과 비밀번호를 입력해주세요.";
    if (accounts.find(a => a.id === name)) return "이미 존재하는 이름입니다.";
    await setDoc(doc(db, "accounts", name), { pw, role: "guide", label: name, bl, teamName });
    return null;
  }
  async function deleteAccount(id) { await deleteDoc(doc(db, "accounts", id)); }

  // 작업 로그
  async function startWork(user, tlId, startedAt) {
    const tl = tls.find(t => t.id === tlId);
    const now = startedAt || new Date().toISOString();
    const ref = await addDoc(collection(db, "workLogs"), {
      driverId: user.id,
      driverName: user.label,
      teamName: user.teamName || "",
      tlId: tlId || "",
      tlSn: tl?.sn || "미지정",
      bl: user.bl || "",
      startedAt: now,
      endedAt: null,
      durationMin: null,
      date: new Date().toISOString().slice(0, 10),
    });
    return ref.id; // logId 반환 → localStorage에 저장
  }
  async function endWork(logId, startedAt, durationMin) {
    const endedAt = new Date().toISOString();
    // durationMin은 DriverScreen에서 로컬 시각 기준으로 이미 계산된 값
    const safeDuration = (durationMin && durationMin > 0 && durationMin < 1440)
      ? durationMin : 1;
    await updateDoc(doc(db, "workLogs", logId), {
      endedAt,
      startedAt: startedAt || endedAt, // startedAt도 확실히 저장
      durationMin: safeDuration,
    });
  }

  // 대여 함수
  async function createRental(fromTeam, toTeam, tlId, tlSn, bl, returnDate) {
    const today = new Date().toISOString().slice(0, 10);
    const existing = rentals.find(r => r.tlId === tlId && r.status === "대여중");
    if (existing) { alert("이미 대여 중인 TL입니다."); return; }
    await addDoc(collection(db, "rentals"), {
      fromTeam, toTeam, tlId, tlSn, bl,
      date: today,
      returnDate: returnDate || today,
      status: "대여중",
      createdAt: serverTimestamp(),
    });
    // 소속 유지, 대여중 표시만 추가
    await updateDoc(doc(db, "tls", tlId), {
      isRented: true,
      rentedTo: toTeam,
      rentReturnDate: returnDate || today,
    });
  }

  async function returnRental(rentalId, tlId) {
    await updateDoc(doc(db, "rentals", rentalId), { status: "반환완료", returnedAt: serverTimestamp() });
    await updateDoc(doc(db, "tls", tlId), { isRented: false, rentedTo: null, rentReturnDate: null });
  }

  // 자정 자동 반환 체크 (반환 날짜 지난 것)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    rentals.filter(r => r.status === "대여중" && r.returnDate < today).forEach(async r => {
      await updateDoc(doc(db, "rentals", r.id), { status: "반환완료", returnedAt: serverTimestamp() });
      await updateDoc(doc(db, "tls", r.tlId), { isRented: false, rentedTo: null, rentReturnDate: null });
    });
  }, [rentals]);

  // 자정 가동률 자동 저장
  useEffect(() => {
    if (tls.length === 0 || teams.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastAutoSave = localStorage.getItem("tl_auto_history");
    if (lastAutoSave === today) return; // 오늘 이미 저장됨
    if (!lastAutoSave || lastAutoSave < today) {
      // 자정이 지난 경우 어제 데이터를 저장
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const snapshot = teams.map(team => {
        const teamTls = tls.filter(t => t.team === team.name);
        const todayLogs = workLogs.filter(l => l.date === yesterdayStr && teamTls.some(t => t.id === l.tlId) && l.durationMin != null);
        const totalMin = todayLogs.reduce((s, l) => s + l.durationMin, 0);
        const maxMin = WORK_HOURS * 60 * (teamTls.length || 1);
        return {
          team: team.name, bl: team.bl || "",
          total: teamTls.length,
          used: teamTls.filter(t => t.todayUse).length,
          totalMin,
          rateTime: Math.min(Math.round((totalMin / maxMin) * 100), 100),
        };
      });
      setDoc(doc(db, "history", yesterdayStr), {
        date: yesterdayStr, data: snapshot,
        savedAt: serverTimestamp(), autoSaved: true
      });
      localStorage.setItem("tl_auto_history", today);
    }
  }, [tls, teams, workLogs]);

  // 자정 사용 현황 초기화
  useEffect(() => {
    if (tls.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastReset = localStorage.getItem("tl_last_reset");
    if (lastReset === today) return; // 오늘 이미 초기화됨
    // 어제 또는 그 이전 날짜면 초기화
    if (lastReset && lastReset < today) {
      tls.forEach(async tl => {
        if (tl.todayUse || tl.todayPurpose || tl.notUsedReason) {
          await updateDoc(doc(db, "tls", tl.id), {
            todayUse: false,
            todayPurpose: "",
            notUsedReason: "",
          });
        }
      });
    }
    localStorage.setItem("tl_last_reset", today);
  }, [tls]);

  useEffect(() => {
    if (currentUser && !activeTab) {
      setActiveTab(NAV_TABS[currentUser.role]?.[0]?.id || "");
    }
  }, [currentUser, accounts]);

  if (loading) return <div className="splash"><div className="spinner" /><p>불러오는 중...</p></div>;
  if (!currentUser) return <LoginScreen accounts={accounts} onLogin={doLogin} />;

  const navTabs = NAV_TABS[currentUser.role] || NAV_TABS['guide'] || [];

  return (
    <div className="app">
      <header className="header">
        <span className="header-icon" style={{ display: "inline-flex", alignItems: "center" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="2" width="22" height="3" rx="1" fill="white"/>
            <line x1="6" y1="5" x2="11" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="11" y1="5" x2="6" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="13" y1="5" x2="18" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="18" y1="5" x2="13" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <rect x="1" y="16" width="22" height="3" rx="1" fill="white"/>
            <circle cx="5" cy="21" r="2" fill="white"/>
            <circle cx="19" cy="21" r="2" fill="white"/>
          </svg>
        </span>
        <h1>TL 장비 관리</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {offline && <span className="offline-badge" title="전파 없음 - 작업 내용은 자동 저장 후 온라인 시 동기화됩니다">📵 오프라인</span>}
          {currentUser.bl && <span className="badge badge-bl">{currentUser.bl}</span>}
          <span className={`badge badge-${currentUser.role === "admin_construction" ? "admin" : currentUser.role === "admin_safety" ? "admin" : currentUser.role}`}>{currentUser.label}</span>
          <button className="btn-icon" onClick={doLogout} title="로그아웃">⎋</button>
        </div>
      </header>
      <nav className="nav">
        {navTabs.map(tab => {
          const isApproval = tab.id === "approval";
          const pendingCount = isApproval
            ? approvals.filter(a => a.status === "대기" &&
                (currentUser.role === "sojangnm" || a.bl === currentUser.bl)).length
            : 0;
          return (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}
              style={{ position: "relative" }}>
              <span className="nav-icon">{tab.icon}</span>
              <span>{tab.label}</span>
              {isApproval && pendingCount > 0 && (
                <span style={{
                  position: "absolute", top: 4, right: 4,
                  background: "#E24B4A", color: "#fff",
                  borderRadius: "50%", width: 16, height: 16,
                  fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}>{pendingCount > 9 ? "9+" : pendingCount}</span>
              )}
            </button>
          );
        })}
      </nav>
      <main className="content">
        {activeTab === "overview" && <OverviewScreen tls={tls} teams={teams} approvals={approvals} currentUser={currentUser} />}
        {activeTab === "tl" && <TLScreen tls={tls} teams={teams} currentUser={currentUser} onAdd={addTL} onUpdate={updateTL} onDelete={deleteTL} />}
        {activeTab === "today" && <TodayScreen tls={tls} teams={teams} currentUser={currentUser} onToggle={toggleTodayUse} onPurpose={setTodayPurpose} onNotUsed={setNotUsedReason} workLogs={workLogs} />}
        {activeTab === "approval" && <ApprovalScreen approvals={approvals} tls={tls} onDecide={decideApproval} currentUser={currentUser} />}
        {activeTab === "rental" && <RentalScreen tls={tls} teams={teams} currentUser={currentUser} rentals={rentals} onRent={createRental} onReturn={returnRental} />}
        {activeTab === "request" && <RequestScreen tls={tls} teams={teams} currentUser={currentUser} onSubmit={submitApproval} onCancel={cancelApproval} approvals={approvals} />}
        {activeTab === "teams" && <TeamsScreen teams={teams} tls={tls} accounts={accounts} onAdd={addTeam} onEdit={editTeam} onDelete={deleteTeam} onChangePw={changePassword} onAddDriver={addDriver} onDeleteAccount={deleteAccount} />}
        {activeTab === "history" && <HistoryScreen tls={tls} teams={teams} workLogs={workLogs} currentUser={currentUser} />}
        {activeTab === "driver" && <GuideScreen currentUser={currentUser} tls={tls} workLogs={workLogs} onStart={startWork} onEnd={endWork} />}
      </main>
    </div>
  );
}

// ── 로그인 ────────────────────────────────────────────────────────────────
function LoginScreen({ accounts, onLogin }) {
  const [step, setStep] = useState("group"); // group → role → login
  const [group, setGroup] = useState(""); // 소장 | 1BL | 2BL
  const [roleId, setRoleId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const sojangnm = accounts.filter(a => a.role === "sojangnm");
  const roleOrder = { admin_construction: 0, admin_safety: 0, admin: 0, team: 1, guide: 2, driver: 2 };
  const groupAccounts = group === "소장"
    ? sojangnm
    : accounts
        .filter(a => a.bl === group && a.role !== "sojangnm")
        .sort((a, b) => {
          const oa = roleOrder[a.role] ?? 9;
          const ob = roleOrder[b.role] ?? 9;
          if (oa !== ob) return oa - ob;
          return (a.label || a.id).localeCompare(b.label || b.id);
        });

  async function handleLogin() {
    if (!pw) { setErr("비밀번호를 입력해주세요."); return; }
    setLoading(true);
    const error = await onLogin(roleId, pw);
    setLoading(false);
    if (error) setErr(error);
  }

  const roleLabel = (role) => {
    if (role === "admin") return "관리자";
    if (role === "admin_construction") return "공사관리자";
    if (role === "admin_safety") return "안전관리자";
    if (role === "team") return "팀장";
    if (role === "guide") return "TL 유도원";
    if (role === "sojangnm") return "소장";
    return role;
  };

  return (
    <div className="login-wrap">
      <div className="login-logo">
        <div className="login-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#534AB7"/>
            <rect x="6" y="10" width="36" height="5" rx="1.5" fill="white"/>
            <line x1="13" y1="15" x2="21" y2="32" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="21" y1="15" x2="13" y2="32" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="27" y1="15" x2="35" y2="32" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="35" y1="15" x2="27" y2="32" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <rect x="6" y="32" width="36" height="5" rx="1.5" fill="white"/>
            <circle cx="11" cy="40" r="3" fill="white"/>
            <circle cx="37" cy="40" r="3" fill="white"/>
          </svg>
        </div>
        <h2>TL 장비 관리</h2>
        <p>현장 테이블리프트 통합 관리 시스템</p>
      </div>

      {/* Step 1: 그룹 선택 */}
      {step === "group" && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>소속 선택</div>
          {["소장", "1BL", "2BL"].map(g => (
            <button key={g} className="group-btn" onClick={() => {
              setGroup(g);
              if (g === "소장") {
                const sojangnmAcc = accounts.find(a => a.role === "sojangnm");
                if (sojangnmAcc) { setRoleId(sojangnmAcc.id); setStep("login"); }
              } else {
                setStep("role");
              }
              setErr("");
            }}>
              {g === "소장" ? "🏢 소장" : g === "1BL" ? "🔵 1BL" : "🟢 2BL"}
            </button>
          ))}
        </>
      )}

      {/* Step 2: 역할 선택 (1BL/2BL) */}
      {step === "role" && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{group} — 계정 선택</div>
          {groupAccounts.length === 0 && <div className="empty" style={{ padding: "16px 0" }}>등록된 계정이 없습니다.</div>}
          {(() => {
            const groups = [
              { label: "관리자", roles: ["admin_construction", "admin_safety", "admin"], icon: "🔧" },
              { label: "팀장", roles: ["team"], icon: "👷" },
              { label: "유도원", roles: ["guide", "driver"], icon: "🦺" },
            ];
            return groups.map(g => {
              const accs = groupAccounts.filter(a => g.roles.includes(a.role));
              if (accs.length === 0) return null;
              return (
                <div key={g.label}>
                  <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, marginTop: 12, marginBottom: 4, paddingLeft: 2 }}>{g.label}</div>
                  {accs.map(a => (
                    <button key={a.id} className="group-btn" onClick={() => { setRoleId(a.id); setStep("login"); setErr(""); }}>
                      {g.icon} {a.label || a.id}
                      <span style={{ fontSize: 11, color: "#aaa", marginLeft: 4 }}>
                        {(a.role === "guide" || a.role === "driver") && a.teamName
                          ? `${a.teamName}`
                          : roleLabel(a.role)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            });
          })()}
          <button className="btn full mt8" onClick={() => { setStep("group"); setGroup(""); }}>← 뒤로</button>
        </>
      )}

      {/* Step 3: 비밀번호 입력 */}
      {step === "login" && (
        <>
          <div className="alert alert-info mb12" style={{ fontSize: 12 }}>
            {group} · {accounts.find(a => a.id === roleId)?.label || roleId}
          </div>
          {err && <div className="alert alert-warn">{err}</div>}
          <div className="form-group">
            <label>비밀번호</label>
            <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }}
              placeholder="비밀번호 입력" autoFocus onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
          <button className="btn btn-primary full" onClick={handleLogin} disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
          <button className="btn full mt8" onClick={() => { setStep(group === "소장" ? "group" : "role"); setPw(""); setErr(""); }}>← 뒤로</button>
        </>
      )}
      <div style={{ textAlign: "center", fontSize: 12, color: "#bbb", marginTop: 32 }}>
        문의) 010-9148-5079 이정환 선임
      </div>
    </div>
  );
}

// ── TL 카드 (팝업용 공통 컴포넌트) ──────────────────────────────────────
function TLCard({ t }) {
  const isNotUsed = t.status === "정상" && !t.todayUse;
  const dotClass = t.status === "고장" ? "broken" : t.status === "점검중" ? "check" : isNotUsed ? "unused" : "ok";
  const statusLabel = t.status === "고장" ? "고장" : t.status === "점검중" ? "점검중" : isNotUsed ? "미사용" : "정상";
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontSize: 15 }}>{t.sn}</div>
          <div className="card-sub">{t.location} · {t.team} · {t.bl}</div>
        </div>
        <span className="status-tag">
          <span className={`dot dot-${dotClass}`} />{statusLabel}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {t.spec && <span className="pill pill-gray" style={{ fontSize: 10, padding: "1px 6px" }}>{t.spec}</span>}
        {t.todayUse && <span className="pill pill-green">금일사용</span>}
        {t.todayUse && t.todayPurpose && <span className="pill pill-purple">{t.todayPurpose}</span>}
        {!t.todayUse && t.notUsedReason && <span className="pill pill-amber">미사용: {t.notUsedReason}</span>}
        {t.isRented && <span className="pill pill-amber">대여중</span>}
      </div>
    </div>
  );
}

// ── 팝업 모달 ─────────────────────────────────────────────────────────────
function Popup({ title, count, children, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="alert alert-info mb12" style={{ fontSize: 13, padding: "8px 12px" }}>총 {count}대</div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {count === 0
            ? <div className="empty">해당 상태의 TL이 없습니다.</div>
            : children}
        </div>
        <button className="btn full" style={{ marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

function TeamPopup({ title, teams, tls, onClose }) {
  const totalTls = teams.reduce((s, t) => s + tls.filter(tl => tl.team === t.name).length, 0);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="alert alert-info mb12" style={{ fontSize: 13, padding: "8px 12px" }}>
          등록 팀 <strong>{teams.length}개</strong> · 전체 TL <strong>{totalTls}대</strong>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {teams.map(team => {
            const cnt = tls.filter(t => t.team === team.name).length;
            const use = tls.filter(t => t.team === team.name && t.todayUse).length;
            return (
              <div key={team.id} className="team-row" style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 10, marginBottom: 10 }}>
                <div className="team-avatar">{team.name.slice(0, 2)}</div>
                <div className="flex1">
                  <div className="tl-sn">{team.name}</div>
                  {team.leader && <div className="tl-meta">{team.leader}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="pill pill-purple">TL {cnt}대</span>
                  {use > 0 && <div style={{ fontSize: 11, color: "#1D9E75", marginTop: 3 }}>금일 {use}대 사용</div>}
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn full" style={{ marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

// ── 현황 ──────────────────────────────────────────────────────────────────
function OverviewScreen({ tls, teams, approvals, currentUser }) {
  const [popup, setPopup] = useState(null); // null | {type, bl}
  const [expandedTeams, setExpandedTeams] = useState({});

  const isSojangnm = currentUser.role === "sojangnm";
  const isAdmin = currentUser.role === "admin";

  const getBlTls = (bl) => bl === "전체" ? tls : tls.filter(t => {
    const team = teams.find(tm => tm.name === t.team);
    return team?.bl === bl;
  });
  const getBlTeams = (bl) => bl === "전체" ? teams : teams.filter(t => t.bl === bl);

  function toggleTeam(name) {
    setExpandedTeams(prev => ({ ...prev, [name]: !prev[name] }));
  }

  // 팝업 TL 목록 계산
  function getPopupTls() {
    if (!popup) return [];
    const baseTls = getBlTls(popup.bl);
    if (popup.type === "전체") return baseTls;
    if (popup.type === "금일사용") return baseTls.filter(t => t.todayUse);
    if (popup.type === "고장") return baseTls.filter(t => t.status === "고장");
    if (popup.type === "점검") return baseTls.filter(t => t.status === "점검중");
    if (popup.type === "정상") return baseTls.filter(t => t.status === "정상");
    if (popup.type === "미사용") return baseTls.filter(t => !t.todayUse);
    if (popup.type === "결재대기") return [];
    return [];
  }

  function MetricsBlock({ bl }) {
    const ftls = getBlTls(bl);
    const fteams = getBlTeams(bl);
    const total = ftls.length;
    const todayUse = ftls.filter(t => t.todayUse).length;
    const broken = ftls.filter(t => t.status === "고장").length;
    const inCheck = ftls.filter(t => t.status === "점검중").length;
    const notUsed = ftls.filter(t => !t.todayUse).length;
    const fpending = approvals.filter(a => a.status === "대기" && (bl === "전체" || a.bl === bl)).length;
    const bl1Teams = getBlTeams("1BL");
    const bl2Teams = getBlTeams("2BL");

    return (
      <>
        {/* 지표 카드 */}
        <div className="metric-grid">
          <div className="metric metric-click" onClick={() => setPopup({ type: "전체", bl })}>
            <div className="metric-val">{total}</div><div className="metric-label">전체 TL</div>
          </div>
          <div className="metric metric-click" onClick={() => setPopup({ type: "금일사용", bl })}>
            <div className="metric-val green">{todayUse}</div><div className="metric-label">금일 사용</div>
          </div>
          {bl === "전체" && isSojangnm ? (
            <>
              <div className="metric metric-click" onClick={() => setPopup({ type: "1BL팀", bl: "1BL" })}>
                <div className="metric-val">{bl1Teams.length}</div><div className="metric-label">1공구 팀</div>
              </div>
              <div className="metric metric-click" onClick={() => setPopup({ type: "2BL팀", bl: "2BL" })}>
                <div className="metric-val">{bl2Teams.length}</div><div className="metric-label">2공구 팀</div>
              </div>
            </>
          ) : (
            <>
              <div className="metric metric-click" onClick={() => setPopup({ type: "고장", bl })}>
                <div className="metric-val red">{broken}</div><div className="metric-label">고장</div>
              </div>
              <div className="metric metric-click" onClick={() => setPopup({ type: "결재대기", bl })}>
                <div className="metric-val amber">{fpending}</div><div className="metric-label">결재 대기</div>
              </div>
            </>
          )}
        </div>

        {/* 상태별 장비 */}
        <div className="section-title">상태별 장비</div>
        <div className="card mb12">
          {[
            { label: "정상(사용중)", color: "#1D9E75", count: ftls.filter(t => t.status === "정상" && t.todayUse).length, type: "금일사용", dotClass: "ok" },
            { label: "점검", color: "#EF9F27", count: inCheck, type: "점검", dotClass: "check" },
            { label: "고장", color: "#E24B4A", count: broken, type: "고장", dotClass: "broken" },
            { label: "미사용", color: "#aaa", count: ftls.filter(t => t.status === "정상" && !t.todayUse).length, type: "미사용", dotClass: "unused" },
          ].map((item, i, arr) => (
            <div key={item.label}
              className="metric-click"
              style={{ display: "flex", alignItems: "center", padding: "10px 4px", borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none", cursor: "pointer" }}
              onClick={() => setPopup({ type: item.type, bl })}>
              <span className={`dot dot-${item.dotClass}`} />
              <span style={{ fontSize: 14, fontWeight: 500, marginLeft: 8, flex: 1 }}>{item.label}</span>
              <span className="pill">{item.count}대</span>
            </div>
          ))}
        </div>

        {/* 층별 TL 현황 */}
        <div className="section-title">층별 현황</div>
        <div className="card mb12">
          {[...TL_FLOORS].reverse().map((floor, fi, arr) => {
            const floorTls = ftls.filter(t => t.floor === floor);
            if (floorTls.length === 0) return null;
            const using = floorTls.filter(t => t.todayUse).length;
            const broken = floorTls.filter(t => t.status === "고장").length;
            const check = floorTls.filter(t => t.status === "점검중").length;
            const [expanded, setExpanded] = React.useState(false);
            return (
              <div key={floor} style={{ borderBottom: fi < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <div className="metric-click"
                  style={{ display: "flex", alignItems: "center", padding: "10px 4px", cursor: "pointer" }}
                  onClick={() => setExpanded(!expanded)}>
                  <span style={{ fontSize: 13, fontWeight: 600, width: 40, color: "#534AB7" }}>{floor}</span>
                  <span style={{ fontSize: 13, flex: 1, color: "#444" }}>총 {floorTls.length}대</span>
                  <div style={{ display: "flex", gap: 6, marginRight: 8 }}>
                    {using > 0 && <span className="pill pill-green" style={{ fontSize: 11 }}>사용 {using}</span>}
                    {broken > 0 && <span className="pill pill-red" style={{ fontSize: 11 }}>고장 {broken}</span>}
                    {check > 0 && <span className="pill pill-amber" style={{ fontSize: 11 }}>점검 {check}</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "#aaa" }}>{expanded ? "▲" : "▼"}</span>
                </div>
                {expanded && (
                  <div style={{ paddingBottom: 8, paddingLeft: 4 }}>
                    {floorTls.map(t => {
                      const dotC = t.status === "고장" ? "broken" : t.status === "점검중" ? "check" : t.todayUse ? "ok" : "unused";
                      const stLabel = t.status === "고장" ? "고장" : t.status === "점검중" ? "점검" : t.todayUse ? "작업중" : "미사용";
                      return (
                        <div key={t.id} className="tl-row" style={{ padding: "5px 0" }}>
                          <span className={`dot dot-${dotC}`} />
                          <span className="tl-sn">{t.sn}</span>
                          {t.spec && <span className="pill pill-gray" style={{ fontSize: 10, padding: "1px 5px" }}>{t.spec}</span>}
                          <span className="tl-meta">{t.team}</span>
                          {t.bl && bl === "전체" && <span className="pill pill-bl" style={{ fontSize: 10 }}>{t.bl}</span>}
                          <span style={{ fontSize: 11, color: dotC === "ok" ? "#1D9E75" : dotC === "broken" ? "#E24B4A" : dotC === "check" ? "#EF9F27" : "#aaa", marginLeft: "auto" }}>{stLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 팀별 현황 - 2단계 접기/펼치기 (공구 → 팀 → TL) */}
        <div className="section-title">팀별 현황</div>
        {["1BL", "2BL"].map(blKey => {
          const blTeams = fteams.filter(t => t.bl === blKey);
          if (blTeams.length === 0) return null;
          const blTlCount = blTeams.reduce((s, t) => s + tls.filter(tl => tl.team === t.name).length, 0);
          const blExpanded = expandedTeams[`__bl_${blKey}`] === true; // 기본 접힘
          return (
            <div key={blKey} className="card" style={{ marginBottom: 8, padding: 0, overflow: "hidden" }}>
              {/* 공구 헤더 */}
              <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", cursor: "pointer", background: blExpanded ? "#f8f7ff" : "#fff" }}
                onClick={() => setExpandedTeams(prev => ({ ...prev, [`__bl_${blKey}`]: !blExpanded }))}>
                <span className={`pill pill-bl`} style={{ marginRight: 8 }}>{blKey}</span>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{blTeams.length}개 팀 · {blTlCount}대</span>
                <span style={{ fontSize: 12, color: "#aaa" }}>{blExpanded ? "▲" : "▼"}</span>
              </div>
              {/* 팀 목록 */}
              {blExpanded && (
                <div style={{ borderTop: "1px solid #f0f0f0" }}>
                  {blTeams.map(team => {
                    const myTls = tls.filter(t => t.team === team.name);
                    const use = myTls.filter(t => t.todayUse).length;
                    const teamExpanded = expandedTeams[team.name] === true; // 기본 접힘
                    return (
                      <div key={team.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        {/* 팀 헤더 */}
                        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", cursor: "pointer", background: teamExpanded ? "#fafafa" : "#fff" }}
                          onClick={() => setExpandedTeams(prev => ({ ...prev, [team.name]: !teamExpanded }))}>
                          <div className="team-avatar" style={{ width: 28, height: 28, fontSize: 11, marginRight: 8 }}>{team.name.slice(0, 2)}</div>
                          <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{team.name}</span>
                          <span className="pill" style={{ marginRight: 6 }}>보유 {myTls.length}대 · {use}대 사용</span>
                          <span style={{ fontSize: 11, color: "#aaa" }}>{teamExpanded ? "▲" : "▼"}</span>
                        </div>
                        {/* TL 목록 */}
                        {teamExpanded && (
                          <div style={{ padding: "4px 14px 10px", background: "#fafafa" }}>
                            {myTls.length === 0 && <p className="empty-sm">보유 장비 없음</p>}
                            {myTls.map(t => (
                              <div key={t.id} className="tl-row" style={{ padding: "6px 0" }}>
                                <span className={`dot dot-${t.status === "정상" ? "ok" : t.status === "고장" ? "broken" : "check"}`} />
                                <span className="tl-sn">{t.sn}</span>
                                {t.spec && <span className="pill pill-gray" style={{ fontSize: 10, padding: "1px 6px" }}>{t.spec}</span>}
                                <span className="tl-meta">{t.location}</span>
                                {t.todayUse && <span className="pill pill-purple">사용중</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {/* 공구 미배정 팀 */}
        {fteams.filter(t => !t.bl || (t.bl !== "1BL" && t.bl !== "2BL")).map(team => {
          const myTls = tls.filter(t => t.team === team.name);
          const use = myTls.filter(t => t.todayUse).length;
          const expanded = expandedTeams[team.name] === true;
          return (
            <div key={team.id} className="card" style={{ marginBottom: 8 }}>
              <div className="card-header" style={{ cursor: "pointer", marginBottom: expanded ? 8 : 0 }}
                onClick={() => setExpandedTeams(prev => ({ ...prev, [team.name]: !expanded }))}>
                <span className="card-title">{team.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="pill">보유 {myTls.length}대 · {use}대 사용</span>
                  <span style={{ fontSize: 12, color: "#aaa" }}>{expanded ? "▲" : "▼"}</span>
                </div>
              </div>
              {expanded && myTls.map(t => (
                <div key={t.id} className="tl-row">
                  <span className={`dot dot-${t.status === "정상" ? "ok" : t.status === "고장" ? "broken" : "check"}`} />
                  <span className="tl-sn">{t.sn}</span>
                  {t.spec && <span className="pill pill-gray" style={{ fontSize: 10, padding: "1px 6px" }}>{t.spec}</span>}
                  <span className="tl-meta">{t.location}</span>
                  {t.todayUse && <span className="pill pill-purple">사용중</span>}
                </div>
              ))}
            </div>
          );
        })}
      </>
    );
  }

  const popupTls = getPopupTls();
  const isTeamPopup = popup?.type === "1BL팀" || popup?.type === "2BL팀";
  const isApprovalPopup = popup?.type === "결재대기";
  const pendingApprovals = approvals.filter(a => a.status === "대기" && (popup?.bl === "전체" || a.bl === popup?.bl));

  // 관리자는 자기 BL만, 소장은 전체
  const isAdminRole = ["admin", "admin_construction", "admin_safety"].includes(currentUser.role);
  const defaultBl = isAdminRole ? currentUser.bl : "전체";

  return (
    <div>
      <MetricsBlock bl={defaultBl} />

      {/* 팝업 */}
      {popup && !isTeamPopup && !isApprovalPopup && (
        <Popup title={`${popup.type} TL 목록`} count={popupTls.length} onClose={() => setPopup(null)}>
          {[...popupTls].sort((a,b) => (a.sn||"").localeCompare(b.sn||"")).map(t => <TLCard key={t.id} t={t} />)}
        </Popup>
      )}
      {popup && isTeamPopup && (
        <TeamPopup
          title={`${popup.bl} 팀 현황`}
          teams={getBlTeams(popup.bl)}
          tls={tls}
          onClose={() => setPopup(null)}
        />
      )}
      {popup && isApprovalPopup && (
        <div className="modal-bg" onClick={() => setPopup(null)}>
          <div className="modal" style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">결재 대기 목록</div>
            <div className="alert alert-info mb12" style={{ fontSize: 13, padding: "8px 12px" }}>총 {pendingApprovals.length}건</div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {pendingApprovals.length === 0
                ? <div className="empty">대기 중인 결재가 없습니다.</div>
                : pendingApprovals.map(a => {
                    const typeClass = a.type === "반입" ? "type-in" : a.type === "반출" ? "type-out" : "type-move";
                    return (
                      <div key={a.id} className="approval-card">
                        <span className={`approval-type ${typeClass}`}>{a.type}</span>
                        <div className="approval-title">{a.from}{a.to ? ` → ${a.to}` : ""}</div>
                        <div className="approval-reason">{a.reason}</div>
                        <div className="approval-meta">{a.requester} · {a.createdAt?.toDate?.().toLocaleDateString("ko-KR") || "-"}</div>
                      </div>
                    );
                  })}
            </div>
            <button className="btn full" style={{ marginTop: 12 }} onClick={() => setPopup(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 장비 목록 ─────────────────────────────────────────────────────────────
function TLScreen({ tls, teams, currentUser, onAdd, onUpdate, onDelete }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [addForm, setAddForm] = useState({ sn: "", team: "", location: "", floor: "", spec: "10m급", status: "정상", inDate: "", memo: "", bl: "" });
  const [editForm, setEditForm] = useState({});
  const [blFilter, setBlFilter] = useState("1BL");
  const [sortBy, setSortBy] = useState("team");
  const [sortSub, setSortSub] = useState("none"); // none | sn | spec
  const [search, setSearch] = useState("");

  const isManager = ["sojangnm", "admin", "admin_construction", "admin_safety"].includes(currentUser.role);
  const isTeam = currentUser.role === "team";
  const isSojangnm = currentUser.role === "sojangnm";

  const myTls = isTeam
    ? tls.filter(t => t.team === currentUser.team)
    : isSojangnm
      ? (blFilter === "전체" ? [...tls] : tls.filter(t => { const team = teams.find(tm => tm.name === t.team); return (t.bl || team?.bl) === blFilter; }))
      : ["admin", "admin_construction", "admin_safety"].includes(currentUser.role)
        ? tls.filter(t => { const team = teams.find(tm => tm.name === t.team); return (t.bl || team?.bl) === currentUser.bl; })
        : [...tls];

  const [statusFilter, setStatusFilter] = useState("전체");
  const STATUS_FILTERS = ["전체", "정상", "점검", "고장", "사용안함"];

  const filtered = myTls.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !search
      || (t.sn || "").toLowerCase().includes(q)
      || (t.team || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "전체"
      ? true
      : statusFilter === "정상" ? t.status === "정상"
      : statusFilter === "점검" ? t.status === "점검중"
      : statusFilter === "고장" ? t.status === "고장"
      : statusFilter === "사용안함" ? !t.todayUse
      : true;
    return matchSearch && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "team") {
      const teamCmp = (a.team || "").localeCompare(b.team || "");
      if (teamCmp !== 0) return teamCmp;
      if (sortSub === "sn") return (a.sn || "").localeCompare(b.sn || "");
      if (sortSub === "spec") return (a.spec || "").localeCompare(b.spec || "");
      return 0;
    }
    if (sortBy === "sn") return (a.sn || "").localeCompare(b.sn || "");
    if (sortBy === "spec") return (a.spec || "").localeCompare(b.spec || "");
    return 0;
  });

  const okCount = myTls.filter(t => t.status === "정상").length;
  const checkCount = myTls.filter(t => t.status === "점검중").length;
  const brokenCount = myTls.filter(t => t.status === "고장").length;

  function startEdit(t) {
    setEditingId(t.id);
    setEditForm({ sn: t.sn, team: t.team, location: t.location || "", floor: t.floor || "", spec: t.spec || "10m급", status: t.status, inDate: t.inDate || "", memo: t.memo || "", bl: t.bl || "" });
    setShowAddForm(false);
  }

  function normalizeSn(sn) { return (sn || "").replace(/\s/g, "").toUpperCase(); }

  async function handleAdd() {
    if (!addForm.sn) { alert("일련번호를 입력해주세요."); return; }
    if (!addForm.team) { alert("담당 팀을 선택해주세요."); return; }
    // 중복 체크 (공백 제거 + 대소문자 무시)
    const inputNorm = normalizeSn(addForm.sn);
    const duplicate = tls.find(t => normalizeSn(t.sn) === inputNorm);
    if (duplicate) {
      alert(`이미 등록된 일련번호입니다.\n기존 등록: ${duplicate.sn} (${duplicate.team})`);
      return;
    }
    const team = teams.find(t => t.name === addForm.team);
    await onAdd({ ...addForm, bl: team?.bl || "", inDate: addForm.inDate || new Date().toISOString().slice(0, 10) });
    setAddForm({ sn: "", team: "", location: "", floor: "", spec: "10m급", status: "정상", inDate: "", memo: "", bl: "" });
    setShowAddForm(false);
  }

  async function handleEditSave(id) {
    if (isTeam) {
      // 팀장은 층수/위치/상태/메모만 수정 가능
      await onUpdate(id, {
        floor: editForm.floor || "",
        location: editForm.location || "",
        status: editForm.status || "정상",
        memo: editForm.memo || "",
      });
    } else {
      if (!editForm.sn) { alert("일련번호를 입력해주세요."); return; }
      await onUpdate(id, editForm);
    }
    setEditingId(null);
  }

  const availableTeams = ["admin", "admin_construction", "admin_safety"].includes(currentUser.role)
    ? teams.filter(t => t.bl === currentUser.bl)
    : teams;

  return (
    <div>
      {isTeam && (
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric"><div className="metric-val">{myTls.length}</div><div className="metric-label">보유 TL</div></div>
          <div className="metric"><div className="metric-val green">{okCount}</div><div className="metric-label">정상</div></div>
          <div className="metric"><div className="metric-val amber">{checkCount}</div><div className="metric-label">점검중</div></div>
          <div className="metric"><div className="metric-val red">{brokenCount}</div><div className="metric-label">고장</div></div>
        </div>
      )}

      {isManager && <button className="btn btn-primary full mb12" onClick={() => { setShowAddForm(!showAddForm); setEditingId(null); }}>+ 장비 등록</button>}

      {/* 소장: 공구 필터 */}
      {isSojangnm && (
        <div className="sort-bar" style={{ marginBottom: 10 }}>
          <span className="sort-label">공구</span>
          {["1BL", "2BL", "전체"].map(bl => (
            <button key={bl} className={`sort-btn${blFilter === bl ? " active" : ""}`} onClick={() => setBlFilter(bl)}>{bl}</button>
          ))}
        </div>
      )}

      {/* 검색창 */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 일련번호 또는 팀 이름 검색"
        style={{ marginBottom: 8 }}
      />
      {/* 상태 필터 탭 */}
      <div className="sort-bar" style={{ marginBottom: 10 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} className={`sort-btn${statusFilter === f ? " active" : ""}`} onClick={() => setStatusFilter(f)}>{f}</button>
        ))}
      </div>

      {showAddForm && (
        <div className="card mb12">
          <div className="card-title mb8">신규 TL 등록</div>
          <label>일련번호</label>
          <input value={addForm.sn} onChange={e => setAddForm({ ...addForm, sn: e.target.value })} placeholder="예: SN-20250515" />
          <label>담당 팀</label>
          <select value={addForm.team} onChange={e => setAddForm({ ...addForm, team: e.target.value })}>
            <option value="">선택해주세요</option>
            {availableTeams.map(t => <option key={t.id}>{t.name}</option>)}
          </select>
          <label>층수</label>
          <select value={addForm.floor} onChange={e => setAddForm({ ...addForm, floor: e.target.value })}>
            <option value="">선택해주세요</option>
            {TL_FLOORS.map(f => <option key={f}>{f}</option>)}
          </select>
          <label>위치 (세부 구역)</label>
          <input value={addForm.location} onChange={e => setAddForm({ ...addForm, location: e.target.value })} placeholder="예: CMS 서측" />
          <label>규격</label>
          <select value={addForm.spec} onChange={e => setAddForm({ ...addForm, spec: e.target.value })}>
            {TL_SPECS.map(s => <option key={s}>{s}</option>)}
          </select>
          <label>반입일자</label>
          <input type="date" value={addForm.inDate} onChange={e => setAddForm({ ...addForm, inDate: e.target.value })} />
          <label>상태</label>
          <select value={addForm.status} onChange={e => setAddForm({ ...addForm, status: e.target.value })}>
            <option>정상</option><option>점검중</option><option>고장</option>
          </select>
          <label>메모</label>
          <input value={addForm.memo} onChange={e => setAddForm({ ...addForm, memo: e.target.value })} placeholder="비고" />
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>등록</button>
            <button className="btn btn-sm" onClick={() => setShowAddForm(false)}>취소</button>
          </div>
        </div>
      )}

      {isManager && (
        <div className="sort-bar" style={{ marginBottom: 4 }}>
          <span className="sort-label">정렬</span>
          <button className={`sort-btn${sortBy === "team" ? " active" : ""}`}
            onClick={() => { setSortBy("team"); setSortSub("none"); }}>팀별</button>
          <button className={`sort-btn${sortBy === "sn" || (sortBy === "team" && sortSub === "sn") ? " active" : ""}`}
            onClick={() => {
              if (sortBy === "team") { setSortSub(sortSub === "sn" ? "none" : "sn"); }
              else { setSortBy("sn"); setSortSub("none"); }
            }}>일련번호순</button>
          <button className={`sort-btn${sortBy === "spec" || (sortBy === "team" && sortSub === "spec") ? " active" : ""}`}
            onClick={() => {
              if (sortBy === "team") { setSortSub(sortSub === "spec" ? "none" : "spec"); }
              else { setSortBy("spec"); setSortSub("none"); }
            }}>규격순</button>
        </div>
      )}
      {isManager && sortBy === "team" && sortSub !== "none" && (
        <div style={{ fontSize: 11, color: "#534AB7", marginBottom: 8, paddingLeft: 2 }}>
          팀별 + {sortSub === "sn" ? "일련번호순" : "규격순"} 정렬 중
        </div>
      )}

      {sorted.length === 0 && <div className="empty">{search ? "검색 결과가 없습니다." : "등록된 장비가 없습니다."}</div>}
      {sorted.map(t => (
        <div key={t.id} className="card">
          {editingId === t.id ? (
            <div>
              <div className="card-title mb8" style={{ color: "#534AB7" }}>✏ 장비 수정 중</div>
              <label>일련번호</label>
              <input value={editForm.sn} onChange={e => setEditForm({ ...editForm, sn: e.target.value })} />
              <label>담당 팀</label>
              <select value={editForm.team} onChange={e => setEditForm({ ...editForm, team: e.target.value })}>
                {availableTeams.map(t2 => <option key={t2.id}>{t2.name}</option>)}
              </select>
              <label>층수</label>
              <select value={editForm.floor || ""} onChange={e => setEditForm({ ...editForm, floor: e.target.value })}>
                <option value="">선택해주세요</option>
                {TL_FLOORS.map(f => <option key={f}>{f}</option>)}
              </select>
              <label>위치 (세부 구역)</label>
              <input value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
              <label>규격</label>
              <select value={editForm.spec} onChange={e => setEditForm({ ...editForm, spec: e.target.value })}>
                {TL_SPECS.map(s => <option key={s}>{s}</option>)}
              </select>
              <label>반입일자</label>
              <input type="date" value={editForm.inDate} onChange={e => setEditForm({ ...editForm, inDate: e.target.value })} />
              <label>상태</label>
              <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                <option>정상</option><option>점검중</option><option>고장</option>
              </select>
              <label>메모</label>
              <input value={editForm.memo} onChange={e => setEditForm({ ...editForm, memo: e.target.value })} />
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" onClick={() => handleEditSave(t.id)}>저장</button>
                <button className="btn btn-sm" onClick={() => setEditingId(null)}>취소</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="card-header">
                <div>
                  <div className="card-title">
                    {t.sn}
                    {t.spec && <span className="pill pill-gray" style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px" }}>{t.spec}</span>}
                    {t.bl && <span className="pill pill-bl" style={{ marginLeft: 4 }}>{t.bl}</span>}
                  </div>
                  <div className="card-sub">{t.team} · {t.floor ? t.floor + " " : ""}{t.location}</div>
                </div>
                <span className="status-tag">
                  <span className={`dot dot-${t.status === "고장" ? "broken" : t.status === "점검중" ? "check" : !t.todayUse && t.status === "정상" ? "unused" : "ok"}`} />
                  {t.status === "정상" && !t.todayUse ? "미사용" : t.status}
                </span>
              </div>
              <div className="card-meta">반입일: {t.inDate}{t.memo && " · " + t.memo}</div>
              {t.isRented && <div className="alert alert-warn mb8" style={{padding:"6px 10px",fontSize:12}}>🔄 대여중 → {t.rentedTo}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {t.todayUse && <span className="pill pill-green">금일사용</span>}
                {t.todayUse && t.todayPurpose && <span className="pill pill-purple">{t.todayPurpose}</span>}
              </div>
              {isManager && (
                <div className="btn-row">
                  <button className="btn btn-sm" onClick={() => startEdit(t)}>✏ 수정</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm("장비를 삭제하시겠습니까?")) onDelete(t.id); }}>삭제</button>
                </div>
              )}
              {isTeam && (
                <div style={{ marginTop: 8 }}>
                  {editingId === t.id ? (
                    <div>
                      <label>층수</label>
                      <select value={editForm.floor || ""} onChange={e => setEditForm({ ...editForm, floor: e.target.value })}>
                        <option value="">선택해주세요</option>
                        {TL_FLOORS.map(f => <option key={f}>{f}</option>)}
                      </select>
                      <label>위치 (세부 구역)</label>
                      <input value={editForm.location || ""} onChange={e => setEditForm({ ...editForm, location: e.target.value })} placeholder="예: B1F 동측" />
                      <label>상태</label>
                      <select value={editForm.status || "정상"} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                        <option>정상</option><option>점검중</option><option>고장</option>
                      </select>
                      <label>메모</label>
                      <input value={editForm.memo || ""} onChange={e => setEditForm({ ...editForm, memo: e.target.value })} placeholder="비고" />
                      <div className="btn-row">
                        <button className="btn btn-primary btn-sm" onClick={() => handleEditSave(t.id)}>저장</button>
                        <button className="btn btn-sm" onClick={() => setEditingId(null)}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn btn-sm" onClick={() => startEdit(t)}>✏ 수정</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 금일 사용 ─────────────────────────────────────────────────────────────
function TodayScreen({ tls, currentUser, onToggle, onPurpose, onNotUsed, workLogs, teams }) {
  const canEdit = ["team", "admin_safety"].includes(currentUser.role);
  const myTlsRaw = currentUser.role === "team"
    ? tls.filter(t => t.team === currentUser.team)
    : ["admin", "admin_construction", "admin_safety"].includes(currentUser.role)
      ? tls.filter(t => (t.bl || teams?.find(tm => tm.name === t.team)?.bl) === currentUser.bl)
      : tls;
  const myTls = [...myTlsRaw].sort((a,b) => (a.sn||"").localeCompare(b.sn||""));
  const useCount = myTls.filter(t => t.todayUse).length;
  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const todayStr = new Date().toISOString().slice(0, 10);

  // 오늘 작업 로그에서 TL별 총 사용시간 계산
  const todayLogs = workLogs.filter(l => l.date === todayStr);
  function getTlMinutes(tlId) {
    return todayLogs.filter(l => l.tlId === tlId && l.durationMin != null)
      .reduce((s, l) => s + l.durationMin, 0);
  }

  return (
    <div>
      <div className="alert alert-info mb12">
        {today} · <strong>{useCount}대</strong> 사용 중
      </div>
      {myTls.map(t => {
        const mins = getTlMinutes(t.id);
        const maxMins = WORK_HOURS * 60; // 1대 기준 8시간
        const rate = Math.min(Math.round((mins / maxMins) * 100), 100);
        return (
          <div key={t.id} className="card">
            <div className="today-row">
              <button className={`toggle ${t.todayUse ? "on" : ""}`} onClick={() => canEdit && onToggle(t.id, t.todayUse)} style={{ opacity: canEdit ? 1 : 0.5, cursor: canEdit ? "pointer" : "not-allowed" }} />
              <div className="flex1">
                <div className="tl-sn">{t.sn}</div>
                <div className="tl-meta">{t.team} · {t.floor ? t.floor + " " : ""}{t.location}</div>
              </div>
              {t.status !== "정상" && <span className="status-tag"><span className={`dot dot-${t.status === "고장" ? "broken" : "check"}`} />{t.status}</span>}
            </div>
            {t.todayUse ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: "#534AB7", fontWeight: 600, marginBottom: 4 }}>작업 내용</div>
                <input className="purpose-input" placeholder="작업 내용을 입력해주세요"
                  defaultValue={t.todayPurpose} readOnly={!canEdit}
                  style={{ background: canEdit ? "#fff" : "#fafafa" }}
                  onBlur={e => canEdit && onPurpose(t.id, e.target.value)} />
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, marginBottom: 4 }}>미사용 사유</div>
                <input className="purpose-input" placeholder={canEdit ? "미사용 사유를 입력해주세요 (선택)" : "미사용"}
                  style={{ borderColor: "#f0f0f0", background: "#fafafa" }}
                  defaultValue={t.notUsedReason || ""} readOnly={!canEdit}
                  onBlur={e => canEdit && onNotUsed(t.id, e.target.value)} />
              </div>
            )}
            {mins > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "#666" }}>오늘 사용 {Math.floor(mins / 60)}시간 {mins % 60}분</span>
                  <span style={{ fontWeight: 600, color: rate >= 50 ? "#1D9E75" : "#BA7517" }}>{rate}%</span>
                </div>
                <div className="rate-bar-bg">
                  <div className="rate-bar-fill" style={{ width: `${Math.min(rate, 100)}%`, background: rate >= 50 ? "#1D9E75" : "#EF9F27" }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {myTls.length === 0 && <div className="empty">배정된 장비가 없습니다.</div>}
    </div>
  );
}

// ── 결재 ──────────────────────────────────────────────────────────────────
function ApprovalScreen({ approvals, tls, onDecide, currentUser }) {
  // 소장: 전체 / 관리자: 자기 BL만 / 팀장: 없음
  const canDecide = ["sojangnm", "admin", "admin_construction", "admin_safety"].includes(currentUser.role);
  const myApprovals = currentUser.role === "sojangnm"
    ? approvals
    : approvals.filter(a => a.bl === currentUser.bl);
  const pending = myApprovals.filter(a => a.status === "대기");
  const done = myApprovals.filter(a => a.status !== "대기");

  async function handleDecide(id, status, approval) {
    if (status === "반려") {
      if (!window.confirm("정말 반려하시겠습니까?\n반려 후에는 되돌릴 수 없습니다.")) return;
    }
    await onDecide(id, status, approval);
  }

  return (
    <div>
      {["admin", "admin_construction", "admin_safety"].includes(currentUser.role) && (
        <div className="alert alert-info mb12" style={{ fontSize: 12 }}>
          {currentUser.bl} 소속 결재 요청만 표시됩니다.
        </div>
      )}
      <div className="section-title">결재 대기 ({pending.length}건)</div>
      {pending.length === 0 && <div className="empty">대기 중인 결재가 없습니다.</div>}
      {pending.map(a => <ApprovalCard key={a.id} approval={a} showBtn={canDecide} onDecide={handleDecide} tls={tls} />)}
      <div className="section-title">처리 완료</div>
      {done.length === 0 && <div className="empty">처리된 결재가 없습니다.</div>}
      {done.map(a => <ApprovalCard key={a.id} approval={a} showBtn={false} onDecide={handleDecide} tls={tls} />)}
    </div>
  );
}

function ApprovalCard({ approval: a, showBtn, onDecide, tls }) {
  const typeClass = a.type === "반입" ? "type-in" : a.type === "반출" ? "type-out" : "type-move";
  // tlId → 일련번호(sn) 변환
  const tlSn = tls?.find(t => t.id === a.tlId)?.sn || a.tlSn || a.tlId || "-";
  return (
    <div className="approval-card">
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <span className={`approval-type ${typeClass}`}>{a.type}</span>
        {a.bl && <span className="pill pill-bl">{a.bl}</span>}
      </div>
      {a.type === "반입" ? (
        <div className="approval-title">{a.from} 반입 요청 · {a.newSn || "일련번호 미정"}</div>
      ) : (
        <div className="approval-title">{a.from}{a.to ? ` → ${a.to}` : ""} · {tlSn}</div>
      )}
      <div className="approval-reason">{a.reason}</div>
      {a.type === "반입" && (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
          규격: {a.newSpec} · 위치: {a.newLocation} · 반입예정: {a.newInDate}
        </div>
      )}
      <div className="approval-meta">요청: {a.requester} · {a.createdAt?.toDate?.().toLocaleDateString("ko-KR") || "-"}</div>
      {showBtn ? (
        <div className="btn-row">
          <button className="btn btn-success btn-sm" onClick={() => onDecide(a.id, "승인", a)}>✓ 승인</button>
          <button className="btn btn-danger btn-sm" onClick={() => onDecide(a.id, "반려", a)}>✕ 반려</button>
        </div>
      ) : (
        <span className={`pill ${a.status === "승인" ? "pill-green" : "pill-red"}`}>{a.status}</span>
      )}
    </div>
  );
}

// ── 승인 요청 ─────────────────────────────────────────────────────────────
function RequestScreen({ tls, teams, currentUser, onSubmit, onCancel, approvals }) {
  const [type, setType] = useState("이관");
  const [form, setForm] = useState({ tlId: "", to: "", reason: "", newSn: "", newSpec: "10m급", newLocation: "", newInDate: "" });
  const myTls = tls.filter(t => t.team === currentUser.team).sort((a,b) => (a.sn||"").localeCompare(b.sn||""));
  const myApprovals = approvals.filter(a => a.requester === currentUser.id);
  const otherTeams = teams.filter(t => t.name !== currentUser.team && t.bl === currentUser.bl);
  // 현재 대기 중인 결재의 TL ID 목록
  const pendingTlIds = new Set(approvals.filter(a => a.status === "대기" && a.tlId).map(a => a.tlId));

  async function handleSubmit() {
    if (!form.reason) { alert("요청 사유를 입력해주세요."); return; }
    if (type !== "반입" && !form.tlId) { alert("대상 TL을 선택해주세요."); return; }
    if (type !== "반입" && pendingTlIds.has(form.tlId)) {
      alert("이미 결재 진행 중인 TL입니다.\n기존 요청을 철회 후 다시 요청해주세요."); return;
    }
    if (type === "이관" && !form.to) { alert("목적지 팀을 선택해주세요."); return; }
    if (type === "반입" && !form.newSn) { alert("일련번호를 입력해주세요."); return; }
    await onSubmit({ type, from: currentUser.team, bl: currentUser.bl, requester: currentUser.id, ...form });
    setForm({ tlId: "", to: "", reason: "", newSn: "", newSpec: "10m급", newLocation: "", newInDate: "" });
    alert("소장님께 결재 요청이 전달되었습니다.");
  }

  return (
    <div>
      <div className="card mb12">
        <div className="card-title mb8">승인 요청 작성</div>
        <label>요청 유형</label>
        <div className="sort-bar" style={{ marginBottom: 12 }}>
          {["반입", "반출", "이관"].map(t => (
            <button key={t} className={`sort-btn${type === t ? " active" : ""}`}
              onClick={() => { setType(t); setForm({ tlId: "", to: "", reason: "", newSn: "", newSpec: "10m급", newLocation: "", newInDate: "" }); }}>
              {t === "반입" ? "📥 반입" : t === "반출" ? "📤 반출" : "🔄 이관"}
            </button>
          ))}
        </div>

        {/* 반입: 새 장비 정보 입력 */}
        {type === "반입" && (
          <>
            <label>일련번호 (예정)</label>
            <input value={form.newSn} onChange={e => setForm({ ...form, newSn: e.target.value })} placeholder="예: SN-20250601" />
            <label>규격</label>
            <select value={form.newSpec} onChange={e => setForm({ ...form, newSpec: e.target.value })}>
              {TL_SPECS.map(s => <option key={s}>{s}</option>)}
            </select>
            <label>배치 위치</label>
            <input value={form.newLocation} onChange={e => setForm({ ...form, newLocation: e.target.value })} placeholder="예: B2F 서측" />
            <label>반입 예정일</label>
            <input type="date" value={form.newInDate} onChange={e => setForm({ ...form, newInDate: e.target.value })} />
          </>
        )}

        {/* 반출/이동: 기존 TL 선택 */}
        {(type === "반출" || type === "이관") && (
          <>
            <label>대상 TL</label>
            <select value={form.tlId} onChange={e => setForm({ ...form, tlId: e.target.value })}>
              <option value="">선택해주세요</option>
              {myTls.map(t => (
                <option key={t.id} value={t.id} disabled={pendingTlIds.has(t.id)}>
                  {t.sn} ({t.location}){pendingTlIds.has(t.id) ? " — 결재 진행 중" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        {/* 이동: 목적지 팀 선택 */}
        {type === "이관" && (
          <>
            <label>목적지 팀</label>
            <select value={form.to} onChange={e => setForm({ ...form, to: e.target.value })}>
              <option value="">선택해주세요</option>
              {otherTeams.map(t => <option key={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        <label>요청 사유</label>
        <textarea rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
          placeholder="소장님께 전달할 요청 사유를 입력해주세요" />
        <button className="btn btn-primary full" onClick={handleSubmit}>소장 결재 요청 →</button>
      </div>

      <div className="section-title">내 요청 현황</div>
      {myApprovals.length === 0 && <div className="empty">요청 내역이 없습니다.</div>}
      {myApprovals.map(a => {
        const typeClass = a.type === "반입" ? "type-in" : a.type === "반출" ? "type-out" : "type-move";
        const tlSn = tls.find(t => t.id === a.tlId)?.sn || a.tlSn || a.tlId || "-";
        return (
          <div key={a.id} className="approval-card">
            <span className={`approval-type ${typeClass}`}>{a.type}</span>
            <div className="approval-title">{a.type === "반입" ? `신규 반입 · ${a.newSn}` : `${tlSn}${a.to ? " → " + a.to : ""}`}</div>
            <div className="approval-reason">{a.reason}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span className={`pill ${a.status === "승인" ? "pill-green" : a.status === "반려" ? "pill-red" : "pill-amber"}`}>{a.status}</span>
            {a.status === "대기" && (
              <button className="btn btn-danger btn-sm" style={{ fontSize: 11, padding: "2px 10px" }}
                onClick={() => { if (window.confirm("결재 요청을 철회하시겠습니까?")) onCancel(a.id); }}>
                철회
              </button>
            )}
          </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 대여 화면 ─────────────────────────────────────────────────────────────
function RentalScreen({ tls, teams, currentUser, rentals, onRent, onReturn }) {
  const [toTeam, setToTeam] = useState("");
  const [tlId, setTlId] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const myTls = tls.filter(t => t.team === currentUser.team && !t.isRented).sort((a,b) => (a.sn||"").localeCompare(b.sn||""));
  const otherTeams = teams.filter(t => t.name !== currentUser.team && t.bl === currentUser.bl);

  // 내가 빌려준 것 (오늘)
  const lentOut = rentals.filter(r => r.fromTeam === currentUser.team && r.date === today && r.status === "대여중");
  // 내가 빌린 것 (오늘)
  const borrowed = rentals.filter(r => r.toTeam === currentUser.team && r.date === today && r.status === "대여중");
  // 전체 오늘 대여 로그
  const todayLogs = rentals.filter(r => r.date === today);

  async function handleRent() {
    if (!tlId) { alert("대여할 TL을 선택해주세요."); return; }
    if (!toTeam) { alert("대여받을 팀을 선택해주세요."); return; }
    const tl = tls.find(t => t.id === tlId);
    if (!window.confirm(`${tl?.sn}을 ${toTeam}에게 오늘 하루 대여하시겠습니까?
자정이 지나면 자동으로 반환됩니다.`)) return;
    await onRent(currentUser.team, toTeam, tlId, tl?.sn, currentUser.bl);
    setTlId(""); setToTeam("");
    alert("대여가 완료되었습니다.");
  }

  return (
    <div>
      {/* 대여하기 */}
      <div className="card mb12">
        <div className="card-title mb8">🔄 TL 대여하기</div>
        <div className="alert alert-info mb12" style={{ fontSize: 12 }}>
          결재 없이 진행되며, 자정에 자동 반환됩니다. 로그는 자동으로 남습니다.
        </div>
        <label>대여할 TL</label>
        <select value={tlId} onChange={e => setTlId(e.target.value)}>
          <option value="">선택해주세요</option>
          {myTls.map(t => <option key={t.id} value={t.id}>{t.sn} ({t.location})</option>)}
        </select>
        <label>대여받을 팀</label>
        <select value={toTeam} onChange={e => setToTeam(e.target.value)}>
          <option value="">선택해주세요</option>
          {otherTeams.map(t => <option key={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn-primary full" onClick={handleRent}>대여 확정</button>
      </div>

      {/* 내가 빌려준 TL */}
      {lentOut.length > 0 && (
        <>
          <div className="section-title">내가 빌려준 TL ({lentOut.length}건)</div>
          {lentOut.map(r => (
            <div key={r.id} className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{r.tlSn}</div>
                  <div className="card-sub">{r.toTeam}에게 대여중</div>
                </div>
                <span className="pill pill-amber">대여중</span>
              </div>
              <button className="btn btn-sm btn-danger" style={{ marginTop: 8 }}
                onClick={() => { if (window.confirm("조기 반환하시겠습니까?")) onReturn(r.id, r.tlId, r.fromTeam); }}>
                조기 반환
              </button>
            </div>
          ))}
        </>
      )}

      {/* 내가 빌린 TL */}
      {borrowed.length > 0 && (
        <>
          <div className="section-title">내가 빌린 TL ({borrowed.length}건)</div>
          {borrowed.map(r => (
            <div key={r.id} className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{r.tlSn}</div>
                  <div className="card-sub">{r.fromTeam}에서 대여</div>
                </div>
                <span className="pill pill-green">사용가능</span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* 오늘 대여 로그 */}
      <div className="section-title">오늘 대여 로그 ({todayLogs.length}건)</div>
      {todayLogs.length === 0 && <div className="empty">오늘 대여 내역이 없습니다.</div>}
      {todayLogs.map(r => (
        <div key={r.id} className="approval-card">
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <span className="approval-type type-move">대여</span>
            <span className={`pill ${r.status === "대여중" ? "pill-amber" : "pill-green"}`}>{r.status}</span>
          </div>
          <div className="approval-title">{r.fromTeam} → {r.toTeam} · {r.tlSn}</div>
          <div className="approval-meta">{r.date}</div>
        </div>
      ))}
    </div>
  );
}

// ── 가동률 히스토리 ───────────────────────────────────────────────────────
function HistoryScreen({ tls, teams, workLogs, currentUser }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rateMode, setRateMode] = useState("count"); // count | time
  const [blTab, setBlTab] = useState(
    ["admin", "admin_construction", "admin_safety"].includes(currentUser.role)
      ? currentUser.bl
      : "1BL"
  ); // 1BL | 2BL | 전체
  const isDesktop = window.innerWidth >= 1024;

  useEffect(() => { fetchHistory(); }, []);

  async function fetchHistory() {
    setLoading(true);
    const snap = await getDocs(query(collection(db, "history"), orderBy("date", "desc")));
    setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoading(false);
  }

  async function downloadExcel() {
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const XLSX = window.XLSX;
    const activeBl = currentUser.role === "sojangnm" ? blTab : currentUser.bl;

    // 팀 목록 수집 (공구별 가나다순)
    const teamSet = new Map();
    filtered.forEach(h => {
      const data = activeBl === "전체" ? (h.data || []) : (h.data || []).filter(d => d.bl === activeBl);
      data.forEach(d => {
        if (!teamSet.has(d.team)) teamSet.set(d.team, d.bl || "");
      });
    });
    // 공구별 가나다순 정렬
    const teamList = [...teamSet.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return (a[1]||"").localeCompare(b[1]||"");
      return a[0].localeCompare(b[0]);
    });

    if (teamList.length === 0) { alert("출력할 데이터가 없습니다."); return; }

    // 날짜 목록 (오름차순)
    const dates = [...new Set(filtered.map(h => h.date))].sort();

    // 행 생성: 팀별로 날짜 순서대로
    const rows = [];
    const teamBoundaries = []; // 팀별 시작/끝 행 인덱스 (헤더 행 제외, 0-based)

    teamList.forEach(([team, bl]) => {
      const startRow = rows.length;
      dates.forEach(date => {
        const h = filtered.find(hh => hh.date === date);
        const d = (h?.data || []).find(dd => dd.team === team);
        const total = d?.total || 0;
        const used = d?.used || 0;
        const totalMin = d?.totalMin || 0;
        const avgMin = total > 0 ? Math.round(totalMin / total) : 0;
        const avgH = Math.floor(avgMin / 60);
        const avgM = avgMin % 60;
        const countRate = total > 0 ? Math.round((used / total) * 100) : 0;
        rows.push({
          "날짜": date,
          "공구": bl,
          "팀": team,
          "전체 TL(대)": total,
          "사용 TL(대)": used,
          "대수 가동률(%)": countRate,
          "TL당 평균 사용시간": avgMin > 0 ? `${avgH}h ${avgM > 0 ? avgM+"m" : ""}`.trim() : "0h",
          "시간 가동률(%)": d?.rateTime || 0,
        });
      });
      teamBoundaries.push({ team, startRow, endRow: rows.length - 1 });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 13 }, { wch: 6 }, { wch: 16 }, { wch: 12 },
      { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
    ];

    // 팀별 굵은 테두리 적용
    const borderThin = { style: "thin", color: { rgb: "CCCCCC" } };
    const borderThick = { style: "medium", color: { rgb: "222222" } };
    const cols = ["A","B","C","D","E","F","G","H"];

    teamBoundaries.forEach(({ startRow, endRow }) => {
      for (let r = startRow; r <= endRow; r++) {
        const xlRow = r + 2; // 헤더 1행 + 1-based
        cols.forEach((col, ci) => {
          const cellRef = `${col}${xlRow}`;
          if (!ws[cellRef]) ws[cellRef] = { t: "s", v: "" };
          const isTop = r === startRow;
          const isBot = r === endRow;
          const isLeft = ci === 0;
          const isRight = ci === cols.length - 1;
          ws[cellRef].s = {
            border: {
              top: isTop ? borderThick : borderThin,
              bottom: isBot ? borderThick : borderThin,
              left: isLeft ? borderThick : borderThin,
              right: isRight ? borderThick : borderThin,
            }
          };
        });
      }
    });

    const wb = XLSX.utils.book_new();
    const sheetName = `가동률_${activeBl}_${dateFrom||"전체"}${dateTo ? "~"+dateTo : ""}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, `TL가동률_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function saveToday() {
    if (!window.confirm("오늘 현황을 기록하시겠습니까?")) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const myTeams = currentUser.role === "sojangnm" ? teams : teams.filter(t => t.bl === currentUser.bl);
    const snapshot = myTeams.map(team => {
      const teamTls = tls.filter(t => t.team === team.name);
      const todayLogs = workLogs.filter(l => l.date === today && teamTls.some(t => t.id === l.tlId) && l.durationMin != null);
      const totalMin = todayLogs.reduce((s, l) => s + l.durationMin, 0);
      // 가동률 = 오늘 실제 사용 시간 / (기준 작업시간 * 보유 TL 대수) * 100
      // 예: TL 3대, 기준 8시간 → 최대 24시간. 실제 6시간 사용 → 25%
      const maxMin = WORK_HOURS * 60 * (teamTls.length || 1);
      return {
        team: team.name,
        bl: team.bl || "",
        total: teamTls.length,
        used: teamTls.filter(t => t.todayUse).length,
        totalMin,
        rateTime: Math.min(Math.round((totalMin / maxMin) * 100), 100),
      };
    });
    await setDoc(doc(db, "history", today), { date: today, data: snapshot, savedAt: serverTimestamp() });
    await fetchHistory();
    setSaving(false);
    alert("오늘 현황이 저장되었습니다.");
  }

  const filtered = history.filter(h => {
    if (dateFrom && h.date < dateFrom) return false;
    if (dateTo && h.date > dateTo) return false;
    return true;
  });

  // 공구 탭에 따라 data 필터링 (관리자는 항상 자기 BL만)
  function filterData(data) {
    if (!data) return [];
    const activeBl = currentUser.role === "sojangnm" ? blTab : currentUser.bl;
    if (activeBl === "전체") return data;
    return data.filter(d => d.bl === activeBl);
  }

  if (loading) return <div className="empty">불러오는 중...</div>;

  return (
    <div>
      <button className="btn btn-primary full mb12" onClick={saveToday} disabled={saving}>
        {saving ? "저장 중..." : "📋 오늘 현황 기록 저장"}
      </button>
      {isDesktop && (
        <button className="btn full mb12" style={{ background: "#1D9E75", color: "#fff" }} onClick={downloadExcel}>
          📥 엑셀 다운로드
        </button>
      )}

      {/* 공구 탭 - 소장만 전체/1BL/2BL 선택 가능, 관리자는 자기 BL만 */}
      {currentUser.role === "sojangnm" ? (
        <div className="sort-bar" style={{ marginBottom: 10 }}>
          <span className="sort-label">공구</span>
          {["1BL", "2BL", "전체"].map(bl => (
            <button key={bl} className={`sort-btn${blTab === bl ? " active" : ""}`} onClick={() => setBlTab(bl)}>{bl}</button>
          ))}
        </div>
      ) : (
        <div className="alert alert-info mb10" style={{ fontSize: 12 }}>
          {currentUser.bl} 가동률만 표시됩니다.
        </div>
      )}

      {/* 기준 선택 탭 */}
      <div className="sort-bar" style={{ marginBottom: 12 }}>
        <span className="sort-label">기준</span>
        <button className={`sort-btn${rateMode === "count" ? " active" : ""}`} onClick={() => setRateMode("count")}>📦 대수</button>
        <button className={`sort-btn${rateMode === "time" ? " active" : ""}`} onClick={() => setRateMode("time")}>⏱ 시간</button>
      </div>

      {/* 날짜 필터 */}
      <div className="card mb12">
        <div className="card-title mb8" style={{ fontSize: 13 }}>📅 날짜 필터</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ margin: 0, flex: 1 }} />
          <span style={{ fontSize: 13, color: "#999" }}>~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ margin: 0, flex: 1 }} />
          {(dateFrom || dateTo) && <button className="btn btn-sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>초기화</button>}
        </div>
      </div>

      <div className="section-title">
        {currentUser.role === "sojangnm" ? blTab : currentUser.bl} 일별 TL 가동률 ({filtered.length}건) · {rateMode === "count" ? "대수 기준" : "시간 기준"}
      </div>
      {filtered.length === 0 && <div className="empty">해당 기간의 기록이 없습니다.</div>}

      {filtered.map(h => {
        const visibleData = filterData(h.data);
        if (visibleData.length === 0) return null;
        const totalAll = visibleData.reduce((s, d) => s + (d.total || 0), 0);
        const usedAll = visibleData.reduce((s, d) => s + (d.used || 0), 0);
        const totalMinAll = visibleData.reduce((s, d) => s + (d.totalMin || 0), 0);
        const rateCount = totalAll > 0 ? Math.round((usedAll / totalAll) * 100) : 0;
        const rateTime = visibleData.length > 0 ? Math.round(visibleData.reduce((s, d) => s + (d.rateTime || 0), 0) / visibleData.length) : 0;
        const displayRate = rateMode === "count" ? rateCount : rateTime;
        const rateColor = displayRate >= 70 ? "#1D9E75" : displayRate >= 40 ? "#BA7517" : "#E24B4A";
        return (
          <div key={h.id} className="card">
            <div className="card-header">
              <div className="card-title">{h.date}</div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rateColor }}>{displayRate}%</div>
                <div style={{ fontSize: 11, color: "#aaa" }}>{rateMode === "count" ? "대수 기준" : "시간 기준"}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
              전체 {totalAll}대 · 사용 {usedAll}대 · 총 {Math.floor(totalMinAll / 60)}시간 {totalMinAll % 60}분
            </div>
            {visibleData.map((d, i) => {
              const r = rateMode === "count"
                ? (d.total > 0 ? Math.round((d.used / d.total) * 100) : 0)
                : (d.rateTime || 0);
              const rc = r >= 70 ? "#1D9E75" : r >= 40 ? "#EF9F27" : "#E24B4A";
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{d.team}
                      {currentUser.role === "sojangnm" && blTab === "전체" && d.bl && <span style={{ color: "#aaa", fontSize: 11 }}> ({d.bl})</span>}
                    </span>
                    <span style={{ color: "#666" }}>
                      {rateMode === "count"
                        ? `${d.used}/${d.total}대 · ${r}%`
                        : `${Math.floor((d.totalMin||0)/60)}h ${(d.totalMin||0)%60}m · ${r}%`}
                    </span>
                  </div>
                  <div className="rate-bar-bg">
                    <div className="rate-bar-fill" style={{ width: `${Math.min(r, 100)}%`, background: rc }} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── 유도원 작업 기록 (QR 스캔, 최대 2대 동시) ───────────────────────────
function GuideScreen({ currentUser, tls, workLogs, onStart, onEnd }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const MAX_SLOTS = 2;

  // localStorage 키 (슬롯별)
  const slotKey  = (i) => `guide_start_${currentUser.id}_${i}`;
  const logKey   = (i) => `guide_logid_${currentUser.id}_${i}`;
  const snKey    = (i) => `guide_tlsn_${currentUser.id}_${i}`;
  const tlIdKey  = (i) => `guide_tlid_${currentUser.id}_${i}`;

  // 슬롯 상태 (2개)
  const [slots, setSlots] = useState(() =>
    Array.from({ length: MAX_SLOTS }, (_, i) => ({
      active: !!localStorage.getItem(slotKey(i)),
      startTime: localStorage.getItem(slotKey(i)) ? new Date(localStorage.getItem(slotKey(i))) : null,
      logId: localStorage.getItem(logKey(i)) || null,
      tlSn: localStorage.getItem(snKey(i)) || "",
      tlId: localStorage.getItem(tlIdKey(i)) || null,
    }))
  );
  const [elapsed, setElapsed] = useState([0, 0]);
  const timerRef = useRef(null);

  // QR 스캔 상태
  const [scanSlot, setScanSlot] = useState(null); // null | 0 | 1
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  // 체크리스트 모달
  const [checkModal, setCheckModal] = useState(null);
  // { type: "start"|"end", slotIdx, tlSn, tlId, tl, checks: [bool,bool,bool] }

  const START_CHECKS = [
    "작업 구역을 설정했습니까?",
    "적재 하중을 준수했습니까?",
    "작업 용도에 맞는 보호구를 착용했습니까?",
  ];
  const END_CHECKS = [
    "키를 제거했습니까?",
    "고임목을 설치했습니까?",
    "주차 구역을 설정했습니까?",
  ];
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);

  // 날짜 조회
  const [viewDate, setViewDate] = useState(todayStr);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // 타이머 + 8시간 자동 종료
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const now = new Date();
      const newElapsed = slots.map(s =>
        s.active && s.startTime ? Math.max(0, Math.floor((now - s.startTime) / 1000)) : 0
      );
      setElapsed(newElapsed);
      // 8시간(28800초) 초과 시 자동 종료
      slots.forEach((s, i) => {
        if (s.active && s.startTime && (now - s.startTime) >= WORK_HOURS * 3600 * 1000) {
          const durationMin = WORK_HOURS * 60;
          const logId = s.logId;
          localStorage.removeItem(slotKey(i));
          localStorage.removeItem(logKey(i));
          localStorage.removeItem(snKey(i));
          localStorage.removeItem(tlIdKey(i));
          setSlots(prev => prev.map((ss, ii) => ii === i
            ? { active: false, startTime: null, logId: null, tlSn: "", tlId: null }
            : ss
          ));
          if (logId) onEnd(logId, s.startTime.toISOString(), durationMin);
          alert(`${s.tlSn} 작업이 8시간 경과로 자동 종료되었습니다.`);
        }
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [slots]);

  function fmt(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function fmtTime(val) {
    if (!val) return "-";
    const d = typeof val === "string" ? new Date(val) : val?.toDate?.() || new Date(val);
    return isNaN(d) ? "-" : d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDate(dateStr) {
    if (!dateStr) return "";
    return new Date(dateStr + "T00:00:00").toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  }

  // QR 카메라 시작
  async function startScan(slotIdx) {
    setScanSlot(slotIdx);
    setScanning(true);
    setScanError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          scanFrame(slotIdx);
        }
      }, 200);
    } catch(e) {
      setScanError("카메라 접근 권한이 필요합니다.");
      setScanning(false);
    }
  }

  // QR 프레임 분석
  function scanFrame(slotIdx) {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      animRef.current = requestAnimationFrame(() => scanFrame(slotIdx));
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // jsQR 동적 로드
    if (!window.jsQR) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      s.onload = () => scanFrame(slotIdx);
      document.head.appendChild(s);
      return;
    }
    const code = window.jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      handleQRResult(code.data, slotIdx);
    } else {
      animRef.current = requestAnimationFrame(() => scanFrame(slotIdx));
    }
  }

  function stopScan() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setScanning(false);
    setScanSlot(null);
  }

  // QR 인식 결과 처리
  async function handleQRResult(data, slotIdx) {
    stopScan();
    // QR 형식: "TL:G06093"
    if (!data.startsWith("TL:")) {
      alert("유효하지 않은 QR코드입니다.\n테이블리프트 QR코드를 스캔해 주세요.");
      return;
    }
    const sn = data.replace("TL:", "").trim();
    // 일련번호로 TL 찾기 (공구 내 전체)
    const tl = tls.find(t => t.sn.replace(/\s/g,"").toUpperCase() === sn.replace(/\s/g,"").toUpperCase()
                           && (t.bl || "") === (currentUser.bl || ""));
    if (!tl) {
      alert(`TL을 찾을 수 없습니다: ${sn}\n소속 공구(${currentUser.bl})의 TL인지 확인해 주세요.`);
      return;
    }
    // 이미 같은 TL 작업 중인지 확인
    const already = slots.some(s => s.active && s.tlId === tl.id);
    if (already) { alert(`${sn}은 이미 작업 중입니다.`); return; }

    // 체크리스트 모달 열기
    setCheckModal({
      type: "start",
      slotIdx,
      tlSn: sn,
      tlId: tl.id,
      tl,
      checks: [false, false, false],
    });
  }

  // 작업 종료
  async function handleEnd(slotIdx) {
    const slot = slots[slotIdx];
    if (!slot.active || !slot.startTime) return;
    // 체크리스트 모달 열기
    setCheckModal({
      type: "end",
      slotIdx,
      tlSn: slot.tlSn,
      tlId: slot.tlId,
      checks: [false, false, false],
    });
  }

  async function confirmEnd(slotIdx) {
    const slot = slots[slotIdx];
    const now = new Date();
    const durationMin = Math.round((now - slot.startTime) / 60000);
    const logId = slot.logId || workLogs.find(l => l.driverId === currentUser.id && l.tlId === slot.tlId && l.endedAt === null)?.id;
    localStorage.removeItem(slotKey(slotIdx));
    localStorage.removeItem(logKey(slotIdx));
    localStorage.removeItem(snKey(slotIdx));
    localStorage.removeItem(tlIdKey(slotIdx));
    setSlots(prev => prev.map((s, i) => i === slotIdx
      ? { active: false, startTime: null, logId: null, tlSn: "", tlId: null }
      : s
    ));
    if (logId) await onEnd(logId, slot.startTime.toISOString(), durationMin);
  }

  async function confirmStart(slotIdx, tl, sn) {
    const now = new Date();
    const nowISO = now.toISOString();
    const logId = await onStart(currentUser, tl.id, nowISO);
    localStorage.setItem(slotKey(slotIdx), nowISO);
    localStorage.setItem(snKey(slotIdx), sn);
    localStorage.setItem(tlIdKey(slotIdx), tl.id);
    if (logId) localStorage.setItem(logKey(slotIdx), logId);
    setSlots(prev => prev.map((s, i) => i === slotIdx
      ? { active: true, startTime: now, logId: logId || null, tlSn: sn, tlId: tl.id }
      : s
    ));
  }

  const activeCount = slots.filter(s => s.active).length;
  const myTodayLogs = workLogs.filter(l => l.driverId === currentUser.id && l.date === todayStr && l.durationMin != null);
  const myViewLogs = workLogs.filter(l => l.driverId === currentUser.id && l.date === viewDate);
  const todayMin = myTodayLogs.reduce((s, l) => s + (l.durationMin || 0), 0);
  const todayRate = Math.min(Math.round((todayMin / (WORK_HOURS * 60)) * 100), 100);
  const allDates = [...new Set(workLogs.filter(l => l.driverId === currentUser.id).map(l => l.date))].sort((a,b) => b.localeCompare(a));

  return (
    <div>
      {/* QR 스캔 모달 */}
      {scanning && (
        <div className="modal-bg">
          <div className="modal" style={{ padding: 0, overflow: "hidden", maxWidth: 360 }}>
            <div style={{ padding: "14px 16px", fontWeight: 600, fontSize: 15, borderBottom: "1px solid #f0f0f0" }}>
              📷 QR코드 스캔
            </div>
            <video ref={videoRef} style={{ width: "100%", display: "block" }} playsInline muted />
            {scanError && <div className="alert alert-warn" style={{ margin: 12 }}>{scanError}</div>}
            <div style={{ padding: 12 }}>
              <button className="btn full" onClick={stopScan}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 체크리스트 모달 */}
      {checkModal && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: 380 }}>
            <div className="modal-title" style={{ fontSize: 15 }}>
              {checkModal.type === "start"
                ? `✅ 작업 시작 전 확인 — ${checkModal.tl?.sn}`
                : `✅ 작업 종료 전 확인 — ${checkModal.tlSn}`}
            </div>
            <div className="alert alert-info mb12" style={{ fontSize: 12 }}>
              {checkModal.type === "start" ? "작업 시작 전" : "작업 종료 전"} 아래 항목을 모두 확인해주세요.
            </div>
            {(checkModal.type === "start" ? START_CHECKS : END_CHECKS).map((item, i) => (
              <div key={i}
                onClick={() => setCheckModal(prev => ({
                  ...prev,
                  checks: prev.checks.map((c, ci) => ci === i ? !c : c)
                }))}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 4px",
                  borderBottom: i < 2 ? "1px solid #f0f0f0" : "none",
                  cursor: "pointer",
                }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  border: checkModal.checks[i] ? "none" : "2px solid #ccc",
                  background: checkModal.checks[i] ? "#1D9E75" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  {checkModal.checks[i] && <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: checkModal.checks[i] ? "#1D9E75" : "#333" }}>
                  {item}
                </span>
              </div>
            ))}
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button
                className="btn btn-primary flex1"
                disabled={!checkModal.checks.every(c => c)}
                style={{ opacity: checkModal.checks.every(c => c) ? 1 : 0.4 }}
                onClick={() => {
                  if (checkModal.type === "start") confirmStart(checkModal.tl, checkModal.slotIdx);
                  else confirmEnd(checkModal.slotIdx);
                }}>
                {checkModal.type === "start" ? "▶ 작업 시작" : "⏹ 작업 종료"}
              </button>
              <button className="btn flex1" onClick={() => setCheckModal(null)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 체크리스트 모달 */}
      {checkModal && (
        <div className="modal-bg">
          <div className="modal" style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="modal-title" style={{ color: checkModal.type === "start" ? "#534AB7" : "#E24B4A" }}>
              {checkModal.type === "start" ? "✅ 작업 시작 전 확인" : "✅ 작업 종료 전 확인"}
            </div>
            <div className="alert alert-info mb12" style={{ fontSize: 13 }}>
              {checkModal.tlSn} · 모든 항목을 확인해야 {checkModal.type === "start" ? "작업을 시작" : "작업을 종료"}할 수 있습니다.
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(checkModal.type === "start" ? START_CHECKS : END_CHECKS).map((item, i) => (
                <div key={i}
                  onClick={() => setCheckModal(prev => ({
                    ...prev,
                    checks: prev.checks.map((c, ci) => ci === i ? !c : c)
                  }))}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 4px",
                    borderBottom: i < 2 ? "1px solid #f0f0f0" : "none",
                    cursor: "pointer",
                  }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 6, border: "2px solid",
                    borderColor: checkModal.checks[i] ? "#1D9E75" : "#ccc",
                    background: checkModal.checks[i] ? "#1D9E75" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, transition: "all 0.15s",
                  }}>
                    {checkModal.checks[i] && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, color: checkModal.checks[i] ? "#1D9E75" : "#333" }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button className="btn flex1" onClick={() => setCheckModal(null)}>취소</button>
              <button
                className="btn btn-primary flex1"
                disabled={!checkModal.checks.every(Boolean)}
                style={{ opacity: checkModal.checks.every(Boolean) ? 1 : 0.4 }}
                onClick={async () => {
                  const modal = checkModal;
                  setCheckModal(null);
                  if (modal.type === "start") {
                    await confirmStart(modal.slotIdx, modal.tl, modal.tlSn);
                  } else {
                    await confirmEnd(modal.slotIdx);
                  }
                }}>
                {checkModal.type === "start" ? "▶ 작업 시작" : "⏹ 작업 종료"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 유도원 정보 */}
      <div className="card" style={{ marginBottom: 12, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, color: "#999" }}>{currentUser.label}</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {currentUser.bl} · {currentUser.teamName || "팀 미배정"}
        </div>
        <div style={{ fontSize: 12, color: activeCount >= MAX_SLOTS ? "#E24B4A" : "#1D9E75", marginTop: 4 }}>
          {activeCount >= MAX_SLOTS ? "⚠ 최대 2대 작업 중 (추가 불가)" : `작업 슬롯 ${activeCount}/${MAX_SLOTS} 사용 중`}
        </div>
      </div>

      {/* 슬롯 1, 2 */}
      {slots.map((slot, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>슬롯 {i + 1}</div>
          {slot.active ? (
            <>
              <div style={{ fontSize: 13, color: "#534AB7", fontWeight: 600, marginBottom: 4 }}>작업 중 — {slot.tlSn}</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#534AB7", letterSpacing: 2, marginBottom: 12, textAlign: "center" }}>
                {fmt(elapsed[i])}
              </div>
              <button className="btn btn-danger full" onClick={() => handleEnd(i)}>⏹ {slot.tlSn} 작업 종료</button>
            </>
          ) : (
            <button
              className="btn btn-primary full"
              disabled={activeCount >= MAX_SLOTS}
              onClick={() => startScan(i)}
              style={{ opacity: activeCount >= MAX_SLOTS ? 0.5 : 1 }}>
              📷 QR 스캔으로 작업 시작
            </button>
          )}
        </div>
      ))}

      {/* 오늘 누적 */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title mb8">오늘 작업 현황 <span style={{ fontSize: 12, color: "#aaa", fontWeight: 400 }}>({fmtDate(todayStr)})</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
          <span>총 {Math.floor(todayMin / 60)}시간 {todayMin % 60}분 / 기준 {WORK_HOURS}시간</span>
          <span style={{ fontWeight: 600, color: todayRate >= 50 ? "#1D9E75" : "#BA7517" }}>{todayRate}%</span>
        </div>
        <div className="rate-bar-bg" style={{ height: 10 }}>
          <div className="rate-bar-fill" style={{ width: `${todayRate}%`, background: todayRate >= 50 ? "#1D9E75" : "#EF9F27" }} />
        </div>
      </div>

      {/* 작업 이력 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          작업 이력 — {viewDate === todayStr ? "오늘" : fmtDate(viewDate)}
        </div>
        <button className="btn btn-sm" onClick={() => setShowDatePicker(!showDatePicker)}>
          {showDatePicker ? "닫기" : "날짜 조회"}
        </button>
      </div>
      {showDatePicker && (
        <div className="card mb12">
          <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>조회할 날짜 선택</div>
          {allDates.length === 0 && <div className="empty-sm">기록된 날짜가 없습니다.</div>}
          {allDates.map(d => (
            <button key={d} className={`sort-btn${viewDate === d ? " active" : ""}`}
              style={{ margin: "3px" }}
              onClick={() => { setViewDate(d); setShowDatePicker(false); }}>
              {d === todayStr ? `오늘 (${d})` : d}
            </button>
          ))}
        </div>
      )}
      {myViewLogs.length === 0 && <div className="empty">해당 날짜의 작업 기록이 없습니다.</div>}
      {myViewLogs.map((l, i) => (
        <div key={l.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>#{i + 1} {l.tlSn}</span>
            {l.durationMin != null
              ? <span className="pill pill-green">{Math.floor(l.durationMin / 60)}시간 {l.durationMin % 60}분</span>
              : <span className="pill pill-amber">진행중</span>}
          </div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
            {l.date} · 시작: {fmtTime(l.startedAt)}
            {l.endedAt ? ` · 종료: ${fmtTime(l.endedAt)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 팀 관리 ──────────────────────────────────────────────────────────────
function TeamsScreen({ teams, tls, accounts, onAdd, onEdit, onDelete, onChangePw, onAddDriver, onDeleteAccount }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: "", leader: "", pw: "", bl: "1BL" });
  const [pwModal, setPwModal] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [driverModal, setDriverModal] = useState(false);
  const [driverForm, setDriverForm] = useState({ name: "", pw: "", bl: "1BL", teamName: "" });
  const [adminModal, setAdminModal] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: "", pw: "", bl: "1BL" });
  const [err, setErr] = useState("");

  const systemAccounts = accounts.filter(a => a.role === "sojangnm");
  const adminAccounts = accounts.filter(a => a.role === "admin");
  const driverAccounts = accounts.filter(a => a.role === "guide" || a.role === "driver");

  async function handleAdd() {
    const error = await onAdd(form.name, form.leader, form.pw, form.bl);
    if (error) { setErr(error); return; }
    setModal(null); setForm({ name: "", leader: "", pw: "", bl: "1BL" }); setErr("");
  }

  async function handleEdit() {
    const error = await onEdit(modal.team.id, form.name, form.leader, form.pw, form.bl);
    if (error) { setErr(error); return; }
    setModal(null); setForm({ name: "", leader: "", pw: "", bl: "1BL" }); setErr("");
  }

  async function handleDelete(team) {
    const tlCount = tls.filter(t => t.team === team.name).length;
    if (!window.confirm(`${team.name}을 삭제하시겠습니까?${tlCount > 0 ? `\nTL ${tlCount}대가 미배정됩니다.` : ""}`)) return;
    await onDelete(team.id);
  }

  async function handleChangePw() {
    if (!newPw) { alert("새 비밀번호를 입력해주세요."); return; }
    await onChangePw(pwModal.id, newPw);
    setPwModal(null); setNewPw("");
    alert("비밀번호가 변경되었습니다.");
  }

  async function handleAddDriver() {
    const error = await onAddDriver(driverForm.name, driverForm.pw, driverForm.bl, driverForm.teamName);
    if (error) { setErr(error); return; }
    setDriverModal(false); setDriverForm({ name: "", pw: "", bl: "1BL", teamName: "" }); setErr("");
  }

  async function handleAddAdmin() {
    if (!adminForm.name || !adminForm.pw) { setErr("이름과 비밀번호를 입력해주세요."); return; }
    if (accounts.find(a => a.id === adminForm.name)) { setErr("이미 존재하는 계정 이름입니다."); return; }
    await setDoc(doc(db, "accounts", adminForm.name), {
      pw: adminForm.pw, role: "admin", label: adminForm.name, bl: adminForm.bl
    });
    setAdminModal(false); setAdminForm({ name: "", pw: "", bl: "1BL" }); setErr("");
  }

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>시스템 계정</div>
      <div className="card mb12">
        {systemAccounts.map(a => (
          <div key={a.id} className="team-row">
            <div className="team-avatar sys">{a.id[0]}</div>
            <div className="flex1"><div className="tl-sn">{a.label || a.id}</div><div className="tl-meta">소장 계정</div></div>
            <button className="btn btn-sm" onClick={() => { setPwModal(a); setNewPw(""); }}>비번변경</button>
          </div>
        ))}
        <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 8, paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>관리자 계정 (고정)</div>
          {accounts.filter(a => ["admin_construction", "admin_safety"].includes(a.role)).map(a => (
            <div key={a.id} className="team-row">
              <div className="team-avatar" style={{ background: a.role === "admin_safety" ? "#E1F5EE" : "#E6F1FB", color: a.role === "admin_safety" ? "#085041" : "#0C447C" }}>
                {a.role === "admin_safety" ? "🛡" : "🔧"}
              </div>
              <div className="flex1">
                <div className="tl-sn">{a.label || a.id}</div>
                <div className="tl-meta">{a.bl} · {a.role === "admin_safety" ? "안전관리자" : "공사관리자"}</div>
              </div>
              <button className="btn btn-sm" onClick={() => { setPwModal(a); setNewPw(""); }}>비번변경</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className="btn btn-primary flex1" onClick={() => { setModal({ type: "add" }); setForm({ name: "", leader: "", pw: "", bl: "1BL" }); setErr(""); }}>+ 팀 추가</button>

        <button className="btn flex1" onClick={() => { setDriverModal(true); setDriverForm({ name: "", pw: "", bl: "1BL", teamName: "" }); setErr(""); }}>+ 유도원 추가</button>
      </div>

      {BLS.map(bl => (
        <div key={bl}>
          <div className="section-title">{bl} 팀 목록</div>
          <div className="card mb12">
            {teams.filter(t => t.bl === bl).length === 0 && <div className="empty-sm">등록된 팀 없음</div>}
            {teams.filter(t => t.bl === bl).map((t, i, arr) => {
              const tlCount = tls.filter(x => x.team === t.name).length;
              return (
                <div key={t.id} className={`team-row${i < arr.length - 1 ? " border-b" : ""}`}>
                  <div className="team-avatar">{t.name.slice(0, 2)}</div>
                  <div className="flex1">
                    <div className="tl-sn">{t.name}</div>
                    <div className="tl-meta">팀장: {t.leader || "-"} · TL {tlCount}대</div>
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => { setModal({ type: "edit", team: t }); setForm({ name: t.name, leader: t.leader || "", pw: "", bl: t.bl || bl }); setErr(""); }}>수정</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t)}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 운전원 목록 */}
      <div className="section-title">TL 유도원</div>
      <div className="card mb12">
        {driverAccounts.length === 0 && <div className="empty-sm">등록된 유도원 없음</div>}
        {driverAccounts.map((a, i) => {
          return (
            <div key={a.id} className={`team-row${i < driverAccounts.length - 1 ? " border-b" : ""}`}>
              <div className="team-avatar" style={{ background: "#FFF3E0", color: "#E65100" }}>🚧</div>
              <div className="flex1">
                <div className="tl-sn">{a.label || a.id}</div>
                <div className="tl-meta">{a.bl} · {a.teamName || "팀 미배정"}</div>
              </div>
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => { setPwModal(a); setNewPw(""); }}>비번변경</button>
                <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm(`${a.id} 계정을 삭제하시겠습니까?`)) onDeleteAccount(a.id); }}>삭제</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="alert alert-warn">⚠ 팀 삭제 시 해당 팀의 TL은 미배정 처리됩니다.</div>

      {/* 팀 추가/수정 모달 */}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{modal.type === "add" ? "새 팀 추가" : "팀 정보 수정"}</div>
            {err && <div className="alert alert-warn mb8">{err}</div>}
            <label>소속 공구</label>
            <select value={form.bl} onChange={e => setForm({ ...form, bl: e.target.value })}>
              <option>1BL</option><option>2BL</option>
            </select>
            <label>팀 이름</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: A팀" />
            <label>팀장 이름</label>
            <input value={form.leader} onChange={e => setForm({ ...form, leader: e.target.value })} placeholder="예: 김철수" />
            <label>{modal.type === "add" ? "비밀번호" : "비밀번호 변경 (비워두면 유지)"}</label>
            <input type="password" value={form.pw} onChange={e => setForm({ ...form, pw: e.target.value })} placeholder="비밀번호 입력" />
            <div className="btn-row mt8">
              <button className="btn btn-primary flex1" onClick={modal.type === "add" ? handleAdd : handleEdit}>{modal.type === "add" ? "추가" : "저장"}</button>
              <button className="btn flex1" onClick={() => { setModal(null); setErr(""); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 운전원 추가 모달 */}
      {driverModal && (
        <div className="modal-bg" onClick={() => setDriverModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">🦺 TL 유도원 추가</div>
            {err && <div className="alert alert-warn mb8">{err}</div>}
            <label>소속 공구</label>
            <select value={driverForm.bl} onChange={e => setDriverForm({ ...driverForm, bl: e.target.value })}>
              <option>1BL</option><option>2BL</option>
            </select>
            <label>유도원 이름 (계정 ID)</label>
            <input value={driverForm.name} onChange={e => setDriverForm({ ...driverForm, name: e.target.value })} placeholder="예: 홍길동" />
            <label>비밀번호</label>
            <input type="password" value={driverForm.pw} onChange={e => setDriverForm({ ...driverForm, pw: e.target.value })} placeholder="비밀번호 입력" />
            <label>소속 팀</label>
            <select value={driverForm.teamName} onChange={e => setDriverForm({ ...driverForm, teamName: e.target.value })}>
              <option value="">선택해주세요</option>
              {teams.filter(t => t.bl === driverForm.bl).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <div className="btn-row mt8">
              <button className="btn btn-primary flex1" onClick={handleAddDriver}>추가</button>
              <button className="btn flex1" onClick={() => { setDriverModal(false); setErr(""); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 관리자 추가 모달 */}
      {adminModal && (
        <div className="modal-bg" onClick={() => setAdminModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">🔧 관리자 계정 추가</div>
            {err && <div className="alert alert-warn mb8">{err}</div>}
            <label>소속 공구</label>
            <select value={adminForm.bl} onChange={e => setAdminForm({ ...adminForm, bl: e.target.value })}>
              <option>1BL</option><option>2BL</option>
            </select>
            <label>관리자 이름 (계정 ID)</label>
            <input value={adminForm.name} onChange={e => setAdminForm({ ...adminForm, name: e.target.value })} placeholder="예: 홍길동 관리자" />
            <label>비밀번호</label>
            <input type="password" value={adminForm.pw} onChange={e => setAdminForm({ ...adminForm, pw: e.target.value })} placeholder="비밀번호 입력" />
            <div className="btn-row mt8">
              <button className="btn btn-primary flex1" onClick={handleAddAdmin}>추가</button>
              <button className="btn flex1" onClick={() => { setAdminModal(false); setErr(""); }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 변경 모달 */}
      {pwModal && (
        <div className="modal-bg" onClick={() => setPwModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{pwModal.label || pwModal.id} 비밀번호 변경</div>
            <label>새 비밀번호</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="새 비밀번호 입력" autoFocus />
            <div className="btn-row mt8">
              <button className="btn btn-primary flex1" onClick={handleChangePw}>변경</button>
              <button className="btn flex1" onClick={() => setPwModal(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
