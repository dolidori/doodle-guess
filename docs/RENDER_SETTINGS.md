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
