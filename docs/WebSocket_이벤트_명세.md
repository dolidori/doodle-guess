# Doodle Guess WebSocket 이벤트 명세

## 1. 지위와 근거

이 문서는 클라이언트와 서버 사이 통신 계약의 단일 출처다. 모든 payload는 strict이며 명시하지 않은 필드는 거부한다.

- 서버 권위·서버 검증: 공통 지침 §1.2, §3.7
- 재접속: 공통 지침 §2.3, `결정_기록.md` D-14~D-16
- 역할·제시어·그리기 권한: `게임 설명.md` 5행, 7~8행
- 공개 추측·정답: `게임 설명.md` 4행, D-08~D-10
- 벡터 캔버스와 도구: `게임 설명.md` 6행, D-12~D-13
- 강퇴: `게임 설명.md` 13행, D-14
- 호스트 비이양·TTL: `게임 설명.md` 14행, D-17
- 방 정원: D-03
- 라운드 제한 시간: `결정_기록.md` D-21
- 이벤트명·크기·Rate Limit·오류 코드는 게임 설명에 없어 결정한 구현 규칙이다.

## 2. 전송과 공통 봉투

WebSocket UTF-8 JSON을 사용한다. 이벤트명은 `UPPER_CASE`, 프로토콜 버전은 `1`이다.

```ts
type ClientEnvelope = {
  v: 1;
  type: ClientEventType;
  requestId: string; // UUID
  payload: unknown;
};

type ServerEnvelope = {
  v: 1;
  type: ServerEventType;
  requestId?: string;   // 요청 결과·오류 상관관계
  roomVersion?: number; // 저빈도 의미 상태 버전
  eventSeq?: number;    // 방 전체 논리 이벤트의 단조 증가 순번
  roundId?: string;
  payload: unknown;
};
```

- C→S JSON 절대 상한은 UTF-8 16KiB다. 초과 frame은 close code 1009로 종료한다.
- envelope와 payload의 unknown field는 `INVALID_PAYLOAD`다.
- `requestId` 중복은 60초 동안 같은 연결에서 멱등 처리한다. 완료 응답을 재전송하며 명령을 다시 실행하지 않는다.
- `JOIN_ROOM` 외 활성 방 명령은 payload에 `roomCode`, `playerId`, 역할을 넣지 않는다. 서버 연결 컨텍스트가 방과 발신자를 정한다.
- `roomVersion`은 player/role/phase/deadline/winner 같은 의미 상태가 바뀔 때 증가한다.
- `eventSeq`는 수락된 방 전체 논리 이벤트마다 증가하며 같은 명령에서 파생된 broadcast들은 같은 값을 쓴다. 수신자별 PRIVATE 전송과 오류에는 부여하지 않는다.
- drawing hot path는 `(drawingRevision, drawingSeq)`, 공개 추측은 `(roundId, guessSeq)`로 별도 정렬한다.

## 3. 공통 타입과 문자열

```ts
type RoomCode = string; // /^[1-9][0-9]{2}$/
type RoomMode = 'NORMAL' | 'MODERATOR';
type RoomStatus =
  | 'WAITING'
  | 'ROUND_ACTIVE'
  | 'ROUND_SOLVED'
  | 'ROUND_EXPIRED'
  | 'CLOSED';
type RoundStatus =
  | 'PREPARING_KEYWORD'
  | 'DRAWING_AND_GUESSING'
  | 'SOLVED'
  | 'EXPIRED';
type PaletteColor =
  | 'BLACK' | 'BLUE' | 'ORANGE'
  | 'GREEN' | 'VERMILION' | 'PURPLE';
type StrokeWidth = 'THIN' | 'MEDIUM' | 'THICK';
type StrokeTool = 'PEN' | 'ERASER';
```

문자열 길이는 Unicode code point로 계산하고 UTF-8 byte 상한도 함께 적용한다.

| 값 | code point | UTF-8 | 추가 규칙 |
|---|---:|---:|---|
| nickname | 1~20 | 80B | 앞뒤 공백 제거 후 비어 있지 않음, 제어 문자 금지 |
| keyword | 1~50 | 256B | 제어 문자 금지, 서버 로그 금지 |
| guess | 1~80 | 512B | 앞뒤 공백 제거 후 비어 있지 않음, 제어 문자 금지 |
| sessionToken | 고정 43자 | 43B | 256-bit base64url |

정답 비교는 keyword와 guess에서 ECMAScript Unicode 공백 문자만 `/\s/gu`로 모두 제거하고 그 밖의 대소문자·구두점·Unicode 형식은 바꾸지 않는다(D-09).

## 4. 이벤트 목록

### C→S

1. `CREATE_ROOM`
2. `JOIN_ROOM`
3. `LEAVE_ROOM`
4. `SET_ROUND_DURATION`
5. `SET_ANSWER_MODE`
6. `SET_KEYWORD_AND_START`
7. `SUBMIT_GUESS`
8. `DRAW_STROKE_BATCH`
9. `UNDO_LAST_STROKE`
10. `CLEAR_DRAWING`
11. `ASSIGN_DRAWER`
12. `RECLAIM_DRAWER`
13. `KICK_PLAYER`
14. `START_NEXT_ROUND`
15. `RETURN_TO_WAITING`

