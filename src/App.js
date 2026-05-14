import React, { useState, useEffect } from "react";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, addDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";
import { db } from "./firebase";
import "./App.css";

// ── 초기 시스템 계정 (Firestore에 없으면 자동 생성) ──────────────────────
const SYSTEM_ACCOUNTS = [
  { id: "소장", pw: "1234", role: "sojangnm", label: "소장" },
  { id: "관리자", pw: "1234", role: "admin", label: "관리자" },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [teams, setTeams] = useState([]);
  const [tls, setTls] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const [loading, setLoading] = useState(true);

  // ── 자동 로그인 ────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("tl_user");
    if (saved) {
      try { setCurrentUser(JSON.parse(saved)); } catch {}
    }
  }, []);

  // ── Firestore 실시간 구독 ──────────────────────────────────────────────
  useEffect(() => {
    const unsubAccounts = onSnapshot(collection(db, "accounts"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAccounts(data);
    });
    const unsubTeams = onSnapshot(collection(db, "teams"), snap => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubTls = onSnapshot(collection(db, "tls"), snap => {
      setTls(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubApprovals = onSnapshot(
      query(collection(db, "approvals"), orderBy("createdAt", "desc")),
      snap => setApprovals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    initSystemAccounts().then(() => setLoading(false));

    return () => { unsubAccounts(); unsubTeams(); unsubTls(); unsubApprovals(); };
  }, []);

  // ── 시스템 계정 초기화 ────────────────────────────────────────────────
  async function initSystemAccounts() {
    for (const acc of SYSTEM_ACCOUNTS) {
      const ref = doc(db, "accounts", acc.id);
      const snap = await getDocs(collection(db, "accounts"));
      if (!snap.docs.find(d => d.id === acc.id)) {
        await setDoc(ref, { pw: acc.pw, role: acc.role, label: acc.label });
      }
    }
  }

  // ── 로그인 ────────────────────────────────────────────────────────────
  async function doLogin(teamId, pw) {
    const acc = accounts.find(a => a.id === teamId);
    if (!acc) return "존재하지 않는 계정입니다.";
    if (acc.pw !== pw) return "비밀번호가 올바르지 않습니다.";
    const user = { id: teamId, role: acc.role, label: acc.label || teamId, team: acc.team || null };
    setCurrentUser(user);
    localStorage.setItem("tl_user", JSON.stringify(user));
    const nav = NAV_TABS[acc.role];
    setActiveTab(nav[0].id);
    return null;
  }

  function doLogout() {
    setCurrentUser(null);
    localStorage.removeItem("tl_user");
    setActiveTab("");
  }

  // ── 팀 CRUD ──────────────────────────────────────────────────────────
  async function addTeam(name, leader, pw) {
    if (!name || !pw) return "팀 이름과 비밀번호를 입력해주세요.";
    if (accounts.find(a => a.id === name)) return "이미 존재하는 이름입니다.";
    await setDoc(doc(db, "teams", name), { name, leader, pw });
    await setDoc(doc(db, "accounts", name), { pw, role: "team", label: name, team: name });
    return null;
  }

  async function editTeam(oldName, newName, leader, pw) {
    if (!newName) return "팀 이름을 입력해주세요.";
    if (oldName !== newName) {
      await setDoc(doc(db, "teams", newName), { name: newName, leader, pw: pw || teams.find(t=>t.id===oldName)?.pw });
      await deleteDoc(doc(db, "teams", oldName));
      await setDoc(doc(db, "accounts", newName), { pw: pw || accounts.find(a=>a.id===oldName)?.pw, role:"team", label:newName, team:newName });
      await deleteDoc(doc(db, "accounts", oldName));
      for (const tl of tls.filter(t => t.team === oldName)) {
        await updateDoc(doc(db, "tls", tl.id), { team: newName });
      }
    } else {
      const updates = { name: newName, leader };
      if (pw) updates.pw = pw;
      await updateDoc(doc(db, "teams", oldName), updates);
      if (pw) await updateDoc(doc(db, "accounts", oldName), { pw });
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

  // ── TL CRUD ──────────────────────────────────────────────────────────
  async function addTL(data) {
    await addDoc(collection(db, "tls"), { ...data, todayUse: false, todayPurpose: "", createdAt: serverTimestamp() });
  }

  async function deleteTL(id) {
    await deleteDoc(doc(db, "tls", id));
  }

  async function updateTLStatus(id, status) {
    await updateDoc(doc(db, "tls", id), { status });
  }

  async function toggleTodayUse(id, current) {
    await updateDoc(doc(db, "tls", id), { todayUse: !current, todayPurpose: current ? "" : "" });
  }

  async function setTodayPurpose(id, purpose) {
    await updateDoc(doc(db, "tls", id), { todayPurpose: purpose });
  }

  // ── 결재 ─────────────────────────────────────────────────────────────
  async function submitApproval(data) {
    await addDoc(collection(db, "approvals"), { ...data, status: "대기", createdAt: serverTimestamp() });
  }

  async function decideApproval(id, status, approval) {
    await updateDoc(doc(db, "approvals", id), { status });
    if (status === "승인" && approval.type === "이동") {
      const tl = tls.find(t => t.id === approval.tlId);
      if (tl) await updateDoc(doc(db, "tls", approval.tlId), { team: approval.to });
    }
  }

  // ── 비밀번호 변경 ─────────────────────────────────────────────────────
  async function changePassword(accountId, newPw) {
    await updateDoc(doc(db, "accounts", accountId), { pw: newPw });
    if (teams.find(t => t.id === accountId)) {
      await updateDoc(doc(db, "teams", accountId), { pw: newPw });
    }
  }

  // ── activeTab 초기화 ──────────────────────────────────────────────────
  useEffect(() => {
    if (currentUser && !activeTab) {
      setActiveTab(NAV_TABS[currentUser.role]?.[0]?.id || "");
    }
  }, [currentUser, accounts]);

  if (loading) return <div className="splash"><div className="spinner"/><p>불러오는 중...</p></div>;

  if (!currentUser) {
    return <LoginScreen accounts={accounts} onLogin={doLogin} />;
  }

  const navTabs = NAV_TABS[currentUser.role] || [];

  return (
    <div className="app">
      <header className="header">
        <span className="header-icon">🏗</span>
        <h1>TL 장비 관리</h1>
        <span className={`badge badge-${currentUser.role}`}>{currentUser.label}</span>
        <button className="btn-icon" onClick={doLogout} title="로그아웃">⎋</button>
      </header>
      <nav className="nav">
        {navTabs.map(tab => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            <span className="nav-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <main className="content">
        {activeTab === "overview" && <OverviewScreen tls={tls} teams={teams} approvals={approvals} />}
        {activeTab === "tl" && <TLScreen tls={tls} teams={teams} currentUser={currentUser} onAdd={addTL} onDelete={deleteTL} onStatusChange={updateTLStatus} />}
        {activeTab === "today" && <TodayScreen tls={tls} currentUser={currentUser} onToggle={toggleTodayUse} onPurpose={setTodayPurpose} />}
        {activeTab === "approval" && <ApprovalScreen approvals={approvals} tls={tls} onDecide={decideApproval} />}
        {activeTab === "request" && <RequestScreen tls={tls} teams={teams} currentUser={currentUser} onSubmit={submitApproval} approvals={approvals} />}
        {activeTab === "teams" && <TeamsScreen teams={teams} tls={tls} accounts={accounts} onAdd={addTeam} onEdit={editTeam} onDelete={deleteTeam} onChangePw={changePassword} currentUser={currentUser} />}
      </main>
    </div>
  );
}

// ── 네비게이션 정의 ────────────────────────────────────────────────────────
const NAV_TABS = {
  sojangnm: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "approval", icon: "✅", label: "결재" },
    { id: "teams", icon: "👥", label: "팀관리" },
  ],
  admin: [
    { id: "overview", icon: "📊", label: "현황" },
    { id: "tl", icon: "🏗", label: "장비목록" },
    { id: "today", icon: "📅", label: "금일사용" },
  ],
  team: [
    { id: "tl", icon: "🏗", label: "내 장비" },
    { id: "today", icon: "📅", label: "금일사용" },
    { id: "request", icon: "📨", label: "승인요청" },
  ],
};

// ── 로그인 화면 ────────────────────────────────────────────────────────────
function LoginScreen({ accounts, onLogin }) {
  const [teamId, setTeamId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!teamId) { setErr("계정을 선택해주세요."); return; }
    if (!pw) { setErr("비밀번호를 입력해주세요."); return; }
    setLoading(true);
    const error = await onLogin(teamId, pw);
    setLoading(false);
    if (error) setErr(error);
  }

  const systemAccounts = accounts.filter(a => a.role !== "team");
  const teamAccounts = accounts.filter(a => a.role === "team");

  return (
    <div className="login-wrap">
      <div className="login-logo">
        <div className="login-icon">🏗</div>
        <h2>TL 장비 관리</h2>
        <p>현장 타워리프트 통합 관리 시스템</p>
      </div>
      {err && <div className="alert alert-warn">{err}</div>}
      <div className="form-group">
        <label>계정 선택</label>
        <select value={teamId} onChange={e => { setTeamId(e.target.value); setErr(""); }}>
          <option value="">선택해주세요</option>
          {systemAccounts.map(a => <option key={a.id} value={a.id}>{a.label || a.id}</option>)}
          {teamAccounts.length > 0 && <optgroup label="── 팀 ──">
            {teamAccounts.map(a => <option key={a.id} value={a.id}>{a.id} (팀장)</option>)}
          </optgroup>}
        </select>
      </div>
      <div className="form-group">
        <label>비밀번호</label>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }}
          placeholder="비밀번호 입력" onKeyDown={e => e.key === "Enter" && handleLogin()} />
      </div>
      <button className="btn btn-primary full" onClick={handleLogin} disabled={loading}>
        {loading ? "로그인 중..." : "로그인"}
      </button>
    </div>
  );
}

// ── 현황 화면 ─────────────────────────────────────────────────────────────
function OverviewScreen({ tls, teams, approvals }) {
  const total = tls.length;
  const todayUse = tls.filter(t => t.todayUse).length;
  const broken = tls.filter(t => t.status === "고장").length;
  const pending = approvals.filter(a => a.status === "대기").length;

  return (
    <div>
      <div className="metric-grid">
        <div className="metric"><div className="metric-val">{total}</div><div className="metric-label">전체 TL</div></div>
        <div className="metric"><div className="metric-val green">{todayUse}</div><div className="metric-label">금일 사용</div></div>
        <div className="metric"><div className="metric-val red">{broken}</div><div className="metric-label">고장</div></div>
        <div className="metric"><div className="metric-val amber">{pending}</div><div className="metric-label">결재 대기</div></div>
      </div>
      <div className="section-title">팀별 현황</div>
      {teams.map(team => {
        const myTls = tls.filter(t => t.team === team.name);
        const use = myTls.filter(t => t.todayUse).length;
        return (
          <div key={team.id} className="card">
            <div className="card-header">
              <span className="card-title">{team.name}</span>
              <span className="pill">보유 {myTls.length}대 · 금일 {use}대 사용</span>
            </div>
            {myTls.length === 0 && <p className="empty-sm">보유 장비 없음</p>}
            {myTls.map(t => (
              <div key={t.id} className="tl-row">
                <span className={`dot dot-${t.status === "정상" ? "ok" : t.status === "고장" ? "broken" : "check"}`} />
                <span className="tl-sn">{t.sn}</span>
                <span className="tl-meta">{t.location}</span>
                {t.todayUse && <span className="pill pill-purple">사용중</span>}
              </div>
            ))}
          </div>
        );
      })}
      {pending > 0 && <div className="alert alert-warn">⚠ 결재 대기 {pending}건이 있습니다.</div>}
    </div>
  );
}

// ── 장비 목록 화면 ─────────────────────────────────────────────────────────
function TLScreen({ tls, teams, currentUser, onAdd, onDelete, onStatusChange }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ sn: "", team: "", location: "", status: "정상", inDate: "", memo: "" });
  const canEdit = currentUser.role === "sojangnm" || currentUser.role === "admin";
  const myTls = currentUser.role === "team" ? tls.filter(t => t.team === currentUser.team) : tls;

  async function handleAdd() {
    if (!form.sn) { alert("일련번호를 입력해주세요."); return; }
    if (!form.team) { alert("담당 팀을 선택해주세요."); return; }
    await onAdd({ ...form, inDate: form.inDate || new Date().toISOString().slice(0, 10) });
    setForm({ sn: "", team: "", location: "", status: "정상", inDate: "", memo: "" });
    setShowForm(false);
  }

  return (
    <div>
      {canEdit && (
        <button className="btn btn-primary full mb12" onClick={() => setShowForm(!showForm)}>
          + 장비 등록
        </button>
      )}
      {showForm && (
        <div className="card mb12">
          <div className="card-title mb8">신규 TL 등록</div>
          <label>일련번호</label>
          <input value={form.sn} onChange={e => setForm({ ...form, sn: e.target.value })} placeholder="예: SN-20250515" />
          <label>담당 팀</label>
          <select value={form.team} onChange={e => setForm({ ...form, team: e.target.value })}>
            <option value="">선택해주세요</option>
            {teams.map(t => <option key={t.id}>{t.name}</option>)}
          </select>
          <label>위치 (층/구역)</label>
          <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="예: 3층 서측" />
          <label>반입일자</label>
          <input type="date" value={form.inDate} onChange={e => setForm({ ...form, inDate: e.target.value })} />
          <label>상태</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option>정상</option><option>점검중</option><option>고장</option>
          </select>
          <label>메모</label>
          <input value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} placeholder="비고" />
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>등록</button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>취소</button>
          </div>
        </div>
      )}
      {myTls.map(t => (
        <div key={t.id} className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{t.sn}</div>
              <div className="card-sub">{t.team} · {t.location}</div>
            </div>
            <span className="status-tag">
              <span className={`dot dot-${t.status === "정상" ? "ok" : t.status === "고장" ? "broken" : "check"}`} />
              {t.status}
            </span>
          </div>
          <div className="card-meta">반입일: {t.inDate}{t.memo && " · " + t.memo}</div>
          {t.todayUse && <div className="alert alert-info mb8">✓ 금일 사용중 — {t.todayPurpose}</div>}
          {canEdit && (
            <div className="btn-row">
              <select defaultValue={t.status} onChange={e => onStatusChange(t.id, e.target.value)} className="select-sm">
                <option>정상</option><option>점검중</option><option>고장</option>
              </select>
              <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm("장비를 삭제하시겠습니까?")) onDelete(t.id); }}>삭제</button>
            </div>
          )}
        </div>
      ))}
      {myTls.length === 0 && <div className="empty">등록된 장비가 없습니다.</div>}
    </div>
  );
}

