# D11 거래 Schema·API 명세 및 확정 메시지

**문서 목적:** 팀 회의에서 D09, D11, D12, D13을 한 번에 확정하고 Fastify 구현의 기준선으로 사용한다.  
**문서 상태:** 제안안 — 회의 승인 후 `v1.0`으로 동결한다.

## 1. 회의에서 확정할 한 문장

> PostgreSQL 독립 VM에 거래를 저장하고, Fastify 단일 애플리케이션이 HAProxy가 전달한 원본 IP와 거래 발생 시각을 기준으로 필수 FDS 4개 Rule을 판정하며, Kubernetes 외부 Prometheus VM이 애플리케이션 지표를 수집한다.

| 결정 ID | 권장 확정안 | 이유 | 담당 |
|---|---|---|---|
| D09 | **PostgreSQL, 독립 DB VM** | Kubernetes PVC/StatefulSet 복잡도를 피하면서 거래 저장을 명확히 검증할 수 있다. | 이재환 |
| D11 | 클라이언트 입력과 서버 생성 데이터를 분리한 아래 거래 Schema | `source_ip` 위조를 막고 시간 기반 FDS 테스트를 재현할 수 있다. | 이재환 |
| D12 | R01/R02/R04/R07의 고정 Threshold 사용 | 코드·테스트·발표에서 같은 결과를 재현할 수 있다. | 이재환 |
| D13 | Kubernetes 외부의 독립 Prometheus VM | Kubernetes 장애가 발생해도 애플리케이션·노드 관측을 유지한다. | 이재환 + 이권욱 |

## 2. D11 Transaction Schema

### 2.1 기본 원칙

거래 요청 본문에는 **클라이언트가 실제로 입력한 업무 데이터만** 넣는다. `transaction_id`, `received_at`, FDS 결과는 서버가 생성한다. `source_ip`는 요청 본문으로 받지 않으며, HAProxy가 전달한 `X-Forwarded-For`를 **신뢰 프록시에서만** 처리해 서버가 수집한다.

`event_time`은 거래 시뮬레이터가 보내는 **거래 발생 시각**이며, `received_at`은 Fastify가 요청을 수신한 **서버 시각**이다. 두 필드는 모두 UTC offset이 포함된 ISO 8601/RFC 3339 문자열로 저장한다. 금액은 부동소수점 오차를 피하기 위해 **KRW 정수**로 처리한다.

### 2.2 `POST /api/v1/transactions` 요청

```json
{
  "account_id": "ACC001",
  "amount": 1500000,
  "transaction_type": "WITHDRAWAL",
  "event_time": "2026-09-01T01:30:00+09:00"
}
```

| 필드 | 형식 | 필수 | 규칙 | 설명 |
|---|---|---:|---|---|
| `account_id` | string | 예 | 3~30자, 영문 대문자·숫자·`_`·`-` | 거래 계좌 식별자 |
| `amount` | integer | 예 | 1 이상, 1,000,000,000 이하 | KRW 단위 거래 금액 |
| `transaction_type` | enum | 예 | `DEPOSIT`, `WITHDRAWAL`, `TRANSFER` | 거래 유형 |
| `event_time` | string | 예 | offset 포함 ISO 8601/RFC 3339, 유효한 날짜 | 시뮬레이터가 정의한 거래 발생 시각 |

다음 필드는 클라이언트가 보내면 안 된다. `transaction_id`, `source_ip`, `received_at`, `fds_detected`, `fds_rules`.

### 2.3 `201 Created` 응답

```json
{
  "transaction_id": "79a98601-9ad9-4e54-86e6-c63cd71bf4a1",
  "account_id": "ACC001",
  "amount": 1500000,
  "transaction_type": "WITHDRAWAL",
  "event_time": "2026-09-01T01:30:00+09:00",
  "received_at": "2026-09-01T01:31:04.602Z",
  "source_ip": "10.1.93.58",
  "fds_detected": true,
  "fds_rules": [
    {
      "rule_id": "R02",
      "rule_name": "HIGH_AMOUNT",
      "reason": "amount >= 1000000 KRW"
    },
    {
      "rule_id": "R04",
      "rule_name": "LATE_NIGHT_HIGH_AMOUNT",
      "reason": "00:00-05:00 KST and amount >= 500000 KRW"
    }
  ]
}
```

| 응답 필드 | 생성 주체 | 설명 |
|---|---|---|
| `transaction_id` | Server | UUID v4 거래 ID |
| `received_at` | Server | API가 받은 실제 서버 시각 |
| `source_ip` | Server | 신뢰된 HAProxy 경유 시 `X-Forwarded-For`에서 해석한 원본 IP. 없으면 `null` |
| `fds_detected` | Server | 하나 이상의 Rule이 탐지됐는지 여부 |
| `fds_rules` | Server | 탐지된 Rule 목록. 탐지가 없으면 빈 배열 |

