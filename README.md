# Hybrid Financial FDS Platform

이 저장소는 교육·시연용 **Mini Rule-Based Financial FDS**를 On-Prem Kubernetes와 AWS/OpenShift에 같은 API 계약으로 배포하기 위한 단일 저장소입니다. 실제 금융기관의 정책, 망분리, 고가용성 또는 재해복구 아키텍처를 구현하지 않습니다.

> 목표는 거래가 Fastify API → FDS Rule → PostgreSQL → Prometheus 흐름으로 처리되고, 동일한 컨테이너 이미지를 On-Prem Kubernetes와 OpenShift에서 재현 가능하게 실행하는 것입니다.

## 구성

| 디렉터리 | 역할 |
|---|---|
| `app/` | Fastify API, FDS Rule, PostgreSQL Repository, API 테스트 |
| `database/` | PostgreSQL Schema Migration |
| `docker/` | OpenShift 호환 앱 이미지와 HAProxy 설정 예시 |
| `kubernetes/` | On-Prem Kubernetes Namespace, Deployment, Service, ConfigMap/Secret Template |
| `monitoring/` | Prometheus Scrape 및 Alert Rule |
| `ansible/` | Linux Baseline, chrony, Node Exporter, containerd, kubeadm, PostgreSQL 자동화 |
| `terraform/` | AWS VPC·Subnet·Route·Security Group IaC |
| `openshift/` | OpenShift Project, Deployment, Service, Route 배포 파일 |
| `docs/` | 설계·운영·테스트 런북 |

## 결정된 MVP 기준

| 영역 | 기준 |
|---|---|
| Database | PostgreSQL 독립 VM |
| API | Fastify 단일 애플리케이션 |
| Client IP | HAProxy의 `X-Forwarded-For`를 신뢰 프록시 CIDR에서만 처리 |
| FDS Rule | R01 반복 출금, R02 고액, R04 심야 고액, R07 소액 분산 이체 |
| Monitoring | Kubernetes 외부 Prometheus VM |
| On-Prem Service | HAProxy → Kubernetes NodePort → Fastify |

## 빠른 로컬 검증

Docker와 Docker Compose Plugin이 설치된 환경에서 다음 명령을 실행합니다.

```bash
cp app/.env.example app/.env  # 값은 docker-compose 환경변수를 사용하므로 선택 사항

docker compose up --build
```

별도 터미널에서 다음을 확인합니다.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/metrics

curl -X POST http://localhost:3000/api/v1/transactions \
  -H 'content-type: application/json' \
  --data '{
    "account_id":"ACC001",
    "amount":1500000,
    "transaction_type":"WITHDRAWAL",
    "event_time":"2026-09-01T01:30:00+09:00"
  }'
```

Prometheus는 `http://localhost:9090`에서 확인합니다. 개발 검증 종료 후에는 다음으로 볼륨까지 제거합니다.

```bash
docker compose down -v
```

## GitHub Actions CI

`.github/workflows/ci.yml`은 `main` 또는 `develop` 브랜치를 대상으로 하는 Push와 Pull Request에서 자동 실행됩니다. CI는 Fastify 테스트를 통과시키고 OpenShift 호환 컨테이너 이미지를 **빌드만 검증**합니다. AWS·Kubernetes·OpenShift에 자동 배포하지 않으므로, 초기에는 클러스터 Credential을 GitHub Secret에 등록할 필요가 없습니다.

| 단계 | CI 작업 | 실패 시 의미 |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | 의존성 또는 Lockfile 불일치 |
| 2 | `pnpm test` | API·FDS Rule 회귀 오류 |
| 3 | `docker build` | Dockerfile·이미지 빌드 오류 |

저장소를 GitHub에 올린 뒤 `Settings → Branches`에서 `main`과 `develop`의 Branch Protection Rule을 설정하고, **FDS API CI 통과를 PR 병합 필수 조건**으로 지정합니다. 직접 Push보다 `feature/* → Pull Request → develop` 흐름을 사용합니다.

컨테이너 Registry Push와 OpenShift 자동 배포는 `.github/workflows/openshift-deploy.yml`로 구성했습니다. 이 워크플로는 `main` Push 시 테스트 → Quay Image Push → OpenShift Rollout을 수행하며, 실제 실행 전 GitHub Secrets와 `openshift-production` Environment 승인 정책을 등록해야 합니다. 필요한 Secret 목록, 로컬 Docker 실행 및 FDS 테스트 절차는 [`docs/CI_CD_AND_LOCAL_DOCKER_GUIDE.md`](docs/CI_CD_AND_LOCAL_DOCKER_GUIDE.md)를 확인합니다.

