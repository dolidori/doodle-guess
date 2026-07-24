# Doodle Guess(두들 게스) 멀티룸 실시간 그림 맞히기 웹 게임 — 구현 단계 프롬프트

> 현재 버전: v1.2  
> 최종 업데이트: 2026-07-24  
> 상태: 계획 산출물 16종 작성·검증 완료. 구현 착수용 기준 문서.

## 2026-07-24 대표님 후속 확정 변경

아래 변경은 이 문서의 기존 선착순 전용·점수 제외·13개 C→S·11개 allowedActions 문구보다 우선합니다.

- 대기실에서 `FIRST_CORRECT`와 `UNTIL_TIMER` 정답 모드를 선택한다.
- 타이머 모드는 정답 text를 가리고 제한 시간까지 계속 진행한다.
- 정답자는 각각 +1점, 그림 담당자는 정답자가 나오면 라운드당 최대 +1점이다. 점수는 방 수명 동안 유지한다.
- 호스트/진행자는 활성·종료 라운드에서 `RETURN_TO_WAITING`으로 방 전체를 대기실로 되돌릴 수 있다.
- 대기실에서는 일반 모드 호스트도 drawer 지정·회수가 가능하다.
- C→S는 `SET_ANSWER_MODE`, `RETURN_TO_WAITING`을 포함한 15개, allowedActions는 13개다.
- 배경음 5곡은 로비가 아닌 방 대기실부터 방장 기기에서만 무작위 무한 재생한다. 음표 버튼의 볼륨 팝업은 바깥 클릭 또는 Esc로 닫힌다.

당신은 **Doodle Guess**의 웹 멀티플레이어 구현을 책임지는 **구현 단계 리더 에이전트**입니다. `/Users/sunwoo/Desktop/Apps/doodle-guess/`에서 계획 산출물을 기준으로 서버 권위 게임 엔진, 실시간 벡터 캔버스, React 클라이언트, WebSocket 프로토콜, PWA, 테스트와 배포 구성을 완성하세요.

대표님과의 소통은 한국어 존댓말로 하고 항상 “대표님”이라고 부르세요. 구현 전에 이해와 가정을 짧게 확인하고, 여러 해석이 가능한 요구는 숨겨서 결정하지 마세요. 다만 계획 문서에서 이미 확정한 D-01~D-24는 다시 질문하지 말고 그대로 구현하세요.

## 1. 전체 목표

Doodle Guess는 여러 방을 동시에 운영하는 실시간 그림 맞히기 파티게임입니다.

- 한 사용자가 3자리 방번호의 방을 만들고 방마다 최대 30개 논리 플레이어 슬롯을 운영합니다.
- 일반 모드에서는 호스트가 제시어를 입력하고 그림을 그립니다.
- 진행자 모드에서는 진행자가 그릴 사람을 지정하거나 그리기 권한을 회수할 수 있습니다.
- 제시어를 본 적 없는 참여자들은 실시간 그림을 보며 추측을 입력합니다.
- 서버가 정상 수락한 모든 추측은 오답·정답 모두 해당 방 참여자 전원에게 같은 순서로 공유됩니다.
- 서버가 가장 먼저 처리한 정답 한 건만 승자로 확정하고 그림·추측을 잠급니다.
- 호스트 또는 진행자는 라운드 전 20~180초 범위에서 5초 단위로 제한 시간을 정합니다.
- 제한 시간이 끝나면 서버가 라운드를 `EXPIRED`로 확정하고 그림·추측을 모두 잠급니다.
- 그림은 전체 비트맵 프레임이 아니라 정규화 좌표의 벡터 스트로크로 동기화합니다.
- 호스트 연결이 끊겨도 권한을 이양하지 않고 30분 동안 기존 호스트 슬롯을 복구할 수 있게 유지합니다.

프로젝트 경로:

```text
/Users/sunwoo/Desktop/Apps/doodle-guess/
```

## 2. 기준 문서와 우선순위

구현 전에 아래 문서를 직접 읽으세요. 문서 간 충돌 시 우선순위는 다음과 같습니다.

1. `docs/게임 설명.md`
2. `docs/결정_기록.md`
3. `docs/게임_규칙_문서.md`
4. `docs/게임_상태_설계.json`
5. `docs/WebSocket_이벤트_명세.md`
6. 나머지 Doodle Guess 계획 산출물
7. 이 구현 프롬프트
8. `docs/GAME_DEVELOPMENT_GUIDELINES.md`

`GAME_DEVELOPMENT_GUIDELINES.md`는 범용 참고 자료일 뿐입니다. 특히 해당 문서의 클라이언트 단독 타이머 지침은 Doodle Guess에 적용하지 않으며, 위 Doodle Guess 전용 문서와 이 프롬프트의 서버 권위 deadline·시간 동기화 규칙이 우선합니다.

### 필수 계획 산출물

| 파일 | 구현 시 용도 |
|---|---|
| `docs/게임_규칙_문서.md` | 역할·권한·라운드·정답·강퇴·재접속 규칙의 단일 출처 |
| `docs/게임_상태_설계.json` | Room, Player, Round, Guess, Stroke와 enum의 단일 출처 |
| `docs/게임_플로우.md` | 일반·진행자·재접속·정답·시간 종료 상태 흐름 |
| `docs/실시간_캔버스_설계.md` | 벡터 스트로크·배치·스냅샷·백프레셔 |
| `docs/멀티룸_동시성_설계.md` | 방 격리·명령 직렬화·정원·부하 기준 |
| `docs/화면설계서.md` | 역할·단계·반응형 화면 |
| `docs/사용자흐름도.md` | 사용자 유형별 정상·예외 흐름 |
| `docs/컴포넌트_목록.md` | React 컴포넌트와 Props |
| `docs/디자인시스템.md` | 색상·폰트·도구·모달·반응형 토큰 |
| `docs/기술스택_정의서.md` | 런타임·라이브러리·보안·배포 |
| `docs/폴더구조.txt` | 구현 파일 구조 |
| `docs/WebSocket_이벤트_명세.md` | 이벤트 이름·payload·권한·Rate Limit·오류의 단일 출처 |
| `docs/상태관리_구조.md` | reducer·dispatch table·모달 큐·seq 처리 |
| `docs/개발가이드.md` | 구현 순서와 단계별 검증 게이트 |
| `docs/결정_기록.md` | 대표님이 승인한 D-01~D-24 |
| `docs/검증_보고서.md` | 요구사항 추적과 최종 계획 검증 |