### S→C

1. `ROOM_SESSION`
2. `PUBLIC_STATE`
3. `PRIVATE_STATE`
4. `GUESS_SHARED`
5. `ROUND_SOLVED`
6. `ROUND_EXPIRED`
7. `STROKE_BATCH`
8. `STROKE_UNDONE`
9. `DRAWING_CLEARED`
10. `DRAWING_SNAPSHOT`
11. `KICKED`
12. `PLAYER_KICKED`
13. `ROOM_CLOSED`
14. `ERROR`

별도 `SET_KEYWORD_VISIBILITY`는 없다. D-11에 따라 보기/가리기는 각 권한자 화면의 로컬 상태다. `PLAYERS_UPDATED`, `DRAWER_CHANGED`, `ROUND_STARTED`, `RECONNECT_STATE`는 `PUBLIC_STATE`/`PRIVATE_STATE`로 통합한다.

### 4.1 S→C 크기와 발생 상한

서버 이벤트는 클라이언트가 임의로 발생시킬 수 없으며 수락된 C→S 명령 또는 서버 timer에 의해서만 발생한다. 같은 명령에서 동일한 full state를 두 번 보내지 않는다.

| 이벤트 | payload 최대 | 발생 상한 |
|---|---:|---|
| `ROOM_SESSION` | 2KiB | CREATE/JOIN 성공당 1회 |
| `PUBLIC_STATE` | 128KiB | 의미 상태 mutation당 1회 |
| `PRIVATE_STATE` | 2KiB | 의미 상태 mutation당 수신자별 1회 |
| `GUESS_SHARED` | 1KiB | 수락 guess당 1회 |
| `ROUND_SOLVED`, `ROUND_EXPIRED` | 각 1KiB | round당 둘 중 1회 |
| `STROKE_BATCH` | 8KiB | 수락 batch당 1회 |
| `STROKE_UNDONE`, `DRAWING_CLEARED` | 각 1KiB | 수락 명령당 1회 |
| `DRAWING_SNAPSHOT` | 청크당 64KiB | 입장·재접속·backpressure 복구당 snapshot 1개 |
| `KICKED`, `PLAYER_KICKED`, `ROOM_CLOSED` | 각 1KiB | 해당 상태 전이당 1회 |
| `ERROR` | 2KiB | 거부 request당 1회 |

## 5. C→S 상세 계약

### 5.1 `CREATE_ROOM`

```ts
payload: {
  nickname: string;
  mode: 'NORMAL' | 'MODERATOR';
}
```

- 허용: 방에 속하지 않은 연결.
- 처리: 100~999의 빈 방을 생성한다. creator는 host이며 초기 drawer다. MODERATOR mode creator는 moderator도 겸한다.
- 정원: creator를 포함한 30 슬롯.
- 성공: 발신자에게 `ROOM_SESSION`, 이어서 `PUBLIC_STATE`, `PRIVATE_STATE`, 빈 `DRAWING_SNAPSHOT`.
- 크기/Rate: 2KiB, IP당 분당 5회·burst 5.
- 오류: `ALREADY_IN_ROOM`, `INVALID_NICKNAME`, `ROOM_CODE_EXHAUSTED`, `RATE_LIMITED`.

### 5.2 `JOIN_ROOM`

```ts
payload: {
  roomCode: RoomCode;
  nickname: string;
  sessionToken?: string;
}
```

- 허용: 방에 속하지 않은 연결.
- 복구 우선순위:
  1. 유효한 sessionToken의 disconnect 슬롯이며 payload nickname이 저장된 nickname과 정확히 같을 때 복구.
  2. token이 없고 정확히 같은 nickname의 disconnect 슬롯.
  3. token을 보내지 않은 다른 nickname이면 새 슬롯.
- sessionToken과 nickname이 서로 다른 기존 슬롯을 가리키면 `INVALID_SESSION`으로 거부한다. 다른 닉네임의 새 플레이어로 들어가려는 클라이언트는 이전 token을 보내지 않는다.
- 연결 중인 nickname/token 탈취는 거부한다.
- 강퇴된 token 또는 같은 nickname은 방이 닫힐 때까지 거부한다.
- 새 슬롯은 host/moderator/drawer 권한이 없다.
- 성공: token을 회전한 `ROOM_SESSION`, `PUBLIC_STATE`, 수신자별 `PRIVATE_STATE`, 현재 `DRAWING_SNAPSHOT`.
- 크기/Rate: 2KiB, IP당 분당 5회·burst 5.
- 오류: `INVALID_ROOM_CODE`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `NICKNAME_IN_USE`, `REENTRY_BLOCKED`, `SESSION_IN_USE`, `INVALID_SESSION`, `RATE_LIMITED`.

### 5.3 `LEAVE_ROOM`

```ts
payload: {}
```