## API 테스트

```bash
cd app
corepack enable
pnpm install
pnpm test
```

프로토타입 테스트는 메모리 저장소를 사용하며, PostgreSQL을 실제 연결하지 않아도 API·Schema·Rule 동작을 빠르게 검증합니다. DB VM이 준비되면 `DATABASE_URL`을 설정하고 아래 Migration을 수행합니다.

```bash
cd app
DATABASE_URL='postgresql://fds_app:REPLACE_ME@10.1.93.53:5432/fdsdb' pnpm migrate
```

## On-Prem 배포 순서

1. `ansible/inventory/hosts.ini`의 IP·SSH 사용자 값을 실제 환경으로 수정합니다.
2. `ansible/group_vars/all.yml`의 비밀값을 **Ansible Vault 또는 CI Secret**으로 교체합니다.
3. Control Node에서 `ansible-playbook -i inventory/hosts.ini playbooks/site.yml`을 실행합니다.
4. `database/migrations/001_create_transactions.sql`을 DB VM에 적용합니다.
5. `kubernetes/base/secret.example.yaml`을 복사해 실제 Secret을 로컬에서 만들고, 저장소에는 커밋하지 않습니다.
6. 이미지 경로를 `kubernetes/base/deployment.yaml`에 반영하고 다음을 실행합니다.

```bash
kubectl apply -f kubernetes/base/namespace.yaml
kubectl apply -f kubernetes/base/configmap.yaml
kubectl apply -f <actual-secret-file>.yaml
kubectl apply -f kubernetes/base/deployment.yaml
kubectl apply -f kubernetes/base/service.yaml
```

HAProxy VM에서는 `docker/haproxy.cfg`의 Worker IP를 실제 값으로 바꾼 뒤, HAProxy가 앱 NodePort `30080`으로 트래픽을 전달하게 합니다. Kubernetes의 `TRUSTED_PROXY_CIDRS`에는 HAProxy VM의 IP/CIDR만 허용합니다.

## AWS Terraform과 OpenShift 배포 순서

AWS/ROSA 권한과 Hybrid 연결 방식은 강사·팀의 확정이 선행되어야 합니다. Terraform은 안전하게 **VPC, Subnet, Route Table, Security Group**까지만 자동화합니다. 실제 VPN/Transit Gateway/ROSA Cluster 생성은 승인된 방식이 결정된 후 변수와 모듈을 추가합니다.

```bash
cd terraform/aws-vpc
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform validate
terraform plan
# 팀 검토 및 AWS 비용 확인 후에만:
terraform apply
```

OpenShift 접근이 준비되면 실 Secret을 생성한 뒤 다음을 실행합니다.

```bash
oc apply -f openshift/project.yaml
oc apply -f openshift/config.yaml       # Secret의 CHANGE_ME는 먼저 교체
oc apply -f openshift/deployment.yaml
oc apply -f openshift/service-route.yaml
oc get route -n fds
```

## 보안 및 운영 주의사항

비밀번호, AWS Access Key, ROSA Token, PostgreSQL URL의 실제 비밀값은 Git에 커밋하지 않습니다. `CHANGE_ME`와 `REPLACE_ME`가 남은 파일은 **예시 템플릿**이며 실제 운영 환경에 바로 적용하면 안 됩니다. VPC CIDR, On-Prem CIDR, HAProxy IP, Registry Image 경로, OpenShift Route와 TLS 옵션은 현장 네트워크 및 강사 요구사항이 확정된 뒤 바꿔야 합니다.

## 다음 팀 작업

| 담당 | 바로 수행할 일 |
|---|---|
| 이재환 | Fastify 코드 검토, API/FDS 테스트 데이터 확정, DB 연결 정보 요청 |
| 조민서 | VM·Switch·IP 계획 확정, HAProxy VM과 DB VM 방화벽 규칙 반영 |
| 이권욱 | Ansible Control Node에서 Playbook 검증, chrony/Node Exporter 증빙 확보 |
| 이하영 | Registry Push, Kubernetes/OpenShift 배포, AWS/ROSA 권한·Quota 확인 |
