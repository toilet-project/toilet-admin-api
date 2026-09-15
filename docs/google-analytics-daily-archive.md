# Google Analytics 일별 영구 보관

관리자 화면의 기존 `admin_analytics_snapshot`은 짧은 캐시 수명으로 현재 보고서를 표시한다. 일별 영구 보관은 이 캐시와 분리되어 화면 요청이나 공개 서비스의 가용성에 영향을 주지 않는다.

## 저장 범위

- GA4 속성 보고 시간대: `Asia/Seoul`
- 자동 실행: 매일 16:30 KST
- 실패 재시도: 같은 날 19:30 KST
- 조회 범위: 오늘을 제외한 최근 완료일 14개
- 저장 단위: 날짜별 요약과 페이지·채널·유입 소스·기기·OS·브라우저·국가·도시·이벤트 집계
- 제외 항목: 실시간 값, 방문자·세션·개별 이벤트 원문, 검색어·회원 식별자·상세 위치

16:30 실행이 성공하면 19:30 실행은 건너뛴다. 최근 14일은 `PROVISIONAL`로 매일 UPSERT하고 범위를 벗어난 이전 날짜는 `FINAL`로 전환한다. Data API 응답이 행 제한을 넘으면 부분 결과를 저장하지 않고 실행을 실패 처리한다.

## 테이블

- `admin_analytics_daily_summary`: 속성·날짜별 주요 지표 한 행
- `admin_analytics_daily_breakdown`: 속성·날짜·세부 차원별 집계 행
- `admin_analytics_collection_run`: 실행 범위, 상태, 재시도, 저장 행 수, 할당량과 정제된 오류

DB 마이그레이션이 먼저 배포되지 않았거나 GA4 연결이 꺼져 있으면 영구 보관만 건너뛴다. 기존 Google Analytics API와 관리자 화면은 계속 단기 캐시를 사용한다.

## 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_ANALYTICS_ARCHIVE_ENABLED` | `true` | GA4 연결이 활성화된 경우 영구 보관 실행 여부 |
| `GOOGLE_ANALYTICS_ARCHIVE_LOOKBACK_DAYS` | `14` | 매일 다시 조회할 완료일 수, 1~31 |
| `GOOGLE_ANALYTICS_ARCHIVE_CRON` | `0 30 16,19 * * *` | 기본 실행과 실패 재시도 시각 |
| `GOOGLE_ANALYTICS_ARCHIVE_ZONE` | `Asia/Seoul` | 보고 날짜와 스케줄 시간대 |

배포 순서는 API의 Flyway 마이그레이션, 관리자 애플리케이션 순서다.