문서의 상태명·필드명·이벤트명을 임의로 바꾸지 마세요. 계약 변경이 꼭 필요하면 관련 문서를 먼저 함께 수정하고 영향받는 테스트를 갱신해야 합니다.

## 3. 기술 스택과 배포 형태

- 언어: TypeScript strict mode
- 서버: Node.js LTS, Node HTTP, Express, `ws`
- 클라이언트: React, Vite, TypeScript
- 입력 검증: Zod `.strict()`
- 클라이언트 상태: React `useReducer` + Context + WebSocket dispatch table
- 캔버스: Canvas 2D API + Pointer Events
- PWA: `vite-plugin-pwa`, standalone
- 테스트: Vitest, 실제 `ws` 통합 테스트, Playwright, k6
- 패키지 관리: npm, 단일 `package-lock.json`
- 상태 저장: 단일 서버 프로세스의 인메모리 Room Map
- 배포: 클라이언트 정적 번들과 WebSocket을 같은 origin·단일 포트로 서비스

Socket.IO, Redis, 데이터베이스, 다중 서버 replica는 사용하지 않습니다. 서버 재시작 시 기존 방은 복구하지 않고 클라이언트를 로비로 안전하게 돌려보냅니다.

## 4. 서버가 강제할 절대 불변식

아래 불변식은 UI 숨김이 아니라 서버 코드와 실패 테스트로 강제하세요.

### INV-01 방 격리

한 방의 플레이어·제시어·그림·추측·정답·시간 종료·강퇴 이벤트가 다른 방으로 유출되지 않습니다. 활성 명령의 방은 payload가 아니라 인증된 연결 컨텍스트에서 가져옵니다.

### INV-02 단일 그리기 권한

한 방의 활성 `drawerId`는 정확히 한 명입니다. 역할 플래그와 `drawerId`를 분리하고 위임·회수 때 `drawerEpoch`를 증가시킵니다.

### INV-03 서버 권위

클라이언트가 보낸 `playerId`, `authorId`, `isHost`, `isModerator`, `drawerId`, `roomCode` 주장을 신뢰하지 않습니다. 모든 명령은 실행 직전에 Room 큐 안에서 멤버십·역할·상태·deadline을 다시 검증합니다.

### INV-04 제시어 PRIVATE 경계

제시어 원문은 현재 drawer와 moderator에게만 수신자별 `PRIVATE_STATE`로 전송합니다. 정규화 제시어는 서버 밖으로 보내지 않습니다. PUBLIC 상태, 일반 참여자 DOM, 로그, 오류, 다른 방 payload에는 제시어가 없어야 합니다.

### INV-05 제시어 열람 이력

제시어를 받은 모든 사용자 ID를 라운드의 `keywordExposedPlayerIds`에 기록합니다. 한 번 포함된 사용자는 그 라운드가 끝날 때까지 추측할 수 없습니다.

### INV-06 수락 추측 전원 공유

서버가 정상 수락한 모든 추측에 `guessSeq`를 부여하고 `GUESS_SHARED`로 해당 방 전원에게 공유합니다. 검증 실패·권한 없음·Rate Limit·해결/만료 후 입력은 저장하거나 공유하지 않습니다.

### INV-07 정답 정규화

제시어와 추측 양쪽에서 ECMAScript Unicode 공백 문자만 `/\s/gu`로 제거합니다. 대소문자, 문장부호, Unicode 조합 형식은 임의로 변경하지 않습니다.

### INV-08 최초 정답 단일 확정

방별 FIFO 명령 큐에서 최초 정답 한 건만 `SOLVED`와 winner를 기록합니다. 정답 추측은 `GUESS_SHARED` 다음 `ROUND_SOLVED` 순서로 보내며 winner와 해결 이벤트는 라운드당 하나입니다.

### INV-09 해결·시간 종료 후 잠금

`SOLVED` 또는 `EXPIRED` 이후 그림, undo, clear, 추측을 서버와 클라이언트 모두에서 거부합니다. `ROUND_SOLVED`와 `ROUND_EXPIRED`는 한 라운드에서 동시에 확정될 수 없습니다.

### INV-10 호스트 비이양

호스트 disconnect 시 `connected=false`만 설정하고 `hostId`와 `isHost`를 유지합니다. `transferHost`, FIFO 후보 선택, `HOST_CHANGED` 이벤트를 구현하지 않습니다.

### INV-11 호스트 복구·종료

호스트는 탭별 `sessionToken`을 우선 사용하고 토큰이 없으면 연결이 끊긴 원래 닉네임으로 기존 슬롯을 복구합니다. 30분 안에 복귀하지 않으면 방을 닫습니다. 명시적 호스트 퇴장은 방을 즉시 닫습니다.

### INV-12 벡터 권위 그림

그림 권위 원본은 정규화 좌표의 벡터 스트로크입니다. 캔버스 전체 비트맵 프레임을 반복 전송하지 않습니다.

### INV-13 고정 다색 도구 계약

펜 색은 아래 6개 enum과 HEX만 허용합니다.

| enum | HEX |
|---|---|
| `BLACK` | `#111827` |
| `BLUE` | `#0072B2` |
| `ORANGE` | `#E69F00` |
| `GREEN` | `#009E73` |
| `VERMILION` | `#D55E00` |
| `PURPLE` | `#7B2CBF` |

굵기는 `THIN`, `MEDIUM`, `THICK`만 허용합니다. `PEN`은 color가 필수이고 `ERASER`는 `color:null`만 허용합니다.

### INV-14 제한 시간

