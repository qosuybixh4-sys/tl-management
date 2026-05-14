# TL 장비 관리 시스템 — 배포 가이드

## 폴더 구조
```
tl-manager/
├── public/
│   ├── index.html
│   └── manifest.json
├── src/
│   ├── App.js         ← 전체 앱 로직
│   ├── App.css        ← 스타일
│   ├── index.js       ← 진입점
│   └── firebase.js    ← Firebase 설정
├── package.json
└── firestore.rules    ← Firestore 보안 규칙 (참고용)
```

---

## 배포 방법 (Vercel — 무료, 5분)

### 1단계 — 코드 GitHub에 올리기
1. [github.com](https://github.com) 접속 → 로그인 (없으면 가입)
2. 우측 상단 **+** → **New repository**
3. Repository name: `tl-manager` → **Create repository**
4. 로컬에서 아래 명령어 실행:

```bash
cd tl-manager
git init
git add .
git commit -m "첫 배포"
git branch -M main
git remote add origin https://github.com/[내 계정]/tl-manager.git
git push -u origin main
```

### 2단계 — Vercel 배포
1. [vercel.com](https://vercel.com) 접속 → GitHub 계정으로 로그인
2. **Add New Project** → GitHub 저장소 `tl-manager` 선택
3. Framework: **Create React App** 자동 감지됨
4. **Deploy** 클릭 → 2~3분 후 완료

### 3단계 — 링크 공유
배포 완료 후 `https://tl-manager-xxxx.vercel.app` 형태의 링크 생성됨
→ 이 링크를 팀원들에게 공유하면 iOS/Android 브라우저에서 모두 사용 가능

---

## 홈 화면에 추가하기 (앱처럼 사용)

**iPhone (Safari):**
1. Safari에서 링크 접속
2. 하단 공유 버튼 → **홈 화면에 추가**

**Android (Chrome):**
1. Chrome에서 링크 접속
2. 주소창 옆 메뉴 → **홈 화면에 추가**

---

## 초기 계정 정보
| 계정 | 비밀번호 | 역할 |
|------|----------|------|
| 소장 | 1234 | 전체 현황, 장비관리, 결재, 팀관리 |
| 관리자 | 1234 | 전체 현황, 장비목록, 금일사용 |
| 팀장 | 소장이 설정 | 내 장비, 금일사용, 승인요청 |

⚠ 배포 후 반드시 소장/관리자 비밀번호를 변경해주세요!

---

## 주요 기능
- ✅ 실시간 동기화 (Firebase Firestore)
- ✅ 자동 로그인 (브라우저 localStorage)
- ✅ TL 장비 등록/수정/삭제
- ✅ 금일 사용 현황 토글 및 용도 기록
- ✅ 반입/반출/팀간 이동 결재 요청 → 소장 승인/반려
- ✅ 팀 추가/수정/삭제 (소장 전용)
- ✅ 소장/관리자/팀 비밀번호 변경
- ✅ PWA — 홈 화면 추가 시 앱처럼 동작
