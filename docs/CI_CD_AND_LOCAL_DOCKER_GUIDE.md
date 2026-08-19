# GitHub Actions 배포 및 로컬 Docker 실행 가이드

## 1. GitHub Actions 워크플로 역할

| 파일 | 실행 시점 | 하는 일 |
|---|---|---|
| `.github/workflows/ci.yml` | `main`·`develop` Push 또는 PR | Fastify 테스트와 Docker Image Build 검증 |
| `.github/workflows/openshift-deploy.yml` | `main` Push 또는 수동 실행 | 테스트 → Quay Image Push → OpenShift 배포 → Rollout 확인 |

OpenShift 배포 워크플로는 `openshift-production` GitHub Environment를 사용한다. GitHub 저장소의 **Settings → Environments**에서 해당 Environment를 만들고, 필요하면 팀 리더 승인(Required reviewers)을 걸어 `main` Push 직후 무조건 배포되지 않게 보호한다.

## 2. GitHub Secrets

`Settings → Secrets and variables → Actions`에서 아래 Repository 또는 Environment Secret을 등록한다. 실제 값은 단톡방, Notion, 소스코드에 남기지 않는다.

| Secret 이름 | 예시 형식 | 용도 |
|---|---|---|
| `QUAY_REGISTRY` | `quay.io` | Image Registry Host |
| `QUAY_NAMESPACE` | `team-fds` | Quay Organization 또는 사용자 Namespace |
| `QUAY_USERNAME` | `team-fds-ci` | Image Push 전용 Quay 계정 또는 Robot Account |
| `QUAY_PASSWORD` | `***` | Quay Password 또는 Robot Token |
| `OPENSHIFT_SERVER` | `https://api.cluster.example.com:6443` | OpenShift API Server URL |
| `OPENSHIFT_TOKEN` | `sha256~...` | 배포 권한만 가진 OpenShift Service Account Token |
| `DATABASE_URL` | `postgresql://fds_app:***@db.example:5432/fdsdb` | OpenShift 앱이 사용할 DB 연결 문자열 |

배포 Workflow는 매 실행 시 `fds-api-secret`을 `DATABASE_URL`로 생성 또는 갱신한다. 토큰 권한은 최소 권한 원칙으로 `fds` Namespace의 Deployment, Service, Route, Secret, ConfigMap을 다룰 수 있는 범위로 제한한다.

> `OPENSHIFT_TOKEN`에는 개인 관리자 계정 토큰 대신, 별도로 만든 배포용 Service Account 토큰을 사용한다. 실제 클러스터의 인증·권한 방식은 관리자 또는 강사의 가이드를 먼저 따른다.

## 3. 로컬 Docker 실행

### 사전 조건

Docker Desktop 또는 Docker Engine과 Docker Compose Plugin이 설치되어 있어야 한다.

```bash
docker --version
docker compose version
```

프로젝트 루트에서 실행한다.

```bash
git clone <TEAM_REPOSITORY_URL>
cd hybrid-financial-fds-platform

docker compose up --build -d
docker compose ps
```

정상이라면 `postgres`, `fds-api`, `prometheus` 컨테이너가 모두 실행 상태여야 한다. API 로그는 아래 명령으로 확인한다.

```bash
docker compose logs -f fds-api
```

## 4. 로컬 API 테스트

### 4.1 Health Check

```bash
curl -i http://localhost:3000/health
```

기대 결과는 HTTP 200과 `{"status":"UP"}`이다.

### 4.2 정상 거래

```bash
curl -sS -X POST http://localhost:3000/api/v1/transactions \
  -H 'content-type: application/json' \
  --data '{
    "account_id":"ACC100",
    "amount":10000,
    "transaction_type":"DEPOSIT",
    "event_time":"2026-09-01T14:00:00+09:00"
  }'
```

기대 결과는 `fds_detected: false`다.

### 4.3 R02 고액 거래와 R04 심야 고액 거래

```bash
curl -sS -X POST http://localhost:3000/api/v1/transactions \
  -H 'content-type: application/json' \
  --data '{
    "account_id":"ACC200",
    "amount":1500000,
    "transaction_type":"WITHDRAWAL",
    "event_time":"2026-09-01T01:30:00+09:00"
  }'
```

응답 `fds_rules`에 `R02`와 `R04`가 모두 포함되어야 한다.

### 4.4 R01 반복 출금

아래 요청을 60초 안에 세 번 실행한다.

```bash
curl -sS -X POST http://localhost:3000/api/v1/transactions \
  -H 'content-type: application/json' \
  --data '{
    "account_id":"ACC300",
    "amount":10000,
    "transaction_type":"WITHDRAWAL",
    "event_time":"2026-09-01T12:00:00+09:00"
  }'
```

각 실행에서는 `event_time`을 20초, 50초 차이로 바꾼다. 세 번째 응답에 `R01`이 포함되어야 한다.

### 4.5 Prometheus 확인

```bash
curl -s http://localhost:3000/metrics | grep -E 'transaction_save|fds_detection|missing_client_ip'
```

브라우저에서는 `http://localhost:9090`으로 접속해 아래 PromQL을 실행한다.

```promql
fds_detection_total
```

## 5. 종료 및 초기화

컨테이너만 중지하려면 다음을 실행한다.

```bash
docker compose down
```

개발 DB 데이터까지 모두 초기화하려면 다음을 실행한다. 이 명령은 로컬 PostgreSQL 데이터를 삭제한다.

```bash
docker compose down -v
```

## 6. 실패 시 빠른 확인 순서

| 증상 | 확인 명령 | 우선 조치 |
|---|---|---|
| API가 시작되지 않음 | `docker compose logs fds-api` | `DATABASE_URL`, PostgreSQL Health Check 확인 |
| API가 503 반환 | `docker compose logs postgres` | PostgreSQL 컨테이너 상태와 초기 Migration 확인 |
| Prometheus Target Down | `docker compose ps`, Prometheus Targets 화면 | API가 3000 포트에서 실행 중인지 확인 |
| GitHub 배포 실패 | Actions 로그의 Quay Login/`oc login` 단계 | GitHub Secret 이름·권한·OpenShift API URL 확인 |
| OpenShift Rollout Timeout | `oc get pods -n fds`, `oc logs deployment/fds-api -n fds` | Image Pull, DB Secret, Route/Network 접근 확인 |
