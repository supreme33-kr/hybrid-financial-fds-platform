# Fastify Mini FDS Prototype

이 프로토타입은 D11 거래 Schema를 기준으로 `POST /api/v1/transactions`를 구현한 최소 실행 코드입니다. 현재는 테스트용 메모리 저장소를 사용하며, Phase 1에서는 같은 Repository 인터페이스를 PostgreSQL 구현체로 교체하면 됩니다.

## 현재 포함 기능

| 기능 | 상태 |
|---|---|
| 거래 요청 검증 | 구현 |
| `source_ip` Body 입력 차단 | 구현 |
| 신뢰 프록시 경유 `X-Forwarded-For` 처리 | 구현 |
| R01/R02/R04/R07 FDS 판정 | 구현 |
| 거래 저장·조회 | 메모리 저장소로 구현 |
| Prometheus `/metrics` | 구현 |
| `/health` | 구현 |
| PostgreSQL Repository | 다음 단계 |

## 실행

```bash
pnpm install
PORT=3000 TRUSTED_PROXY_CIDRS=10.1.93.55/32 pnpm start
```

`TRUSTED_PROXY_CIDRS`에는 HAProxy VM처럼 실제로 신뢰할 프록시의 IP/CIDR만 넣습니다. 개발 중 프록시를 사용하지 않는다면 이 환경변수를 생략할 수 있으며, 이 경우 응답의 `source_ip`는 `null`입니다. 운영 환경에서는 `trustProxy=true`처럼 모든 프록시를 신뢰하면 안 됩니다.

## 테스트

```bash
pnpm test
```

현재 테스트는 다음 세 가지를 확인합니다.

1. 고액·심야 거래가 R02와 R04로 탐지되고 거래가 조회되는지 확인합니다.
2. 클라이언트가 `source_ip`를 요청 본문에 넣으면 400 오류가 나는지 확인합니다.
3. 동일 계좌에서 60초 안에 출금 3회가 발생하면 R01이 탐지되는지 확인합니다.

## API 호출 예시

```bash
curl -i -X POST http://localhost:3000/api/v1/transactions \
  -H 'content-type: application/json' \
  -H 'x-forwarded-for: 203.0.113.25' \
  --data '{
    "account_id": "ACC001",
    "amount": 1500000,
    "transaction_type": "WITHDRAWAL",
    "event_time": "2026-09-01T01:30:00+09:00"
  }'
```

## Phase 1 전환 작업

메모리 저장소를 그대로 쓰면 Pod 재시작 시 거래 이력이 사라집니다. DB VM이 준비되면 다음 순서로 PostgreSQL을 연동합니다.

1. `DATABASE_URL`을 Kubernetes Secret으로 주입합니다.
2. `src/repositories/postgres-transaction-repository.js`를 추가합니다.
3. `create`, `findById`, `findByAccountId` 인터페이스를 PostgreSQL 쿼리로 구현합니다.
4. `src/app.js`에서 메모리 구현체 대신 PostgreSQL 구현체를 주입합니다.
5. DB 연결 실패가 `503 DATABASE_UNAVAILABLE`로 반환되는지 통합 테스트합니다.

상세 계약과 팀 회의용 확정 메시지는 `docs/D11_API_명세_및_확정_메시지.md`를 확인합니다.