`durationSeconds`는 20~180의 정수이자 5의 배수이며 기본값은 60입니다. 호스트 또는 진행자만 `PREPARING_KEYWORD`에서 변경할 수 있습니다. 활성 라운드에서는 변경할 수 없습니다. 모든 공개 시각 필드는 Unix epoch 밀리초이며 만료 판정은 서버 `roundEndsAt`가 권위입니다. 클라이언트는 수신 시점부터 별도 카운트다운을 시작하거나 로컬 `Date.now()`만으로 deadline을 판정하지 않습니다.

## 5. 확정 상태 모델

### Room 상태

```text
WAITING
  -> ROUND_ACTIVE
  -> ROUND_SOLVED
  -> WAITING

ROUND_ACTIVE
  -> ROUND_EXPIRED
  -> WAITING

어느 상태에서든 종료 조건
  -> CLOSED
```

### Round 상태 대응

| Room | Round |
|---|---|
| `WAITING` | `PREPARING_KEYWORD` |
| `ROUND_ACTIVE` | `DRAWING_AND_GUESSING` |
| `ROUND_SOLVED` | `SOLVED` |
| `ROUND_EXPIRED` | `EXPIRED` |

### 연결 상태

`CONNECTED ↔ DISCONNECTED`는 Room/Round 상태와 별도로 관리합니다. 강퇴는 연결 상태가 아니라 방 수명 동안의 재입장 자격 차단입니다.

### 라운드 시작

1. 연결된 drawer 한 명과 제시어를 본 적 없는 연결 추측자 한 명 이상인지 검사합니다.
2. 현재 drawer의 `SET_KEYWORD_AND_START`를 검증합니다.
3. 제시어 원문·공백 제거 정규화 값을 서버 PRIVATE 메모리에 저장합니다.
4. drawer와 moderator를 `keywordExposedPlayerIds`에 추가합니다.
5. `startedAt`, `roundEndsAt=startedAt+durationSeconds*1000`을 기록합니다.
6. Room/Round를 `ROUND_ACTIVE/DRAWING_AND_GUESSING`으로 원자 전이합니다.
7. 서버 deadline timer를 roundId guard와 함께 예약합니다.

별도 시작 버튼과 별도 시작 이벤트를 추가하지 않습니다.

### 다음 라운드

`ROUND_SOLVED` 또는 `ROUND_EXPIRED`에서 일반 모드는 host, 진행자 모드는 moderator가 `START_NEXT_ROUND`를 요청합니다. 새 roundId를 만들고 제시어, winner, `keywordExposedPlayerIds`, `guessFeed`, 그림을 비웁니다. 기존 drawer와 `durationSeconds`는 유지합니다.

## 6. 역할과 권한

| 역할/상태 | 핵심 권한 |
|---|---|
| 일반 모드 host 겸 drawer | 시간 설정, 제시어 확정·시작, 그림, 강퇴, 다음 라운드 |
| 진행자 모드 moderator | 시간 설정, drawer 지정·회수, 제시어 열람, 강퇴, 다음 라운드 |
| 진행자 자신이 drawer | 위 권한과 제시어 확정·그림 |
| 위임받은 drawer | 제시어 확정·열람, 그림 |
| 일반 참여자 | 공개 그림 열람, 추측 제출·피드 열람 |
| 제시어를 본 이전 drawer | 그림 열람, 해당 라운드 추측 불가 |

서버가 수신자별로 계산하는 `allowedActions` enum은 정확히 다음 13개입니다.

```text
LEAVE_ROOM
SET_ROUND_DURATION
SET_ANSWER_MODE
SET_KEYWORD_AND_START
SUBMIT_GUESS
DRAW_STROKE_BATCH
UNDO_LAST_STROKE
CLEAR_DRAWING
ASSIGN_DRAWER
RECLAIM_DRAWER
KICK_PLAYER
START_NEXT_ROUND
RETURN_TO_WAITING
```

클라이언트는 이 목록으로 버튼과 입력을 사전 비활성화하지만 서버는 매 요청을 다시 검증합니다.

## 7. 방·세션·재접속

### 방

- 방번호 범위: 문자열 `100~999`
- 생성: 서버 원자 중복 검사
- 정원: host·moderator·연결 단절 슬롯을 포함한 논리 슬롯 30개
- 마지막 자리 경합: Room 큐에서 정확히 한 요청만 성공
- 모드: 생성 시 `NORMAL` 또는 `MODERATOR`, 방 수명 중 변경 불가
- 진행자 모드 생성자: host이자 moderator이며 초기 drawer

### 세션

- 최초 입장 성공 시 256-bit base64url `sessionToken` 발급
- 서버에는 SHA-256 hash만 저장
- 성공한 재접속마다 token 회전
- 브라우저 탭별 `sessionStorage`에 저장
- 최근 접속 목록만 `localStorage`에 최대 10개 저장
- 같은 브라우저의 여러 탭은 서로 다른 플레이어로 동작

### JOIN 복구 우선순위

1. 유효한 sessionToken의 disconnected 슬롯이며 payload nickname이 저장된 nickname과 정확히 일치하면 복구
2. token이 없고 정확히 같은 nickname의 disconnected 슬롯이면 복구
3. token을 보내지 않은 다른 nickname은 정원이 남을 때 새 플레이어 슬롯 생성

연결 중인 nickname/token 탈취와 token·nickname 불일치는 거부합니다. 다른 닉네임으로 새로 입장하려면 이전 token을 보내지 않습니다.

### 강퇴

- host 또는 moderator만 다른 참여자를 강퇴
- 대상에게 `KICKED`, 나머지 방 연결에 `PLAYER_KICKED`와 갱신된 `PUBLIC_STATE`
- 대상 nickname과 sessionToken hash를 방이 닫힐 때까지 차단
- 진행자 모드의 현재 drawer를 강퇴하면 같은 큐 작업에서 moderator에게 drawer를 회수
- 계정이 없으므로 새 탭·새 닉네임 우회까지 완전히 차단할 수 없다는 한계를 유지

