# Render 설정값

| 항목 | 값 |
|---|---|
| 서비스 유형 | Web Service |
| 이름 | doodle-guess |
| 리전 | Singapore |
| 브랜치 | main |
| 언어 | Node |
| 루트 디렉터리 | 비워두기 |
| 빌드 명령 | `npm ci --include=dev && npm run build` |
| 시작 명령 | `npm start` |
| 상태 확인 경로 | `/health/ready` |
| 자동 배포 | On Commit |
| 인스턴스 수 | 1 |

| 환경 변수 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://doodle-guess-9m52.onrender.com` |
| `TRUST_PROXY` | `1` (생략 가능. `NODE_ENV=production`이면 자동으로 켜진다) |
| `AI_PROVIDER` | 쓸 provider를 **쉼표로 나열**한다. 앞에서부터 시도한다. 기본 `gemini` |
| `AI_PASSWORD` | AI 참여자를 추가할 수 있는 비밀번호. 없으면 기능이 꺼진다 |
| `GEMINI_API_KEY` | 목록에 `gemini`가 있으면 필요 |
| `OPENROUTER_API_KEY` | 목록에 `openrouter`가 있으면 필요 |
| `DEEPSEEK_API_KEY` | 목록에 `deepseek`가 있으면 필요 |
| `AI_GUESS_INTERVAL_MS` | 생략 가능(기본 7000). AI가 캔버스를 다시 보는 간격 |
| `AI_TIMEOUT_MS` | 생략 가능(기본 20000). 이 시간을 넘기면 다음 provider로 넘긴다 |
| `GEMINI_MODEL` 등 | 생략 가능. provider별 기본 모델을 바꿔 끼울 때만 쓴다 |

## AI 참여자

고른 provider 중 **적어도 하나의 API 키**와 **`AI_PASSWORD`**가 있어야 기능이 켜진다.
하나라도 없으면 로비의 AI 입구 자체가 보이지 않으므로, 키만 넣고 비밀번호를 빠뜨려
아무나 쓰게 되는 일은 생기지 않는다.

### provider를 여러 개 쓰기 (권장)

```
AI_PROVIDER = openrouter,gemini
```

이렇게 두면 **무료 한도가 있는 OpenRouter를 먼저 쓰고**, 한도가 떨어지거나 오류가 나면
자동으로 Gemini로 넘어간다. 한도(429)나 잔액 부족(402)에 걸린 provider는 5분 동안
건너뛰므로, 막힌 곳을 계속 두드리지 않는다. 키를 넣지 않은 provider는 목록에서 저절로
빠지므로, 나중에 키만 추가하면 그때부터 쓰인다.

| provider | 기본 모델 | 비용 |
|---|---|---|
| `openrouter` | `openrouter/free` | 무료. 하루 50회 제한(크레딧 $10 이상 1회 구매 시 1,000회로 영구 상승) |
| `gemini` | `gemini-2.5-flash` | 결제 연결 시 AI 3명 1시간에 약 $0.23. `gemini-3.5-flash`는 12배 비싸다 |
| `deepseek` | `deepseek-v4-flash` (+ 비전 전용 모델) | 무료 크레딧이 없어 **충전해야** 쓸 수 있다 |

키 발급처는 각각 openrouter.ai/keys, aistudio.google.com, platform.deepseek.com 이다.

### 무료 모델은 느리다 — 그래서 타임아웃이 중요하다

무료 모델은 짧은 답(추측)은 2초 안에 주지만, 그림 계획처럼 긴 답은 50초가 넘게
걸리기도 한다. 라운드가 60초인데 그 답을 끝까지 기다리면 정작 그릴 시간이 사라진다.
`AI_TIMEOUT_MS`(기본 20초)로 끊어 주면 체인이 다음 provider로 넘겨 제때 그림이 나온다.

실제로 `openrouter,gemini` 조합에서는 이렇게 나뉜다. 호출 수의 대부분을 차지하는
추측이 무료로 처리되므로 비용이 크게 줄어든다.

| 하는 일 | 라운드당 호출 | 주로 처리하는 곳 |
|---|---|---|
| 맞히기 | AI 수 × 8회 | OpenRouter (무료, 약 2초) |
| 그리기 | 1회 | Gemini (무료 쪽이 느려 넘어감, 약 5초) |

`ai_call` / `ai_call_failed` 로그에 provider와 소요 시간이 남으므로, 무료 쪽이 계속
실패해 유료로만 넘어가고 있지는 않은지 확인할 수 있다.

### Gemini 무료 티어 주의

Google Cloud 프로젝트에 **결제를 연결하면 그 프로젝트의 무료 티어는 사라지고 첫 토큰부터
과금된다.** 정말 무료로 쓰려면 결제를 연결하지 않은 별도 프로젝트에서 키를 발급해야 하며,
그때 한도는 모델에 따라 분당 5~15회다. 그 한도에 맞추려면 `AI_GUESS_INTERVAL_MS`를
늘려 호출을 줄인다 — AI n명이면 분당 대략 `(60 / 간격초) × n` 회를 부른다.

지금 쓰는 키가 무료인지 유료인지는 잔액이 아니라 **호출 속도로 가늠**할 수 있다. 40회를
몇 초 만에 다 통과한다면 무료 티어가 아니다.

### 모델을 바꿀 때

그림을 알아보는 쪽은 **비전(이미지 인식)을 지원하는 모델**이어야 한다. 이 점을 놓치면
맞히기만 조용히 실패한다.

통합 포털(games-unified)에 얹을 때는 게이트웨이가 접두사를 떼고 넘겨주므로

