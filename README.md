# Doodle Guess

여러 방에서 동시에 즐기는 실시간 벡터 그림 맞히기 게임입니다. 선착순 종료와 타이머까지 계속하는 정답 모드를 대기실에서 선택할 수 있고, 정답자·그림 담당자의 점수는 방이 유지되는 동안 누적됩니다. 서버 메모리의 Room Map만 사용하며 DB, Redis, 계정, 장기 저장은 없습니다. 서버가 재시작되면 기존 방은 사라지고, 단일 서버 replica로 실행합니다.

## 실행

Node.js 22 이상이 필요합니다.

```bash
npm install
npm run dev
```

- 클라이언트: `http://127.0.0.1:5173`
- 서버: `http://127.0.0.1:3001`
- WebSocket: `ws://127.0.0.1:3001/ws`

프로덕션 빌드와 실행:

```bash
npm run build
npm start
```

기본 포트는 `3001`이며 `PORT`, `HOST`, `ALLOWED_ORIGINS` 환경 변수로 서버 실행 환경을 지정할 수 있습니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright는 데스크톱 Chrome, Pixel 7 세로, Pixel 7 가로에서 실제 여러 페이지를 열어 방 생성·입장·그림·정답·만료·잠금·대기실 복귀·진행자 위임·강퇴·재접속·방 격리·퇴장과 PWA 자산을 검증합니다.

배경음은 메인 로비가 아닌 방 대기실부터 방장 기기에서만 재생됩니다. `bgm1.mp3`~`bgm5.mp3`을 같은 곡 연속 재생 없이 무작위로 무한 재생하며, 헤더의 음표 버튼에서 볼륨을 조절할 수 있습니다.

## 구조

- `shared/`: WebSocket 이벤트, 상태, 상수의 공용 계약
- `server/`: Express, `ws`, 방별 FIFO 큐, 게임·그림 서비스
- `client/`: React reducer, WebSocket 재연결, Pointer Events 캔버스, PWA
- `tests/`: Playwright E2E와 부하 테스트 정의
- `docs/IMPLEMENTATION_PROMPT.md`: 구현 기준
- `docs/검증_보고서.md`: 요구사항 추적과 검증 결과