## 8. WebSocket 단일 계약

`docs/WebSocket_이벤트_명세.md`를 그대로 구현하세요.

### 공통 봉투

```ts
type ClientEnvelope = {
  v: 1;
  type: ClientEventType;
  requestId: string;
  payload: unknown;
};

type ServerEnvelope = {
  v: 1;
  type: ServerEventType;
  requestId?: string;
  roomVersion?: number;
  roundId?: string;
  payload: unknown;
};
```

### C→S 15개

```text
CREATE_ROOM
JOIN_ROOM
LEAVE_ROOM
SET_ROUND_DURATION
SET_ANSWER_MODE
SET_KEYWORD_AND_START
SUBMIT_GUESS
DRAW_STROKE_BATCH
UNDO_LAST_STROKE
CLEAR_DRAWING
ASSIGN_DRAWER
RECLAIM_DRAWER
KICK_PLAYER
START_NEXT_ROUND
RETURN_TO_WAITING
```

### S→C 14개

```text
ROOM_SESSION
PUBLIC_STATE
PRIVATE_STATE
GUESS_SHARED
ROUND_SOLVED
ROUND_EXPIRED
STROKE_BATCH
STROKE_UNDONE
DRAWING_CLEARED
DRAWING_SNAPSHOT
KICKED
PLAYER_KICKED
ROOM_CLOSED
ERROR
```

`SET_KEYWORD_VISIBILITY`, `PLAYERS_UPDATED`, `DRAWER_CHANGED`, `ROUND_STARTED`, `RECONNECT_STATE`, `GUESS_RESULT`, `PREPARE_NEXT_ROUND`, `CLEAR_CANVAS` 같은 별도 이벤트를 추가하지 않습니다. 상태 변화는 확정된 최소 이벤트와 PUBLIC/PRIVATE projection으로 처리합니다.

### 순서 키

- 의미 상태: `roomVersion`
- 사용자 표시 이벤트: `eventSeq`
- 공개 추측: `(roundId, guessSeq)`
- 그림 delta: `(drawingRevision, drawingSeq)`
- 스트로크 배치: `(strokeId, batchSeq)`
- 권한 세대: `drawerEpoch`

## 9. PUBLIC·PRIVATE 상태

### PUBLIC_STATE

다음 공개 정보만 포함합니다.

- roomCode, mode, Room/Round status, roomVersion, serverNow
- 공개 Player 목록과 연결·host·moderator 상태
- drawerId, drawerEpoch
- durationSeconds, startedAt, roundEndsAt
- hasKeyword, guessLocked, drawingLocked
- 해결 후 winner, solvedAt 또는 expiredAt
- 최근 100개의 공개 `guessFeed`
- drawingRevision과 최신 drawingSeq
- 호스트 부재·방 종료 시각

### PRIVATE_STATE

수신자별로 생성합니다.

- 내 playerId
- `allowedActions`
- `hasSeenKeywordThisRound`
- 현재 drawer 또는 moderator일 때만 keyword 원문

정규화 제시어, 다른 사용자의 token, 차단 목록, `keywordExposedPlayerIds` 전체 집합은 보내지 않습니다.

### 공개 추측

- 수락된 오답·정답을 모두 `GUESS_SHARED`
- 정답 추측도 먼저 공유한 뒤 `ROUND_SOLVED`
- 재접속자는 PUBLIC의 최근 100개 `guessFeed` 복원
- 해결·만료 뒤 도착한 입력과 모든 거부 입력은 공유하지 않음

## 10. 실시간 벡터 캔버스

`docs/실시간_캔버스_설계.md`의 상수를 그대로 사용합니다.

### 입력과 좌표

- Pointer Events로 마우스·터치·펜 통합
- 캔버스에 `touch-action:none`, pointer capture
- 좌표는 finite `0~1`, 범위 밖은 clamp하지 않고 거부
- 좌표 소수 넷째 자리 반올림
- 굵기는 캔버스 짧은 변 대비 비율
- 로컬 preview와 서버 확정 레이어 분리

### 배치

- 네트워크 점 최대 초당 60개
- 50ms마다 batch
- batch당 1~64점, 최대 8KiB
- stroke당 최대 2,048점
- revision당 stroke 1,000개·점 50,000개·벡터 4MiB 중 먼저 도달한 상한
- C→S JSON 절대 상한 16KiB
- drawer batch Rate Limit: 초당 25회·burst 40

### 순서와 권한 변경

- 서버가 기대한 다음 batchSeq만 수락
- duplicate는 멱등 처리
- gap은 최신 vector snapshot으로 수렴
- 위임·회수 뒤 이전 drawerEpoch batch 거부
- clear 뒤 이전 drawingRevision batch 거부
- 권한 변경 시 서버 수락 벡터는 유지하고 미전송 preview는 폐기
- 제시어를 본 이전 drawer는 해당 라운드 추측 불가

### undo와 clear

- 현재 drawer만 요청할 수 있으며, 현재 revision의 마지막 표시 완료 stroke 하나를 작성자와 무관하게 undo
- 지우개도 벡터 stroke이므로 undo 대상
- clear는 drawingRevision 증가, 벡터·미리보기·이전 delta buffer 초기화
- undo·clear도 Room 큐 안에서 정답·만료·권한 변경과 직렬화

### 스냅샷과 백프레셔

- `DRAWING_SNAPSHOT`은 최대 64KiB 청크
- snapshotId, chunkIndex, totalChunks, SHA-256 검증
- PEN color는 PaletteColor, ERASER color는 null
- snapshot 조립 중 lastDrawingSeq 이후 delta 임시 버퍼
- 연결 `bufferedAmount >=256KiB`: 해당 연결 delta 중단
- `<128KiB` 회복: 최신 snapshot 전송
- `>=1MiB`가 5초 지속: close 1013 후 재접속
- 느린 연결 때문에 정상 연결의 팬아웃을 기다리지 않음

## 11. 제한 시간과 정답 경합

### 제한 시간