### 2.4 오류 응답

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "event_time must be a valid ISO 8601 timestamp with timezone offset",
    "request_id": "aaf0fc99-2bcf-49ff-851d-07a7a8247b7a"
  }
}
```

| 상태 | 코드 | 발생 조건 | 클라이언트 처리 |
|---:|---|---|---|
| 400 | `VALIDATION_ERROR` | 필수 필드 누락, enum/금액 형식 오류, 잘못된 시각 | 요청 수정 후 재시도 |
| 404 | `TRANSACTION_NOT_FOUND` | 존재하지 않는 거래 ID 조회 | ID 확인 |
| 503 | `DATABASE_UNAVAILABLE` | DB 연결 또는 저장 실패 | 재시도, 운영자 확인 |
| 500 | `INTERNAL_ERROR` | 예기치 못한 서버 오류 | `request_id`로 로그 확인 |

### 2.5 API 목록

| Method | Endpoint | 목적 | 1차 구현 우선순위 |
|---|---|---|---|
| GET | `/health` | 앱/DB 상태 확인 | P0 |
| POST | `/api/v1/transactions` | 거래 생성·FDS 판정·저장 | **P0 — 첫 구현 라우터** |
| GET | `/api/v1/transactions/:transactionId` | 거래·FDS 결과 조회 | P1 |
| POST | `/api/v1/fds/check` | 저장 없이 FDS 판정만 시험 | P1 |
| GET | `/metrics` | Prometheus 지표 노출 | P0 |

## 3. D12 — Minimum FDS Rule Specification

아래 수치는 실제 금융기관 정책이 아니라, 일정 내 반복 검증을 위한 **교육용 Synthetic Rule**이다. 규칙 값은 코드·테스트·발표 스크립트에 모두 같은 값으로 사용한다.

| ID | Rule 이름 | 탐지 조건 | 데이터 기준 |
|---|---|---|---|
| R01 | `REPEAT_WITHDRAWAL` | 동일 계좌의 `WITHDRAWAL`이 **60초 내 3회 이상** | `event_time` 기준, 현재 거래 포함 |
| R02 | `HIGH_AMOUNT` | 거래 금액이 **1,000,000 KRW 이상** | 현재 거래 1건 |
| R04 | `LATE_NIGHT_HIGH_AMOUNT` | KST **00:00~05:00** 사이이며 금액이 **500,000 KRW 이상** | `event_time` 기준 |
| R07 | `SMALL_TRANSFER_SPLIT` | 동일 계좌의 `TRANSFER`가 **10분 내 5회 이상**이고 각 금액이 **100,000 KRW 이하** | `event_time` 기준, 현재 거래 포함 |

선택 Rule인 R03(평균 대비), R05(IP 변경), R06(반복 입금 후 미출금)은 이번 동결 범위에 포함하지 않는다.

## 4. DB 연결·테이블 계약(D09)

Phase 1에서는 PostgreSQL을 독립 VM에 둔다. Kubernetes에는 Fastify/FDS 애플리케이션만 배포한다. DB 생성, OS 설정, 방화벽은 인프라 담당과 협업하며 애플리케이션은 환경변수로만 연결 정보를 받는다.

```sql
CREATE TABLE transactions (
  transaction_id UUID PRIMARY KEY,
  account_id VARCHAR(30) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  transaction_type VARCHAR(12) NOT NULL CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')),
  event_time TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  source_ip INET NULL,
  fds_detected BOOLEAN NOT NULL DEFAULT FALSE,
  fds_rules JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX idx_transactions_account_event_time
  ON transactions (account_id, event_time DESC);
```

| 환경변수 | 예시 | 설명 |
|---|---|---|
| `DATABASE_URL` | `postgresql://fds_app:***@10.1.93.53:5432/fdsdb` | 비밀값은 Secret으로 주입하고 저장소에 커밋하지 않는다. |
| `TRUSTED_PROXY_CIDRS` | `10.1.93.55/32` | HAProxy 등 신뢰 프록시 IP/CIDR만 허용한다. |
| `PORT` | `3000` | Fastify Listen Port |

## 5. D13 — Minimum Metric Specification

| Metric | Type | 증가/관측 시점 |
|---|---|---|
| `transaction_save_success_total` | Counter | 거래 저장 성공 |
| `transaction_save_failure_total` | Counter | DB 저장 실패 |
| `fds_detection_total{rule_id}` | Counter | 해당 Rule 탐지 |
| `missing_client_ip_total` | Counter | 신뢰 프록시 경로에서 원본 IP를 얻지 못함 |
| `transaction_processing_duration_seconds` | Histogram | 거래 API 처리 시간 |

## 6. 팀 회의용 메신저 템플릿

### 6.1 최초 제안 메시지

```text
[결정 요청 | D09 · D11 · D12 · D13]

앱 구현과 테스트 기준을 오늘 동결하려고 합니다. 아래를 Phase 1 Baseline으로 제안합니다.

1) D09 DB: PostgreSQL을 Kubernetes 밖 독립 DB VM에 둡니다. Fastify/FDS만 Kubernetes에 배포합니다.
2) D11 거래 API: 클라이언트는 account_id, amount, transaction_type, event_time만 전송합니다. transaction_id, received_at, FDS 결과는 서버가 생성하고 source_ip는 HAProxy의 X-Forwarded-For에서 수집합니다.
3) D12 FDS Minimum Rule: R01(60초/출금 3회), R02(100만원 이상), R04(00~05시·50만원 이상), R07(10분/10만원 이하 이체 5회)로 고정합니다. 나머지 Rule은 Stretch Scope입니다.
4) D13 Monitoring: Prometheus는 Kubernetes 외부 독립 VM에 두고 Node Exporter, Fastify /metrics, 필요한 Kubernetes 지표를 수집합니다.

반대나 필수 변경이 있으면 [결정 시각]까지 알려 주세요. 없으면 이 기준으로 API 명세·테스트 케이스·Fastify 프로토타입을 작성하겠습니다.
```

### 6.2 회의에서 항목별로 확정할 때

```text
[D09 확정 요청]
DB는 PostgreSQL 독립 VM으로 확정해도 될까요? Kubernetes DB/PVC는 이번 Phase 1 범위에서 제외합니다. 확정되면 DB명·포트·방화벽·계정 전달 방식을 인프라 담당과 맞추겠습니다.

[D11 확정 요청]
거래 요청 Body는 account_id, amount, transaction_type, event_time만 받는 것으로 확정해도 될까요? source_ip는 Body에서 받지 않고 HAProxy→X-Forwarded-For 경로에서 서버가 수집합니다.

[D12 확정 요청]
Minimum FDS Rule은 R01/R02/R04/R07만 구현하고, 문서에 적힌 Threshold를 테스트·발표 기준으로 고정해도 될까요? R03/R05/R06은 시간 여유가 있을 때만 진행합니다.

[D13 확정 요청]
Prometheus는 Kubernetes 외부 Monitoring VM에 배치하고, Node Exporter와 Fastify /metrics를 필수 수집 대상으로 확정해도 될까요? kube-state-metrics와 Grafana는 Optional로 두겠습니다.
```

### 6.3 회의 종료 후 기록 메시지

```text
[결정 기록 | M0 Baseline]
회의 결과를 아래와 같이 기록합니다.

- D09: PostgreSQL / 독립 DB VM / 담당: 이재환 + 인프라 담당
- D11: 단일 Fastify App, 정의된 거래 Schema 사용, source_ip는 HAProxy X-Forwarded-For 경유 수집 / 담당: 이재환
- D12: R01·R02·R04·R07 Minimum 구현, 나머지 Stretch Scope / 담당: 이재환
- D13: Kubernetes 외부 Prometheus VM, Node Exporter + Fastify /metrics 필수 / 담당: 이재환 + 이권욱

변경이 필요한 경우 Decision Register에 사유·영향·승인자를 기록한 뒤 반영합니다. 이 기준으로 API 명세와 코드 작업을 시작합니다.
```

## 7. 협업 요청 문구

| 대상 | 이재환 님이 전달할 요청 |
|---|---|
| 조민서 님 | `HAProxy → NodePort` 구조에서 X-Forwarded-For를 설정하고 NodePort는 HAProxy에서만 접근 가능하게 해 주세요. App Port, Health Path, 필요한 DB Port는 명세에 맞춰 공유하겠습니다. |
| 이권욱 님 | PostgreSQL VM과 Prometheus VM에 필요한 주소·포트·환경변수 전달 방식을 정하고, Node Exporter와 `node_timex_offset_seconds` 확인 절차를 공유해 주세요. |
| 이하영 님 | Fastify 이미지에 환경변수 `DATABASE_URL`, `TRUSTED_PROXY_CIDRS`, `PORT`를 Secret/ConfigMap으로 주입해 주세요. Probe는 `GET /health`, Metrics는 `GET /metrics`를 사용합니다. |
