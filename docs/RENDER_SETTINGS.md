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

Render는 앱을 로드밸런서 뒤에서 실행하므로 `socket.remoteAddress`가 모든 접속자에게
동일한 프록시 IP로 보인다. `TRUST_PROXY`가 켜져 있어야 `X-Forwarded-For`로 실제
접속자를 구분하며, 그렇지 않으면 서로 무관한 사용자끼리 레이트리밋을 공유한다.