// ── 금일 사용 화면 ─────────────────────────────────────────────────────────
function TodayScreen({ tls, currentUser, onToggle, onPurpose }) {
  const myTls = currentUser.role === "team" ? tls.filter(t => t.team === currentUser.team) : tls;
  const useCount = myTls.filter(t => t.todayUse).length;
  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  return (
    <div>
      <div className="alert alert-info mb12">
        {today} 기준 · {currentUser.role === "team" ? currentUser.team + " " : ""}<strong>{useCount}대</strong> 사용 중
      </div>
      <div className="section-title">TL 사용 현황</div>
      {myTls.map(t => (
        <div key={t.id} className="card">
          <div className="today-row">
            <button className={`toggle ${t.todayUse ? "on" : ""}`} onClick={() => onToggle(t.id, t.todayUse)} aria-label="사용 여부 토글" />
            <div className="flex1">
              <div className="tl-sn">{t.sn}</div>
              <div className="tl-meta">{t.team} · {t.location}</div>
            </div>
            {t.status !== "정상" && (
              <span className="status-tag">
                <span className={`dot dot-${t.status === "고장" ? "broken" : "check"}`} />{t.status}
              </span>
            )}
          </div>
          {t.todayUse && (
            <input
              className="purpose-input"
              placeholder="사용 용도 입력 (예: 덕트 설치, 배관 작업...)"
              defaultValue={t.todayPurpose}
              onBlur={e => onPurpose(t.id, e.target.value)}
            />
          )}
        </div>
      ))}
      {myTls.length === 0 && <div className="empty">배정된 장비가 없습니다.</div>}
    </div>
  );
}