- 일반 참여자: 슬롯을 즉시 제거하고 나머지에 `PUBLIC_STATE`.
- host: 자동 이양 없이 전원에게 `ROOM_CLOSED` reason `HOST_LEFT`, Room 삭제.
- 크기/Rate: 1KiB, 초당 2회·burst 2.
- 오류: `NOT_IN_ROOM`.

### 5.4 `SET_ROUND_DURATION`

```ts
payload: {
  durationSeconds: number; // integer, min 20, max 180, multipleOf 5
}
```

- 권한: host 또는 moderator.
- 허용 phase: `PREPARING_KEYWORD`만. mode와 관계없이 활성 라운드 중 변경 금지.
- 기본값: Room 생성 시 60초. 다음 라운드에도 마지막 설정값을 유지한다.
- 성공: `roomVersion` 증가 후 방 전체 `PUBLIC_STATE`.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_PHASE`, `INVALID_DURATION`, `RATE_LIMITED`.

### 5.5 `SET_ANSWER_MODE`

```ts
payload: {
  answerMode: 'FIRST_CORRECT' | 'UNTIL_TIMER';
}
```

- 권한: host 또는 moderator.
- 허용 phase: `PREPARING_KEYWORD`만.
- 성공: Room `answerMode` 변경, `roomVersion` 증가 후 방 전체 `PUBLIC_STATE`.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_PHASE`, `INVALID_PAYLOAD`, `RATE_LIMITED`.

### 5.6 `SET_KEYWORD_AND_START`

```ts
payload: {
  roundId: string; // UUID
  keyword: string;
}
```

- 권한: 현재 drawer.
- 허용 phase: `PREPARING_KEYWORD`.
- 시작 조건: 연결된 drawer 1명과, keyword를 본 적 없는 연결 추측자 1명 이상.
- 원자 처리: keyword 저장, 정규화 값 서버 전용 저장, drawer와 moderator를 `keywordExposedPlayerIds`에 추가, status를 `DRAWING_AND_GUESSING`으로 전환, `startedAt`과 `roundEndsAt=serverNow+durationSeconds*1000` 설정, 서버 타이머 시작.
- 성공: `roomVersion` 증가, 방 전체 `PUBLIC_STATE`, 현재 drawer와 moderator에게 keyword가 든 `PRIVATE_STATE`, 나머지에게 keyword 없는 `PRIVATE_STATE`.
- keyword 원문과 정규화 값은 PUBLIC 또는 로그에 쓰지 않는다.
- 크기/Rate: 1KiB, 10초당 2회·burst 2.
- 오류: `FORBIDDEN`, `NOT_DRAWER`, `STALE_ROUND`, `INVALID_PHASE`, `MIN_PLAYERS`, `INVALID_KEYWORD`, `RATE_LIMITED`.

### 5.7 `SUBMIT_GUESS`

```ts
payload: {
  roundId: string;
  guessId: string; // UUID, 클라이언트 생성 멱등 키
  text: string;
}
```

- 권한: 연결된 일반 참여자 중 해당 round의 keyword를 본 적 없고 아직 정답을 맞히지 않은 사용자. 현재·과거 drawer와 moderator는 금지한다.
- 허용 phase: `DRAWING_AND_GUESSING`, 서버 deadline 이전.
- 원자 처리:
  1. 다음 `guessSeq` 부여.
  2. `GuessPublic`을 최근 feed에 저장.
  3. 방 전체에 `GUESS_SHARED`.
  4. 정답이면 정답자 +1점, 첫 정답이면 현재 drawer +1점.
  5. `FIRST_CORRECT`면 `SOLVED`·winner·lock을 기록하고 타이머 취소 후 `ROUND_SOLVED`.
  6. `UNTIL_TIMER`면 정답자를 기록하고 해당 사용자의 추가 추측만 막은 채 타이머까지 진행.
- 선착순 모드 정답 text는 공개한다. 타이머 모드 정답은 `text:null`로 가린다. 거부된 text는 절대 공유하지 않는다.
- 크기/Rate: 1KiB, 초당 4회·burst 8.
- 오류: `GUESS_FORBIDDEN`, `STALE_ROUND`, `ROUND_LOCKED`, `ROUND_EXPIRED`, `INVALID_GUESS`, `RATE_LIMITED`.

### 5.8 `DRAW_STROKE_BATCH`

```ts
payload: {
  roundId: string;
  drawingRevision: number; // non-negative integer
  drawerEpoch: number;     // non-negative integer
  strokeId: string;        // UUID
  batchSeq: number;        // non-negative integer
  isFinal: boolean;
  tool: 'PEN' | 'ERASER';
  color: PaletteColor | null;
  width: StrokeWidth;
  points: Array<{ x: number; y: number }>; // 1..64
}
```