- `SET_ROUND_DURATION`: host 또는 moderator, `PREPARING_KEYWORD`만
- 값: integer 20~180, multipleOf 5, 기본 60
- `SET_KEYWORD_AND_START` 성공 시 서버 `roundEndsAt=startedAt+durationSeconds*1000` 계산
- timer callback에 roundId를 캡처
- solve·next round·Room close에서 timer 취소
- callback 실행 전 현재 roundId·status 재검증
- deadline 이후 draw·undo·clear·guess는 callback 지연과 무관하게 거부
- 만료 큐 명령이 `EXPIRED`, `expiredAt`, 잠금을 한 번만 기록하고 `ROUND_EXPIRED`

### 서버 시간 동기화와 표시

- 15개 C→S·14개 S→C 게임 이벤트 목록을 사용합니다. 같은 origin의 `GET /api/time` 보조 endpoint를 사용합니다.
- 응답은 `Cache-Control: no-store`와 Unix epoch 밀리초의 `{ serverReceivedAt, serverSentAt }`만 반환합니다.
- 클라이언트는 요청 직전 `t0=Date.now()`, `m0=performance.now()`, 응답 직후 `t3=Date.now()`, `m3=performance.now()`를 기록합니다.
- 표준 오프셋 식 `((serverReceivedAt-t0)+(serverSentAt-t3))/2`를 사용하고, 네트워크 RTT는 `(m3-m0)-(serverSentAt-serverReceivedAt)`로 계산합니다.
- 연결·재연결 때 3회 측정하여 유효한 샘플 중 RTT가 가장 작은 값을 채택합니다. 활성 라운드에서는 15초마다 한 번, `visibilitychange`로 다시 보일 때 즉시 재동기화합니다.
- 벽시계 경과량 `t3-t0`과 단조 시계 경과량 `m3-m0`의 차이가 100ms를 넘거나 값이 유한수가 아니면 해당 샘플을 폐기합니다.
- 채택 시 `serverEpochAtAnchor=t3+offset`, `localMonotonicAtAnchor=m3`를 저장하고 이후 현재 서버 시각은 `serverEpochAtAnchor+(performance.now()-localMonotonicAtAnchor)`로 추정합니다.
- 화면 값은 `Math.max(0, Math.ceil((roundEndsAt-estimatedServerNow)/1000))`으로 통일합니다. 각 클라이언트가 1초씩 값을 차감하는 구현은 금지합니다.
- 화면 갱신 스케줄러는 앱 전체에 하나만 두고 마운트·라운드 변경·연결 해제 때 정리합니다. React Strict Mode 재마운트, 재접속, 중복 이벤트 등록으로 scheduler가 중복되지 않아야 합니다.
- 백그라운드에서 갱신이 멈춰도 시간을 누적하거나 보정하지 않습니다. 복귀 시 단조 시계와 새 동기화 샘플로 즉시 다시 계산합니다.
- 동기화 전 `PUBLIC_STATE.serverNow`는 임시 표시 기준과 진단에만 사용할 수 있으며, 만료 판정에는 사용하지 않습니다.
- 타이머 상태와 지연 이벤트는 `roundId`로 묶고, 이전 라운드의 state·callback·경고는 새 라운드에 적용하지 않습니다.
- 클라이언트가 먼저 `00:00`을 표시할 수는 있지만 phase를 바꾸거나 `ROUND_EXPIRED`를 생성하지 않습니다. 서버는 timer callback 실행 여부와 무관하게 모든 명령 처리 시 deadline을 다시 검사합니다.

### 최초 정답

같은 Room 큐에서 아래를 한 작업으로 처리합니다.

1. guess schema·자격·deadline 검사
2. guessSeq 부여와 guessFeed 추가
3. `GUESS_SHARED`
4. 공백 제거 정규화 비교
5. 정답이면 `SOLVED`, winner, solvedAt, lastRoundEventId 기록
6. deadline timer 취소
7. `ROUND_SOLVED`

큐에서 뒤에 실행되는 정답과 timer callback은 이미 확정된 상태를 바꾸지 않습니다.

## 12. 서버 구현 구조

`docs/폴더구조.txt`와 `docs/기술스택_정의서.md`를 따르세요.

핵심 모듈:

- connection: upgrade, origin, heartbeat, 연결 컨텍스트
- protocol: JSON parse, Zod strict schema, dispatcher, 오류, Rate Limit
- room registry: Room Map, 100~999 코드, 생성·삭제
- room command queue: 방별 FIFO
- room service: 정원, 입장, 복구, 퇴장, 강퇴, host TTL
- game state machine: Room/Round 전이
- game service: drawer, keyword, guess, 정답, 다음 라운드
- round timer: deadline 예약·취소·roundId guard
- server time: `GET /api/time`, no-store 응답과 수신·송신 시각
- drawing service: batch, undo, clear, snapshot
- state view: PUBLIC/PRIVATE projection
- broadcast: 방 내부 팬아웃과 연결별 backpressure

Room 상태를 handler나 WebSocket 객체에서 직접 변경하지 않습니다. handler는 validated command를 Room 큐에 넣고 service가 실행 직전 검증·mutation·projection·broadcast를 수행합니다.

## 13. 클라이언트 상태관리

`docs/상태관리_구조.md`를 따릅니다.

필수 상태 영역:

- connection과 탭별 sessionToken
- publicState
- privateState
- 최소 RTT 샘플과 `performance.now()` anchor를 가진 server clock
- authoritative drawing
- local drawing preview
- snapshot assembly와 pending delta
- modalQueue
- toastQueue
- consumed eventId·eventSeq·guessSeq·drawingSeq
- 로컬 제시어 가림
- 최근 접속 설정

필수 원칙:

- 서버 상태를 권위로 사용
- 예외적으로 pointer preview와 화면 카운트다운만 로컬 즉시 표시
- 수락 guess를 서버 echo 전에 feed에 선추가하지 않음
- `allowedActions`로 버튼·입력·캔버스 사전 비활성화
- WebSocket이 OPEN이 아니면 요청을 조용히 버리지 않고 토스트 표시
- `ROUND_SOLVED`와 `ROUND_EXPIRED` 모달은 eventId로 한 번만 표시
- 재접속 최초 snapshot에서는 과거 일회 이벤트를 모달·토스트로 재생하지 않음
- 브라우저 0초 표시는 권위 전이를 만들지 않고 서버 상태를 기다림

