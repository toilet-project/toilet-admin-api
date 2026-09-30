# 관리자 반응형 프리뷰

WBS: https://github.com/toilet-project/toilet-admin-api/issues/137

## 크기를 유지하면서 확인하기

https://preview.geupddong.com/admin-responsive/responsive-screen.html?size=13

프리뷰 안에 실제 1280×800 크기의 페이지 표시 영역을 만듭니다.
메뉴 이동과 새로고침에도 크기가 유지되고, 상단에서 15인치(1440×900),
데스크탑(1920×1080), 실제 브라우저 크기를 선택할 수 있습니다.
선택한 크기는 브라우저에 저장되고 현재 페이지는 주소에 유지됩니다.
이 화면과 내부 관리자 페이지 모두 기존 관리자 인증을 요구합니다.
내부 HTML만 같은 출처의 프레임을 허용하며, 다른 출처나 인증 화면의 임베드는 허용하지 않습니다.

## 화면 변경 범위

- 브라우저 너비 1600px 이하 또는 높이 760px 이하에서 공통 압축 배치 적용
- 넓고 높은 데스크탑에서는 기존 배치 유지
- 접이식 사이드 메뉴, 작업 목록과 상세 영역의 높이 배분, 지도/편집 탭
- 개방시간 적용 대상과 이력, 통계 상세 필터 접기
- 적용 버튼 접근성, 관리 표 내부 스크롤, 모니터링 카드 배치
- 탭은 기존 DOM을 유지해 편집값과 스크롤을 보존하며 지도의 크기 변경을 관찰

## 빌드와 배포

`node scripts/build-responsive-preview.cjs <private-output-directory>`

빌드는 정적 파일과 `responsive-bridge.js`, Worker, 파일 목록만 복사합니다.
키·사용량 스냅샷·회원 데이터는 빌드 산출물에 포함하지 않습니다.

별도 Worker `geupddong-admin-responsive-preview`의 설정은 비공개 출력 폴더에서 관리합니다.

- 정적 파일 바인딩: `ASSETS`, `run_worker_first: true`
- 경로: `preview.geupddong.com/admin-responsive*`
- 기존 관리자 인증 연결: `api.geupddong.com/__responsive-preview-auth*`
- `workers_dev: false`, `preview_urls: false`, 관측 로그 비활성화
- `html_handling: none`, `not_found_handling: none`
- Secret: `PREVIEW_SESSION_KEY` (별도 발급한 32바이트 난수의 16진수 표현)
- 변수: `PREVIEW_EXPIRES_AT` (게시 시점에서 최대 24시간 이내의 Unix 밀리초)

기존 관리자 계정으로 로그인한 사용자만 볼 수 있습니다. 암호화된 일회성 연결용
티켓은 URL이 아닌 POST 본문으로 전달하고, 출처·상태값·만료를 검증합니다.
프리뷰 세션은 최대 15분이며 각 조회마다 현재 관리자 권한을 다시 확인합니다.
운영 조회는 요청한 사용자의 기존 자격으로만 전달합니다. 서비스 계정 대체는 없습니다.
허용한 관리자 경로의 GET 이외 운영 요청은 차단합니다.

## 검증과 남은 인수

자동 검사:

```text
node --test tests/responsive-preview-gateway.test.mjs
node scripts/verify-admin-home.cjs
node scripts/verify-cloudflare-monitor.cjs
```

기존 화장실·개방시간·중복 품질·행정구역·제보·통계·API 쿼터 테스트를 함께 수행합니다.
실제 화면 검수는 1280×640, 1366×680, 1440×900, 1920×1080 및 작은 화면에서 진행합니다.
화면 넘침, 적용 버튼 접근, 지도 재배치, 편집값 유지, 페이지 이동을 확인해야 합니다.
프리뷰 게시만으로 화면 인수가 완료된 것으로 취급하지 않습니다.

운영 배포는 프리뷰 인수 후 별도로 진행합니다.