- 권한: 현재 연결된 drawer.
- 허용 phase: `DRAWING_AND_GUESSING`, 서버 deadline 이전.
- 모든 batch는 tool/color/width가 필수다. `PEN`은 PaletteColor가 필수이고 `ERASER`는 `color:null`만 허용한다.
- 같은 stroke의 batchSeq는 0부터 1씩 증가하고 style은 첫 배치와 정확히 같아야 한다.
- 성공: `drawingSeq` 증가, 방 전체에 서버 authorId가 추가된 `STROKE_BATCH`. sender echo가 수락 확인이다.
- duplicate batch는 상태를 바꾸지 않고 기존 `STROKE_BATCH`를 sender에게 재전송한다.
- gap은 거부하고 sender에게 자동 `DRAWING_SNAPSHOT`.
- 크기/Rate: 8KiB, 초당 25회·burst 40.
- 상한: batch 64점, stroke 2,048점, revision 1,000 stroke·50,000점·4MiB.
- 오류: `NOT_DRAWER`, `INVALID_PHASE`, `ROUND_EXPIRED`, `STALE_ROUND`, `STALE_DRAWING_REVISION`, `STALE_DRAWER_EPOCH`, `INVALID_STROKE`, `STROKE_STYLE_MISMATCH`, `STROKE_SEQUENCE_GAP`, `STROKE_LIMIT`, `DRAWING_LIMIT`, `RATE_LIMITED`.

### 5.9 `UNDO_LAST_STROKE`

```ts
payload: {
  roundId: string;
  drawingRevision: number;
  drawerEpoch: number;
}
```

- 권한: 현재 drawer.
- 허용 phase: `DRAWING_AND_GUESSING`, deadline 이전.
- 성공: 마지막 확정·비-undo stroke를 서버에서 `undone=true`로 표시, `drawingSeq` 증가, 방 전체 `STROKE_UNDONE`.
- 크기/Rate: 1KiB, 초당 3회·burst 5.
- 오류: `NOT_DRAWER`, `INVALID_PHASE`, `ROUND_EXPIRED`, stale 계열, `NO_STROKE_TO_UNDO`, `RATE_LIMITED`.

### 5.10 `CLEAR_DRAWING`

```ts
payload: {
  roundId: string;
  drawingRevision: number;
  drawerEpoch: number;
}
```

- 권한: 현재 drawer.
- 허용 phase: `DRAWING_AND_GUESSING`, deadline 이전.
- 성공: 벡터 비움, `drawingRevision+1`, `drawingSeq=0`, 방 전체 `DRAWING_CLEARED`.
- 크기/Rate: 1KiB, 초당 3회·burst 5.
- 오류: `NOT_DRAWER`, `INVALID_PHASE`, `ROUND_EXPIRED`, stale 계열, `RATE_LIMITED`.

### 5.11 `ASSIGN_DRAWER`

```ts
payload: {
  targetPlayerId: string; // UUID
}
```

- 권한: 준비 중 host/moderator, 활성 중 MODERATOR mode moderator.
- 허용 phase: `PREPARING_KEYWORD` 또는 `DRAWING_AND_GUESSING`.
- 대상: 같은 방의 연결된 일반 참여자.
- 성공: 기존 그림·keyword 유지, `drawerEpoch+1`, target을 `keywordExposedPlayerIds`에 추가, `roomVersion+1`, 방 전체 `PUBLIC_STATE`, 새 drawer와 moderator에게 keyword가 든 `PRIVATE_STATE`, 이전 drawer에게 keyword 없는 `PRIVATE_STATE`.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_MODE`, `INVALID_PHASE`, `TARGET_NOT_FOUND`, `TARGET_DISCONNECTED`, `RATE_LIMITED`.

### 5.12 `RECLAIM_DRAWER`

```ts
payload: {}
```

- 권한과 phase: `ASSIGN_DRAWER`와 동일.
- 성공: moderator를 drawer로 지정, `drawerEpoch+1`, 기존 그림·keyword 유지, state events 전송.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_MODE`, `INVALID_PHASE`, `RATE_LIMITED`.

### 5.13 `KICK_PLAYER`

```ts
payload: {
  targetPlayerId: string;
}
```

- 권한: host 또는 moderator.
- 대상: 같은 방의 일반 참여자. host와 moderator는 대상이 될 수 없다.
- 성공: 대상 token과 nickname을 Room ban Set에 추가, 슬롯 제거, 대상에게 `KICKED`, 나머지에게 `PLAYER_KICKED`와 `PUBLIC_STATE`, 대상 연결은 close code 4003.
- target이 drawer인 MODERATOR room에서는 `drawerId`를 moderator로 원자 회수하고 `drawerEpoch+1`.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `TARGET_NOT_FOUND`, `CANNOT_KICK_PRIVILEGED`, `RATE_LIMITED`.

### 5.14 `START_NEXT_ROUND`

```ts
payload: {
  previousRoundId: string;
}
```