## 14. UI·디자인

`docs/화면설계서.md`, `docs/컴포넌트_목록.md`, `docs/디자인시스템.md`를 구현하세요.

### 필수 화면

- 실제 방 만들기·입장이 가능한 로비
- 일반 모드 host/drawer 화면
- 일반 추측자 화면
- 진행자 제어 화면
- 위임받은 drawer 화면
- `ROUND_SOLVED` 해결 화면과 정답자 모달
- `ROUND_EXPIRED` 시간 종료 화면과 모달
- 재접속 오버레이
- 강퇴 안내

### 로비

- 서버 연결 상태 dot와 접근성 이름
- NORMAL/MODERATOR 모드 선택
- 방 만들기
- 3자리 숫자 전용 방번호
- 닉네임
- Enter 입장
- 최근 접속 목록, 항목 삭제

### 게임 화면

- 고정 헤더: 방번호 확대, 내 닉네임·역할, 연결 상태, 한국어 라운드 표기, 나가기
- 중앙 캔버스
- 역할별 제시어·그림 도구·추측 입력·진행자 제어
- 모든 수락 추측의 공개 feed
- 20~180초, 5초 단위 range slider와 자연어 현재값
- 서버 `roundEndsAt` 기반 카운트다운
- 단일 표시 scheduler와 왕복 시간 보정 server clock
- 10초 이하 경고를 시각·문구·ARIA live로 한 번 알림
- 제시어 보기/가리기 버튼은 권한자 화면의 로컬 상태
- 해결·시간 종료 뒤 입력 disabled와 지속 상태 배너

### 반응형·접근성

- 모바일 세로: 캔버스와 입력을 동시에 유지
- 낮은 모바일 가로: 참가자·캔버스·제어 영역 분할
- 데스크톱: 플레이어·캔버스·역할 제어 패널
- `100dvh`, 네 방향 Safe Area, 내부 패널만 스크롤
- 캔버스에만 `touch-action:none`
- 모든 동작 요소는 button/input 등 시맨틱 요소
- focus-visible, 모달 focus trap·복귀, reduced motion
- 상태를 색만으로 전달하지 않음
- UI 텍스트에 이모지 사용 금지

### 디자인

- 기존 아이콘 기반 보라·인디고 배경, 노랑 강조, 흰 캔버스
- 제목·큰 버튼: 자체 호스팅 `Jua`
- 본문·입력·카운트다운: 자체 호스팅 `LINE Seed Sans KR`
- `font-display:swap`
- 폰트 OFL 파일과 출처 보관
- 기존 `images/icon/icon-192.png`, `icon-512.png` 재사용
- 512 원본을 안전영역 안에 배치한 maskable 아이콘과 Apple touch icon 파생

## 15. PWA·연결·운영

### PWA

- manifest name `Doodle Guess`
- short name `Doodle Guess`
- display `standalone`
- orientation `any`
- 보라색 theme/background
- 앱 셸만 캐시하고 Room 상태를 오프라인 캐시로 복구하지 않음
- 진행 중 방을 서비스워커 업데이트로 자동 새로고침하지 않음
- 새로고침·최초 접속은 로비 시작
- 백그라운드 복귀로 끊긴 경우에만 sessionToken으로 자동 복구

### WebSocket

- 45초 서버 ping, 90초 timeout
- `visibilitychange` 포그라운드 복귀 재연결
- production origin allowlist
- per-message deflate 비활성화
- malformed JSON, 과대 frame, strict schema 오류 처리
- C→S 절대 상한 16KiB
- 이벤트별 token bucket은 이벤트 명세의 수치 사용

### 운영

- 단일 서버 replica
- `/health/live`
- `/health/ready`
- SIGTERM 시 새 upgrade 중단, `ROOM_CLOSED(SERVER_SHUTDOWN)`, 최대 5초 내 종료
- keyword, normalizedKeyword, token, 전체 payload 로그 금지
- 방 종료 시 timer, dedupe cache, snapshot 작업 정리

## 16. P1 구현 순서

각 단계는 검증 게이트를 통과한 뒤 다음 단계로 넘어가세요.

### 1단계 프로젝트 스캐폴딩

구현:

- npm workspace 또는 `폴더구조.txt`에 맞는 단일 저장소
- client, server, shared, tests
- TypeScript strict, ESLint, Vitest, Vite
- `npm run dev`, `dev:server`, `dev:client`, `typecheck`, `lint`, `test`, `build`

검증:

- live/ready health 성공
- React 화면 표시
- WebSocket v1 연결
- 빈 테스트와 production build 통과

### 2단계 공용 타입·이벤트·스키마

구현:

- `게임_상태_설계.json`을 TypeScript 타입과 상수로 반영
- C→S 15개·S→C 14개 이벤트 상수
- 모든 C→S Zod strict schema
- 오류 코드·문자열·좌표·팔레트·크기·Rate Limit 상수

검증:

- unknown field 거부
- event/detail schema 1:1
- allowedActions 13개 일치
- 문서 상수와 코드 상수 일치 테스트

### 3단계 Room·세션·연결

구현:

- 100~999 Room registry
- 방별 FIFO queue
- 30 슬롯 입장 경합
- sessionToken 발급·회전·hash
- same-token·same-nickname 복구
- 강퇴 ban Set
- host disconnect 30분 TTL, 자동 이양 없음

검증:

- 29슬롯 방에 50개 동시 JOIN → 성공 1건
- 다중 탭이 서로 다른 플레이어
- 연결 중 nickname/token 탈취 거부
- host disconnect/reconnect 반복에서 hostId 불변

### 4단계 상태 머신·권한

구현:

- Room/Round/Connection 분리
- 상태 전이
- mode별 역할
- drawerId·drawerEpoch
- keywordExposedPlayerIds
- allowedActions

