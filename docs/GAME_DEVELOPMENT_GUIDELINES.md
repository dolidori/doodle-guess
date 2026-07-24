# 게임 개발 공통 지침서

> **목적**: 향후 개발할 게임들의 PRD 작성 및 구현 시 일관된 품질과 패턴을 유지하기 위한 공통 가이드라인
> **기반**: coup, Drawing-game, Love-Letter, number-baseball-game, Set-Card-Game, skull-king, time-line-card-game, battle-ship-game, bang-game, Galpang-Jilpang, initial-game, avalon-game, twilight-struggle, ra-game, whitehall-mystery-game 15개 프로젝트의 코드 분석 결과
> **최종 갱신**: 2026-06-14

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [백엔드 — 게임 로직 & 상태 관리](#2-백엔드--게임-로직--상태-관리)
   - 2.4 [플레이어 역할 시스템 (진행자 권한 유지 포함)](#24-플레이어-역할-시스템)
   - 2.6 [연결 끊김 & 호스트 처리 정책](#26-연결-끊김--호스트-처리-정책)
   - 2.9 [게임 종료 & 승리 조건 (화면 전환 순서)](#29-게임-종료--승리-조건)
   - 2.10 [서버 측 자동 진행 타이머](#210-서버-측-자동-진행-타이머-auto-advance)
   - 2.12 [스냅샷 저장 & 서버 재시작 복구](#212-스냅샷-저장--서버-재시작-복구)
3. [통신 프로토콜 — WebSocket & Socket.IO](#3-통신-프로토콜--websocket--socketio)
4. [프론트엔드 — UI/UX 설계](#4-프론트엔드--uiux-설계)
   - 4.4 [Safe Area & 노치 대응 (하단 잘림 방지)](#44-safe-area--노치-대응)
   - 4.5 [고정 헤더 (나가기 분기, 라운드 표기)](#45-고정-헤더--뷰포트-잠금)
   - 4.6 [모달 큐 (토스트 큐 & 타이밍)](#46-모달-큐queue-시스템)
   - 4.8 [카드 인터랙션 (선택 불가 차단, 제출 흐름)](#48-카드-인터랙션-ui)
   - 4.12 [로비 화면 필수 요소](#412-로비-화면-필수-요소)
5. [게임 편의성 — 플레이어 경험 향상](#5-게임-편의성--플레이어-경험-향상)
   - 5.8 [효과음(SFX) 가이드라인 & 음소거 전역 유지](#58-효과음sfx-가이드라인)
6. [크로스 프로젝트 패턴 매트릭스](#6-크로스-프로젝트-패턴-매트릭스)

---

## 1. 아키텍처 개요

### 1.1 기술 스택

| 계층 | 기술 | 비고 |
|------|------|------|
| **서버** | Node.js (Express) | 신규 게임 표준 |
| **실시간 통신** | WebSocket (ws 라이브러리) | 신규 게임 표준 |
| **클라이언트** | React (Vite) + TypeScript | 신규 게임 표준. 기존 JS 프로젝트는 유지 |
| **React 버전** | React 18 (기존) / React 19 (신규) | battle-ship, bang-game은 React 19 사용 |
| **상태 관리** | React useState + useRef | 외부 라이브러리 없이 순수 React |
| **배포** | Render (무료/유료 플랜) | 일부 프로젝트 MongoDB 병행 (skull-king, bang-game) |

### 1.2 서버 권위 모델 (Server-Authoritative)

모든 게임은 **서버가 유일한 진실의 원천(Single Source of Truth)**이다.

```
클라이언트 → 액션 요청 → 서버 검증 → 상태 갱신 → 전체 브로드캐스트 → 클라이언트 UI 반영
```

- 클라이언트는 낙관적 업데이트(Optimistic Update)를 **사용하지 않는다**
- 서버가 응답할 때까지 클라이언트 상태를 변경하지 않는다
- 게임 상태는 서버 메모리에 보관 (DB 미사용, skull-king만 MongoDB 하이브리드)

---

## 2. 백엔드 — 게임 로직 & 상태 관리

### 2.1 방(Room) 관리 시스템

#### 방번호 생성 규칙
- **3자리 숫자** (000~999 또는 100~999)
  - **000~999 범위**: coup, Love-Letter, number-baseball-game
  - **100~999 범위**: Drawing-game, Set-Card-Game, skull-king, time-line-card-game, battle-ship-game, bang-game, initial-game
- 서버에서 랜덤 생성, 중복 불가
- 메모리 기반 저장 (`Map<roomCode, Room>` 또는 `Object`)

```js
// 표준 구현 패턴 (100~999)
function generateRoomCode(rooms) {
  while (true) {
    const code = String(Math.floor(Math.random() * 900) + 100);
    if (!rooms.has(code)) return code;
  }
}
```

> **Galpang-Jilpang 패턴 (확장성 권장)**: 범위를 상수로 선언해 필요 시 쉽게 조정 가능
> ```js
> const ROOM_CODE_MIN = 100;
> const ROOM_CODE_MAX = 999;
> const code = String(Math.floor(Math.random() * (ROOM_CODE_MAX - ROOM_CODE_MIN + 1)) + ROOM_CODE_MIN);
> ```

#### 방 데이터 구조
```js
// 플레이어 객체
const createPlayer = (nickname, ws) => ({
  nickname,
  ws,          // WebSocket 연결 객체
  isHost: false,
  connected: true,
  isModerator: false,
});

// 방 객체
const createRoom = (code) => ({
  code,        // "042"
  status: 'waiting', // "waiting" | "playing" | "ended"
  players: [],
  settings: {}, // 게임별 설정
  gameState: {}, // 게임 진행 상태
});
```

### 2.2 호스트 권한 & 이양 시스템

#### 호스트 권한 범위
- 게임 시작/종료/재시작
- 게임 설정 변경
- 강제 패스, 플레이어 관리

#### 호스트 이양 규칙
호스트 퇴장 시 **입장 순서(FIFO)** 기준으로 다음 활성 플레이어에게 자동 이양.

```js
// 표준 이양 패턴
function transferHost(room) {
  const candidates = room.players.filter(p => p.connected && !p.isModerator);
  if (candidates.length > 0) {
    candidates[0].isHost = true;
    broadcast(room, 'HOST_CHANGED', { newHost: candidates[0].nickname });
  }
}
```

> **권장**: number-baseball-game처럼 명시적 `joinOrder` 필드를 사용하면 배열 순서 의존보다 안정적이다.

### 2.3 재접속 & 세션 복구

#### 식별 방식 비교

| 방식 | 보안성 | 복잡도 | 적용 프로젝트 |
|------|--------|--------|---------------|
| **닉네임 + 방번호** | 낮음 (중복 닉네임 취약) | 낮음 | coup, battle-ship, initial-game, Galpang-Jilpang |
| **sessionId (UUID)** | 높음 (위장 불가) | 중간 | bang-game (**권장**) |
| **닉네임 + wsId 맵핑** | 중간 | 중간 | Galpang-Jilpang (보조) |

> **신규 게임 권장**: bang-game의 sessionId 패턴. 닉네임 충돌 없이 안전하게 재접속 플레이어를 식별한다.

#### 복구 흐름 (닉네임 기반 — 기본)
```
1. 클라이언트 재연결 → JOIN_ROOM { nickname, roomCode }
2. 서버: room.players에서 nickname 매칭
3. 매칭 성공 → socketId 갱신 + connected: true
4. 게임 중이면 → 현재 게임 상태 전체 전송 (hand, publicState, phase 등)
5. isReconnect 플래그 전송 → 클라이언트에서 모달/UI 리셋 방지
```

#### 복구 흐름 (sessionId 기반 — 권장, bang-game 패턴)
```
1. 최초 입장 시 서버가 UUID sessionId 발급 → 클라이언트 탭별 sessionStorage 저장 (다중 탭 충돌 방지, 아래 주의 참고)
2. 재연결 → JOIN_ROOM { sessionId, roomCode }
3. 서버: room.players에서 sessionId 매칭 (닉네임 무관하게 동일 슬롯 확정)
4. 이후 흐름은 동일
```

```js
// bang-game 패턴
const player = {
  playerId: uuid(),
  sessionId: uuid(), // 클라이언트에 발급, 탭별 sessionStorage 저장 (다중 탭 충돌 방지)
  nickname,
  ws, isHost, connected, isAlive
};

// 재접속 검증
const existing = room.players.find(p => p.sessionId === sessionId && !p.connected);
if (existing) {
  existing.ws = ws;
  existing.connected = true;
}
```

#### 같은 기기 다중 탭 = 서로 다른 플레이어 (탭별 sessionId)

한 PC에서 브라우저 탭(또는 창)을 둘 띄워 **서로 다른 닉네임으로 동시 접속**할 수 있어야 한다(개발·테스트, 현장 1대 다계정 시연에 필수). 이를 위해 sessionId는 **탭 단위로 격리**한다.

- sessionId는 `localStorage`가 아니라 **`sessionStorage`에 저장한다.** `localStorage`는 같은 출처의 모든 탭이 공유하므로, 두 탭이 같은 sessionId를 들고 서버에서 **동일 슬롯으로 충돌**(한 탭이 다른 탭을 밀어냄)한다. 이것이 "브라우저 두 개로 다른 닉네임 접속이 안 되는" 전형적 원인이다.
- `sessionStorage`는 탭마다 독립이라 각 탭이 고유 sessionId를 가져 서로 다른 플레이어로 입장한다.
- 단점: `sessionStorage`는 **탭/브라우저 완전 종료 시 사라진다.** 따라서 종료 후 재접속은 sessionId가 아니라 **닉네임 + 방번호(+ DB에 저장한 uid)** 폴백 경로로 처리한다(위 닉네임 기반 복구). 즉 두 경로를 함께 둔다:
  - **새로고침·포그라운드 복귀**: 탭이 살아 있으면 sessionStorage의 sessionId로 즉시 복귀
  - **브라우저 종료 후 재입장**: 닉네임 + 방번호로 기존 슬롯 매칭 (DB의 uid로 식별)
- 서버는 같은 방에서 **닉네임 중복만 차단**하고, sessionId가 다르면 다른 탭의 접속을 막지 않는다.

#### Galpang-Jilpang wsId 맵 패턴 (보조)
```js
// ws → { roomCode, playerId } 역방향 조회를 위한 맵
const playerWsMap = new Map(); // wsId → { roomCode, playerId }

ws.id = uuid(); // ws 객체에 고유 ID 부여
playerWsMap.set(ws.id, { roomCode, playerId });

ws.on('close', () => {
  const info = playerWsMap.get(ws.id);
  // info로 방과 플레이어 즉시 특정 가능
  playerWsMap.delete(ws.id);
});
```

#### 핵심 구현 사항
- `isReconnect` 플래그: 재접속 시 모달 큐 리셋을 방지
- 로비 vs 게임 중 재접속 분기 처리
- 투표/선택 상태 복구 (skull-king 참고)

#### 재접속 시 페이즈별 UI 즉시 복원 (필수)

상태 값만 전달하는 것으로는 부족하다. 현재 진행 중인 **페이즈에 맞는 UI**가 재접속 직후 즉시 표시되어야 한다.

- 본인 턴 진행 중 재접속 → 해당 페이즈(카드 제출, 반응 대기 등)의 입력 UI 즉시 활성화
- 다른 플레이어 턴 중 재접속 → 대기 상태 UI 표시
- 체력·사정거리·장착 카드 등 로컬 계산 값도 서버에서 전달받아 즉시 복원
- 서버의 `GAME_STATE` 재전송에는 `turnPhase`, `pendingReaction`, `hand`, 장착 카드 등을 모두 포함해야 한다

#### MongoDB 영속성 (skull-king 전용)
- 서버 재시작 시 진행 중인 게임 복구 (`restoreGames()` 함수)
- 각 게임 상태가 비동기로 DB에 저장 (`saveGameToDB()`)
- 재접속 시 MongoDB에서 게임 상태 전체 복구 + 투표 데이터 복구
- BIDDING_REVEALED 상태에서 재접속 시 3초 후 자동으로 PLAYING 전환

### 2.4 플레이어 역할 시스템

| 역할 | 설명 | 적용 프로젝트 |
|------|------|---------------|
| **일반 플레이어** | 게임에 참여하는 기본 역할 | 전체 |
| **호스트** | 게임 진행 권한 보유 | 전체 |
| **진행자(Moderator)** | 게임 미참여, 대형 화면으로 중계 + 직접 컨트롤 | 전체 (필수) |
| **Presenter** | 게임 미참여 중계자. Moderator와 유사하나 컨트롤 권한 없음 | bang-game |
| **Witness** | 제3자 관찰자. 플레이어로 카운트되지 않고 게임 상황만 열람 | Galpang-Jilpang |
| **Ghost AI** | 인원 부족 시 AI로 자동 플레이 | skull-king |
| **AI 플레이어** | ANTHROPIC_API_KEY 주입 시 Claude가 실제 플레이 수행 | bang-game |

#### 진행자(Moderator) 모드 개요

진행자는 게임에 직접 참여하지 않고, 별도의 대형 디스플레이 화면으로 전체 게임 상황을 중계하며 필요 시 직접 컨트롤하는 역할이다.

#### AI 플레이어 통합 (bang-game 패턴)

`ANTHROPIC_API_KEY` 환경 변수가 주입된 경우 Claude API를 사용해 AI 플레이어가 실제 게임을 수행한다. 싱글플레이 또는 인원 부족 시 활용한다.

```js
// 서버: AI 플레이어 생성
if (process.env.ANTHROPIC_API_KEY) {
  const aiPlayer = createAIPlayer({ nickname: 'AI', roomCode });
  // AI 컨트롤러가 게임 상태를 읽고 액션을 선택해 ws 메시지로 전송
}
```

> **참고**: AI 플레이어는 일반 WebSocket 클라이언트처럼 동작한다. 서버 코드를 수정하지 않고 AI 컨트롤러만 별도 모듈로 분리한다.

#### 방 개설 흐름

```
진행자 모드 O: 진행자가 방 개설 → 플레이어들이 참여
진행자 모드 X: 플레이어 중 한 명이 방 개설 후 함께 참여 (호스트 역할 겸임)
```

- 방 입장 시 `isModerator: true` 플래그로 구분
- 진행자가 방을 개설하면 자동으로 moderator 역할 부여, 호스트 권한도 보유

#### 진행자 모드 구현 원칙

**제외 항목** (게임 참여자가 아님)
- 플레이어 카운트에서 **제외**
- 턴 순서에서 **제외**
- 플레이어용 액션 버튼(의심/차단/카드 선택 등) **미표시**

**보유 권한** (중계 및 컨트롤)
- 모든 플레이어의 패 **열람 가능** (중계 화면에 표시)
- 게임 시작/종료/재시작 권한 **보유**
- 강제 진행, 턴 스킵 등 **직접 컨트롤 가능**
- 턴 공지 모달(TurnAnnouncementModal) 자동 표시 — Space로 닫기

**화면 구성**
- 일반 플레이어 UI와 별도의 **중계 전용 뷰** 제공
- 전체 게임 상황(모든 플레이어 상태, 패, 점수 등)이 한눈에 보이는 레이아웃
- 대형 디스플레이 기준 설계 (가로 폭 넉넉히 활용)

**진행자 화면 추가 요구사항**
- 역할 카드는 **기본 숨김** 처리. "역할 보기" 버튼을 눌러야 전체 공개. 개별 카드 클릭 시 해당 카드만 열람 가능
- 투표 진행 상황: 누가 투표 완료했는지 실시간 표시
- 액션·카드 제출 상황: 누가 제출 완료했는지 실시간 표시
- 음향 효과는 진행자 화면에서도 재생하되 **중복 재생 방지** (다른 플레이어에게 이미 재생된 이벤트는 한 번만)

**진행자 권한 유지 (재접속 시 필수)**

진행자가 나갔다가 다시 들어올 때 `isModerator: true` 슬롯을 그대로 유지한다. 닉네임 + `isModerator` 플래그로 재접속 시 기존 슬롯과 매칭하고, 진행자 권한을 자동으로 복원한다. 일반 플레이어에게 이양하거나 초기화하지 않는다.

```js
// 재접속 시 진행자 슬롯 복원
const existing = room.players.find(
  p => p.nickname === nickname && p.isModerator && !p.connected
);
if (existing) {
  existing.ws = ws;
  existing.connected = true;
  // isModerator, isHost 권한 그대로 유지 — 별도 이양 없음
}
```

#### 숨은 정보 게임의 진행자 열람 (선택적 peek)

비대칭 정보 게임(은닉 이동형 추격 게임 등, 한쪽만 진실을 아는 게임)에서는 진행자가 **숨은 정보를 항상 노출하지 않는다.** 기본은 가림 상태로 두고, 진행자가 명시적으로 "엿보기(peek)" 토글을 켤 때만 해당 정보를 보여준다.

- 진행자는 숨은 말의 실제 위치·정체 등을 **토글로만** 열람한다. 토글 OFF가 기본값
- 진행자에게는 **열람 권한만 주고 조작 권한은 주지 않는다** — 숨은 측 플레이어의 결정을 대신하지 못한다
- peek 결과는 진행자 본인 화면에만 적용되며, 다른 플레이어에게 브로드캐스트하지 않는다 (PRIVATE_STATE 격벽 유지, §2.12)
- 진행자가 무심코 정보를 흘리지 않도록 peek는 **누르고 있는 동안에만 보이거나 명시적 토글**로 설계한다

```js
// 서버: PRIVATE_STATE 빌드 시 진행자 peek 여부에 따라 숨은 정보 포함
function buildPrivateState(room, player) {
  if (player.isModerator) {
    return { ...publicView(room), hidden: player.peeking ? room.gameState.hidden : null };
  }
  // ... 일반 플레이어용 PRIVATE_STATE
}
```

### 2.5 턴/라운드/페이즈 상태 머신

#### 공통 상태 흐름
```
WAITING → PLAYING → ROUND_END → (다음 라운드 or GAME_END)
```

#### 복잡한 게임의 세분화 (coup 참고)
```
action → reaction → (challenge | block | block-challenge) → lose-influence → exchange → game-end
```

#### 고복잡도 멀티-페이즈 구조 (bang-game 참고)

턴 내부를 세분화된 페이즈로 나눠 각 단계에서 허용되는 액션을 엄격히 제한한다.

```
TURN_START
  → AWAITING_DYNAMITE_DRAW  (다이너마이트 소지 시)
  → DYNAMITE_CHECK
  → AWAITING_JAIL_DRAW      (감옥 상태 시)
  → JAIL_CHECK
  → AWAITING_DRAW           (카드 드로우 단계)
  → DRAW
  → PLAY                    (카드 플레이 단계, 여러 번 가능)
      → AWAITING_REACTION   (Bang! 등 반응 필요 카드)
      → DUEL_IN_PROGRESS    (결투 진행 중)
      → EMPORIO_SELECTING   (General Store 카드 선택)
      → DISCARD             (핸드 리밋 초과 시 버리기)
  → TURN_END
  → TURN_START (다음 플레이어)
```

> **핵심**: 각 페이즈에서 허용된 메시지 타입만 서버에서 처리. 나머지는 즉시 `ERROR` 반환.
> 페이즈가 5개 이상이면 `turnPhase` 필드를 `gameState`에 별도로 두어 `status`(PLAYING)와 분리한다.

#### 예외: 동시 진행 게임 (Set-Card-Game, Drawing-game)
- **Set-Card-Game**: 턴 순서 없음. 모든 플레이어가 실시간으로 테이블의 카드 조합을 감시하며, 유효한 세트(3장) 발견 시 먼저 claim한 플레이어가 점수 획득
- **Drawing-game**: 카드 기반이 아닌 **스케치북 회전 메커닉**. DRAW → 스케치북 회전 → GUESS → 결과 공개 순서로 진행. 모든 플레이어가 동시에 그리기/맞추기 수행

#### 구현 원칙
- 상태 전이는 **서버에서만** 수행
- 각 상태에서 허용되는 이벤트를 명시적으로 검증
- 현재 턴 플레이어만 액션 가능 (`currentPlayer === nickname` 검증)
- 상태별 타임아웃 값 지정 (액션 8초, 반응 6초, 교환 15초 등)

#### 신규 게임: GameStateMachine 클래스 사용 (필수)

새로 만드는 게임은 산발적 `if`문 대신 아래 클래스를 기반으로 상태 관리를 구현한다.

```js
class GameStateMachine {
  constructor(initialState) {
    this.state = initialState;
    this.transitions = {}; // { from: [{ to, validator }] }
    this.history = [];     // [{ from, to, ts }]
  }

  addTransition(from, to, validator = null) {
    if (!this.transitions[from]) this.transitions[from] = [];
    this.transitions[from].push({ to, validator: validator ?? (() => true) });
  }

  transition(to, ctx = {}) {
    const available = this.transitions[this.state] ?? [];
    const match = available.find(t => t.to === to);
    if (!match) throw new Error(`${this.state} → ${to} 불가`);
    if (!match.validator(ctx)) throw new Error(`검증 실패: ${this.state} → ${to}`);
    this.history.push({ from: this.state, to, ts: Date.now() });
    this.state = to;
  }
}

// 사용 예:
const sm = new GameStateMachine('WAITING');
sm.addTransition('WAITING', 'PLAYING', (ctx) => ctx.players.length >= 2);
sm.addTransition('PLAYING', 'ROUND_END');
sm.addTransition('ROUND_END', 'PLAYING');
sm.addTransition('ROUND_END', 'GAME_END');
```

> **주의**: 턴 플레이어 식별 방식은 게임마다 다르다:
> - **nickname 기반** (coup, Love-Letter): 문자열 식별, 간단하지만 중복 가능성 있음
> - **socketId/playerId 기반** (Set-Card-Game, skull-king, time-line): 유일 식별자, 재접속 시 ID 갱신 필요

### 2.6 연결 끊김 & 호스트 처리 정책

게임 중 플레이어 또는 호스트의 연결이 끊겼을 때 어떻게 처리할지 **사전에 명확히 정의**해야 한다. 처리 정책이 없으면 게임이 교착 상태에 빠진다.

#### 게임별 disconnect 처리 전략 비교

| 항목 | Battle-Ship | Bang! | Coup | Galpang-Jilpang | Initial-Game |
|------|:-----------:|:-----:|:----:|:---------------:|:------------:|
| 자동 타이머 | 30초 후 게임종료 | 페이즈별 10~30초 | 없음 | 없음 | 게임중 5분 / 대기중 30초 |
| 턴 자동 진행 | ✗ | ✓ (페이즈별 세분화) | ✗ | ✗ | ✓ (즉시) |
| 호스트 이양 방식 | FIFO (joinOrder) | 살아있는 플레이어 우선 | 즉시 첫 번째 | FIFO + 진행자 fallback | FIFO (joinOrder) |
| 호스트 자동 퇴장 | ✓ | ✓ | ✓ | ✓ | ✗ (재접속 시 권한 복원) |
| 게임 상태 탈락 처리 | ✗ | ✗ | ✗ | ✗ | ✓ (isEliminated) |
| DB 저장 (disconnect 시) | ✗ | ✓ | ✗ | ✗ | ✗ |
| 방 삭제 기준 | 전원 퇴장 | 전원 퇴장 + 진행자도 없음 | 대기실만 (게임중 유지) | connected 0명 | 전원 퇴장 |

---

#### 표준 disconnect 흐름 (모든 게임 공통)

```js
ws.on('close', () => {
  const player = findPlayerByWs(ws);  // playerWsMap 또는 순회
  if (!player) return;

  player.connected = false;
  player.ws = null;

  broadcast(room, 'PLAYER_DISCONNECTED', { playerId: player.id, nickname: player.nickname });

  // 1) 호스트면 즉시 이양
  if (player.isHost) transferHost(room);

  // 2) 해당 플레이어 턴이면 자동 처리 타이머 시작 (§2.10 참고)
  if (isCurrentTurn(room, player)) scheduleAutoAdvance(room, player);

  // 3) 방이 비었으면 삭제
  if (room.players.filter(p => p.connected).length === 0) rooms.delete(room.code);
});
```

---

#### 호스트 이양 (`transferHost`) — 표준 패턴

```js
function transferHost(room) {
  // Moderator는 후보에서 제외 (일반 플레이어만)
  const candidates = room.players
    .filter(p => p.connected && !p.isModerator)
    .sort((a, b) => a.joinOrder - b.joinOrder); // 입장 순서 빠른 사람 우선 (FIFO)

  if (candidates.length > 0) {
    room.players.forEach(p => { p.isHost = false; }); // 기존 호스트 해제
    candidates[0].isHost = true;
    room.hostId = candidates[0].id;
    broadcastToRoom(room, 'HOST_CHANGED', { newHostId: candidates[0].id });
    return;
  }

  // 일반 플레이어가 없을 때 — 진행자(Moderator)가 있으면 진행자에게 이양 (Galpang-Jilpang 패턴)
  const moderator = room.players.find(p => p.connected && p.isModerator);
  if (moderator) {
    room.players.forEach(p => { p.isHost = false; });
    moderator.isHost = true;
    room.hostId = moderator.id;
    broadcastToRoom(room, 'HOST_CHANGED', { newHostId: moderator.id });
  }
}
```

> **Initial-Game 예외**: 호스트가 연결 끊겨도 자동 퇴장시키지 않는다. 재접속 시 호스트 권한이 그대로 복원된다. 대신 다른 플레이어는 유예 시간 후 완전 퇴장 처리한다.

---

#### 게임 단계별 disconnect 처리 정책

**대기실(WAITING) 중 플레이어 퇴장**

```js
// 대기실에서는 바로 방에서 제거
room.players = room.players.filter(p => p.id !== playerId);
if (player.isHost) transferHost(room);
if (room.players.length === 0) rooms.delete(room.code);
```

**게임 중(PLAYING) 플레이어 연결 끊김**

| 게임 | 즉시 처리 | 유예 후 처리 |
|------|----------|------------|
| **Battle-Ship** | `connected: false` + 상대방에게 알림 | 30초 후 `MATCH_ENDED` (재접속 없으면) |
| **Bang!** | `connected: false` + 페이즈별 타이머 시작 | 타이머 만료 시 자동 액션 처리 |
| **Coup** | `connected: false` 표시만 | 없음 (무기한 재접속 슬롯 유지) |
| **Galpang-Jilpang** | `connected: false` + `PLAYERS_UPDATED` | 없음 (무기한 슬롯 유지) |
| **Initial-Game** | 해당 턴이면 즉시 `advanceTurn()` | 게임중 5분 / 대기중 30초 후 완전 퇴장 |

```js
// Initial-Game 패턴 — 즉시 턴 진행 + 유예 후 완전 퇴장
ws.on('close', () => {
  player.connected = false;

  // 해당 플레이어 턴이면 즉시 넘김 (교착 방지)
  if (gs.sm.state === 'PLAYING' && isCurrentTurn(room, player)) {
    advanceTurn(room);
    broadcastToRoom(room, 'TURN_START', { ... });
  }

  const gracePeriod = gs.sm.state === 'PLAYING' ? 300_000 : 30_000; // 5분 vs 30초

  setTimeout(() => {
    const stillDisconnected = room.players.find(p => p.id === playerId && !p.connected);
    if (!stillDisconnected) return; // 재접속 성공 → 아무것도 안 함

    if (player.isHost) return; // 호스트는 자동 퇴장 없음

    room.players = room.players.filter(p => p.id !== playerId);
    broadcastToRoom(room, 'PLAYER_LEFT', { playerId, nickname: player.nickname });
    if (room.players.length === 0) rooms.delete(room.code);
  }, gracePeriod);
});
```

```js
// Bang! 패턴 — 페이즈별 서버 자동 처리 (교착 방지)
ws.on('close', () => {
  player.isConnected = false;

  if (room.gameStatus === 'PLAYING') {
    const phase = room.turnPhase;
    const isMyTurn = room.turnOrder[room.currentTurnIndex] === playerId;

    if (room.pendingReaction && isReactionTarget(room, playerId)) {
      setTimer(room, 'reaction', 15_000, () => handleRespondReaction(room, playerId, { isPass: true }));
    } else if (isMyTurn) {
      if (phase === 'AWAITING_DRAW')      setTimer(room, 'draw',    10_000, () => handleDrawCard(room, playerId));
      else if (phase === 'PLAY')          setTimer(room, 'turn',    30_000, () => handleEndTurn(room, playerId));
      else if (phase === 'DISCARD')       setTimer(room, 'discard', 10_000, () => autoDiscard(room, playerId));
      else if (phase === 'EMPORIO_SEL')   setTimer(room, 'emporio', 15_000, () => handleSelectEmporio(room, playerId, null));
    }
  }

  persistenceService.saveGameToDB(room).catch(() => {}); // DB 저장
});
```

**SETUP / WORD_REVIEW 단계 퇴장 (Galpang-Jilpang / Initial-Game)**

인원이 최소 조건 아래로 떨어지면 게임을 WAITING으로 되돌린다.

```js
// Initial-Game: SETUP 중 3명 미만이면 WAITING 복귀
if (gs.sm.state === 'SETUP') {
  const activePlayers = room.players.filter(p => !p.isModerator);
  if (activePlayers.length < 3) {
    gs.sm.state = 'WAITING';
    gs.sm.subPhase = null;
    broadcastToRoom(room, 'GAME_RESET', { reason: 'NOT_ENOUGH_PLAYERS' });
  }
}
```

---

#### 방 소멸 조건 (전 게임 공통)

| 조건 | 처리 |
|------|------|
| 대기실: 모든 플레이어 퇴장 | 즉시 `rooms.delete(roomCode)` |
| 게임 중: connected 플레이어 0명 | 즉시 `rooms.delete(roomCode)` |
| Bang! 전용: 플레이어도 0명이고 presenter도 없음 | `rooms.delete(roomCode)` |

```js
// 공통 방 소멸 체크 (disconnect 또는 LEAVE_ROOM 처리 후 호출)
function maybeDeleteRoom(room) {
  const hasConnected = room.players.some(p => p.connected);
  const hasPresenter = room.presenter?.isConnected;
  if (!hasConnected && !hasPresenter) {
    rooms.delete(room.code);
  }
}
```

---

### 2.7 카드/덱 관리 시스템

#### 공통 패턴
```js
// 1. 덱 생성
const deck = createDeck(ruleType);

// 2. Fisher-Yates 셔플 (모든 프로젝트 공통)
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 3. 배분
shuffle(deck);
for (const player of players) {
  player.hand = deck.splice(0, cardsPerPlayer);
}
```

#### 라운드별 배분량 조절
- skull-king: `cardsToDeal = Math.min(round, Math.floor(70 / playerCount))`
- Love-Letter: 매 라운드 1장씩 + 턴마다 1장 드로우

### 2.8 점수/토큰 시스템

| 유형 | 예시 | 프로젝트 |
|------|------|----------|
| **누적 토큰** | 정답 시 +1, 목표 토큰 달성 → 승리 | number-baseball, Love-Letter |
| **복합 점수** | 비딩 성공/실패 × 배수 + 보너스 | skull-king |
| **자원 관리** | 코인 획득/소비, 영향력 잃기 | coup |
| **순위 기반** | 카드 소진 순서 = 등수 | time-line-card-game |
| **세트 점수** | 유효한 세트 발견 시 +1 | Set-Card-Game |

### 2.9 게임 종료 & 승리 조건

#### 종료 트리거 유형
1. **생존형**: 마지막 생존자 = 승리 (coup)
2. **목표 달성형**: 토큰/점수 목표 도달 (number-baseball, Love-Letter)
3. **라운드 소진형**: 전체 라운드 완료 후 최고 점수 (skull-king)
4. **자원 소진형**: 카드/덱 소진 (time-line-card-game, Set-Card-Game)
5. **호스트 수동 종료**: 호스트 판단으로 게임 종료

#### 종료 후 처리
- 최종 순위/리더보드 화면 표시
- 재시작 옵션 제공 (호스트 권한)
- `RETURN_TO_WAITING` 또는 `restart-game` 이벤트로 로비 복귀

#### 게임 종료 시 화면 전환 순서 (필수)

결과 화면으로 **바로 전환하지 않는다.** 게임 테이블에서 한 박자 여유를 두고 공개할 것이 있으면 공개한 뒤 넘어간다.

```
1. 게임 종료 조건 충족
2. (해당하는 경우) 게임 테이블에서 역할/패 공개 — 카드 뒤집기 애니메이션
3. 짧은 대기 (2~3초) 또는 진행자·호스트의 "결과 보기" 버튼
4. 최종 결과/점수 화면으로 전환
```

- 바로 화면이 전환되면 무슨 일이 일어났는지 파악할 시간이 없어 혼란스럽다
- 역할 공개가 없는 게임은 2단계를 생략하고 3단계부터 진행

### 2.10 서버 측 자동 진행 타이머 (Auto-advance)

클라이언트 단독 타이머(§5.1)와 달리, **서버에서 직접 setTimeout을 관리**해 플레이어 미응답 시 자동으로 게임을 진행한다. 연결이 끊기거나 오래 응답하지 않는 플레이어로 인해 게임이 멈추는 상황을 방지한다.

> **클라이언트 타이머 vs 서버 타이머**
> - §5.1 클라이언트 타이머: UI 카운트다운 표시용. 네트워크 지연 무관.
> - §2.10 서버 타이머: 게임 교착 방지용. 클라이언트와 독립적으로 동작.

#### bang-game 구현 패턴

```js
class GameService {
  constructor() {
    this._autoAdvanceTimers = new Map(); // roomCode → timeoutId
  }

  scheduleAutoAdvance(room, delayMs, action) {
    this.clearAutoAdvance(room.code);
    const timer = setTimeout(() => {
      this._autoAdvanceTimers.delete(room.code);
      action(room); // 자동 패스, 랜덤 선택, 다음 턴 등
    }, delayMs);
    this._autoAdvanceTimers.set(room.code, timer);
  }

  clearAutoAdvance(roomCode) {
    const t = this._autoAdvanceTimers.get(roomCode);
    if (t) { clearTimeout(t); this._autoAdvanceTimers.delete(roomCode); }
  }
}

// 사용 예: 반응 기다리는 중
gameService.scheduleAutoAdvance(room, 15_000, (r) => {
  // 15초 내 미응답 → 자동 패스
  handleNoReaction(r);
});

// 플레이어가 응답하면 타이머 취소
gameService.clearAutoAdvance(room.code);
```

#### 표준 타임아웃 값 (bang-game 기준)

| 단계 | 타임아웃 | 자동 처리 |
|------|---------|---------|
| 반응 대기 (AWAITING_REACTION) | 15초 | 패스 처리 |
| 카드 드로우 (AWAITING_DRAW) | 10초 | 자동 드로우 |
| 턴 종료 (TURN_END) | 30초 | 강제 다음 턴 |
| 엠포리오 선택 | 15초 | 랜덤 선택 |

#### 구현 원칙
- 타이머 Map은 `roomCode → timeoutId` 구조 (방별로 독립)
- 플레이어 액션 수신 시 반드시 `clearAutoAdvance` 먼저 호출
- 방 소멸 시 모든 타이머 일괄 정리
- 자동 진행 시 클라이언트에게 `AUTO_ACTION` 또는 `TIMEOUT_ACTION` 이벤트로 알림

### 2.11 AI 행동 분석 & 봇 추론 — 사회적 추론 게임 (Avalon 패턴)

아발론처럼 **다른 플레이어의 의도를 추론**하는 게임에서는 단순 룰 검증을 넘어 행동 데이터 누적·LLM 분석·책임 기반 점수 시스템이 필요하다. 자세한 구현은 **부록 §A, §B** 참고.

#### 핵심 원칙
- **행동 이력은 누적 보관** — 직전 1회 투표만 보내면 패턴 학습 불가. `voteHistory: Array<{ questNumber, attemptIndex, leaderId, proposedTeam, votes, approved }>`를 매 투표 결과마다 누적.
- **LLM 분석은 fire-and-forget** — `analyzeSuspicion(room)` 결과를 await하지 않고, 응답이 오면 `suspicionScores`만 갱신. AI 키 미설정 시 silent return.
- **점수는 책임 기반(leader/approve)** — 그 사람이 reject 던졌는데 통과된 임무 결과로 그 사람을 평가하지 않는다.
- **본인 경험 기반 확정 신호 별도 set 운영** — `knownEvilFromOwnFails(room, bot)`: 본인이 갔던 2인 팀이 실패하면 다른 1명은 100% 악 → 즉시 무조건 reject/제외.
- **봇 의사결정은 분기 명확화** — 멀린/퍼시/일반선/악/오베론 각각 별도 분기. 잘못된 분기 통합은 "악이 자기 팀을 reject" 같은 비합리 행동의 원인이 됨.

#### 함정 (실수 사례)
- 악 봇 cover-reject(정체 숨김 15% 확률)에 `!meOnTeam` 조건이 없으면 본인이 fail 카드 낼 기회를 거부하는 비합리 행동 발생
- `allSuccessTeam` 검사에 본인을 success 멤버로 포함시키면, 본인이 끼어 있어 fail 가능한 팀도 reject로 빠짐 — `meOnTeam` 분리 필수

---

### 2.12 스냅샷 저장 & 서버 재시작 복구

라 게임과 황혼의 투쟁처럼 턴이 길고 상태가 많은 게임은 메모리 상태만으로 운영하면 안 된다. **명령 처리 후 스냅샷 저장, 서버 재시작 후 방 복구, 재접속 시 진행 UI 복원**을 초기 설계에 포함한다.

#### 적용 기준
- 30분 이상 지속되는 게임, 비동기 중단 가능성이 있는 게임, 카드/토큰/지도 상태가 많은 게임은 스냅샷 저장을 기본값으로 둔다.
- 단판 짧은 파티게임은 메모리 기반으로 시작해도 되지만, 재접속 요구가 있으면 `GameSnapshot` 구조를 먼저 설계한다.
- 저장소는 MongoDB를 권장한다. Render 무료/유료 환경에서는 `MONGODB_URI` 누락 시 시작 실패 또는 명확한 degrade 정책을 둔다.

#### 저장 타이밍
- 방 생성/입장/퇴장/호스트 이양 후 저장
- 게임 시작, 페이즈 전환, 턴 종료, 점수 계산 후 저장
- 플레이어 명령 하나가 서버 검증을 통과해 상태를 바꾼 직후 저장
- 자동 타이머 행동, 자동 패스, 서버 측 강제 진행 후 저장
- 저장 실패는 silent 처리하지 말고 서버 로그와 관리자용 warning toast/event로 노출한다

#### 스냅샷 구조
```ts
type GameSnapshot = {
  roomCode: string;
  version: number;
  status: 'waiting' | 'playing' | 'ended';
  players: PlayerSnapshot[];
  publicState: PublicGameState;
  privateStateByPlayerId: Record<string, PrivatePlayerState>;
  pendingAction?: PendingAction;
  timers?: TimerSnapshot[];
  updatedAt: string;
};
```

- `publicState`와 `privateStateByPlayerId`를 분리한다. 재접속 시 다른 플레이어의 비공개 정보가 섞이면 치명적이다.
- `pendingAction`에는 현재 입력 주체, 허용 액션, 마감 시간, 자동 행동을 포함한다.
- `version` 필드를 둬서 스냅샷 구조 변경 시 migration 또는 discard 정책을 명확히 한다.
- 카드/타일/지도 좌표처럼 정적 데이터는 스냅샷에 중복 저장하지 말고 카탈로그 id만 저장한다.

#### 복구 흐름
```
1. 서버 시작
2. DB에서 active snapshot 조회
3. room Map 재구성
4. ws는 null, connected=false 상태로 플레이어 슬롯 복원
5. 타이머가 만료된 pendingAction은 즉시 자동 행동 또는 복구 대기 정책 적용
6. 클라이언트 재접속 시 GAME_STATE + PRIVATE_STATE 재전송
```

#### 재접속 UI 복원
- 라 게임: 재접속 후 경매 입력 UI가 즉시 복원되어야 한다.
- 황혼의 투쟁: Headline/Action Round/Scoring처럼 현재 페이즈별 입력 가능 카드와 필수 행동을 즉시 복원해야 한다.
- 단순히 `phase`만 보내지 말고 `allowedActions`, `selectedTargets`, `pendingInput`, `timerRemaining`까지 함께 보낸다.
- `isReconnect: true`인 상태 갱신은 모달 큐를 초기화하지 않는다. 진행 중인 필수 입력 모달만 현재 상태에 맞게 재구성한다.

#### 검증 기준
- 명령 처리 후 DB 스냅샷이 갱신되는지 테스트한다.
- 서버 종료/재시작 후 방, 플레이어 슬롯, 현재 페이즈, 비공개 손패/타일이 복구되는지 테스트한다.
- 재접속 후 현재 행동 UI가 바로 활성화되는지 브라우저에서 확인한다.
- 끊긴 플레이어가 현재 행동자일 때 자동 패스/자동 행동이 저장되고, 재접속 후 중복 실행되지 않는지 확인한다.

---

### 2.13 진행자 게임 잠금 (SET_LOCK)

현장(오프라인 동시 플레이) 게임에서는 룰 분쟁·휴식·오심 정정을 위해 **진행자가 모든 플레이어의 액션을 일시 정지**시킬 수 있어야 한다. 잠금 상태에서는 서버가 게임 액션을 거부하고, 클라이언트는 안내 오버레이로 정지 상태를 표시한다.

#### 동작
- 진행자가 `SET_LOCK { locked: true }` 전송 → 서버 `room.locked = true` → 전체 브로드캐스트
- 잠금 중 들어온 게임 액션은 서버에서 즉시 거부(`ERROR`). 단 **진행자 컨트롤·재접속·heartbeat는 허용**
- 클라이언트는 `locked` 상태에서 잠금 오버레이/모달 표시 ("진행자가 게임을 잠시 멈췄습니다")
- 진행자가 `SET_LOCK { locked: false }` → 해제 후 정상 진행

```js
// 서버: 게임 액션 핸들러 진입부에서 잠금 검사
function handleGameAction(room, player, msg) {
  if (room.locked && !player.isModerator) {
    return sendError(player.ws, '진행자가 게임을 멈춘 상태입니다');
  }
  // ... 정상 처리
}
```

#### 구현 원칙
- 스냅샷 저장 시 `locked` 상태도 포함해 재시작·재접속 후에도 잠금이 유지되도록 한다 (§2.12)
- §2.10 서버 자동 진행 타이머와 연동: 잠금 시 진행 타이머를 멈추고, 해제 시 남은 시간으로 재개한다
- 잠금/해제 이벤트는 §3.8 이벤트 로그에 남겨 누가 언제 멈췄는지 추적 가능하게 한다

---

## 3. 통신 프로토콜 — WebSocket & Socket.IO

### 3.1 프로토콜 선택 기준

**신규 게임은 Node.js + ws 라이브러리를 표준으로 사용한다.** React와 동일한 JS 생태계에서 타입 안전성과 세밀한 제어를 우선한다.

| 기준 | WebSocket (ws 라이브러리) | Socket.IO |
|------|--------------------------|-----------|
| **제어 수준** | 높음 (직접 ping/pong, 메시지 포맷) | 중간 (자동 재연결, 내장 heartbeat) |
| **적합한 경우** | 신규 게임 표준, 타입 안전한 게임 로직 | 기존 프로젝트 유지 |
| **사용 프로젝트** | 신규 게임 전체 | Drawing-game, number-baseball-game, Set-Card-Game, skull-king, time-line-card-game (기존 유지) |

### 3.2 이벤트 네이밍 규칙

#### WebSocket 프로젝트: `UPPER_CASE` (JSON 메시지 타입)
```javascript
// 메시지 형식
{ type: "CREATE_ROOM", payload: { nickname, isModerator } }
{ type: "PLAY_ACTION", payload: { action, target } }

// 서버 → 클라이언트
{ type: "ROOM_JOINED", payload: { code, players, isHost } }
{ type: "ACTION_DECLARED", payload: { player, action, target, cost } }
```

#### Socket.IO 프로젝트: `kebab-case` (권장) 또는 `snake_case` (skull-king)
**프로젝트별 네이밍**:
- **kebab-case**: Set-Card-Game, time-line-card-game, number-baseball-game, Drawing-game
- **snake_case**: skull-king (예: `create_room`, `submit_vote`, `error_message`)
```javascript
// 클라이언트 → 서버
socket.emit('create-room', { nickname });
socket.emit('submit-answer', { roomId, answer });

// 서버 → 클라이언트
socket.emit('game-started', { settings, turnOrder });
socket.emit('answer-result', { nickname, answer, strike, ball });
```

#### 이벤트 이름 설계 원칙
- **C→S (요청)**: 동사-명사 (`create-room`, `submit-bid`, `PLAY_ACTION`)
- **S→C (응답/브로드캐스트)**: 과거형 또는 상태명 (`game-started`, `ROOM_JOINED`)
- **에러**: `ERROR` 또는 `error_message`

### 3.3 공통 페이로드 키

| 키 | 용도 | 비고 |
|----|------|------|
| `nickname` / `name` | 플레이어 식별자 | 방 내 고유 |
| `roomId` / `roomCode` / `code` | 방 식별자 | 3자리 숫자 |
| `players` | 플레이어 목록 배열 | 공개 정보만 포함 |
| `status` / `gameStatus` | 현재 게임 페이즈 | 상태 머신 값 |
| `hand` / `cards` | 해당 플레이어의 패 | 본인에게만 전송 |
| `action` / `card` | 수행한 액션/카드 | 턴 액션 |
| `target` | 대상 플레이어 | 선택적 |
| `isReconnect` | 재접속 여부 | 모달 리셋 방지 |
| `timeoutSeconds` | 타임아웃 시간 | 클라이언트 타이머용 |

### 3.4 클라이언트 메시지 핸들러 패턴

#### 패턴 A: 디스패치 테이블 + Ref (WebSocket용, **권장**)
```javascript
// 핸들러 맵 정의
const MSG_HANDLERS = {
  ROOM_JOINED(payload, { setRoomState, setScreen }) { /* ... */ },
  GAME_STARTED(payload, { setGameState }) { /* ... */ },
  ACTION_DECLARED(payload, { setGameState, myNicknameRef }) { /* ... */ },
  // 20+ 핸들러
};

// Ref로 최신 핸들러 참조 (클로저 스테일 방지)
const myNicknameRef = useRef('');
const handleMessageRef = useRef(null);
const settersRef = useRef({ setRoomState, setGameState });

// 메시지 수신
ws.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);
  handleMessageRef.current?.(type, payload);
};
```

> **핵심**: `useRef`로 상태값과 setter를 감싸서 의존성 배열 없이 항상 최신 값에 접근.
> WebSocket `onmessage` 핸들러는 초기 마운트 시점의 값을 캡처(stale closure)하므로,
> `settersRef.current`를 통해 항상 최신 상태에 접근해야 한다.

#### 패턴 B: 인라인 리스너 + 클린업 (Socket.IO용)
```javascript
useEffect(() => {
  socket.on('room_created', (data) => { /* ... */ });
  socket.on('update_players', (players) => { /* ... */ });
  return () => {
    socket.off('room_created');
    socket.off('update_players');
  };
}, [dependencies]);
```

#### 패턴 C: 이벤트 상수 파일 분리 (Set-Card-Game 참고)
```javascript
// events.js
export const EVENTS = {
  JOIN_ROOM: 'join-room',
  START_GAME: 'start-game',
  SELECT_CARDS: 'select-cards',
};

// 서버/클라이언트 모두에서 import하여 사용
socket.on(EVENTS.JOIN_ROOM, handler);
```

### 3.5 Heartbeat & Keep-Alive

#### WebSocket: 수동 Ping/Pong
```js
// 서버 (Node.js + ws)
// 프로젝트별 heartbeat interval:
// - 빠른 게임: 20초 / 느린 게임: 45초 (게임 페이스에 따라 조정)
const HEARTBEAT_INTERVAL = 45_000;

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// 각 클라이언트 연결에서:
ws.isAlive = true;
ws.on('pong', () => { ws.isAlive = true; });
```

#### Socket.IO: 내장 Heartbeat 활용
```javascript
// 서버 설정
const io = new Server(server, {
  pingTimeout: 120000,   // 2분 (Drawing-game 대용량 전송 대응)
  pingInterval: 30000,   // 30초
});
```

#### Render 무료 플랜 Sleep 정책 (40분 유휴 시 허용)

Render 무료 플랜은 30분 비활성 시 슬립한다. 게임 중에는 keep-alive 핑으로 깨워 두되, **마지막 플레이어 입력 후 40분간 아무 입력이 없으면 keep-alive를 멈추고 Render 슬립을 허용한다.** 빈 방을 무한정 깨워 둘 필요가 없고, 다시 접속하면 콜드 스타트 후 재개된다. (클라이언트 측 정책은 §5.4 참고)

| 게임 | 주기 | 조건 | 비고 |
|------|------|------|------|
| **bang-game** | 14분 | 마지막 활동 후 30분 이상 경과 시 스킵 | 유휴 시 불필요한 ping 방지 |
| **Galpang-Jilpang** | 5분 | 게임 진행 중일 때만 (`status === 'PLAYING'`) | 대기실에서는 ping 안 함 |
| **initial-game** | 10분 | 접속 클라이언트 있을 때만 (`wss.clients.size > 0`) | 서버 혼자일 때 불필요 |
| **기본 권장** | 14분 | 마지막 입력 후 40분 미만일 때만 | 40분 무입력 시 중단 → 슬립 허용 |

```js
// 권장 패턴 (bang-game 스타일 — 유휴 감지)
let lastActivityAt = Date.now();

// 플레이어 액션 처리 시마다 갱신
function onPlayerAction() { lastActivityAt = Date.now(); }

const renderURL = process.env.RENDER_EXTERNAL_URL;
if (renderURL) {
  setInterval(() => {
    const idleMs = Date.now() - lastActivityAt;
    if (idleMs > 40 * 60 * 1000) return; // 40분 이상 무입력이면 keep-alive 중단 → Render 슬립 허용
    fetch(`${renderURL}/health`).catch(() => {});
  }, 14 * 60 * 1000);
}
```

### 3.6 CORS & Socket.IO 클라이언트 설정

#### CORS 설정 (Socket.IO)
| 프로젝트 | CORS 설정 | 비고 |
|----------|----------|------|
| **skull-king** | `origin: process.env.ALLOWED_ORIGIN \|\| "*"` | 환경 변수로 제어 |
| **number-baseball-game** | `origin: ALLOWED_ORIGINS` (화이트리스트) | 특정 도메인만 허용 |
| **Set-Card-Game** | `NODE_ENV === 'prod' ? false : localhost` | 환경별 분기 |
| **time-line-card-game** | `origin: '*'` | 와일드카드 |

> **권장**: 프로덕션 배포 시 명시적 화이트리스트 사용

#### Socket.IO 클라이언트 연결 옵션
```javascript
const socket = io('http://server-url', {
  autoConnect: false,          // 수동 연결 (방 입장 시) — 대부분 프로젝트
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,     // 1초 간격 (Drawing-game: 2초~10초 지수 백오프)
});
```

#### 방(Room) & 네임스페이스
- 모든 프로젝트는 **기본 "/" 네임스페이스** 사용 (별도 네임스페이스 없음)
- 방 입장: `socket.join(roomId)` → 브로드캐스트: `io.to(roomId).emit()`

### 3.7 서버 검증 원칙

모든 클라이언트 요청은 서버에서 반드시 검증한다:

| 검증 항목 | 내용 |
|-----------|------|
| **턴 검증** | `currentPlayer === nickname` |
| **페이즈 검증** | 현재 상태에서 허용된 액션인지 |
| **카드 검증** | 패에 해당 카드가 있는지 |
| **자원 검증** | 비용 충분한지 (`coins >= cost`) |
| **대상 검증** | 대상이 유효한지 (존재, 미탈락) |
| **방 상태 검증** | 게임 진행 중인지 |

#### zod `.strict()` 스키마 확장 시 함정

zod 스키마를 `.strict()`로 잠가두면 알 수 없는 필드를 거부한다. 새 설정 필드 추가 시 **스키마와 핸들러 양쪽**을 동시에 수정해야 한다. 한쪽만 수정하면 "페이로드 검증 실패" 토스트가 떠 사용자가 원인 모르게 됨. → 부록 §C 참조 (`UPDATE_SETTINGS` 확장 사례).

#### 입력 검증 + Rate Limiting (신규 게임 필수)

악의적 페이로드 및 과도한 요청으로부터 서버를 보호한다.

```js
// 입력 검증: 필수 필드 누락·타입 오류 즉시 거부
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    if (data.length > 4096) { ws.close(); return; } // 최대 메시지 크기 제한

    let msg;
    try { msg = JSON.parse(data); } catch { ws.close(); return; }
    if (!msg.type) return;

    // Rate Limiting
    const now = Date.now();
    ws._reqCount = (ws._reqCount ?? 0) + 1;
    ws._windowStart = ws._windowStart ?? now;
    if (now - ws._windowStart > 60_000) { ws._reqCount = 1; ws._windowStart = now; }
    if (ws._reqCount > 100) { sendError(ws, '요청이 너무 많습니다'); return; }

    // 핸들러 디스패치
    dispatch(ws, msg);
  });
});
```

### 3.8 에러 처리 & 경합 조건 방지

#### 에러 전송 패턴
```js
// WebSocket (Node.js 신규 게임)
function sendError(ws, message) {
  ws.send(JSON.stringify({ type: 'ERROR', payload: { message } }));
}
// 사용: sendError(ws, '게임 규칙 위반')
```

```javascript
// Socket.IO (기존 프로젝트 유지)
socket.emit('error-message', { message: '존재하지 않는 방입니다.' });
// 또는 콜백: callback({ success: false, message: '잘못된 입력' });
```

#### 클라이언트 에러 표시
```javascript
// 3초 후 자동 클리어
setError(payload.message);
setTimeout(() => setError(''), 3000);
```

#### 클라이언트 `send()` silent drop 방어 (필수)

WebSocket이 OPEN 상태가 아닐 때 `ws.send()`를 silent drop 하면 사용자는 "아무 반응 없음"으로 인식. 토스트 + 콘솔 경고로 명시한다.

```ts
const send = (type, payload = {}) => {
  const ws = wsRef.current;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
    return;
  }
  console.warn('[send] dropped — ws not open', { type, readyState: ws?.readyState });
  dispatch({ type: 'PUSH_TOAST', toast: { variant: 'warning', message: '연결이 불안정합니다. 다시 시도해주세요.' } });
};
```

→ 부록 §E.1 참조.

#### 경합 조건 방지: 큐 기반 순차 처리 (coup 참고)
```js
// 영향력 상실 큐 — 여러 플레이어가 동시에 영향력을 잃어야 할 때

// gameState 안에 포함
room.gameState.loseInfluenceQueue = []; // [{ playerId, ...게임별 필드 }]

function processLoseInfluenceQueue(room) {
  if (room.gameState.loseInfluenceQueue.length === 0) {
    advanceTurn(room);
    return;
  }
  const item = room.gameState.loseInfluenceQueue.shift();
  // 플레이어 선택 완료 후 재귀 호출로 다음 항목 처리
  // (선택 핸들러 내에서 processLoseInfluenceQueue(room) 재호출)
}
```

#### 구조화 로깅 + 클라이언트 디버그 패널 (신규 게임 권장)

```js
// 서버: 링 버퍼 기반 이벤트 로거 (Node.js)
class EventLogger {
  constructor(maxSize = 10000) {
    this.events = [];
    this.maxSize = maxSize;
  }

  log({ roomId, type, playerId, payload }) {
    this.events.push({ roomId, type, playerId, payload, ts: Date.now() });
    if (this.events.length > this.maxSize) this.events.shift();
  }
}

const logger = new EventLogger();
// 사용: logger.log({ roomId, type: 'PLAY_ACTION', playerId })
```

```jsx
// 클라이언트: 개발 모드에서만 우하단에 디버그 패널 표시
{import.meta.env.DEV && <DebugPanel events={eventLog} />}
```

#### seq 기반 이벤트 로그 & 신규 이벤트만 토스트 (재접속 중복 방지)

게임 진행 이벤트(이동, 단서 발견, 체포 시도 등)를 `PUBLIC_STATE`에 **순번(seq)과 함께 누적**해 두면, 클라이언트는 "마지막으로 본 seq 이후의 새 이벤트만" 토스트로 띄울 수 있다. 재접속·상태 재전송 시 과거 이벤트가 다시 토스트로 쏟아지는 문제를 막는다.

```js
// 서버: 이벤트를 seq와 함께 PUBLIC_STATE에 누적 (링 버퍼 — 최근 20개만 유지)
function announce(room, event) {
  const gs = room.gameState;
  gs.eventLog.push({ seq: ++gs.eventSeq, ...event, ts: Date.now() });
  if (gs.eventLog.length > 20) gs.eventLog.shift();
}
```

```js
// 클라이언트: 마지막으로 처리한 seq 이후의 이벤트만 토스트
const lastSeenSeqRef = useRef(0);
function onPublicState(state) {
  for (const e of state.eventLog) {
    if (e.seq > lastSeenSeqRef.current) {
      pushToast(e.message);              // §4.6 토스트 큐로 표시
      lastSeenSeqRef.current = e.seq;
    }
  }
}
```

- `eventSeq`는 방 단위 단조 증가. 재시작·스냅샷 복구 후에도 이어지도록 스냅샷에 포함한다 (§2.12)
- **재접속 직후** 첫 `PUBLIC_STATE`는 `lastSeenSeq`를 현재 최대 seq로 맞춰 과거 이벤트를 토스트하지 않고 조용히 동기화한다
- §3.8의 서버 `EventLogger`(디버그용 링 버퍼)와는 별개다. 이쪽은 **플레이어에게 보이는** 게임 이벤트 로그다

---

## 4. 프론트엔드 — UI/UX 설계

### 4.1 비율 기반 레이아웃 시스템 (필수)

**고정 px 사용 금지.** 모든 크기 값은 뷰포트/컨테이너 비율 단위를 사용한다.

**글자 크기 원칙**: 텍스트가 컴포넌트 안에서 너무 작게 보이지 않도록 한다. 여백이 많고 글자가 작은 것보다 글자가 컴포넌트 공간을 시원하게 채우는 것을 우선한다. `clamp`의 최솟값은 가독성을 확보할 수 있는 수준으로 설정한다.

#### 기본 공식
```css
/* 글자 크기 스케일 */
--text-sm:  clamp(15px, 2vh,   18px);   /* 라벨, 캡션 */
--text-md:  clamp(17px, 2.4vh, 22px);   /* 본문, 버튼 */
--text-lg:  clamp(20px, 3vh,   28px);   /* 섹션 제목 */
--text-xl:  clamp(24px, 4vh,   36px);   /* 주요 제목 */

/* 카드 사이즈 */
height: clamp(100px, 18vh, 200px);
width: auto;
aspect-ratio: 0.65 / 1;

/* 버튼 — width는 절대 100% 금지. 내용물 + 패딩으로만 결정 */
font-size: clamp(15px, 2.2vh, 19px);
padding: clamp(11px, 1.6vh, 16px) clamp(18px, 2.5vw, 28px);
height: clamp(46px, 6.5vh, 60px);
width: auto;          /* ✅ 콘텐츠 너비 */
max-width: 280px;     /* 단독 버튼 최대 너비 */
min-width: 80px;      /* 너무 좁아지지 않도록 */

/* 버튼 여러 개 나열 시 — flex 컨테이너로 묶어 가운데 정렬 */
.button-group {
  display: flex;
  justify-content: center;
  gap: clamp(8px, 1.5vw, 16px);
  flex-wrap: wrap;
}

> **버튼 width 금지**: `width: 100%` 또는 화면 가로를 꽉 채우는 스타일 절대 사용 금지. 버튼은 내용물 + 패딩으로만 크기를 결정하고, 여러 버튼은 flex로 가운데 정렬한다.

> **이모지 사용 금지**: UI 텍스트(버튼, 라벨, 헤더, 알림 등) 전체에서 이모지 사용을 금지한다. 이모지는 폰트 렌더링 환경에 따라 크기·위치가 달라져 레이아웃을 깨뜨린다.

/* 여백/패딩 */
padding: clamp(10px, 1.5vh, 20px) clamp(12px, 2vw, 24px);
gap: clamp(10px, 1.5vw, 20px);

/* 모달 */
width: min(92vw, 440px);
padding: clamp(24px, 3.5vh, 42px) clamp(24px, 3.5vw, 42px);

/* Transform (hover/선택) */
transform: translateY(-4vh);   /* 카드 선택 */
transform: translateY(-2px);   /* 버튼 호버 (미세한 이동은 px 허용) */
```

### 4.2 다크 테마 & 색상 체계

#### 공통 색상 구조
```css
:root {
  /* 배경 계층 */
  --bg: #0d1b2a;              /* 매우 어두운 기본 배경 */
  --surface: rgba(20,30,50,0.8); /* 카드/패널 표면 */

  /* 텍스트 */
  --text: #ede0c4;            /* 밝은 크림/화이트 */
  --text-dim: #8899aa;        /* 보조 텍스트 */

  /* 강조색 (골드 계열 필수) */
  --gold: #f5c842;            /* 주요 강조 */
  --gold-dim: #c9a227;        /* 보조 강조 */
  --gold-glow: 0 0 20px 5px rgba(245, 200, 66, 0.45);

  /* 상태색 */
  --success: #4CAF50;
  --danger: #c0392b;
  --info: #4FC3F7;
}
```

#### 게임별 테마 커스터마이징

**Dark Theme + Gold Accent (6개 프로젝트)**:
- coup: 버건디 (`#1e0808`) + 역할별 카드 색상 (듀크 `#1e3d6e`, 암살자 `#141428`, 대사 `#143820`, 선장 `#6a0a0a`, 콩테스 `#4a1860`)
- Love-Letter: 딥 블루 (`#0d1b4b`)
- skull-king: 네이비 (`#141e30`, 그라디언트 `#243b55`)
- number-baseball: 다크 그린 (`#2D6A2D`)
- 골드 강조색: `#FFD700` ~ `#f5c842` (전 다크 테마 프로젝트 공통)

**Light Theme (예외: Drawing-game)**:
- 밝은 배경 (`#F9F9F9`) + 블루 강조 (`#29B6F6`) + 오렌지 강조 (`#FF7043`)

**강조색 예외**:
- Set-Card-Game: 카드 선택 시 **빨강** (`#e53535`) 사용 (골드 아님)

#### 색맹 모드 + 폰트 크기 조절 (설정 패널 제공)

색상에만 의존하는 정보 전달을 피하고, 색맹 모드와 글자 크기 조절을 설정에서 제공한다.

```css
/* 적녹 색맹 대응 */
[data-colorblind="deuteranopia"] {
  --color-action: #0173B2;   /* 빨강 → 파랑 */
  --color-block: #DE8F05;    /* 초록 → 주황 */
}

/* 폰트 크기 */
[data-font-size="large"] { font-size: 20px; }
[data-font-size="xl"]    { font-size: 24px; }
```

```
설정 → 접근성
  색맹 모드: [끄기 | 적녹 | 적색 | 청황]
  글자 크기: [작게 | 보통 | 크게 | 매우 크게]
```

#### 배경 이미지 화면 전환 일관성

배경 이미지는 게임 세계관을 구성하는 요소다. 화면 전환 시마다 배경이 바뀌면 몰입이 깨진다.

- 동일 게임 컨텍스트 내 화면 전환(로비 → 대기실 → 역할 확인 → 게임)에서 **배경 이미지를 유지**하거나 자연스럽게 이어지도록 한다
- React: `App` 또는 최상위 레이아웃 컴포넌트에 배경을 고정하고 내부 뷰만 교체

```css
/* 배경 유지 패턴 — 최상위 래퍼에 배경 고정 */
.app-root {
  background-image: url('/bg/game-bg.jpg');
  background-size: cover;
  background-position: center;
  /* 화면 전환 시 이 배경은 그대로 유지됨 */
}
```

### 4.3 반응형 멀티 레이아웃

#### 브레이크포인트 기준
```css
/* 모바일 세로 */
@media (max-width: 640px) {
  .game-body { flex-direction: column; }
  .sidebar {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
  }
}

/* 가로 모드 소형 기기 */
@media (orientation: landscape) and (max-height: 500px) {
  .game-body { flex-direction: row; }
  .card { /* 축소 사이즈 */ }
}

/* 태블릿/데스크톱 */
@media (min-width: 768px) {
  .game-body { flex-direction: row; }
  .sidebar { width: 250px; border-right: 1px solid var(--border); }
}
```

#### 레이아웃 전환 원칙
- 모바일 세로: **세로 스택** (사이드바 → 가로 스크롤 바로 전환)
- 가로 모드: **2열 레이아웃** (좌: 플레이어, 우: 게임 영역)
- 데스크톱: **3열 레이아웃** (좌: 플레이어, 중앙: 게임, 우: 패)

### 4.4 Safe Area & 노치 대응

#### 필수 meta 태그
```html
<meta name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

#### CSS 적용 패턴
```css
/* 방법 1: CSS 변수로 통합 관리 (number-baseball 패턴, 권장) */
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
}

.header { padding-top: max(8px, var(--sat)); }
.hand-area { padding-bottom: max(12px, var(--sab)); }

/* 방법 2: 직접 사용 (Love-Letter 패턴) */
.header { padding-top: max(8px, env(safe-area-inset-top)); }
```

#### 모바일 하단 버튼 잘림 방지 (필수)

게임 버튼(게임 시작, 턴 종료, 제출 등)이 모바일에서 하단에 잘리는 것은 게임을 진행 불가 상태로 만드는 치명적 오류다.

- 레이아웃을 `flex-direction: column`으로 구성하고 버튼 영역에 `flex-shrink: 0`을 부여해 콘텐츠가 늘어나도 버튼이 밀리지 않도록 한다
- 플레이어 목록·패 등 가변 콘텐츠 영역만 `overflow-y: auto`로 스크롤 가능하게 하고, 버튼은 항상 고정

```css
.game-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.scrollable-content {
  flex: 1;
  overflow-y: auto;
}
.action-buttons {
  flex-shrink: 0;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

### 4.5 고정 헤더 & 뷰포트 잠금

#### 뷰포트 잠금 (스크롤 방지)
```css
html, body, #root {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: fixed;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
```

#### 헤더 구성
```css
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}
```

#### 헤더 콘텐츠 구성
```
[방번호 (골드)] | [라운드/턴 정보] | [내 닉네임] | ─── 스페이서 ─── | [게임 종료] [나가기]
```

- **내 닉네임**: 항상 헤더에 표시. 자신이 누구인지 한눈에 확인 가능
- **내 턴 표시**: 현재 본인 턴일 때 닉네임 옆 또는 헤더 전체에 시각적 강조
- **방번호**: 헤더에서 테두리(박스)로 감싸 강조. 클릭 시 크게 확대 표시. 복사 버튼은 제공하지 않는다

#### 헤더 타이틀/로고는 데스크톱 전용 (모바일 숨김)

헤더에 게임 타이틀·로고 이미지를 넣을 때는 **데스크톱에서만 표시하고 모바일에서는 숨긴다.** 모바일 좁은 폭에서 타이틀이 공간을 차지하면 우측 버튼(음소거·나가기 등)이 잘려 조작 불가가 된다.

```css
.header-title { display: block; }
@media (max-width: 640px) {
  .header-title { display: none; }   /* 모바일: 버튼 공간 확보 위해 숨김 */
}
```

- 타이틀을 숨긴 모바일에서도 방번호·내 닉네임·핵심 버튼은 항상 보이게 한다
- 헤더는 로비를 제외한 **대기실·게임 등 모든 인게임 화면에 동일하게** 고정 적용한다 (화면마다 헤더 유무가 달라지면 안 됨)

#### 라운드 표기 방식

`R1`, `R1/3` 같은 약식 표기 대신 **자연스러운 한국어 표기**를 사용한다.

```
✅  1라운드  /  3라운드 중 1라운드
❌  R1       /  R1/3
```

#### 나가기 버튼 분기

나가기 버튼은 **로비로 나가기**와 **대기실로 나가기** 두 가지를 제공한다. 나가기 버튼 하나를 두고 클릭 시 모달에서 선택하는 방식도 허용.

- **로비로 나가기**: 방을 완전히 벗어남. 방번호를 다시 입력해야 재입장 가능
- **대기실로 나가기**: 같은 방의 대기 화면으로 복귀. 방은 유지됨
- 호스트·일반 플레이어·진행자 모두에게 이 선택지를 제공한다

```css
/* 내 닉네임 기본 */
.header-my-nickname {
  color: var(--text-dim);
  font-size: clamp(12px, 1.6vh, 15px);
}

/* 내 턴일 때 강조 */
.header-my-nickname.my-turn {
  color: var(--gold);
  font-weight: bold;
  animation: pulse 1.2s ease-in-out infinite;
}
```

#### Z-Index 계층 관리
| 계층 | z-index | 용도 |
|------|---------|------|
| 헤더 | 100 | 고정 네비게이션 |
| 드롭다운/툴팁 | 150 | 오버레이 요소 |
| 모달 | 200~600 | 게임 이벤트 모달 |
| 최상위 오버레이 | 1000 | 로딩, 에러, 전체화면 토글 |

#### 전체화면 토글 + 헤더 패딩 동기화 (데스크톱 권장)

모든 화면 공통 우상단 `position: fixed` 전체화면 토글(`FullscreenToggle`)을 App 레벨에서 한 번만 렌더. Fullscreen API 미지원 환경(`!document.fullscreenEnabled`)에서는 컴포넌트 자체를 렌더하지 않는다.

각 화면의 헤더 우측 끝 버튼(나가기, 음소거 등)과 겹치지 않도록 **모든 헤더 CSS에 `padding-right: clamp(56px, 7vw, 72px)` 공통 추가**. → 부록 §F.2 참조.

### 4.6 모달 큐(Queue) 시스템

게임 이벤트가 빠르게 연속 발생할 때 모달을 **순차적으로** 표시한다.

#### 구현 패턴
```javascript
// 상태
const [gameState, setGameState] = useState({ modalQueue: [] });

// 큐에 추가 (이벤트 핸들러에서)
setGameState(prev => ({
  ...prev,
  modalQueue: [...(prev.modalQueue ?? []), { type: 'challenge_result', ...payload }]
}));

// 첫 번째 모달만 렌더링
const firstModal = gameState.modalQueue[0];

// 닫기 = 큐에서 제거
function dismissModal() {
  setGameState(prev => ({
    ...prev,
    modalQueue: (prev.modalQueue ?? []).slice(1)
  }));
}

// Space/Enter로 닫기
useEffect(() => {
  const handler = (e) => {
    if (!firstModal) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      dismissModal();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

#### 모달 타입 예시
- `action_declared`: 액션 선언 알림
- `challenge_result`: 의심 결과
- `influence_lost`: 영향력 상실
- `player_out`: 플레이어 탈락
- `round_end`: 라운드 종료 요약

#### Toast vs Modal 구분 원칙 (신규 게임 필수)

알림 종류에 따라 Toast와 Modal을 구분해서 사용한다. 모든 알림을 풀스크린 모달로 처리하면 게임 화면이 불필요하게 가려진다.

| 종류 | 용도 | 동작 |
|------|------|------|
| **Toast** | 단순 정보 (턴 공지, 결과 알림 등) | 큰 글씨와 글로우로 2초 표시 후 자동 닫힘 |
| **Modal** | 플레이어가 직접 결정해야 하는 경우 | 풀스크린, 수동으로 닫아야 함 |

```jsx
// Toast: 비차단 알림
<Toast variant="info" duration={2000}>Alice의 턴입니다</Toast>

// Modal: 결정 필요 시만
<Modal onConfirm={handleConfirm}>카드를 선택하세요</Modal>
```

#### 토스트 큐 & 타이밍 일관성 (필수)

여러 이벤트가 연달아 발생할 때 토스트가 순서 없이 겹쳐 뜨면 정보를 파악하기 어렵다.

**원칙**
- 동시에 표시되는 토스트는 최대 3개 (이후 큐에 쌓임)
- 표시 순서: 큐에 들어온 순서대로 FIFO
- 각 토스트는 **약 2초 표시 후 자동 닫힘**. 터치·클릭 시 즉시 닫힘
- 새 토스트 등장 시 기존 토스트는 한 방향으로 밀림 (방향 일관성 유지)

```jsx
const [toastQueue, setToastQueue] = useState([]);

function pushToast(message, duration = 2000) {
  const id = Date.now();
  setToastQueue(q => [...q, { id, message }]);
  setTimeout(() => setToastQueue(q => q.filter(t => t.id !== id)), duration);
}
```

**단순 알림 토스트 디자인 기준**
- Ra처럼 배경·테두리·닫기 버튼 **없음**. 텍스트만 크게
- 화면 정중앙 또는 일관된 고정 위치
- 폰트 크기: `clamp(20px, 3vh, 30px)` — 읽기 쉽게 충분히 크게
- 글로우 효과로 가독성을 확보한다. 토스트 박스 배경과 테두리는 만들지 않는다

```css
.toast-simple {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: clamp(20px, 3vh, 30px);
  font-weight: bold;
  color: #fff;
  background: transparent;
  border: 0;
  text-shadow:
    0 0 10px rgba(255, 230, 120, 0.95),
    0 0 22px rgba(255, 180, 70, 0.65),
    0 2px 8px rgba(0,0,0,0.85);
  pointer-events: none;
  z-index: 800;
  animation: fadeInOut 2s ease forwards;
}
```

#### Deferred Actions — 모달과 후속 페이즈 전이 동기화

화면 전환 액션(`QUEST_START`, `GAME_ENDED` 등)이 결과 모달 표시 중 도착하면 즉시 적용돼 사용자가 결과를 못 보고 지나칠 수 있다. **deferrable 액션 타입을 정의해 모달이 떠 있는 동안 보류 큐에 쌓고, 마지막 모달이 닫힐 때 순서대로 flush**한다.

```ts
const DEFERRABLE_TYPES = ['QUEST_START','TEAM_PROPOSED','GAME_ENDED', ...];
if (state.modalQueue.length > 0 && isDeferrable(action)) {
  return { ...state, deferredActions: [...state.deferredActions, action] };
}
// DEQUEUE_MODAL 시 — 모달 큐가 비면 보류 액션을 reducer에 재진입
```

→ 부록 §D 참조.

### 4.7 플레이어 상태 시각화

| 상태 | 시각 표현 |
|------|-----------|
| **현재 턴** | 골드 테두리 글로우 + 배경 하이라이트 |
| **일반** | 기본 스타일 |
| **탈락** | `opacity: 0.38` + 회색 처리 + `line-through` |
| **연결 끊김** | `text-decoration: line-through` + dim 색상 |
| **대상** | 특별 하이라이트 (빨간 테두리 또는 타겟 아이콘 이미지) |
| **행동 중** | 펄스 애니메이션 |

```css
/* 현재 턴 플레이어 */
.player-card.active-turn {
  border-color: var(--gold);
  background: rgba(245, 200, 66, 0.07);
  box-shadow: 0 0 16px rgba(245, 200, 66, 0.4);
}

/* 탈락 플레이어 */
.player-card.eliminated {
  opacity: 0.38;
  filter: grayscale(80%);
}
.player-card.eliminated .player-name {
  text-decoration: line-through;
  color: #444;
}
```

#### 드래그로 순서 변경 + shift 애니메이션 (선택)

대기실에서 좌석 순서를 드래그로 바꿀 때, 끼어들 위치 주변 카드들이 한 칸씩 옆으로 부드럽게 밀려나는 시각 피드백. 순수 CSS + native HTML5 DnD로 구현. **drop target은 카드의 onDrop이 아닌 `dragOverId` 상태로 결정**해야 함 — transform으로 옆 카드가 밀려나면 mouse hit-test가 빈 영역으로 빠지는 케이스 대비 그리드 컨테이너에 fallback `onDrop` 필수. → 부록 §F.1 참조.

#### 겹치는 말/토큰 깊이 정렬 (y값 기반 z-index)

지도·보드 위에서 말(토큰)이 서로 겹칠 때, 화면 아래쪽(y값이 큰) 말이 위 레이어로 오도록 `z-index`를 y 좌표에 비례해 부여한다. 위에서 비추는 시점의 자연스러운 입체감을 만든다.

```jsx
// 좌표 y(0~100 비율 또는 px)를 z-index로 환산 — y가 클수록 앞으로
<div className="piece" style={{
  left: `${piece.x}%`,
  top: `${piece.y}%`,
  zIndex: Math.round(piece.y * 10),   // 아래쪽 말이 위 레이어
}} />
```

- 같은 칸에 여러 말이 겹치면 살짝 오프셋(부채꼴/계단식)을 줘 모두 보이게 한다
- 선택·현재 차례 말은 별도 강조 레이어(글로우)로 띄우되, 깊이 정렬과 충돌하지 않도록 **z-index 대역을 분리**한다 (예: 일반 말 0~1000, 강조 말 1500+)

### 4.8 카드 인터랙션 UI

#### 카드 상태별 스타일

> **주의**: 클래스 구조가 프로젝트마다 다름 — coup: `.card-wrap.selected`, Love-Letter: `.card.selected`

```css
/* 선택 가능 (기본) */
.card-wrap { cursor: pointer; transition: all 0.15s; }

/* 호버 */
.card-wrap:hover { transform: translateY(-2vh); }

/* 선택됨 (coup 패턴) */
.card-wrap.selected { transform: translateY(-4vh); }
.card-wrap.selected .card-img {
  border: 3px solid var(--gold);
  box-shadow: var(--gold-glow);
}

/* 비활성 */
.card.disabled {
  opacity: 0.6;
  cursor: default;
  pointer-events: none;
}

/* 공개/사용됨 */
.card.revealed {
  filter: grayscale(80%) brightness(0.55);
}

/* 유효하지 않은 선택 시 흔들기 */
.card.invalid-flash {
  animation: shake 0.4s ease;
}
```

#### 터치 최적화
```css
body {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
}
```

#### 선택 불가 카드/버튼 사전 차단 (필수)

서버 검증만으로는 부족하다. 클라이언트에서도 사용 불가한 카드·버튼을 **사전에 비활성화**해야 한다. "제출할 수 없는 카드"라는 에러가 뜨는 것은 UX 실패다.

- 현재 페이즈·턴에서 낼 수 없는 카드는 `pointer-events: none` + `opacity: 0.45` + 회색 처리
- 비활성 버튼에는 `disabled` 속성 명시 (`<button disabled>`)
- 서버에서 내려오는 `gameState`에 현재 허용 액션 목록(`allowedActions`)을 포함해 클라이언트가 능동적으로 판단하도록 설계

```js
// 서버: 매 상태 업데이트 시 허용 액션 포함
broadcast(room, 'GAME_STATE', {
  ...gameState,
  allowedActions: getAllowedActions(room, playerId), // ['PLAY_CARD', 'END_TURN']
});

// 클라이언트: allowedActions로 버튼 활성화 결정
const canPlay = allowedActions.includes('PLAY_CARD');
<button disabled={!canPlay} className={!canPlay ? 'disabled' : ''}>카드 내기</button>
```

#### 카드 제출 후 결과 표시 흐름

카드를 제출하는 순간 즉시 사라지거나 결과가 나와버리면 무슨 일이 일어났는지 파악할 수 없어 혼란스럽다.

**원칙**: 모든 제출이 완료된 후 **결과를 보여주고**, 충분히 확인한 다음 다음 단계로 넘어간다.

```
1. 플레이어가 카드/액션 제출
2. 모든 대상 플레이어가 제출 완료될 때까지 제출된 카드를 화면에 유지
3. 전원 제출 완료 → 결과 표시 (승패 판정, 효과 적용 등)
4. (확인 버튼 또는 2~3초 대기) → 다음 턴/단계로 전환
```

- 타이머로 자동 넘어가는 경우에도 최소 2초는 결과를 보여준다
- 확인 버튼 방식은 진행자나 증인이 페이스를 조절할 수 있어서 현장 게임에 적합하다

### 4.9 키보드 & 접근성

#### 키보드 지원 — 우선순위 (신규 게임 필수)

모든 클릭 가능한 요소는 키보드로도 조작 가능해야 한다.

- 클릭 가능한 요소는 반드시 `<button>` 또는 `<a>` 시맨틱 태그 사용 (`<div onClick>` 금지)
- 포커스 인디케이터 명시적으로 표시

```css
button:focus-visible {
  outline: 3px solid var(--color-accent-gold);
  outline-offset: 2px;
}
```

#### 공통 단축키 (전 프로젝트 적용 권장)

| 키 | 컨텍스트 | 동작 |
|----|----------|------|
| **Space / Enter** | 모달 | 확인/닫기 |
| **Escape** | 모달/메뉴 | 취소/뒤로 |
| **Arrow Up/Down** | 메뉴 목록 | 항목 탐색 |
| **Arrow Left/Right** | 카드 패 | 카드 선택 이동 |
| **1~9** | 액션 선택 | 번호로 바로 선택 |
| **Backspace** | 다단계 메뉴 | 이전 단계로 |

#### 구현 패턴
```javascript
// Ref 기반 핸들러 (의존성 제거)
const kbRef = useRef();
kbRef.current = (e) => {
  if (e.code === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(max, c + 1)); }
  else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); confirmSelection(); }
  else if (e.code === 'Escape') { e.preventDefault(); cancel(); }
};

useEffect(() => {
  const handler = (e) => kbRef.current(e);
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

#### 스크린 리더(ARIA) 지원 — 후순위 (여유 있을 때 적용)

시각 장애인 사용자를 위한 스크린 리더 지원. 키보드 지원 완료 후 적용한다.

```jsx
<button
  aria-label={`${label} (${index + 1}번 키로 선택)`}
  aria-pressed={cursor === index}
>
  {label}
</button>
```

- 게임 상태 변화 시 `aria-live` 영역으로 스크린 리더에 알림
- WCAG 2.1 AA 기준 준수 목표

---

### 4.10 상태 관리 — useReducer + Context (신규 게임 권장)

`useState` 여러 개를 나열하는 대신, 게임 상태를 한 바구니에 모아 어느 컴포넌트에서든 직접 꺼내 쓴다. Set-Card-Game이 이 패턴으로 구현되어 있으므로 참고한다.

```jsx
// gameReducer.js
function gameReducer(state, action) {
  switch (action.type) {
    case 'TOGGLE_MODAL':
      return { ...state, ui: { ...state.ui, [action.modal]: !state.ui[action.modal] } };
    case 'UPDATE_GAME':
      return { ...state, game: { ...state.game, ...action.payload } };
    default:
      return state;
  }
}

// 사용
const [state, dispatch] = useReducer(gameReducer, initialState);
```

- 상태가 단순한 게임은 `useState`도 무방
- 컴포넌트 depth가 3단계 이상이거나 상태가 10개 이상이면 이 패턴 적용 권장

---

### 4.11 PWA 설정 (필수)

모든 게임은 홈 화면 추가 후 앱처럼 실행되는 PWA를 기본 지원한다.

#### manifest.json

```json
{
  "name": "게임 전체 이름",
  "short_name": "게임명",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1b2a",
  "theme_color": "#0d1b2a",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- `display: "standalone"` — 주소창·브라우저 UI 없이 앱처럼 실행
- `maskable` 아이콘 필수 — Android에서 원형/모양 아이콘으로 잘리지 않도록
- `background_color` / `theme_color` — 게임 다크 테마 색상과 일치시킬 것

#### index.html 링크

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0d1b2a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="게임명" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

#### Vite 프로젝트 설정 (vite-plugin-pwa 권장)

```js
// vite.config.js
import { VitePWA } from 'vite-plugin-pwa'

export default {
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,        // manifest.json 직접 관리 시 false
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
}
```

#### 아이콘 규격 요약

| 파일 | 크기 | 용도 |
|------|------|------|
| `icon-192.png` | 192×192 | Android 홈 화면, PWA 기본 |
| `icon-512.png` | 512×512 | 스플래시 화면 |
| `icon-512-maskable.png` | 512×512 | Android 적응형 아이콘 |
| `apple-touch-icon.png` | 180×180 | iOS 홈 화면 추가 |

#### 새로고침 시 초기 화면 규칙

새로고침 또는 최초 접속 시 **무조건 로비(입장) 화면으로 시작**한다. sessionStorage에 방 정보가 있더라도 자동으로 방에 입장시키지 않는다.

```
✅ 새로고침 → 로비 화면 (방번호·닉네임 입력)
❌ 새로고침 → 자동으로 이전 방 재입장
```

#### 모바일 뷰포트 & 오버스크롤 고정 (필수)

standalone PWA는 브라우저 UI가 없어 **오버스크롤(러버밴드)·확대·주소창 여백**이 그대로 게임 화면을 흔든다. 특히 캔버스·드래그가 있는 게임은 제스처가 페이지 스크롤로 새면 조작이 깨지므로 뷰포트를 고정한다. (speed-draw: iOS·맥에서 러버밴드 바운스로 캔버스가 밀리는 이슈 → 규칙화)

```html
<!-- viewport-fit=cover: iOS 노치/홈바 safe-area 대응, user-scalable=no: 핀치 줌 차단 -->
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, maximum-scale=1" />
```

```css
html, body {
  height: 100%;
  overflow: hidden;               /* 페이지 스크롤 자체를 제거 */
  overscroll-behavior: none;      /* 러버밴드/바운스 및 pull-to-refresh 차단 */
  position: fixed;                /* iOS 주소창 여닫힘에 따른 리플로우 방지 */
  width: 100%;
  -webkit-user-select: none;      /* 길게 눌러 텍스트 선택되는 것 방지 */
  user-select: none;
  overscroll-behavior-y: contain;
}

/* 캔버스/드래그 영역: 브라우저 기본 제스처(스크롤·줌)를 삼켜 그리기에만 반응 */
.canvas, .draggable {
  touch-action: none;
  -webkit-touch-callout: none;    /* 길게 눌러 뜨는 iOS 컨텍스트 메뉴 차단 */
}
```

- **`overscroll-behavior: none`** — 러버밴드/당겨서 새로고침 제거. 스크롤이 필요한 내부 패널만 `auto`로 예외 허용.
- **`position: fixed` + `overflow: hidden`** — iOS 주소창이 접히며 뷰포트 높이가 튀는 현상 방지. 높이는 `100dvh`/`100svh` 또는 JS `--vh` 변수로 잡는다.
- **`touch-action: none`** — 캔버스/드래그 요소는 반드시 지정. 미지정 시 스크롤·줌 제스처와 충돌해 "그려지지 않음"으로 오인된다(§부록 E 참조).
- **safe-area** — `padding: env(safe-area-inset-*)` 로 노치·홈바 침범 방지.

- 재접속이 필요하면 플레이어가 직접 방번호를 입력해서 들어오게 한다
- sessionStorage는 입력 편의(자동완성)에만 활용하고, 자동 입장 트리거로 쓰지 않는다

---

### 4.12 로비 화면 필수 요소

모든 게임의 로비(입장) 화면은 아래 요소를 포함한다.

#### 서버 접속 상태 신호등

서버 연결 여부를 색상으로만 표시한다. 텍스트 레이블이나 테두리 없이 **작은 동그라미(dot)**만 사용한다.

```css
.server-dot {
  width: clamp(8px, 1.2vw, 12px);
  height: clamp(8px, 1.2vw, 12px);
  border-radius: 50%;
  /* 연결됨: #4CAF50 / 연결 중·불안정: #FF9800 / 끊김: #c0392b */
}
```

#### 방번호 확대

방번호를 클릭/터치하면 화면 중앙에 크게 확대 표시한다. **복사 버튼은 제공하지 않는다.** 눈으로 보고 옮겨 적거나 화면을 보여주는 방식으로 공유한다.

#### 최근 접속 목록

마지막으로 접속했던 방번호와 닉네임을 목록으로 표시한다. 다시 입장할 때 탭 한 번으로 자동 입력되게 한다.

- 각 항목에 **삭제(✕) 버튼** 제공
- 목록이 길어지면 **목록 영역만 스크롤**, 로비 패널 전체는 고정
- `localStorage` 기반으로 저장 (최대 10개, 최신 순)

```
┌─────────────────────────────┐  ← 로비 패널 고정
│  방번호 [___]  닉네임 [___] │
│                             │
│  최근 접속                  │
│ ┌─────────────────────────┐ │  ┐
│ │ 042  홍길동          ✕  │ │  │
│ │ 117  김철수          ✕  │ │  ├ 이 영역만 스크롤
│ │ 033  이영희          ✕  │ │  │
│ └─────────────────────────┘ │  ┘
│         [입장하기]          │
└─────────────────────────────┘
```

```css
.recent-list {
  max-height: clamp(120px, 20vh, 240px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

#### 기타 로비 원칙

- 방번호 입력칸은 숫자 전용 (`inputMode="numeric"` + `pattern="[0-9]*"`)
- 방번호·닉네임 입력 후 **Enter 키로 바로 입장** 가능

---

## 5. 게임 편의성 — 플레이어 경험 향상

### 5.1 클라이언트 단독 타이머

타이머가 필요한 경우 **클라이언트 단독 방식을 표준으로 사용한다.** 서버 타임스탬프 기준 동기화는 클라이언트 간 시간차가 발생하므로 사용하지 않는다.

서버 동기화 없이 클라이언트에서 독립적으로 타이머를 운영한다.

```
서버: turn-start { timeoutSeconds: 30 } → 브로드캐스트
클라이언트: 로컬 setInterval 카운트다운 시작
타임아웃 시: 현재 턴 플레이어 클라이언트가 timeout 이벤트 전송
서버: 타임아웃 처리 + 다음 턴 진행
```

#### 장점
- 네트워크 지연 무관한 부드러운 UI
- 서버 부하 감소
- 서버는 fallback 검증만 담당

#### 시각 피드백
- 5초 이하: 긴급 색상 (빨강) + 펄스 애니메이션
- 자동 제출/패스 시 안내 메시지

### 5.2 자동/강제 액션

| 조건 | 동작 | 프로젝트 |
|------|------|----------|
| 코인 10개 이상 | 쿠데타만 가능 (`mustCoup: true`) | coup |
| 전원 패스 | 즉시 다음 단계 진행 (기본 3초 대기) | coup |
| 타임아웃 | 자동 패스/다음 턴 | 전체 |
| 호스트 강제 패스 | 특정 플레이어 턴 스킵 | Drawing-game |
| 전원 투표 일치 | 자동 진행 | skull-king |
| Card 7/8 보유 조건 | 강제 폐기 (`FORCED_DISCARD_7`) | Love-Letter |

### 5.3 확인 대화상자 (고비용·되돌릴 수 없는 액션)

돌이킬 수 없거나 비용이 큰 중요한 결정에만 확인 대화상자를 표시한다. 모든 액션에 달면 게임 템포를 해친다.

```
"Bob에게 쿠데타? (7코인 소비)"
  [취소]  [확인]
```

적용 기준 예시: 쿠데타, 의심(Challenge), 암살 등 — 단순 코인 획득이나 패스에는 달지 않는다.

### 5.4 자동 재접속 & 백그라운드 앱 복귀

#### 기본 원칙

백그라운드에 잠깐 들어갔다 돌아와도 게임을 이어서 할 수 있어야 한다.  
연결 유지를 위한 keepalive ping은 허용한다 — Render 프록시는 일정 시간 트래픽이 없으면 WebSocket을 idle로 끊으므로, 짧은 주기(예: 클라이언트 25초 PING)로 연결을 살려 두는 편이 실전에서 안정적이다.

```
클라이언트 keepalive ✅ → 25초 주기 PING으로 Render 프록시 idle 끊김 방지
서버 Heartbeat ✅      → 서버가 45초 주기로 ping → 클라이언트 pong 응답 (§3.5)
포그라운드 복귀 재연결 ✅ → visibilitychange 감지 시 연결 상태 확인 후 재연결
```

> **40분 무입력 시 Render 슬립 허용**: 빈 방을 무한정 깨워 둘 필요는 없다. 마지막 플레이어 입력 이후 **40분간 아무 입력이 없으면 클라이언트·서버 양쪽이 모두 keepalive를 멈추고 Render 슬립을 허용한다.** 다시 누군가 접속(포그라운드 복귀·재입력)하면 콜드 스타트 후 재개된다. (서버 측 유휴 감지 정책은 §3.5 참고)

> **핵심 — keepalive는 "사용자 입력"에 게이팅한다**: keepalive PING 자체는 활동으로 치지 않는다. "마지막 사용자 입력 시각(`lastInputAt`)"만 활동으로 기록하고, 클라이언트 PING과 서버 self-ping 둘 다 이 시각 기준 40분이 지나면 멈춘다. 그래야 "활성 세션은 깨워 두기"와 "방치 세션은 40분 뒤 슬립"이 모순 없이 동시에 성립한다. **클라이언트 PING만 게이팅하지 않으면, 탭이 열려 있는 한 PING 트래픽이 서버를 계속 깨워 슬립이 영영 발동하지 않는다.**

```javascript
// 클라이언트: 사용자 입력에만 lastInputAt 갱신 (PING/탭 전환은 활동 아님)
const lastInputAtRef = useRef(Date.now());
function onUserInput() { lastInputAtRef.current = Date.now(); } // 게임 액션·클릭·키 입력에서 호출

// 25초 keepalive PING — 40분 무입력이면 스스로 중단 → Render 슬립 허용
const pingTimer = setInterval(() => {
  if (Date.now() - lastInputAtRef.current > 40 * 60 * 1000) return; // 멈춤 (다음 입력 시 재개)
  const ws = wsRef.current;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PING' }));
  }
}, 25_000);
```

#### visibilitychange 이벤트 처리
```javascript
const handleVisibility = () => {
  if (document.visibilityState !== 'visible') return;
  const ws = wsRef.current;
  if (!ws || ws.readyState >= 2) { // CLOSING or CLOSED
    clearTimeout(reconnectRef.current.timer);
    reconnectRef.current.timer = null;
    wsRef.current = createWs(); // 재연결 후 JOIN_ROOM 자동 전송
  }
};
document.addEventListener('visibilitychange', handleVisibility);
```

#### sessionStorage 기반 자동 재입장
```javascript
// 방 입장 시 저장
sessionStorage.setItem('game_room', JSON.stringify({ nickname, roomCode, isModerator }));

// 재연결 시 자동 복구 (포그라운드 복귀 시에만)
const saved = sessionStorage.getItem('game_room');
if (saved) {
  const { roomCode, nickname } = JSON.parse(saved);
  ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { nickname, roomCode } }));
}
```

> **주의**: sessionStorage는 포그라운드 복귀 재연결에만 사용한다. 새로고침·최초 접속 시 자동 입장 트리거로 쓰지 않는다. (4.11 참고)

#### 재접속 중복 방지
```javascript
const reconnectRef = useRef({ timer: null });
// 타이머 중복 방지 로직으로 동시 다발적 재연결 시도 차단
```

#### 재접속 UX 오버레이 (신규 게임 필수)

재연결 시도 중 유저에게 현재 상태를 명시적으로 표시한다. 무음 재연결은 게임이 멈춘 건지 인터넷 문제인지 알 수 없어 혼란을 유발한다.

```
CONNECTED    → 표시 없음
RECONNECTING → "재연결 중... 시도 2/3" + 스피너 오버레이
FAILED       → "연결 실패" + [다시 참여] [나가기] 버튼
RECONNECTED  → Toast: "재연결됨!" (1초 후 자동 닫힘)
```

### 5.5 도움말/튜토리얼 시스템

튜토리얼은 **강제로 표시하지 않는다.** 플레이어가 `?` 버튼을 눌러 직접 찾아보는 방식으로만 제공한다.

#### 인게임 도움말 모달
- 게임 화면에 `?` 버튼 배치 (항상 접근 가능)
- 카드 설명, 액션 비용, 차단 가능 여부 등 레퍼런스 표시
- Space/Enter/Escape로 닫기

#### 튜토리얼 구성 (권장)
- **규칙 요약**: 게임 목표 + 카드/액션 설명 (슬라이드 또는 탭 형식)
- **인터랙티브 모의 턴**: 실제 UI로 한 번 따라해보기 (선택적)
- **인게임 툴팁**: 액션 버튼 hover/포커스 시 간단한 설명 표시

#### 구현 (coup HelpModal 참고 — 현재 coup만 구현)
- 5개 캐릭터(공작, 암살자, 대사, 캡틴, 백작부인) 카드별 action + block 능력 설명
- 3개 기본 액션(소득: +1코인, 해외원조: +2코인, 쿠데타: 7코인) 설명
- 풀스크린 모달 + 슬라이드업 애니메이션 + Space/Enter/Escape 닫기

### 5.6 규칙 변형 & 난이도 설정

#### 설정 가능 항목 (게임별)
- 자릿수(3~6), 중복 허용 여부, 목표 토큰(1~10 또는 무제한) (number-baseball-game)
- 기본/확장 규칙, Card7/8 변형(`card7Type`: 7-1/8-1 vs 7-2/8-2), 진행자 손패 열람 (Love-Letter)
- 최대 라운드 수 (skull-king: `maxRounds = Math.min(Math.floor(70/playerCount), 10)`)
- 타이머 ON/OFF, 시간 설정(5~60초) (Drawing-game)

#### skull-king 투표 시스템 (호스트리스 모드)
플레이어 전원 투표로 게임 진행을 결정한다:
- **ghostMode**: Ghost AI 추가 여부
- **shuffle**: 플레이어 순서 섞기
- **nextTrick**: 다음 트릭 진행
- **nextRound**: 다음 라운드 진행
- 불일치 시: `vote_mismatch` 이벤트 → 재투표 요청

#### 설정 UI 위치
- 대기실(로비)에서 호스트만 조작 가능
- 게임 시작 전까지 변경 가능

### 5.7 사운드 자산 최적화 (avalon-game 적용)

BGM은 게임 분위기용이라 CD 음질이 불필요. **MP3 320 kbps → OGG Opus 96 kbps**로 약 60% 절감 가능. 호환성은 모던 데스크탑 브라우저(Chrome/Firefox/Edge/Safari 11+) 모두 OK. iOS 미지원 환경까지 고려해야 하면 AAC 128 kbps(`.m4a`)로 대체.

```bash
ffmpeg -i main-title.mp3 -c:a libopus -b:a 96k main-title.ogg
```

→ 부록 §G 참조.

### 5.8 효과음(SFX) 가이드라인

게임 몰입도를 높이는 핵심 요소다. 주요 이벤트마다 효과음을 적용한다.

#### 적용 우선순위

| 이벤트 유형 | 예시 | 우선순위 |
|-------------|------|---------|
| 카드 제출/사용 | 카드 내는 소리 | 필수 |
| 공격/피해 | 총소리, 타격음 | 필수 |
| 피해 수용/탈락 | 피격음 | 필수 |
| 승리/패배 판정 | 성공음, 실패음 | 필수 |
| 카드 드로우 | 카드 넘기는 소리 | 권장 |
| 특수 효과 발동 | 게임별 SFX | 권장 |
| BGM | 배경 음악 | 선택 |

#### 음소거 상태 전역 유지 (필수)

음소거 버튼은 BGM + 모든 효과음을 **동시에** 끈다. 화면을 전환해도 음소거 상태가 유지되어야 한다.

- `localStorage`에 `soundEnabled` 저장. 앱 최초 로드 시 복원
- 음소거 상태는 App 최상위에서 관리. 로비·대기실·게임 화면 모두 동일 상태 참조
- 로비 화면에는 음소거 버튼을 두지 않는다. **방장(호스트)에게만** 표시하거나 게임 화면에만 표시

```js
// 앱 최상위 (App.jsx)
const [soundEnabled, setSoundEnabled] = useState(
  () => localStorage.getItem('soundEnabled') !== 'false'
);

function toggleSound() {
  const next = !soundEnabled;
  setSoundEnabled(next);
  localStorage.setItem('soundEnabled', String(next));
}
```

#### BGM과 SFX 토글 분리 (대상·범위가 다를 때)

BGM과 효과음(SFX)은 **들리는 대상과 제어 범위가 다를 수 있으므로** 토글을 분리할 수 있다(헤더에 두 버튼을 나란히 배치). 화이트홀 사례:

| 종류 | 재생 대상 | 토글 노출 | 토글 적용 범위 |
|------|----------|----------|--------------|
| **BGM** | 호스트 화면에서만 재생 (현장 1대 스피커 가정) | 호스트에게만 | 호스트 본인 |
| **SFX** | **모든 플레이어**에게 재생 | **전원에게** | 각 플레이어 본인 기기 |

- BGM은 현장에서 한 대(호스트 기기)로 깔아 주는 분위기 음악이라 호스트만 재생·제어한다
- SFX는 각자 기기에서 울려야 하므로 전원에게 재생하고, 음소거 토글도 모든 플레이어에게 노출한다
- 두 토글 상태 모두 `localStorage`에 저장해 화면 전환·새로고침 후에도 유지한다 (위 음소거 상태 전역 유지)
- 단일 음향만 쓰는 게임은 위 단일 토글로 충분하다

#### 중복 재생 방지

같은 이벤트에 대해 여러 경로로 동일한 효과음이 중복 재생되지 않도록 한다. 특히 진행자 화면에서는 다른 플레이어 이벤트와 자신의 이벤트가 겹쳐 재생될 수 있으니 주의한다.

```js
// 중복 방지 패턴 — 재생 중인 사운드는 건너뜀
function playSound(src) {
  if (!soundEnabled) return;
  const audio = new Audio(src);
  audio.play().catch(() => {}); // 자동재생 정책 에러 무시
}
```

### 5.9 미구현 — 향후 고려 사항

| 기능 | 상태 | 권장 |
|------|------|------|
| **햅틱 피드백** | 미구현 (전 프로젝트) | 모바일 진동 (`navigator.vibrate`) |
| **게임 로그/히스토리** | 부분 구현 (coup 진행자 로그) | 전체 액션 로그 패널 |
| **관전자 모드** | 부분 구현 | 비참여 실시간 관전 |

---

## 6. 크로스 프로젝트 패턴 매트릭스

### 6.1 구현 현황 요약

| 패턴 | Coup | Drawing | Love-Letter | Baseball | Set-Card | Skull-King | Timeline | **Battle-Ship** | **Bang!** | **Galpang** | **Initial** |
|------|:----:|:-------:|:-----------:|:--------:|:--------:|:----------:|:--------:|:---------------:|:---------:|:-----------:|:-----------:|
| 3자리 방번호 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 호스트 이양 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 재접속 복구 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| sessionId 재접속 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| wsId 맵 (연결추적) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ |
| 진행자/관전 모드 | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⚠️ | ✅ | ⬜ |
| 상태 머신 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 멀티-페이즈 턴 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ⬜ |
| 서버 자동진행 타이머 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ✅ |
| Fisher-Yates 셔플 | ✅ | ⬜ | ✅ | ⬜ | ✅ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| 비율 기반 CSS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 다크 테마 + 골드 | ✅ | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 반응형 레이아웃 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safe Area 대응 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 고정 헤더 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 모달 큐 | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 플레이어 상태 시각화 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 카드 인터랙션 | ✅ | ⬜ | ✅ | ⬜ | ✅ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| 키보드 단축키 | ✅ | ⬜ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 클라이언트 타이머 | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ⬜ |
| 자동 재접속 | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| sessionStorage 복구 | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 규칙 변형 | ⬜ | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ✅ | ⬜ |
| 도움말 모달 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 사운드/햅틱 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| MongoDB 영속성 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| AI 플레이어 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| Keep-Alive (유휴감지) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ✅ |

> ✅ = 구현됨, ⚠️ = 부분 구현, ⬜ = 미구현

#### avalon-game 추가 패턴 (사회적 추론 게임 전용)

| 패턴 | 구현 |
|------|:----:|
| 3자리 방번호 / 호스트 이양 / 재접속 / 상태 머신 / 비율 CSS / 다크 테마 / Safe Area / 고정 헤더 | ✅ |
| 모달 큐 + **Deferred Actions** (후속 페이즈 전이 동기화) | ✅ |
| **LLM 기반 의심 점수 (`SuspicionAnalyzer`)** | ✅ |
| **전체 행동 이력 누적 (`voteHistory`)** | ✅ |
| **AI 봇 의사결정 (책임 기반 추론, knownEvilFromOwnFails 등)** | ✅ |
| **동적 역할 조합 (확장 카드 must/random/off)** | ✅ |
| **send() silent drop 토스트 방어** | ✅ |
| **드래그 reorder shift 애니메이션** | ✅ |
| **전체화면 토글 + 헤더 패딩 동기화** | ✅ |
| **OGG Opus 오디오** (BGM 60% 절감) | ✅ |
| 진행자/관전 모드 / 진행자 수동 게이트 | ✅ |
| 사운드(BGM + SFX) + 뮤트 토글 | ✅ |
| 키보드 단축키 (Space/Enter/Escape) | ✅ |
| AI 플레이어(봇) | ✅ |
| 규칙 변형 (기본/확장) | ✅ |

세부 구현은 **부록: Avalon-Game 적용 사례** 참고.

### 6.2 표준 프로젝트 구조 (신규 게임 필수)

새로 만드는 게임은 아래 폴더 구조를 기준으로 시작한다.

```
game-name/
├── server/
│   ├── index.js                       # Express + WebSocket(ws) 셋업
│   ├── services/
│   │   ├── roomService.js             # 방 CRUD + 호스트 이양
│   │   ├── gameService.js             # 게임 상태 머신 + 규칙
│   │   └── persistenceService.js      # 저장/복구 (필요 시)
│   ├── handlers/
│   │   ├── roomHandlers.js            # CREATE_ROOM, JOIN_ROOM
│   │   ├── gameHandlers.js            # PLAY_ACTION 등
│   │   └── connectionHandlers.js      # heartbeat, reconnect
│   └── config/
│       └── gameConfig.js              # 게임별 규칙 설정
├── client/
│   ├── src/
│   │   ├── hooks/useGameSocket.js
│   │   ├── components/
│   │   └── stores/
│   └── vite.config.js
├── package.json
└── .env.example
```

### 6.3 신규 게임 필수 체크리스트

#### 개발 착수 전 필수 결정 사항

구현에 들어가기 전, 아래 항목을 반드시 확인하고 PRD에 명시한다. 개발 중반에 바뀌면 일정이 크게 틀어진다.

**게임 지속성 타입 결정**

| 타입 | 설명 | 구현 영향 |
|------|------|-----------|
| **일회성 세션** | 게임 종료 또는 서버 재시작 시 상태 소멸. 이어하기 없음 | 서버 메모리만 사용, DB 불필요 |
| **영속 세션** | 중간에 종료해도 나중에 이어서 진행 가능 | DB 저장 필수, 상태 직렬화 + 복구 로직 필요 |

- **일회성**: 방이 비거나 서버 재시작 시 게임 소멸해도 무방한 게임 (카드 게임, 파티 게임 등)
- **영속**: 장기 캠페인, 랭킹 누적, 중단 후 재개가 필요한 게임

로비 화면 공통 요건(서버 신호등, 최근 접속 목록, 방번호 확대 등)은 §4.12 참조.

> 결정하지 않고 시작하면 개발 중반에 DB 연동이 추가되어 방 관리·재접속·배포 구조가 전면 변경될 수 있다. **반드시 먼저 결정할 것.**

---

새 게임 개발 시 아래 항목을 반드시 포함한다:

#### 필수 (Tier 1)
- [ ] 3자리 방번호 + 메모리 기반 방 관리
- [ ] 호스트 권한 + FIFO 자동 이양
- [ ] 닉네임+방번호 재접속 복구 + isReconnect 플래그
- [ ] 재접속 시 페이즈별 UI 즉시 복원 (체력·장착·페이즈 포함)
- [ ] 장시간/복잡 상태 게임은 `GameSnapshot` 저장 + 서버 재시작 복구 설계
- [ ] 명령 처리 후 스냅샷 저장, 재접속 후 `PUBLIC_STATE`/`PRIVATE_STATE` 분리 복원
- [ ] 서버 권위 상태 머신 + 턴/페이즈 검증
- [ ] 비율 기반 CSS (`clamp` + `vh/vw`)
- [ ] 버튼 `width: auto` (100% 금지) + 이모지 사용 금지
- [ ] 다크 테마 + 골드 강조색
- [ ] 반응형 레이아웃 (모바일 세로/가로 + 데스크톱)
- [ ] Safe Area + 노치 대응 + 하단 버튼 잘림 방지
- [ ] 고정 헤더 + 뷰포트 잠금
- [ ] 헤더: 라운드 한국어 표기 + 방번호 클릭 확대 + 나가기 분기(로비/대기실)
- [ ] 플레이어 상태 시각화 (현재 턴, 탈락, 연결 끊김)
- [ ] 선택 불가 카드·버튼 클라이언트 사전 비활성화 (`allowedActions` 기반)
- [ ] 카드 제출 후 결과 표시 흐름 (즉시 사라짐 금지, 최소 2초 확인 시간)
- [ ] 게임 종료 시 화면 전환 순서 (공개 → 대기 → 결과화면)
- [ ] 로비 화면: 서버 신호등 + 최근 접속 목록 + 방번호 확대
- [ ] 토스트 큐 & 타이밍 일관성 (FIFO, 약 2초 자동 닫힘, Ra처럼 큰 글씨 + 글로우 + 배경·테두리 없음)
- [ ] WebSocket 끊김/저장 실패/검증 실패는 토스트로 명확히 노출
- [ ] 배경 이미지 화면 전환 일관성 (최상위 고정)
- [ ] Heartbeat (45초 주기)
- [ ] PWA 설정 (`manifest.json` + 앱 아이콘, 주소창 없는 standalone 모드)
- [ ] 진행자 모드 (방 개설 흐름 분기 + 중계 전용 뷰 + 전체 패 열람 + 직접 컨트롤)
- [ ] 진행자 권한 재접속 시 유지 (isModerator 슬롯 복원)
- [ ] 음향: 주요 이벤트 SFX + 음소거 localStorage 전역 유지

#### 권장 (Tier 2)
- [ ] 모달 큐 시스템 (이벤트 순차 표시)
- [ ] 필수 입력 모달은 재접속 후 현재 페이즈 기준으로 재구성
- [ ] 키보드 단축키 (Space/Enter 확인, Escape 취소, 방향키 탐색)
- [ ] 클라이언트 단독 타이머
- [ ] 자동 재접속 (`visibilitychange` + `sessionStorage`)
- [ ] 도움말 모달

#### 선택 (Tier 3)
- [ ] 규칙 변형 & 난이도 설정 (살보 모드 + AI 난이도 Easy/Medium)
- [ ] 투표 시스템 (호스트리스 모드) — 배틀쉽 2인 구조에 불필요
- [ ] 사운드 효과 & 햅틱 피드백 (cannon_fly / explosion / sink)
- [ ] 게임 로그/히스토리 패널 — 미포함 (서버 History 배열만 존재)

---

## 부록: 프로젝트별 핵심 파일 경로

| 프로젝트 | 서버 진입점 | 게임 로직 | 방 관리 | 클라이언트 메인 | CSS |
|----------|------------|----------|---------|---------------|-----|
| coup | `server/index.js` | `server/gameLogic.js` | `server/roomManager.js` | `src/App.jsx` | `src/index.css` |
| Drawing-game | `server.js` | (내장) | (내장) | `public/script.js` | `public/style.css` |
| Love-Letter | `server/index.js` | `server/gameLogic.js` | `server/roomManager.js` | `src/App.jsx` | `src/index.css` |
| number-baseball-game | `server/index.js` | `server/gameLogic.js` | `server/roomManager.js` | `client/src/hooks/useSocket.js` | `client/src/index.css` |
| Set-Card-Game | `server/index.js` | `server/game/gameState.js` | `server/rooms/roomManager.js` | `client/src/` | `client/src/styles/` |
| skull-king | `server/index.js` | `server/utils/gameLogic.js` | (내장) | `client/src/hooks/useGameSocket.js` | `client/src/App.css` |
| time-line-card-game | `server/index.js` | `server/game.js` | `server/game.js` | `client/src/` | `client/src/App.css` |
| **battle-ship-game** | `server/index.js` | `server/services/gameService.js` | `server/services/roomService.js` | `client/src/` | `client/src/index.css` |
| **bang-game** | `server/index.js` | `server/services/gameService.js` | `server/services/roomService.js` | `client/src/` | `client/src/index.css` |
| **Galpang-Jilpang** | `server/index.js` | `server/services/gameService.js` | `server/services/roomService.js` | `client/src/` | `client/src/index.css` |
| **initial-game** | `server/index.js` | `server/services/gameService.js` | `server/services/roomService.js` | `client/src/` | `client/src/index.css` |
| **avalon-game** | `server/index.ts` | `server/services/GameService.ts` + `AIBotService.ts` + `SuspicionAnalyzer.ts` | `server/services/RoomService.ts` | `client/src/App.tsx` + `hooks/useGameSocket.ts` | 각 컴포넌트 인라인 `<style>{...}</style>` |

---

## 7. 마스터 구현 체크리스트

> **목적**: 신규 게임 개발 시 **계획 단계부터 구현 완료까지** 빠뜨리는 항목 없이 점검하기 위한 전체 체크리스트.
> 각 항목 옆의 `§번호`는 이 지침서의 해당 섹션을 가리킨다. 세부 내용은 해당 섹션을 참고할 것.
>
> **사용법**: 계획 에이전트는 산출물 작성 시 해당 항목에 `[x]` 체크. 검증 에이전트는 전체 목록을 재확인.

---

### 🏗️ 7.1 아키텍처 & 기술 스택 결정

- [ ] Node.js (Express) + `ws` 라이브러리 사용 결정 (신규 게임 표준) — §1.1
- [ ] React (Vite) + TypeScript 사용 결정 — §1.1
- [ ] 상태 관리: `useState` + `useRef` (외부 라이브러리 금지) — §1.1
- [ ] 배포 플랫폼: Render 사용 결정 — §1.1
- [ ] **게임 지속성 타입**: 일회성 세션 (메모리 기반, DB 불필요) — §6.3
- [ ] 서버 권위 모델 적용 선언 (낙관적 업데이트 금지 명시) — §1.2

---

### 🎮 7.2 백엔드 — 방 관리

- [ ] 3자리 방번호 생성 (100~999 랜덤, 중복 불가) — §2.1
- [ ] 메모리 기반 방 저장 (`Map<string, Room>`) — §2.1
- [ ] `Room` 객체: code, status, players, settings, gameState 포함 — §2.1
- [ ] `Player` 객체: nickname, ws, isHost, connected, isModerator 포함 — §2.1
- [ ] `joinOrder` 필드로 입장 순서 명시적 추적 (배열 순서 의존 금지) — §2.2
- [ ] 호스트 권한 범위 정의: 시작/종료/재시작/설정 변경/강제 패스 — §2.2
- [ ] 호스트 퇴장 시 FIFO 자동 이양 (`transferHost` 함수) — §2.2
- [ ] HOST_CHANGED 이벤트 브로드캐스트 — §2.2
- [ ] 게임 종료 후 재시작 옵션 제공 (호스트 권한) + RETURN_TO_WAITING 이벤트 — §2.8

---

### 🔄 7.3 백엔드 — 재접속 & 세션 복구

- [ ] 닉네임 + 방번호 조합으로 재접속 플레이어 식별 (기본) — §2.3
- [ ] (보안 강화 시) sessionId UUID 발급 + 재접속 식별 — §2.3
- [ ] 같은 기기 다중 탭 = 서로 다른 플레이어: sessionId는 탭별 `sessionStorage`, 종료 후 재접속은 닉네임+방번호(+uid) 폴백 — §2.3
- [ ] ws.on('close') 핸들러에서 `connected: false` + `ws = null` 처리 — §2.6
- [ ] 호스트 끊김 시 즉시 FIFO 자동 이양 (`transferHost`) — §2.6
- [ ] 게임 중 해당 플레이어 턴이면 자동 진행 처리 (교착 방지) — §2.6
- [ ] 대기실 vs 게임 중 disconnect 분기 처리 (유예 시간 차별화) — §2.6
- [ ] SETUP/WORD_REVIEW 중 최소 인원 이하 퇴장 시 WAITING 복귀 — §2.6
- [ ] connected 플레이어 0명 시 방 소멸 (`rooms.delete(roomCode)`) — §2.6
- [ ] `PLAYER_DISCONNECTED` 이벤트 브로드캐스트 (클라이언트 UI 갱신) — §2.6
- [ ] 재접속 시 기존 슬롯 매칭 + `connected: true` 갱신 — §2.3
- [ ] 재접속 시 현재 게임 상태 전체 재전송 (`turnPhase`, `pendingReaction`, `hand`, 장착 카드 포함) — §2.3
- [ ] `isReconnect: true` 플래그 전송 (클라이언트 모달 큐 리셋 방지) — §2.3
- [ ] 로비 vs 게임 중 재접속 분기 처리 — §2.3
- [ ] `GameSnapshot` 모델/저장소 작성, 명령 처리 직후 저장 — §2.12
- [ ] 서버 시작 시 active snapshot 복구, 플레이어 슬롯은 `connected=false`, `ws=null`로 복원 — §2.12
- [ ] `PUBLIC_STATE`와 플레이어별 `PRIVATE_STATE` 분리 전송 검증 — §2.12
- [ ] 현재 행동자 재접속 시 `allowedActions`, `pendingInput`, `timerRemaining` 포함 UI 복원 — §2.12
- [ ] 타이머 자동 행동 후 저장, 재시작/재접속 후 중복 실행 방지 — §2.12

---

### 🎭 7.4 백엔드 — 진행자(Moderator) 모드

- [ ] 방 입장 시 `isModerator: true` 플래그로 역할 구분 — §2.4
- [ ] 진행자는 플레이어 카운트 및 턴 순서에서 제외 — §2.4
- [ ] 진행자에게 모든 플레이어의 패·상태 전체 공개 — §2.4
- [ ] 진행자 전용 중계 뷰 설계 (일반 플레이어 UI와 별도) — §2.4
- [ ] 진행자 화면: 역할 기본 숨김 + "역할 보기" 버튼으로만 공개 — §2.4
- [ ] 진행자 화면: 투표·제출 완료 현황 실시간 표시 — §2.4
- [ ] 진행자 보유 권한: 시작/종료/재시작/강제 진행/턴 스킵 — §2.4
- [ ] 진행자 액션 버튼 (의심/차단 등 플레이어 전용) 비표시 — §2.4
- [ ] **진행자 재접속 시 `isModerator` 슬롯 그대로 복원 (이양 없음)** — §2.4
- [ ] 진행자 퇴장 시 FIFO 호스트 이양 (일반 플레이어 기준) — §2.2
- [ ] 턴 변환 안내 모달(TurnAnnouncementModal) 자동 표시 + Space로 닫기 — §2.4
- [ ] 진행자 게임 잠금(SET_LOCK): 전체 액션 일시정지 + 잠금 오버레이 + 스냅샷 반영 — §2.13
- [ ] (숨은 정보 게임) 진행자 선택적 peek: 토글 열람만, 조작 권한 없음, 브로드캐스트 금지 — §2.4

---

### ⚙️ 7.5 백엔드 — 게임 상태 머신

- [ ] `GameStateMachine` 구조체 사용 (산발적 `if`문 금지) — §2.5
- [ ] `AddTransition` + `Validator` 함수로 상태 전이 정의 — §2.5
- [ ] `History` 배열로 상태 전이 이력 기록 — §2.5
- [ ] 상태 전이는 서버에서만 수행 (클라이언트 상태 예측 금지) — §2.5
- [ ] 각 상태에서 허용되는 이벤트를 명시적으로 검증 — §2.5
- [ ] 현재 턴 플레이어만 액션 가능하도록 서버 검증 — §2.5
- [ ] 상태별 타임아웃 값 지정 및 문서화 — §2.5

---

### 📡 7.6 통신 프로토콜

- [ ] 이벤트명 `UPPER_CASE` 통일 (C→S, S→C 모두) — §3.2
- [ ] 공통 페이로드 키 이름 표준: `nickname`, `roomCode`, `isReconnect`, `timeoutSeconds` — §3.3
- [ ] `events.ts` 상수 파일 분리 (서버/클라이언트 공용) — §3.4
- [ ] 클라이언트: 디스패치 테이블 + `useRef` 패턴 (stale closure 방지) — §3.4
- [ ] WebSocket `onmessage` 핸들러에서 `settersRef.current` 사용 — §3.4
- [ ] Heartbeat: 서버 45초 주기 ping + 클라이언트 pong — §3.5
- [ ] `isAlive` 플래그로 응답 없는 클라이언트 연결 종료 — §3.5
- [ ] Render keep-alive: 14분 자기 핑(`/health`) + 마지막 입력 후 40분 유휴 시 중단·슬립 허용 — §3.5
- [ ] 서버 검증 6종: 턴 / 페이즈 / 카드·자원 / 대상 / 방 상태 — §3.7
- [ ] Rate Limiting: `golang.org/x/time/rate` (1분 100 요청 기준) — §3.7
- [ ] 메시지 최대 크기 제한: `SetReadLimit(4096)` — §3.7
- [ ] `sendError` 함수 정의 + `ERROR` 타입 응답 패턴 — §3.8
- [ ] 경합 조건 방지: 큐 기반 순차 처리 (필요 시) — §3.8
- [ ] 구조화 로깅 (`EventLogger` 링 버퍼) — §3.8 ⚠️ 클라이언트 로그는 설계됨, 서버 EventLogger 구조체 미설계
- [ ] 클라이언트 DEV 모드 디버그 패널 (`import.meta.env.DEV`) — §3.8
- [ ] CORS 프로덕션 환경 명시적 화이트리스트 설정 — §3.6
- [ ] seq 기반 이벤트 로그(PUBLIC_STATE 누적) + 신규 seq만 토스트(재접속 중복 방지) — §3.8

---

### 🎨 7.7 프론트엔드 — 레이아웃 & 스타일

- [ ] **고정 `px` 사용 금지** — 모든 크기에 `clamp(min, vw/vh, max)` 적용 — §4.1
- [ ] 버튼 `width: auto` (100% 금지), flex 컨테이너로 정렬 — §4.1
- [ ] **이모지 사용 금지** — 버튼·라벨·헤더·알림 전체 — §4.1
- [ ] 카드/이미지: `height: clamp(...)` + `width: auto` + `aspect-ratio` — §4.1
- [ ] 여백/패딩: `vh` 또는 `%` 기준 — §4.1
- [ ] hover/transform 이동값: `vh` 기준 — §4.1
- [ ] 다크 테마 CSS 변수 정의 (`--bg`, `--surface`, `--text`, `--gold`) — §4.2
- [ ] 강조색 (게임 테마에 맞는 색 — 기본값 골드 `#f5c842`) — §4.2
- [ ] 배경 이미지 최상위 고정 (화면 전환 시 유지) — §4.2
- [ ] 색맹 모드: `[data-colorblind]` CSS 변수 오버라이드 — §4.2
- [ ] 폰트 크기 조절: `[data-font-size]` 설정 패널 — §4.2
- [ ] 반응형 브레이크포인트 3단계: 모바일 세로 / 가로 소형 / 태블릿+ — §4.3
- [ ] Safe Area 대응: CSS 변수 (`--sat`, `--sar`, `--sab`, `--sal`) — §4.4
- [ ] 필수 meta 태그: `viewport-fit=cover`, `apple-mobile-web-app-capable` — §4.4
- [ ] 모바일 하단 버튼 잘림 방지: 버튼 `flex-shrink: 0` + `padding-bottom` safe-area — §4.4
- [ ] 뷰포트 잠금: `overflow: hidden`, `position: fixed`, `touch-action: manipulation` — §4.5
- [ ] 고정 헤더: `position: sticky`, `backdrop-filter: blur(8px)` — §4.5
- [ ] 헤더 내 내 닉네임 항상 표시 + 내 턴일 때 골드 강조 — §4.5
- [ ] 헤더: 라운드 한국어 표기(`1라운드`), 방번호 클릭 확대, 나가기 분기(로비/대기실) — §4.5
- [ ] 헤더 타이틀/로고 데스크톱 전용(모바일 숨김 → 버튼 잘림 방지), 헤더는 대기실 포함 모든 인게임 화면에 적용 — §4.5
- [ ] z-index 계층 정의: 헤더(100) / 드롭다운(150) / 모달(200~600) / 최상위(1000) — §4.5
- [ ] 로비 화면: 서버 신호등(dot) + 최근 접속 목록(`localStorage`) + 방번호 클릭 확대 — §4.12

---

### 🪟 7.8 프론트엔드 — 모달 & 상태 시각화

- [ ] 모달 큐 시스템: `modalQueue` 배열, 첫 번째만 렌더링 — §4.6
- [ ] 모달 닫기: Space/Enter 키 + 버튼 클릭 — §4.6
- [ ] Toast (비차단): FIFO 큐, 약 2초 자동 닫힘, 터치 시 즉시 닫힘 — §4.6
- [ ] 단순 알림 토스트: Ra처럼 배경·테두리·버튼 없음, 큰 텍스트 + 글로우 (`clamp(20px, 3vh, 30px)`) — §4.6
- [ ] WebSocket 연결 끊김/복구/저장 실패/페이로드 검증 실패 토스트 문구 정의 — §4.6
- [ ] Modal (결정 필요): 풀스크린, 수동 닫기 — §4.6
- [ ] 필수 액션 모달: ESC 불가 + 포커스 트랩 (해당하는 경우) — §4.6 ⚠️ 포커스 트랩 구현 가이드 미설계
- [ ] 재접속 직후 경매/카드 선택/지도 타깃 선택 등 현재 페이즈 필수 모달 복원 — §2.12
- [ ] 결과 모달 표시 중 페이즈 전이 이벤트는 Deferred Actions로 보류 — §4.6
- [ ] 현재 턴 플레이어: 골드 테두리 글로우 + 배경 하이라이트 — §4.7
- [ ] 탈락 플레이어: `opacity: 0.38` + `grayscale(80%)` + `line-through` — §4.7
- [ ] 연결 끊김 플레이어: dim 색상 + `line-through` — §4.7
- [ ] 카드 호버: `translateY(-2vh)` — §4.8
- [ ] 카드 선택: `translateY(-4vh)` + 골드 테두리 — §4.8 ⚠️ 계획서 현재값 -3vh (구현 시 -4vh로 상향)
- [ ] 비활성 카드: `opacity: 0.6` + `pointer-events: none` — §4.8
- [ ] **선택 불가 카드·버튼 클라이언트 사전 비활성화** (`allowedActions` 기반) — §4.8
- [ ] **카드 제출 후 결과 표시 흐름** (즉시 사라짐 금지, 최소 2초 유지) — §4.8
- [ ] 터치 최적화: `-webkit-tap-highlight-color: transparent` — §4.8
- [ ] useReducer + Context (컴포넌트 depth 3단계↑ 또는 상태 10개↑ 시 권장) — §4.10 ⚠️ useState 패턴 설계됨, useReducer 전환 계획 미명시
- [ ] 확인 대화상자: 되돌릴 수 없는 고비용 액션에만 표시 (남용 금지) — §5.3
- [ ] (보드/지도 게임) 겹치는 말 깊이 정렬: y값 기반 z-index + 강조 레이어 대역 분리 — §4.7

---

### ⌨️ 7.9 프론트엔드 — 키보드 & 접근성

- [ ] 클릭 가능 요소 전부 `<button>` 또는 `<a>` (`<div onClick>` 금지) — §4.9
- [ ] `focus-visible` 포커스 인디케이터 명시 (3px solid 강조색) — §4.9
- [ ] Space / Enter: 모달 확인/닫기 — §4.9
- [ ] Escape: 모달/메뉴 취소 — §4.9
- [ ] 방향키: 목록/카드 패 탐색 — §4.9
- [ ] 키보드 핸들러: `useRef` 기반 (의존성 배열 없는 최신값 접근) — §4.9

---

### 📱 7.10 프론트엔드 — PWA

- [ ] `manifest.json` 작성 (name, short_name, start_url, display, theme_color) — §4.11
- [ ] 아이콘 3종: `icon-192.png` / `icon-512.png` / `icon-512-maskable.png` — §4.11
- [ ] `apple-touch-icon.png` (180×180) — §4.11
- [ ] `index.html` 링크: manifest, theme-color, apple-touch-icon — §4.11
- [ ] `vite-plugin-pwa` 설정 — §4.11
- [ ] **새로고침 시 로비 화면** (자동 재입장 트리거 금지) — §4.11
- [ ] **모바일 뷰포트 고정**: `overscroll-behavior: none` + `position: fixed` + viewport-fit=cover — §4.11
- [ ] **캔버스/드래그 요소 `touch-action: none`** + safe-area 패딩 — §4.11

---

### 🛠️ 7.11 게임 편의성

- [ ] 타이머: **클라이언트 단독** 방식 (서버 타임스탬프 동기화 금지) — §5.1
- [ ] 타이머: 5초 이하 긴급 색상(빨강) + 펄스 애니메이션 — §5.1
- [ ] 자동 재접속: `visibilitychange` 이벤트로 포그라운드 복귀 감지 — §5.4
- [ ] keepalive ping 허용(클라이언트 25초 PING) — `lastInputAt` 기준 게이팅, 40분 무입력 시 클라·서버 양쪽 중단 → Render 슬립 허용 — §5.4
- [ ] `sessionStorage` 입력 편의 (자동 재입장 트리거로 사용 금지) — §5.4
- [ ] 재접속 UX 오버레이: CONNECTED / RECONNECTING / FAILED / RECONNECTED 상태 표시 — §5.4
- [ ] 재접속 중복 방지: `reconnectRef` 타이머 중복 차단 — §5.4
- [ ] 도움말 모달: `?` 버튼으로만 접근 (강제 표시 금지) — §5.5
- [ ] 이미지 로드 실패 시 폴백 UI — §5.7
- [ ] 타임아웃 자동 패스 처리 + 호스트 강제 패스 기능 — §5.2
- [ ] 주요 이벤트 SFX 적용 (카드 제출, 공격, 피해, 판정) — §5.8
- [ ] 음소거 상태 `localStorage` 전역 유지 (화면 전환 후에도 유지) — §5.8
- [ ] BGM/SFX 토글 분리(둘 다 쓰는 게임): BGM 호스트 전용 재생·제어, SFX 전원 재생 + 전원에게 토글 노출 — §5.8
- [ ] 게임 종료 시 화면 전환 순서 준수 (공개 → 대기 → 결과) — §2.9

---

### 📁 7.12 프로젝트 구조

- [ ] 표준 폴더 구조 준수: `server/` + `client/` 분리 — §6.2
- [ ] `server/handlers/` (room, game, connection 분리) — §6.2
- [ ] `server/services/` (room_service, game_service) — §6.2
- [ ] `client/src/hooks/useGameSocket.ts` — §6.2
- [ ] `client/src/constants/events.ts` — §6.2
- [ ] `client/src/types/game.ts` — §6.2
- [ ] `.env.example` 포함 — §6.2
- [ ] `package.json` 포함 (서버 의존성: express, ws, dotenv) — §6.2

---

> **총 체크 항목: 103개**
> 계획 단계에서 산출물에 각 항목의 구현 방식이 명시되어 있는지 확인할 것.
> 구현 단계에서 실제 코드와 대조하여 하나씩 완료 처리할 것.

---

## 부록: Avalon-Game 적용 사례 — 사회적 추론 게임 패턴

다른 카드/파티 게임과 달리 **사회적 추론(Social Deduction)** 장르(아발론)에서는 "다른 플레이어의 행동 패턴을 추론"하는 것이 게임의 본질이다. 이 부록은 그 과정에서 도입한 패턴 중 다른 프로젝트에서 참고할 가치가 있는 항목을 정리한다.

### A. LLM 기반 AI 의심 점수 시스템 (`SuspicionAnalyzer`)

게임 진행 데이터를 LLM에 보내 각 플레이어가 악(evil) 진영일 가능성을 0~100 정수로 평가받는다. 결과는 `gameState.suspicionScores`에 저장되어 AI 봇의 의사결정 및 향후 UI 힌트에 활용 가능.

**핵심 설계 원칙**
- **Fire-and-forget**: 게임 진행을 블로킹하지 않는다. `analyzeSuspicion(room)` 호출 시 응답을 await하지 않고, 결과가 도착하면 비동기로 점수만 갱신.
- **AI Pool 가용성 체크**: API 키 미설정 시 즉시 return — 게임은 그대로 진행, AI 기능만 비활성.
- **전체 행동 이력 전달**: 직전 1회 투표만 보내면 패턴 학습 불가. `voteHistory: Array<{ questNumber, attemptIndex, leaderId, proposedTeam, votes, approved }>`를 매 투표 결과마다 누적해 프롬프트 전체에 전달.
- **평가 규칙 명문화**: 프롬프트에 평가 휴리스틱을 명시 — "본인 포함 팀에 reject 던진 플레이어 → 선의 약한 신호", "5번째 거부 직전 합리적 이유 없이 거부 → 의심 ↑", "한 번 실패한 팀 구성 재제안에 approve → 의심 ↑" 등.

```ts
// server/services/SuspicionAnalyzer.ts
export function analyzeSuspicion(room: Room): void {
  const pool = getAIPool();
  if (!pool.available()) return;          // AI 없으면 silent return
  if (!room.gameState) return;
  pool.ask(buildPrompt(room))
    .then((scores) => { /* room.gameState.suspicionScores 갱신 */ })
    .catch(() => { /* 게임에 영향 없음 */ });
}
```

호출 시점: `resolveVote()` 직후, `resolveQuest()` 직후.

### B. 봇 의사결정 — 책임 기반 추론

게임 결과로 누군가를 판단할 때 "팀에 있었다"만으로 점수를 매기면 부당하다. **그 사람이 의지로 가담한 임무**(리더로 짰거나 approve로 찬성한 경우)만 그 사람의 판단 능력을 보여주는 신호다.

```ts
// server/services/GameService.ts:resolveQuest
// 통과된 마지막 투표 항목 찾기
const passedVote = [...history].reverse()
  .find(v => v.questNumber === gs.currentQuest && v.approved);

for (const c of merlinCandidates) {
  if (!gs.proposedTeam.includes(c.id)) continue;
  const wasLeader   = passedVote?.leaderId === c.id;
  const votedApprove = passedVote?.votes[c.id] === 'approve';
  if (!wasLeader && !votedApprove) continue;   // 책임 없으면 점수 안 매김
  gs.persyMerlinScores[c.id] += questFailed ? -3 : 1;
}
```

**파생 헬퍼** (`AIBotService.ts`)
- `failedQuestMembers(room)` — 모든 실패 임무 멤버 집합 (약한 신호)
- `lastFailedQuestTeam(room)` — 직전 실패 팀 (동일 조합 재제안 차단)
- `knownEvilFromOwnFails(room, bot)` — **본인이 갔던 2인 팀이 실패 시 다른 1명은 100% 악 확정** (확정 신호)
- `merlinAuthoredTeam(room, merlinId)` — voteHistory에서 멀린이 직접 짠 팀 멤버 학습 (퍼시벌 신뢰 신호)

**봇 분기 별 활용**
- 모든 선 봇: `knownEvilFromOwnFails`가 팀에 끼면 무조건 reject; `lastFailedQuestTeam`과 정확히 같은 조합 재제안 시 reject; 실패 멤버 2명 이상이면 reject
- 악 봇: `meOnTeam`이면 cover-reject(15% 확률) 비활성 — 본인이 fail 카드 낼 기회를 거부하는 비합리 차단
- 퍼시 봇: `percyInfer()`로 모르가나/멀린 식별 후 모르가나는 팀 배제·reject, 멀린은 -50 가중치로 최우선 포함·approve

### C. 동적 역할 조합 (확장 카드)

호스트가 대기실에서 기본/확장 규칙을 선택하고, 확장 카드 4종(`persy/morgana/mordred/oberon`)을 각각 `must`/`random`/`off`로 설정. 서버는 `assignRoles()`에서 `random`을 50% 동전 던지기로 `must`/`off` 확정 후, 같은 진영 일반 슬롯 한도 내에서 기본 카드 1장씩 대체(`loyal→percival`, `minion→morgana/mordred/oberon`).

**가시성 규칙**(`server/utils/roleFilter.ts`)도 역할별로 분리:
- 멀린: 악인 노출 단 **mordred 제외**
- 퍼시벌: `merlin` + `morgana` 둘 다 멀린 후보로 노출, 모두 동일한 멀린 이미지로 가려져 식별 불가
- 오베론: 다른 악인 모름. 다른 악인도 오베론 모름.

설정 전송은 기존 `UPDATE_SETTINGS` / `SETTINGS_UPDATED` 흐름 확장. zod 스키마(`server/utils/schemas.ts`)에 새 필드를 추가하지 않으면 `.strict()` 때문에 거부되는 함정 주의.

### D. 모달 큐 + Deferred Actions

화면 전환 액션(`QUEST_START` / `TEAM_PROPOSED` / `ASSASSINATION_PHASE` / `GAME_ENDED` / `GAME_STATUS_UPDATE` 등)이 결과 모달 표시 중 도착하면 즉시 적용되어 사용자가 결과를 못 보고 지나칠 수 있다. **모달 큐 + Deferred Actions** 패턴으로 해결:

```ts
// client/src/reducers/gameReducer.ts
const DEFERRABLE_TYPES = [
  'QUEST_START','TEAM_PROPOSED','VOTE_COLLECTING','QUEST_EXECUTION_START',
  'QUEST_CARD_SUBMITTED','ASSASSINATION_PHASE','GAME_ENDED','GAME_STATUS_UPDATE',
];

// 모달이 떠 있는 동안 deferrable 액션은 deferredActions 큐에 보류
if (state.modalQueue.length > 0 && isDeferrable(action)) {
  return { ...state, deferredActions: [...state.deferredActions, action] };
}

// DEQUEUE_MODAL 시 — 마지막 모달이 닫히면 보류된 액션을 순서대로 flush
case 'DEQUEUE_MODAL': {
  let next = { ...state, modalQueue: state.modalQueue.slice(1) };
  while (next.modalQueue.length === 0 && next.deferredActions.length > 0) {
    const [head, ...rest] = next.deferredActions;
    next = gameReducer({ ...next, deferredActions: rest }, head!);
  }
  return next;
}
```

§4.6 모달 큐의 확장형 — 단순히 모달만 큐잉하는 게 아니라 **후속 페이즈 전이 자체를 모달 닫힘과 동기화**한다.

### E. 통신 안정성 강화

#### E.1 `send()` silent drop 방어
WebSocket이 OPEN 상태가 아닐 때 `ws.send()`를 호출하면 silent drop. 사용자는 "아무 반응 없음"으로 인식한다. **토스트 + 콘솔 경고**로 명시.

```ts
// client/src/hooks/useGameSocket.ts
const send = useCallback((type, payload = {}) => {
  const ws = wsRef.current;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
    return;
  }
  console.warn('[send] dropped — ws not open', { type, readyState: ws?.readyState });
  dispatch({ type: 'PUSH_TOAST', toast: { variant: 'warning', message: '연결이 불안정합니다. 다시 시도해주세요.' } });
}, [dispatch]);
```

#### E.2 게임 재시작 시 상태 잔존 방지
`restartGame()`에서 플레이어/게임 상태만 reset하면 `room.presenterGate`가 잔존해 새 게임 진행이 막힐 수 있다. **명시적으로 reset**:

```ts
room.gameState = null;
room.status = 'waiting';
room.presenterGate = 'NONE';        // 잔존 게이트 방지
room.pendingPresenterFn = null;
```

#### E.3 새 방 입장 시 클라이언트 상태 명시 초기화
`ROOM_JOINED` 처리에서 게임 진행 상태만 reset하면 이전 방의 `ruleMode`/`extensionCards`/`anonymousVoting`이 잔존할 수 있다. SETTINGS_UPDATED가 곧 따라오지만 race condition 방어로 명시 초기화:

```ts
case 'ROOM_JOINED':
  return { ...state, /* ... */,
    anonymousVoting: false,
    ruleMode: 'basic',
    extensionCards: { persy: 'off', morgana: 'off', mordred: 'off', oberon: 'off' },
  };
```

### F. UX 강화

#### F.1 드래그 reorder shift 애니메이션
대기실에서 좌석 순서를 드래그로 바꿀 때, 끼어들 위치 주변 카드들이 한 칸씩 옆으로 부드럽게 밀려나는 시각 피드백. **순수 CSS + native HTML5 DnD**로 라이브러리 없이 구현.

```tsx
// dragOverId 추적 → from..to 사이 카드들에 transform 적용
const shift = reorderShift.get(p.id) ?? 0;  // -1, 0, +1
<div style={shift !== 0 ? {
  transform: `translateX(calc(${shift} * (100% + var(--reorder-gap))))`
} : undefined} className={`player-card ${shift !== 0 ? 'shifting' : ''}`}>
```

```css
.waiting-grid {
  --reorder-gap: clamp(10px, 1.5vw, 20px);
  gap: var(--reorder-gap);              /* gap과 동기화 */
}
.player-card.shifting { transition: transform 200ms var(--ease-out); }
```

#### F.2 전체화면 토글 + 헤더 패딩 동기화
모든 화면 공통 우상단 `position: fixed` 전체화면 토글(`FullscreenToggle`). 각 화면 헤더의 우측 끝 버튼(나가기 등)이 겹치지 않도록 헤더에 `padding-right: clamp(56px, 7vw, 72px)` 공통 추가.

```tsx
// App.tsx — 모든 화면 위에 항상 노출
<div style={{ position: 'fixed', top: 'clamp(8px,1.2vh,16px)',
              right: 'clamp(8px,1vw,16px)', zIndex: 1000 }}>
  <FullscreenToggle />
</div>
```

Fullscreen API 미지원 환경(iOS Safari 등)은 `document.fullscreenEnabled`로 감지해 컴포넌트 자체를 렌더 안 함.

#### F.3 방 코드 확대 모달
대기실 헤더의 방 코드 버튼을 누르면 전체 화면 중앙에 큰 글씨로 표시. 멀리서 다른 플레이어가 폰 화면을 봐도 입장 가능. ESC/탭으로 닫힘.

### G. 자산 최적화 — OGG 오디오

BGM은 게임 분위기용이라 CD 음질이 불필요. MP3 320 kbps(5.2 MB)를 **OGG Opus 96 kbps(2.0 MB)** 로 재인코딩해 약 60% 절감. 호환성은 모던 데스크탑 브라우저(Chrome/Firefox/Edge/Safari 11+) 모두 OK.

```bash
ffmpeg -i main-title.mp3 -c:a libopus -b:a 96k main-title.ogg
```

### H. Twilight Struggle / Ra 개발 중점 반영

두 프로젝트는 공통적으로 **긴 플레이타임, 많은 상태, 재접속/복구 중요도, 페이즈별 입력 UI 복원**이 핵심이다. 신규 보드게임 프로젝트는 아래 항목을 계획서와 구현 프롬프트에 명시한다.

#### Twilight Struggle 중점
- 맵/카드/이벤트 명세를 단일 출처로 둔다. 카드 텍스트를 런타임 파싱하지 말고 `카드_카탈로그.json` + 이벤트 registry/handler 계약으로 고정한다.
- Scoring, War, Ops Modifier, Permanent Event, Hand Manipulation처럼 카드 효과 유형을 먼저 분류하고 테스트한다.
- `PUBLIC_STATE`와 `PRIVATE_STATE`를 엄격히 분리한다. 상대 손패, 비공개 선택, pending input이 새면 안 된다.
- 서버 재시작 복구 후 Headline, Action Round, Scoring 의무 플레이 같은 현재 페이즈 입력 UI가 즉시 살아나야 한다.
- 타이머 자동 행동은 서버 권위로 처리하고, 자동 행동 결과도 스냅샷에 저장한다.

#### Ra 중점
- 경매 게임은 재접속 후 “내가 지금 입찰/패스해야 하는지”가 즉시 보여야 한다. 상태 값만 복구하고 입력 UI가 닫혀 있으면 실패다.
- 타일 확대 모달, 경매 입력 모달, 재앙 처리 선택 UI는 현재 페이즈에서만 열리고, 재접속 시 현재 상태 기준으로 재구성한다.
- 연결 끊김은 경매 흐름을 멈추지 않도록 자동 패스/타임아웃 정책을 정의한다.
- 에포크 종료, 점수 계산, 경매 완료처럼 되돌리기 어려운 상태 전이는 스냅샷 저장 후 브로드캐스트한다.
- WebSocket 연결 끊김/복구는 Ra 스타일 toast(큰 글씨, 글로우, 배경·테두리 없음, 약 2초 표시)로 알려 사용자가 “입력이 안 먹는다”고 느끼지 않게 한다.

#### 공통 구현 프롬프트 반영 문구
```md
- 서버는 모든 명령 처리 후 GameSnapshot을 저장한다.
- 서버 시작 시 active snapshot을 복구하고, 플레이어 ws는 null/connected=false로 초기화한다.
- 재접속 시 PUBLIC_STATE와 해당 플레이어 PRIVATE_STATE를 분리 전송한다.
- 재접속 직후 현재 phase에 맞는 입력 UI/모달을 즉시 복원한다.
- WebSocket 연결 끊김, 저장 실패, 검증 실패는 Ra 스타일 toast(큰 글씨, 글로우, 배경·테두리 없음, 약 2초 표시)로 노출한다.
- 결과 모달이 떠 있는 동안 후속 phase 전이는 deferredActions에 보류한다.
```

> **요약 — 다른 사회적 추론 게임 개발 시 참고**
> - 행동 데이터는 **누적 이력**으로 보관해야 패턴 학습 가능 (직전 1회만 보내면 무의미)
> - 점수는 **책임 기반**(leader/approve)으로 매겨야 부당한 판단 방지
> - 본인 경험 기반 100% 확정 신호(2인팀 실패)를 별도 set으로 운영하면 봇이 즉시 학습
> - 결과 모달 + 후속 페이즈 전이는 **Deferred Actions 큐**로 동기화
> - LLM 호출은 항상 fire-and-forget — 게임 진행은 절대 블로킹하지 않음

---

## 부록: Speed-Draw 적용 사례 — 실시간 릴레이 드로잉 게임 개발 반영

> **출처**: speed-draw 프로젝트 개발 중(2026-07-01 ~ 07-03) 실제로 접수·반영한 요청과 현장(학생 21명 대면 테스트) 피드백을 일반화한 것. 릴레이 드로잉/실시간 협동 게임 개발 시 참고.

### A. 릴레이 순번 로테이션 — 라운드마다 시작 주자 회전

- **배경**: 매 라운드 시작 시 순번을 한 칸씩 밀어야 한다(1→2, 2→3, …, 마지막→1).
- **원칙**: 릴레이/순차 진행 게임은 **라운드 시작 시점에 순번을 회전(shift)** 시켜 특정 자리(첫/마지막 주자)에 유리·불리가 고착되지 않게 한다.
- **구현**: 순번은 배정 시점에 **고정 배열로 잠그고**, 라운드가 넘어갈 때 배열을 회전만 시킨다(매 라운드 재추첨 금지 → 추측자 미리보기 등 순서 의존 UI가 흔들리지 않음).

### B. 역할 무결성 — 배정된 관전/추측 역할은 게임 시작 후에도 유지

- **배경**: 돋보기(추측자) 표시로 시작했는데 게임이 시작되면 그리기 참여자로 바뀌는 버그. "봇 때문인지, 일반 모드에서도 그런지 확인"을 함께 요청받음.
- **원칙**: 역할은 **배정 시점에 확정(lock)** 하고, 게임 시작/페이즈 전이 시 인원수 기준으로 **재계산하지 않는다**. 재계산 로직이 남아 있으면 상태 전이마다 역할이 뒤집힌다.
- **검증**: 봇/실사용자가 **동일 경로**를 타는지 반드시 확인. "봇 있을 때만 재현"되는 버그는 대개 봇 초기화 경로가 사용자 경로와 갈라진 것.

### C. 정보 은닉 — 정답 키워드는 방장(진행자)만 열람

- **배경**: 클라이언트 결과 화면에서는 키워드를 클릭해도 보이면 안 되고, 방장만 열어볼 수 있어야 한다.
- **원칙**: 정답·숨은 정보의 노출 여부는 **서버가 권한(진행자/방장)으로 판정**한다. 클라 결과 화면에는 일반 참가자용 페이로드에서 정답을 아예 빼서 보낸다(클라 토글로 가리기 금지 — DOM에 값이 남으면 뚫린다). §2.4의 "숨은 정보 게임의 진행자 열람(peek)" 패턴과 동일 계열.

### D. 비율 기반 반응형 레이아웃 — 개수 가변 컬렉션의 그리드 규칙 명시

프로젝트 공통 원칙(고정 px 금지, 뷰포트/비율 기반)을 릴레이 드로잉 UI에 반복 적용하며 나온 구체 규칙:

- **결과 모달**: 화면의 약 **70%**를 차지하도록 확대. 고정 픽셀이 아니라 **비율(clamp/%/vh)로 계산**.
- **스케치북 패널(개수 가변)**: 개수별 그리드를 명시한다.
  - 1·2·3개 → 한 줄, 4개 → 2×2, 5개 → 3+2, 6개 → **3×2 유지**
  - 컬렉션 개수가 유동적인 UI는 "count별 배치 규칙"을 **표로 확정**해야 창 크기·인원에 따라 깨지지 않는다.
- **넘침 방지**: 작은 화면에서 그룹(예: 6번)이 **줄바꿈되어 아래로 떨어지는 현상**을 브레이크포인트별로 잡는다. 방장 화면처럼 인원이 몰리는 영역은 오버플로 설계를 먼저 한다.
- **여백/모서리 느낌**: 패널이 컨테이너에 딱 붙으면 "둥글둥글한 느낌"이 사라진다 → 컨테이너 내부 패딩을 **비율 여백**으로 확보.
- **헤더 타이틀 이미지**: 데스크톱은 헤더 이미지 적용 + 나머지 컴포넌트를 좌우로 밀어 배치, **모바일은 폭이 좁으므로 이미지 미적용**. 이미지 좌우 폭은 미세 조정 대상.

### E. 모바일·터치 안정성 — 드로잉 게임의 최우선 과제

- **오버스크롤 제거**: 아이폰/맥의 **러버밴드(바운스) 효과를 없애고 뷰포트를 고정**한다(`overscroll-behavior: none` + 뷰포트 고정). 캔버스 위 제스처가 페이지 스크롤로 새는 것을 막는다.
- **스타일러스/펜 입력 방어**(현장 버그): 크롬북에서 **캔버스는 열리지만 펜으로 그려지지 않는** 증상 발생. 특정 디바이스의 pointer/touch 이벤트 처리 차이 → **방어적 이벤트 처리**(pointer/touch/mouse 전 범위 커버, `preventDefault`/passive 리스너 정리)로 대응.
- **교훈**: 드로잉 게임은 "내 기기에서 되니까 OK"가 통하지 않는다. 크롬북·태블릿·스타일러스 등 **입력 다양성**을 전제로, 방어 수정이 다른 입력을 깨지 않는지 함께 검증한다(대면 테스트에서만 드러나는 부류).

### F. 점수·컨트롤 표기 UX

- **점수 표기**: 추상적인 토큰 아이콘 대신 **"N점" 텍스트를 원형 배지로 감싸** 직관적으로 표시. (플레이어가 즉시 이해 못 하는 상징은 숫자로 환원한다.)
- **마지막 주자 지정**: 방장 대기실에서 "랜덤 자동 배정" 버튼 옆에 **마지막 주자를 수동 지정**하는 버튼 제공(특별한 진행이 필요한 경우 방장 재량).

### G. 자산·테스트·협업 원칙

- **PWA + 단일 기기 다중 브라우저 테스트**: 기획 단계부터 PWA 설정과, 한 디바이스에서 여러 브라우저를 띄워 다중 접속을 테스트할 수 있는 구성을 요구사항에 포함.
- **봇 대량 투입 스크립트**: 특정 방 번호에 봇 N명을 투입해 대인원(17~26명) 레이아웃·부하를 실서버(Render)에서 사전 검증.
- **사용자 자산 임의 복원 금지**: 방장이 **일부러 교체한 아이콘/이미지를 자동 "복원"하지 말 것**. 내가 만들지 않았거나 사용자가 의도적으로 바꾼 자산은 되돌리기 전에 반드시 확인한다.

> **요약 — 실시간 릴레이 드로잉 게임 개발 시 참고**
> - 순번은 배정 시 잠그고 **라운드마다 회전만** (재추첨 금지)
> - 역할은 배정 시 확정, **페이즈 전이 때 재계산 금지**; 봇/사용자 경로 일치 검증
> - 정답 은닉은 **서버 권한 판정**으로, 클라 페이로드에서 제거 (DOM 토글 금지)
> - 개수 가변 패널은 **count별 그리드 규칙을 표로 확정**
> - 드로잉 게임 1순위는 **터치·펜·오버스크롤 안정성** — 대면 테스트로만 드러나는 버그 존재
> - 사용자가 바꾼 자산은 **함부로 되돌리지 않는다**