- 권한: NORMAL mode host, MODERATOR mode moderator.
- 허용 phase: `SOLVED` 또는 `EXPIRED`.
- 성공: 기존 deadline timer 취소, 새 roundId, `PREPARING_KEYWORD`, keyword·winner·`guessFeed`·`keywordExposedPlayerIds`·정답자 목록 초기화, 그림 비움, `drawingRevision+1`, `drawingSeq=0`; drawer·durationSeconds·answerMode·누적 점수는 유지. `roomVersion+1`, `PUBLIC_STATE`, 수신자별 `PRIVATE_STATE`, `DRAWING_CLEARED`.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_PHASE`, `STALE_ROUND`, `RATE_LIMITED`.

### 5.15 `RETURN_TO_WAITING`

```ts
payload: {
  roundId: string;
}
```

- 권한: host 또는 moderator.
- 허용 phase: `DRAWING_AND_GUESSING`, `SOLVED`, `EXPIRED`.
- 성공: 타이머를 취소하고 새 roundId의 `PREPARING_KEYWORD`로 복귀한다. 참가자·drawer·durationSeconds·answerMode·누적 점수는 유지하며 라운드 데이터와 그림만 초기화한다.
- 크기/Rate: 1KiB, 10초당 5회·burst 5.
- 오류: `FORBIDDEN`, `INVALID_PHASE`, `STALE_ROUND`, `RATE_LIMITED`.

## 6. S→C 상세 계약

### 6.1 `ROOM_SESSION`

대상 연결에만 보낸다.

```ts
payload: {
  roomCode: RoomCode;
  playerId: string;
  nickname: string;
  mode: RoomMode;
  sessionToken: string; // 성공 때마다 회전, sessionStorage 저장
  isReconnect: boolean;
}
```

token은 PUBLIC/PRIVATE state, 로그, 다른 사용자에게 포함하지 않는다.

### 6.2 `PUBLIC_STATE`

방 전체 브로드캐스트 또는 입장자 단독 복원에 사용한다. keyword 필드는 타입 자체에 없다.

```ts
payload: {
  roomCode: RoomCode;
  mode: RoomMode;
  status: RoomStatus;
  roomVersion: number;
  eventSeq: number;
  serverNow: number; // Unix epoch ms
  hostDisconnectedAt: number | null;
  expiresAt: number | null; // host 30분 TTL
  players: Array<{
    playerId: string;
    nickname: string;
    connected: boolean;
    isHost: boolean;
    isModerator: boolean;
  }>;
  drawerId: string;
  drawerEpoch: number;
  round: {
    roundId: string;
    status: RoundStatus;
    durationSeconds: number;
    startedAt: number | null;
    roundEndsAt: number | null;
    hasKeyword: boolean;
    guessLocked: boolean;
    winnerId: string | null;
    winnerNickname: string | null;
    solvedAt: number | null;
    expiredAt: number | null;
    lastRoundEventId: string | null;
    guessSeq: number;
  };
  drawing: {
    drawingRevision: number;
    drawingSeq: number;
    strokeCount: number;
    pointCount: number;
  };
  guessFeed: GuessPublic[]; // 현재 round 최근 100개
}
```

Room status와 Round status의 대응은 `WAITING/PREPARING_KEYWORD`, `ROUND_ACTIVE/DRAWING_AND_GUESSING`, `ROUND_SOLVED/SOLVED`, `ROUND_EXPIRED/EXPIRED`다. Room 삭제 직전만 `CLOSED`를 사용한다.

`serverNow`는 Unix epoch 밀리초의 상태 생성 시각이며 진단·초기 임시 표시에 사용한다. 정확한 clock offset은 §8의 왕복 시간 동기화로 계산하고 `roundEndsAt`까지의 남은 시간을 표시한다. 표시 타이머는 권위가 아니며 0이 되어도 서버의 `ROUND_EXPIRED` 또는 state를 기다린다.

### 6.3 `PRIVATE_STATE`

수신자별로 별도 생성한다.

```ts
payload: {
  playerId: string;
  roundId: string;
  keyword: string | null;
  hasSeenKeywordThisRound: boolean;
  allowedActions: Array<
    | 'LEAVE_ROOM'
    | 'SET_ROUND_DURATION'
    | 'SET_ANSWER_MODE'
    | 'SET_KEYWORD_AND_START'
    | 'SUBMIT_GUESS'
    | 'DRAW_STROKE_BATCH'
    | 'UNDO_LAST_STROKE'
    | 'CLEAR_DRAWING'
    | 'ASSIGN_DRAWER'
    | 'RECLAIM_DRAWER'
    | 'KICK_PLAYER'
    | 'START_NEXT_ROUND'
    | 'RETURN_TO_WAITING'
  >;
  hasAnsweredCorrectly: boolean;
}
```

keyword는 현재 drawer 또는 moderator에게만 원문, 나머지는 null이다. 이전 drawer는 null이지만 `hasSeenKeywordThisRound:true`이고 추측 권한이 없다.

### 6.4 `GUESS_SHARED`

서버가 정상 수락한 모든 추측을 방 전체에 보낸다.

```ts
type GuessPublic = {
  guessId: string;
  roundId: string;
  guessSeq: number;
  playerId: string;
  nickname: string;
  text: string | null; // UNTIL_TIMER 정답은 null
  submittedAt: number;
  isCorrect: boolean;
};
payload: GuessPublic;
```

guessSeq는 round별 1부터 연속 증가한다. 정답도 먼저 `GUESS_SHARED(isCorrect:true)`로 공유되고 바로 다음에 `ROUND_SOLVED`가 온다.

### 6.5 `ROUND_SOLVED`

```ts
payload: {
  eventId: string;
  roundId: string;
  guessId: string;
  guessSeq: number;
  winnerId: string;
  winnerNickname: string;
  answerText: string;
  solvedAt: number;
}
```

방 전체 전송이다. `answerText`는 정답으로 수락되어 이미 `GUESS_SHARED`에 공개된 입력이다. keyword 서버 원문을 별도 노출하지 않는다. `eventId`는 roundId에 대해 안정적이며 모달은 한 번만 표시한다.

### 6.6 `ROUND_EXPIRED`

```ts
payload: {
  eventId: string;
  roundId: string;
  expiredAt: number;
  roundEndsAt: number;
}
```

서버 deadline 만료 큐 작업이 drawing과 guess를 원자 잠근 뒤 방 전체에 한 번 보낸다. keyword는 공개하지 않는다. 재접속 시 이 이벤트를 재생하지 않고 `PUBLIC_STATE.status='EXPIRED'`와 `lastRoundEventId`로 화면을 복원한다.

### 6.7 `STROKE_BATCH`

```ts
payload: {
  roundId: string;
  drawingRevision: number;
  drawingSeq: number;
  drawerEpoch: number;
  strokeId: string;
  batchSeq: number;
  isFinal: boolean;
  authorId: string;
  tool: StrokeTool;
  color: PaletteColor | null;
  width: StrokeWidth;
  points: Array<{ x: number; y: number }>;
}
```

방 전체 전송이며 drawingSeq로 적용 순서를 검증한다.

### 6.8 `STROKE_UNDONE`

```ts
payload: {
  roundId: string;
  drawingRevision: number;
  drawingSeq: number;
  strokeId: string;
}
```

클라이언트는 해당 stroke를 제거하고 전체 벡터를 순서대로 다시 합성한다.

### 6.9 `DRAWING_CLEARED`

```ts
payload: {
  roundId: string;
  drawingRevision: number;
  drawingSeq: 0;
}
```

새 revision으로 로컬 벡터·미리보기·이전 delta buffer를 비운다.

### 6.10 `DRAWING_SNAPSHOT`

각 청크 payload는 UTF-8 64KiB 이하다.

```ts
payload: {
  snapshotId: string;
  roundId: string;
  drawingRevision: number;
  lastDrawingSeq: number;
  chunkIndex: number; // 0-based
  totalChunks: number;
  sha256: string;     // 전체 재조립 canonical vector JSON
  fragments: Array<{
    strokeId: string;
    authorId: string;
    tool: StrokeTool;
    color: PaletteColor | null;
    width: StrokeWidth;
    finalized: boolean;
    lastBatchSeq: number;
    fragmentIndex: number;
    fragmentCount: number;
    points: Array<{ x: number; y: number }>;
  }>;
}
```

청크는 같은 snapshot 메타데이터를 반복한다. 클라이언트는 `totalChunks`개를 모두 받은 뒤 sha256을 확인하고 `lastDrawingSeq` 이후 버퍼 delta를 적용한다.
snapshot fragments에는 서버 상태에서 `undone=false`인 활성 스트로크만 합성 순서대로 포함한다.
각 fragment의 color 조건도 delta와 같다. `PEN`은 PaletteColor, `ERASER`는 null이다.

### 6.11 `KICKED`

```ts
payload: {
  roomCode: RoomCode;
  reason: 'KICKED_BY_HOST' | 'KICKED_BY_MODERATOR';
}
```

대상에게만 전송한 뒤 close code 4003으로 종료한다.

### 6.12 `PLAYER_KICKED`

```ts
payload: {
  playerId: string;
  nickname: string;
  kickedByPlayerId: string;
}
```

강퇴 대상 이외의 방 연결에 한 번 전송한다. 이어지는 `PUBLIC_STATE`가 목록과 권한을 권위 상태로 수렴시킨다.

### 6.13 `ROOM_CLOSED`

```ts
payload: {
  roomCode: RoomCode;
  reason:
    | 'HOST_LEFT'
    | 'HOST_ABSENT_TIMEOUT'
    | 'SERVER_SHUTDOWN';
  closedAt: number;
}
```

현재 연결자 전체에 전송하고 Room을 삭제한다. 호스트 권한은 이양하지 않는다.

### 6.14 `ERROR`

```ts
payload: {
  code: ErrorCode;
  message: string;       // keyword·token·원본 payload 미포함
  retryable: boolean;
  retryAfterMs?: number;
  current?: {
    roomVersion?: number;
    roundId?: string;
    drawingRevision?: number;
    drawerEpoch?: number;
  };
}
```

`requestId`를 반드시 되돌린다. 검증 실패 payload는 다른 사용자에게 보내지 않는다.

## 7. 오류 코드

| 코드 | 의미 | retryable |
|---|---|---:|
| `INVALID_JSON` | JSON 파싱 실패 | false |
| `INVALID_ENVELOPE` | v/type/requestId 오류 | false |
| `INVALID_PAYLOAD` | strict schema 위반 | false |
| `PAYLOAD_TOO_LARGE` | 이벤트별 크기 초과 | false |
| `RATE_LIMITED` | token bucket 초과 | true |
| `SERVER_BUSY` | Room 큐 200개 초과 | true |
| `INTERNAL_ERROR` | 명령 처리 예외 | true |
| `ALREADY_IN_ROOM` | 이미 방 컨텍스트 보유 | false |
| `NOT_IN_ROOM` | 방 컨텍스트 없음 | false |
| `ROOM_NOT_FOUND` | 존재하지 않는 방 | false |
| `ROOM_FULL` | 30 슬롯 사용 중 | true |
| `ROOM_CODE_EXHAUSTED` | 100~999 모두 사용 | true |
| `INVALID_ROOM_CODE` | 100~999 문자열 형식 위반 | false |
| `INVALID_NICKNAME` | 닉네임 규칙 위반 | false |
| `NICKNAME_IN_USE` | 연결 중 닉네임 | false |
| `REENTRY_BLOCKED` | 강퇴된 닉네임 또는 token | false |
| `SESSION_IN_USE` | 연결 중 token | false |
| `INVALID_SESSION` | token이 슬롯과 불일치 | false |
| `FORBIDDEN` | 역할 권한 없음 | false |
| `NOT_DRAWER` | 현재 drawer 아님 | false |
| `INVALID_MODE` | mode에서 이벤트 불가 | false |
| `INVALID_PHASE` | 현재 round status에서 불가 | false |
| `MIN_PLAYERS` | 연결 drawer+eligible guesser 조건 미충족 | true |
| `INVALID_DURATION` | 20~180 정수·5초 배수 위반 | false |
| `INVALID_KEYWORD` | keyword 문자열 규칙 위반 | false |
| `INVALID_GUESS` | guess 문자열 규칙 위반 | false |
| `GUESS_FORBIDDEN` | keyword 열람 이력/역할로 추측 불가 | false |
| `ROUND_LOCKED` | solved/expired로 추측 잠금 | false |
| `ROUND_EXPIRED` | 서버 deadline 이후 명령 | false |
| `STALE_ROUND` | roundId 불일치 | false |
| `STALE_DRAWING_REVISION` | clear/next-round 이전 revision | false |
| `STALE_DRAWER_EPOCH` | 권한 변경 이전 epoch | false |
| `INVALID_STROKE` | 좌표·style·점 배열 오류 | false |
| `STROKE_STYLE_MISMATCH` | 같은 stroke의 style 변경 | false |
| `STROKE_SEQUENCE_GAP` | expected batchSeq보다 큼 | true |
| `STROKE_LIMIT` | stroke 2,048점 초과 | false |
| `DRAWING_LIMIT` | revision 상한 도달 | false |
| `NO_STROKE_TO_UNDO` | undo 대상 없음 | false |
| `TARGET_NOT_FOUND` | 같은 방 대상 없음 | false |
| `TARGET_DISCONNECTED` | drawer 대상 연결 끊김 | true |
| `CANNOT_KICK_PRIVILEGED` | host/moderator 강퇴 시도 | false |

## 8. 서버 deadline과 clock skew

1. `SET_KEYWORD_AND_START`가 방 큐에서 성공한 서버 시각을 `startedAt`으로 삼는다.
2. `roundEndsAt = startedAt + durationSeconds*1000`을 저장하고 timer callback에 roundId를 캡처한다.
3. callback은 직접 상태를 바꾸지 않고 같은 Room FIFO 큐에 `EXPIRE_ROUND(roundId)` 내부 명령을 넣는다.
4. 실행 시 roundId, status, 현재 서버 시각을 다시 검사한다. 다른 라운드면 폐기하고, 아직 deadline 전이면 남은 시간으로 다시 예약한다.
5. solve, next round, Room close 때 timer를 취소한다.
6. deadline 이후 큐에서 실행되는 guess/draw/undo/clear는 callback 실행 전이라도 `ROUND_EXPIRED`로 거부한다.
7. expiry는 status `EXPIRED`, `guessLocked=true`를 원자 기록하고 drawing 입력도 status 검증으로 잠근 뒤 `ROUND_EXPIRED`를 한 번 보낸다.
8. timer callback은 편의를 위한 깨우기 장치일 뿐이다. 모든 guess/draw/undo/clear 처리에서 현재 서버 시각과 `roundEndsAt`을 다시 비교한다.
9. reconnect는 `PUBLIC_STATE`의 `serverNow`, `roundEndsAt`, status로 임시 타이머 UI를 복원하고 즉시 아래 시간 동기화를 수행한다.

### 8.1 보조 서버 시간 동기화

게임 WebSocket 이벤트는 15개 C→S·14개 S→C다. 같은 origin의 HTTP endpoint를 사용한다.

```http
GET /api/time
Cache-Control: no-store
```

```ts
{
  serverReceivedAt: number; // Unix epoch ms
  serverSentAt: number;     // Unix epoch ms, 응답 직전
}
```

클라이언트는 요청 직전의 `t0=Date.now()`, `m0=performance.now()`와 응답 직후의 `t3=Date.now()`, `m3=performance.now()`를 기록한다.

```ts
const offsetMs =
  ((serverReceivedAt - t0) + (serverSentAt - t3)) / 2;