검증:

- 각 상태의 비허용 이벤트 오류
- 조작한 역할·playerId·authorId 무시
- 위임·회수 경합 뒤 drawer 한 명
- 이전 drawer의 추측 거부

### 5단계 PUBLIC·PRIVATE projection

구현:

- PUBLIC builder
- 수신자별 PRIVATE builder
- 민감 정보 redaction

검증:

- 일반 참여자 raw frame·DOM·로그에서 keyword와 normalizedKeyword 0건
- 권한 회수 직후 이전 drawer PRIVATE keyword 0건
- 다른 방 민감·공개 상태 유출 0건

### 6단계 제한 시간·정답·공개 추측

구현:

- SET_ROUND_DURATION
- SET_KEYWORD_AND_START
- server deadline
- SUBMIT_GUESS
- GUESS_SHARED
- 최초 정답 확정
- ROUND_SOLVED·ROUND_EXPIRED
- START_NEXT_ROUND

검증:

- 20/180 성공, 15/185/5의 배수 아님 거부
- 활성 라운드 시간 변경 거부
- deadline 경계 정답/만료 단일 확정
- 동시 정답 30개를 100회 실행해 winner 매회 하나
- 수락 guess 전원 동일 순서, 거부 guess 공유 0건

### 7단계 벡터 캔버스

구현:

- Pointer Events와 정규화 좌표
- 다색 펜·3굵기·지우개
- preview·batch·server echo
- drawingSeq/revision/epoch
- undo·clear
- snapshot chunk·hash
- backpressure

검증:

- 세 기기 크기에서 같은 벡터 재현
- invalid 좌표·65점 batch·2,049점 stroke 거부
- duplicate 점 중복 0
- gap 뒤 snapshot hash 수렴
- 권한 변경·clear 뒤 stale packet 수락 0
- deadline 뒤 draw/undo/clear 수락 0

### 8단계 React socket·reducer

구현:

- WebSocket lifecycle·heartbeat·reconnect
- reducer와 dispatch table
- PUBLIC/PRIVATE merge
- snapshot assembler
- modal/toast queue
- seq·eventId dedupe

검증:

- stale closure 없음
- reconnect 중 입력 차단
- 해결·만료 모달 한 번
- 과거 이벤트 재생 없음
- send silent drop 없음

### 9단계 역할별 UI·디자인

구현:

- 로비
- 일반 host/drawer
- 추측자
- moderator
- 위임 drawer
- 공개 guess feed
- timer slider·countdown
- solved/expired·kick·reconnect UX
- 반응형·Safe Area·키보드·ARIA
- Jua·LINE Seed Sans KR

검증:

- allowedActions와 controls 일치
- 모바일 키보드가 입력·제출을 가리지 않음
- drawer/guess/locked 상태가 문구와 형태로 구분
- focus 이동·복구
- 색상 대비와 reduced motion

### 10단계 PWA·자산

구현:

- manifest·service worker
- 기존 아이콘 복사
- maskable·Apple 아이콘
- font 파일·OFL
- service worker에서 `/api/time` 캐시·오프라인 대체 금지

검증:

- manifest와 모든 자산 200
- `/api/time` 응답 `Cache-Control: no-store`, service worker 캐시 적중 0건
- 설치 가능
- mask 잘림 없음
- standalone Safe Area 조작 가능
- 오프라인에서 가짜 Room 상태를 표시하지 않음

### 11단계 통합·E2E·부하

구현:

- 통합 테스트
- Playwright 다중 브라우저 시나리오
- k6 baseline·stress
- 보안 fuzz

검증:

- 아래 테스트 필수 목록 전체 통과
- `검증_보고서.md` 추적 항목에 테스트 파일 연결

### 12단계 배포 후보 검증

구현:

- production build
- same-origin 정적·WebSocket
- origin allowlist·보안 헤더
- shutdown

검증:

- CI typecheck→lint→test→build→E2E 통과
- 배포 후보 부하 합격
- 계획 문서·코드 상수 최종 대조

## 17. 테스트 필수 목록

### 서버 규칙·보안

- 방번호 `100`, `999`, 중복·범위 밖·코드 소진
- 정원 30과 마지막 자리 동시 입장
- NORMAL/MODERATOR 모드 불변
- 상태별 allowedActions
- 권한 없는 keyword·draw·assign·kick·next 요청
- host·moderator 강퇴와 일반 참여자 강퇴 거부
- 강퇴 token·nickname 재입장 차단
- host 자동 이양 0건
- host token 복구와 원래 nickname 폴백
- host 30분 TTL 및 명시 퇴장
- 서버 재시작 후 ROOM_NOT_FOUND·로비 복귀

### 정답·추측·시간

- space, tab, newline, NBSP, ideographic space 제거
- 대소문자·문장부호·Unicode 조합은 그대로 비교
- 수락 오답·정답 모두 GUESS_SHARED
- 거부·Rate Limit·해결·만료 후 입력 공유 0건
- 정답 경합 winner 하나
- 정답 뒤 입력 잠금
- timer 20~180·5초 단위·기본 60
- active 시간 변경 거부
- solve와 expiry 경합 최종 상태 하나
- 재접속 후 roundEndsAt 기준 시간 복원
- 로컬 벽시계가 각각 -120초·0초·+120초인 3개 클라이언트에 0/200/800ms 지연을 주어도 같은 `roundEndsAt`을 유지하고 표시 차이가 초 단위 경계 오차 1초 이내
- 활성 라운드 중 로컬 벽시계를 변경해도 `performance.now()` anchor 기반 남은 시간이 역행하거나 멋대로 뛰지 않음
- 백그라운드 복귀 즉시 현재 deadline으로 복원되고 숨겨진 시간만큼 별도 차감·가산하지 않음
- React Strict Mode 재마운트·재접속·라운드 교체 뒤 활성 표시 scheduler가 정확히 하나
- 이전 roundId의 타이머 callback·동기화 응답·10초 경고가 새 라운드에 미치는 영향 0건
- 서버 timer callback을 고의로 늦춰도 deadline 이후 draw·undo·clear·guess 수락 0건
- 초/밀리초 혼용과 `floor`/`ceil` 불일치를 단위 테스트로 차단

