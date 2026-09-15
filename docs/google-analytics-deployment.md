# Google Analytics 관리자 연동 배포

관리자 애플리케이션은 GA4 방문자 원본을 저장하지 않고 Google Analytics Data API의 집계 결과만 읽는다. `admin_analytics_snapshot`에는 홈과 상세 화면에 필요한 고정 크기 JSON 스냅샷만 보관한다.

## 필요한 GitHub Secrets

| 이름 | 값 |
| --- | --- |
| `GOOGLE_ANALYTICS_PROPERTY_ID` | GA4 숫자 속성 ID. `properties/` 접두사는 넣지 않는다. |
| `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64` | 뷰어 권한만 가진 서비스 계정 JSON 파일의 base64 값 |

두 Secret이 모두 없으면 관리자 서버는 정상 기동하며 화면에 `연동 필요`를 표시한다. 하나만 등록된 상태는 잘못된 부분 설정이므로 배포를 중단한다.

배포 스크립트는 자격 증명을 저장소나 Docker 이미지에 넣지 않는다. 운영 호스트에서 권한 `600` 파일로 복원한 뒤 컨테이너의 `/run/secrets/ga4-service-account.json`에 읽기 전용으로 마운트한다. 교체 전 파일은 기존 롤백 디렉터리에 함께 보관한다.

## 적용 순서

1. API의 Flyway `V20__create_admin_analytics_snapshot.sql`을 먼저 배포한다.
2. GA4 속성에 서비스 계정 이메일을 `뷰어`로 추가하고 Data API를 활성화한다.
3. 위 두 GitHub Secret을 등록한 뒤 관리자 애플리케이션을 배포한다.
4. `Google Analytics` 상세 화면에서 상태가 `정상` 또는 `데이터 대기`인지 확인한다.
5. 공개 웹에 Measurement ID를 주입해 배포하고 동의한 브라우저에서 Realtime·DebugView를 확인한다.

서비스 계정 키가 노출되거나 교체가 필요하면 Google Cloud에서 기존 키를 폐기하고 Secret을 새 base64 값으로 바꾼 후 관리자만 다시 배포한다.