const rttMs =
  (m3 - m0) - (serverSentAt - serverReceivedAt);
const serverEpochAtAnchor = t3 + offsetMs;
const localMonotonicAtAnchor = m3;

const estimatedServerNow =
  serverEpochAtAnchor + (performance.now() - localMonotonicAtAnchor);
```

- 연결·재연결 때 3개 유효 샘플 중 RTT가 가장 작은 샘플을 채택한다.
- 활성 라운드에서는 15초마다 한 번, 숨김 탭이 다시 보일 때 즉시 측정한다.
- `t3-t0`과 `m3-m0`의 차이가 100ms를 넘거나 음수·NaN·Infinity가 있는 샘플은 폐기한다.
- 표시 초는 모든 화면에서 `Math.max(0, Math.ceil((roundEndsAt-estimatedServerNow)/1000))`을 사용한다.
- `setInterval` tick 횟수나 메시지 수신 시점부터 시간을 차감하지 않는다. 표시 scheduler는 앱 전체에 하나만 존재하고 수명주기마다 해제한다.
- 동기화 응답·표시 effect·10초 경고는 캡처한 `roundId`가 현재 라운드와 같을 때만 반영한다.
- 클라이언트 0초는 표시일 뿐이며 phase 변경이나 `ROUND_EXPIRED` 전송을 만들지 않는다.

## 9. 순서와 재접속

- 정상 입장/복구 순서: `ROOM_SESSION` → `PUBLIC_STATE` → `PRIVATE_STATE` → `DRAWING_SNAPSHOT` → 이후 delta.
- 클라이언트는 roomVersion이 감소한 state를 버린다.
- 서버가 backpressure 때문에 drawing delta를 건너뛴 연결에는 snapshot을 자동 전송한다. 그 밖에 클라이언트가 drawingSeq gap·snapshot chunk 누락·해시 불일치를 발견하면 소켓을 닫고 자동 재접속해 새 snapshot으로 복구한다.
- guessSeq gap은 다음 `PUBLIC_STATE.guessFeed`로 복구한다. 최근 100개 이전 이력은 게임 UI 복원 범위가 아니다.
- `ROUND_SOLVED`와 `ROUND_EXPIRED` 모달은 `eventId`를 reducer에서 소비 기록해 중복 방지한다. reconnect에서는 일회 이벤트를 재생하지 않는다.
- host disconnect는 `PUBLIC_STATE`만 바꾸며 host를 다른 player로 바꾸는 이벤트는 존재하지 않는다.

## 10. 정보 경계 검증

| 데이터 | 방 전체 | drawer | moderator | 서버만 |
|---|:---:|:---:|:---:|:---:|
| player/role/connection | O | O | O | O |
| drawerId/phase/deadline | O | O | O | O |
| vector drawing | O | O | O | O |
| 수락 guess와 정답 입력 | O | O | O | O |
| keyword 원문 | X | O | O | O |
| normalized keyword | X | X | X | O |
| session token | X | 본인만 | 본인만 | hash |
| 강퇴 ban token hash | X | X | X | O |
| allowedActions | X | 본인만 | 본인만 | O |

다른 방 연결, 강퇴 사용자, 일반 추측자에게 keyword가 전달되는 경로는 없다. `ERROR`, 로그, snapshot에도 keyword를 포함하지 않는다.

## 11. 계약 검증 기준

1. 각 C→S event의 unknown field·누락·경계 밖 값이 `INVALID_PAYLOAD` 또는 전용 오류로 거부된다.
2. 수락 guess는 오답·정답 모두 정확히 한 번 `GUESS_SHARED`; 거부 guess 공유는 0건이다.
3. 정답 순서는 `GUESS_SHARED` 다음 `ROUND_SOLVED`이며 winner는 하나다.
4. deadline 이후 guess/drawing/undo/clear 수락은 timer callback 지연 여부와 무관하게 0건이다.
5. 새 round 뒤 이전 timer callback이 현재 round를 만료시키는 경우는 0건이다.
6. 일반 사용자의 raw frame, state, error에서 keyword와 normalized keyword 검색 결과가 0이다.
7. duplicate stroke batch는 점 중복 0, drawingSeq gap은 snapshot 후 서버와 해시가 같다.
8. host disconnect 후 host 변경 이벤트와 일반 사용자 isHost 승격은 0건이다.
9. 30명 방에 신규 JOIN은 `ROOM_FULL`, 기존 slot 복구는 성공한다.
10. 모든 event의 문서상 크기·Rate Limit과 Zod schema 상수가 동일하다.