// ── 결재 화면 ─────────────────────────────────────────────────────────────
function ApprovalScreen({ approvals, tls, onDecide }) {
  const pending = approvals.filter(a => a.status === "대기");
  const done = approvals.filter(a => a.status !== "대기");

  return (
    <div>
      <div className="section-title">결재 대기 ({pending.length}건)</div>
      {pending.length === 0 && <div className="empty">대기 중인 결재가 없습니다.</div>}
      {pending.map(a => <ApprovalCard key={a.id} approval={a} showBtn onDecide={onDecide} />)}
      <div className="section-title">처리 완료</div>
      {done.length === 0 && <div className="empty">처리된 결재가 없습니다.</div>}
      {done.map(a => <ApprovalCard key={a.id} approval={a} showBtn={false} onDecide={onDecide} />)}
    </div>
  );
}

function ApprovalCard({ approval: a, showBtn, onDecide }) {
  const typeClass = a.type === "반입" ? "type-in" : a.type === "반출" ? "type-out" : "type-move";
  return (
    <div className="approval-card">
      <span className={`approval-type ${typeClass}`}>{a.type}</span>
      <div className="approval-title">{a.from} → {a.to} · {a.tlId}</div>
      <div className="approval-reason">{a.reason}</div>
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

// ── 승인 요청 화면 ─────────────────────────────────────────────────────────
function RequestScreen({ tls, teams, currentUser, onSubmit, approvals }) {
  const [form, setForm] = useState({ type: "이동", tlId: "", to: "", reason: "" });
  const myTls = tls.filter(t => t.team === currentUser.team);
  const myApprovals = approvals.filter(a => a.requester === currentUser.id);

  async function handleSubmit() {
    if (!form.reason) { alert("요청 사유를 입력해주세요."); return; }
    await onSubmit({ ...form, from: currentUser.team, requester: currentUser.id });
    setForm({ type: "이동", tlId: "", to: "", reason: "" });
    alert("소장님께 결재 요청이 전달되었습니다.");
  }

  return (
    <div>
      <div className="card mb12">
        <div className="card-title mb8">승인 요청 작성</div>
        <label>요청 유형</label>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option>이동</option><option>반입</option><option>반출</option>
        </select>
        <label>대상 TL</label>
        <select value={form.tlId} onChange={e => setForm({ ...form, tlId: e.target.value })}>
          <option value="">선택해주세요</option>
          {myTls.map(t => <option key={t.id} value={t.id}>{t.sn} ({t.location})</option>)}
          <option value="NEW">신규 장비 (반입)</option>
        </select>
        <label>목적지 팀</label>
        <select value={form.to} onChange={e => setForm({ ...form, to: e.target.value })}>
          <option value="">선택해주세요</option>
          {teams.map(t => <option key={t.id}>{t.name}</option>)}
          <option value="-">해당없음 (반출)</option>
        </select>
        <label>요청 사유</label>
        <textarea rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
          placeholder="소장님께 전달할 요청 사유를 입력해주세요" />
        <button className="btn btn-primary full" onClick={handleSubmit}>소장 결재 요청 →</button>
      </div>
      <div className="section-title">내 요청 현황</div>
      {myApprovals.length === 0 && <div className="empty">요청 내역이 없습니다.</div>}
      {myApprovals.map(a => {
        const typeClass = a.type === "반입" ? "type-in" : a.type === "반출" ? "type-out" : "type-move";
        return (
          <div key={a.id} className="approval-card">
            <span className={`approval-type ${typeClass}`}>{a.type}</span>
            <div className="approval-title">{a.tlId} → {a.to}</div>
            <div className="approval-reason">{a.reason}</div>
            <span className={`pill ${a.status === "승인" ? "pill-green" : a.status === "반려" ? "pill-red" : "pill-amber"}`}>{a.status}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── 팀 관리 화면 ──────────────────────────────────────────────────────────
function TeamsScreen({ teams, tls, accounts, onAdd, onEdit, onDelete, onChangePw, currentUser }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: "", leader: "", pw: "" });
  const [pwModal, setPwModal] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [err, setErr] = useState("");

  async function handleAdd() {
    const error = await onAdd(form.name, form.leader, form.pw);
    if (error) { setErr(error); return; }
    setModal(null); setForm({ name: "", leader: "", pw: "" }); setErr("");
  }

  async function handleEdit() {
    const error = await onEdit(modal.team.id, form.name, form.leader, form.pw);
    if (error) { setErr(error); return; }
    setModal(null); setForm({ name: "", leader: "", pw: "" }); setErr("");
  }

  async function handleDelete(team) {
    const tlCount = tls.filter(t => t.team === team.name).length;
    const msg = tlCount > 0
      ? `${team.name}을 삭제하시겠습니까?\n보유 TL ${tlCount}대가 미배정 상태가 됩니다.`
      : `${team.name}을 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;
    await onDelete(team.id);
  }

  async function handleChangePw() {
    if (!newPw) { alert("새 비밀번호를 입력해주세요."); return; }
    await onChangePw(pwModal.id, newPw);
    setPwModal(null); setNewPw("");
    alert("비밀번호가 변경되었습니다.");
  }

  const systemAccounts = accounts.filter(a => a.role !== "team");

  return (
    <div>
      <button className="btn btn-primary full mb12" onClick={() => { setModal({ type: "add" }); setForm({ name: "", leader: "", pw: "" }); setErr(""); }}>
        + 새 팀 추가
      </button>

      <div className="section-title">시스템 계정 비밀번호</div>
      <div className="card mb12">
        {systemAccounts.map(a => (
          <div key={a.id} className="team-row">
            <div className="team-avatar sys">{a.id[0]}</div>
            <div className="flex1">
              <div className="tl-sn">{a.label || a.id}</div>
              <div className="tl-meta">{a.role === "sojangnm" ? "소장 계정" : "관리자 계정"}</div>
            </div>
            <button className="btn btn-sm" onClick={() => { setPwModal(a); setNewPw(""); }}>비번변경</button>
          </div>
        ))}
      </div>

      <div className="section-title">등록된 팀 ({teams.length}개)</div>
      {teams.length === 0 && <div className="empty">등록된 팀이 없습니다.</div>}
      <div className="card">
        {teams.map((t, i) => {
          const tlCount = tls.filter(x => x.team === t.name).length;
          return (
            <div key={t.id} className={`team-row${i < teams.length - 1 ? " border-b" : ""}`}>
              <div className="team-avatar">{t.name.slice(0, 2)}</div>
              <div className="flex1">
                <div className="tl-sn">{t.name}</div>
                <div className="tl-meta">팀장: {t.leader || "-"} · TL {tlCount}대 보유</div>
              </div>
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => { setModal({ type: "edit", team: t }); setForm({ name: t.name, leader: t.leader || "", pw: "" }); setErr(""); }}>수정</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t)}>삭제</button>
              </div>
            </div>
          );
        })}
      </div>
      {teams.length > 0 && <div className="alert alert-warn mt8">⚠ 팀 삭제 시 해당 팀의 TL은 미배정 처리됩니다.</div>}

      {/* 팀 추가/수정 모달 */}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{modal.type === "add" ? "새 팀 추가" : "팀 정보 수정"}</div>
            {err && <div className="alert alert-warn mb8">{err}</div>}
            <label>팀 이름</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: D팀" />
            <label>팀장 이름</label>
            <input value={form.leader} onChange={e => setForm({ ...form, leader: e.target.value })} placeholder="예: 김철수" />
            <label>{modal.type === "add" ? "비밀번호" : "비밀번호 변경 (비워두면 유지)"}</label>
            <input type="password" value={form.pw} onChange={e => setForm({ ...form, pw: e.target.value })} placeholder="비밀번호 입력" />
            <div className="btn-row mt8">
              <button className="btn btn-primary flex1" onClick={modal.type === "add" ? handleAdd : handleEdit}>
                {modal.type === "add" ? "추가" : "저장"}
              </button>
              <button className="btn flex1" onClick={() => { setModal(null); setErr(""); }}>취소</button>
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
