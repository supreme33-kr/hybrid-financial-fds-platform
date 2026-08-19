# 운영·테스트 런북

## 1. 배포 전 확인

| 확인 항목 | 확인 명령 또는 방법 | 통과 기준 |
|---|---|---|
| 시간 동기화 | `chronyc tracking`, `chronyc sources -v` | NTP Source가 선택되고 offset이 허용 범위에 있다. |
| Ansible 연결 | `ansible all -m ping` | 모든 Managed Node가 SUCCESS를 반환한다. |
| Kubernetes | `kubectl get nodes` | Control Plane과 Worker가 `Ready`다. |
| DB | `pg_isready -h <DB_IP> -U fds_app -d fdsdb` | accepting connections |
| API | `curl http://<NODE_IP>:30080/health` | `{"status":"UP"}` |
| Monitoring | Prometheus Targets 화면 | FDS API와 Node Exporter가 `UP`이다. |

## 2. 정상 거래와 FDS 데모 시나리오

모든 요청은 HAProxy의 `http://<LB_IP>:8080`으로 전송한다. 아래는 예시이며 실제 LB 주소로 교체한다.

```bash
API_URL=http://10.1.93.55:8080

# 정상 거래: 탐지되지 않아야 함
curl -sS -X POST "$API_URL/api/v1/transactions" \
  -H 'content-type: application/json' \
  --data '{"account_id":"ACC100","amount":10000,"transaction_type":"DEPOSIT","event_time":"2026-09-01T14:00:00+09:00"}'

# R02 고액 거래: 탐지되어야 함
curl -sS -X POST "$API_URL/api/v1/transactions" \
  -H 'content-type: application/json' \
  --data '{"account_id":"ACC200","amount":1500000,"transaction_type":"WITHDRAWAL","event_time":"2026-09-01T14:00:00+09:00"}'

# R04 심야 고액 거래: 낮에도 event_time으로 재현 가능
curl -sS -X POST "$API_URL/api/v1/transactions" \
  -H 'content-type: application/json' \
  --data '{"account_id":"ACC300","amount":600000,"transaction_type":"TRANSFER","event_time":"2026-09-01T02:00:00+09:00"}'
```

R01은 동일 계좌로 60초 안에 출금을 세 번, R07은 10분 안에 100,000원 이하 이체를 다섯 번 전송한다. 응답의 `fds_detected`, `fds_rules`와 Prometheus의 `fds_detection_total`을 함께 캡처한다.

## 3. 장애·복구 테스트

| 시나리오 | 실행 | 기대 결과 | 복구 검증 |
|---|---|---|---|
| App Pod 삭제 | `kubectl -n fds delete pod -l app.kubernetes.io/name=fds-api` | Deployment가 Pod를 재생성한다. | 새 Pod `Ready`, `/health` 200 |
| DB 차단 | DB VM 방화벽에서 앱 Node CIDR의 5432을 임시 차단 | `POST /transactions`가 503, `transaction_save_failure_total` 증가 | 방화벽 복구 후 201 응답 |
| 원본 IP 누락 | HAProxy의 `option forwardfor`를 테스트 중 임시 제거 | 응답 `source_ip: null`, `missing_client_ip_total` 증가 | 설정 복구 후 실제 Client IP 기록 |
| Node Exporter 중지 | `systemctl stop node_exporter` | Prometheus Target이 Down | 시작 후 Target UP |
| Ansible 재실행 | `ansible-playbook .../site.yml` | 불필요 변경 없이 성공 | 변경 수 및 로그 증빙 저장 |

## 4. 증빙 파일 규칙

각 Gate의 증빙은 `docs/evidence/<GATE>/<YYYYMMDD>/`에 저장한다. 파일명은 `<영역>_<검증항목>_<PASS또는FAIL>.png|txt` 형식으로 통일한다. 예를 들어 `G5/API_R02_HIGH_AMOUNT_PASS.png`, `G5/PROMETHEUS_FDS_DETECTION_PASS.png`로 저장한다.

## 5. Known Constraints

이 저장소는 실제 금융기관 망연계, Production HA/DR, AI/ML 모델, Kafka, Service Mesh 및 Multi-Region을 구현하지 않는다. Hybrid 연결의 실제 VPN/Transit Gateway/ROSA Cluster 생성은 강사 요구사항, 계정 권한, 비용 한도가 확정된 뒤 별도 승인으로 수행한다.
