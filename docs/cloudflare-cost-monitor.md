# Cloudflare 사용량·예상 요금

## 표시 범위

`/cloudflare.html`과 기존 ADMIN 전용 `/api/admin/v1/cloudflare/usage`를 확장한다. 새 공개 API, 인증 변경, 배포 설정 변경은 없다. 운영 홈에는 R2 Class A/B, Workers CPU, D1 쓰기를 요약한다.

연결된 **계정 전체**를 집계한다. 운영, 미리보기, 주차장 등 다른 앱도 동일한 포함량을 공유하므로 서비스별 무료 포함량을 중복 적용하지 않는다. Worker 이름, DB ID, 버킷별 관측값으로 원인을 추적한다. 실제 사용이 있는 항목과 미확인 항목을 기본 표시하고, 확인된 0은 선택해서 표시한다.

자동 집계 항목:

- R2 Standard Class A/B: 작업별 분류, 포함량, 비율, 현재 초과액과 주기 종료 시 추정액. IA 요청이 관측되면 IA 단가를 별도로 적용한다.
- Workers: 요청 수, CPU 합계. GraphQL CPU 마이크로초를 과금 기준 밀리초로 변환한다.
- D1: 읽은 행, 쓴 행. SQL 실행 횟수로 대체하지 않는다.
- R2/D1 현재 저장량: 저장소별 마지막 관측값. GB-month 청구액으로 오인하지 않도록 요금 계산에서 제외한다.
- Durable Objects: 요청·실행 GB-s. WebSocket 메시지가 있으면 요청 과금 환산을 확정하지 않고 요청 비용 계산을 보류한다.

Workers Logs와 DO 저장·행 사용량은 추가 연동이 필요하다고 명시한다. 현재 용량만으로 과거 저장 기간과 월 저장 비용을 추정하지 않는다. 미분류 R2 작업도 별도 표시하며 소계에 포함하지 않는다. 따라서 화면의 금액은 **집계 가능한 초과액 소계**이며 전체 청구액이 아니다. Workers Paid 기본요금 $5도 별도로 표시한다.

## 집계·계산

- 기존 설정 `CLOUDFLARE_BILLING_CYCLE_DAY`(현재 29)를 UTC 경계로 사용한다. 화면에는 KST로 표시한다. 제품별 청구 갱신일이 다르거나 계정 요금제가 달라지면 이 공통 주기를 그대로 사용하지 말고 분리해야 한다.
- 5분 서버 캐시. 병렬 조회는 최대 7개이며 각 요청에는 연결/읽기 제한 시간이 있다. UI 새로고침은 캐시를 우회하지 않는다.
- 15분 전까지 Analytics를 요청한다. 이것은 반영 지연의 여유이며 완전한 청구 데이터 보장은 아니다. Analytics의 표본 추정·지연·정정 가능성을 표시한다.
- 각 데이터셋의 권한, 조회 허용 기간, 보관 기간, 응답 행 제한을 검사한다. 범위가 불완전하거나 한도에 도달하면 산출을 보류한다. 제품 하나의 실패가 다른 제품의 성공값을 없애지 않는다.
- 실패 시 동일 청구 주기 내 해당 항목의 마지막 성공값만 `STALE`로 표시하고 금액 계산에서는 제외한다. 새 주기에 지난 주기 값을 이월하지 않는다.
- 종료 예상량 = 현재 누계 × 전체 주기 초 / 관측 주기 초. 최소 하루 관측 전에는 예상을 보류한다. 초기 캐시 채우기, 봇 급증, 계절성은 반영하지 못하는 단순 추세 시나리오다.
- R2/DO는 무료 포함량을 한 번 차감한 **초과분**을 공개 청구 단위로 올림한다. 예: Standard Class A 1,000,001회 → 예상 초과액 $4.50. Workers/D1 행 사용은 공개 비례 단가를 적용한다.
- 공개 단가 확인일 2026-09-30. 크레딧, 별도 계약·할인, 환율, 세금은 추정하지 않는다. 요금제 변경 시 계산기도 검토한다.

## 추가 모니터링 우선순위

| 우선순위 | 항목 | 확인 목적 |
| --- | --- | --- |
| 1 | Class A 시간별 급증 / 원본·언어본문·배포캐시·지도별 PUT | 대량 저장의 원인을 구분. Analytics 합계만으로 최초 생성과 덮어쓰기 비율을 단정하지 않음 |
| 1 | 포함량 80%·100%, 종료 전 소진 예상, 월 예산 | 비용 발생 전에 알림. 이번 변경은 화면 경고이며 외부 알림 발송은 추가 연동 |
| 1 | 정기 갱신 누락 / 변경 알림 대기열 / 실패 재시도 | 정상 저장과 오류로 인한 반복을 구분 |
| 2 | R2 GET 200/404, 원본 조회 비율, CDN 캐시 적중률 | 데이터 캐시와 CDN 캐시를 구분해 효율 판단 |
| 2 | 봇별 요청, 경로, 국가, WAF 차단 | 급증 트래픽의 출처 파악. 개인정보·토큰을 로그에 추가하지 않음 |
| 2 | Workers 오류·CPU 초과 / 지연 p95 | 비용 증가와 장애 원인을 동시에 추적 |
| 2 | D1 쿼리 스캔 행 / 느린 쿼리 / 저장 증가 | 인덱스 누락과 과도한 읽기·쓰기 탐지 |
| 2 | 원본 5xx / Tunnel 연결 / DO 장애 | 사용자 응답 장애 조기 발견 |
| 3 | 로그 수집 비용 / DO 저장 과금 / GB-month 이력 | 아직 소계에 포함하지 못한 비용 보완 |

## 검증과 로컬 검토

`./gradlew test --tests 'com.example.toiletadmin.cloudflare.*'`는 포함량 경계, R2 올림, CPU 단위, 예측 최소 기간, 부분 실패, 누락 숫자, 오래된 값, 주기 전환, GraphQL 범위 제한을 검증한다. `node scripts/verify-admin-home.cjs`는 기존 운영 홈 계약을 검증한다.

선택적인 test-only `CloudflareMonitorProbe`는 기존 자격 증명을 프로세스 환경에서 받아 공식 API를 읽고 사용량 JSON만 저장한다. 운영 JAR에 포함되지 않는다. `cloudflarePreviewClasspath` 작업으로 클래스패스를 생성한다. 키를 명령행 인수·파일·출력·브라우저로 전달하지 않는다.

`node preview/cloudflare-cost-preview.mjs <credential-free-snapshot.json>`은 127.0.0.1:8197에서만 화면을 검토한다. 스냅샷, 로그, 인증값은 저장소에 커밋하지 않는다. 검토 서버는 운영 인증 경로를 변경하지 않는다.

공식 출처:

- [R2 요금](https://developers.cloudflare.com/r2/pricing/)
- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)
- [Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Analytics 표본 추정](https://developers.cloudflare.com/analytics/graphql-api/sampling/)