### 정보 경계·방 격리

- 일반 참여자에게 keyword 원문·정규화 값 미전송
- 이전 drawer 권한 회수 뒤 keyword 미전송
- 다른 방 PUBLIC·PRIVATE·stroke·guess·solved·expired·kick 유출 0건
- 로그·오류·분석 이벤트 keyword·token 0건
- 세션 token은 ROOM_SESSION 대상 연결에만 전송

### 캔버스

- 마우스·터치·펜
- 6색·3굵기·지우개
- PEN/ERASER color 조건
- 정규화 좌표 기기 독립 렌더
- NaN·Infinity·범위 밖
- batch/stroke/revision 상한
- duplicate/gap/out-of-order
- stale round/revision/epoch
- undo는 현재 revision의 마지막 표시 완료 stroke이며 요청 권한은 현재 drawer에게만 있음
- clear와 지연 batch 경합
- snapshot chunk·SHA-256·delta 합류
- 느린 클라이언트 격리와 snapshot 수렴

### 클라이언트·접근성

- 로비 필수 요소와 Enter 입장
- 다중 탭 독립 세션
- PUBLIC/PRIVATE 권한별 DOM
- 공개 guess feed 순서·최근 100개 복원
- 제시어 로컬 가림
- timer range 키보드·aria-valuetext
- 10초 경고 1회
- 해결·만료 모달 1회
- 재접속 overlay와 현재 UI 복원
- 강퇴 안내
- 모바일 세로·낮은 가로·데스크톱
- Safe Area·소프트 키보드·캔버스 제스처
- PWA 설치·아이콘·폰트 fallback

### E2E 핵심 경로

1. 일반 모드 방 생성 → 참가 → 시간 설정 → 제시어 확정 → 그림·공개 추측 → 정답 → 잠금 → 다음 라운드
2. 진행자 모드 방 생성 → drawer 지정 → 제시어·그림 → 권한 회수·재지정 → 이전 drawer 추측 불가
3. 시간 설정 → 정답 없이 expiry → 그림·추측 잠금 → 다음 라운드
4. host disconnect → 일반 사용자 비이양 확인 → 원래 host 복귀
5. host 미복귀 30분 → ROOM_CLOSED
6. 강퇴 → 대상 KICKED → 방 PLAYER_KICKED → 재입장 차단
7. 서로 다른 두 방에서 동시에 그림·추측 → 교차 이벤트 0건
8. drawing 중 연결 끊김 → reconnect snapshot·권한·시간 복원

### 부하 합격 기준

- 기준: 20 rooms × 30 sockets = 600 연결, 30분
- 스트레스: 50 rooms × 30 sockets = 1,500 연결, 30분
- stroke 서버 수신→관찰자 p95 ≤150ms, p99 ≤300ms
- guess 수신→ROUND_SOLVED p95 ≤200ms, p99 ≤400ms
- Room 큐 대기 p95 ≤50ms
- event-loop lag p95 <50ms
- CPU 평균 <70%
- 안정 구간 RSS 증가율 <10%
- 누락·중복·다른 방 유출 0건
- 느린 클라이언트로 인한 정상 클라이언트 p95 악화 <20%

## 18. P2 후속 범위

P1 완료 뒤 대표님 승인으로만 구현합니다.

- 도움말·튜토리얼
- 효과음과 전역 음소거
- 관전자용 고급 중계 화면
- 라운드 기록·이전 그림 다시 보기
- 접근성 고도화

P2를 위한 빈 abstraction이나 미사용 설정을 P1에 미리 만들지 않습니다.

## 19. 구현 금지 사항

- 호스트 권한 자동 이양
- 클라이언트 역할·drawer·author·room 주장 신뢰
- 일반 참여자에게 제시어 전송
- 정규화 제시어를 클라이언트에 전송
- 해결·만료 후 guess/draw/undo/clear 수락
- 거부된 추측 공개
- 캔버스 전체 비트맵 프레임 반복 전송
- 자유 색상 선택기와 고급 편집
- 랜덤 제시어 풀
- 팀전 또는 D-22 외의 점수 규칙
- 릴레이 그리기·그룹 배정·순번·턴 수 맞추기
- AI 플레이어·자동 그리기
- 계정·랭킹·장기 통계
- MongoDB·Redis·기타 영속 저장
- 다중 서버 replica
- Socket.IO
- 이벤트 명세에 없는 중복 상태 이벤트
- UI 텍스트의 이모지
- 근거 없는 인접 리팩터링과 범위 밖 기능

## 20. 완료 기준

다음 조건이 모두 충족될 때만 구현 완료로 보고하세요.

- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm test` 통과
- `npm run build` 통과
- Playwright 핵심 E2E 통과
- 서버·클라이언트 개발 실행 가능
- 방 생성·입장·다중 탭·재접속 가능
- C→S 15개·S→C 14개 이벤트와 코드 상수 1:1
- allowedActions 13개와 UI·서버 검증 일치
- PUBLIC/PRIVATE 제시어 경계 검증 통과
- 수락 추측 전원 공유와 최초 정답 단일 확정 통과
- 20~180초 slider·서버 expiry 경합 통과
- 6색 vector canvas·snapshot·backpressure 통과
- host 비이양·30분 복구·강퇴 차단 통과
- 모바일·Safe Area·접근성·PWA 검증 통과
- 기준 부하 합격
- 코드와 문서에 금지된 릴레이·그룹·D-22 외 점수 규칙·구 이벤트가 없음
- `docs/검증_보고서.md`의 P1 추적 항목에 구현 파일과 테스트 근거가 연결됨

작업 중 실패 테스트나 계약 불일치를 발견하면 원인을 수정하고 같은 검증을 다시 실행하세요. 완료되지 않은 상태를 완료라고 보고하지 마세요.
