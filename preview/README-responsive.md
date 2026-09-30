# 관리자 반응형 프리뷰

WBS: https://github.com/toilet-project/toilet-admin-api/issues/137

## 기존 관리자 프리뷰

https://admin.geupddong.com/preview/

13인치 고정 보기: https://admin.geupddong.com/preview/responsive-screen.html?size=13

기존 `geupddong-admin-preview` Worker와 관리자 인증을 사용합니다.
OAuth 복귀 대상은 `adminPreview`입니다. 일반 서비스의 `preview` 복귀 대상과 구분합니다.
로그인은 상위 창에서 진행하고, 복귀 시 선택한 화면 크기와 페이지를 복원합니다.
13인치 1280×800, 15인치 1440×900, 데스크탑 1920×1080을 선택할 수 있습니다.

실제 데이터는 기존 API 및 관리자 서버에서 로그인한 사용자의 권한으로 조회합니다.
별도 로그인 쿠키 전달·보관이나 서비스 계정은 필요하지 않습니다.
프리뷰 런타임은 운영 API 쓰기 요청을 차단하며, 로그인 갱신과 로그아웃만 예외입니다.
이 차단은 프리뷰 UI의 오조작 방지용이며 서버의 기존 관리자 권한 검사를 대신하지 않습니다.

## 빌드와 배포

```text
node scripts/build-admin-preview.mjs
wrangler deploy --config wrangler.admin-preview.jsonc
```

`build/admin-preview-assets/preview`에 정적 파일만 생성합니다.
인증 정보나 운영 데이터는 빌드에 포함하지 않습니다. 기존 Cloudflare Access 보호를 사용합니다.

예전에 공유한 `preview.geupddong.com/admin-responsive/` 링크는 기존 관리자 프리뷰로 이동합니다.
호환 Worker는 `wrangler.responsive-redirect.jsonc`로 배포합니다.
추가했던 API·관리자 인증 중계 경로는 제거했으며, 호환 Worker는 로그인 정보나 데이터를 처리하지 않습니다.

## 화면 변경과 검증

- 너비 1600px 이하 또는 높이 760px 이하에서 압축 배치, 넓고 높은 데스크탑에서는 기존 배치
- 접이식 메뉴, 이름 툴팁, 카테고리 구분선, 주아체 및 서비스 녹색 로고
- 중복 헤더 제거, 목록·지도·편집 공간 확장, 탭과 접기 상태 유지
- 최신 Cloudflare 탭·개별 로딩 동작 보존

```text
node --test tests/admin-preview.test.mjs
node scripts/verify-admin-home.cjs
node scripts/verify-cloudflare-monitor.cjs
```

실제 프리뷰에서 화장실 목록, 배치 이력, 서비스 분석, Cloudflare 조회와
1280×800 / 1920×1080 전환을 확인했습니다. 전체 페이지·크기별 검수 및 사용자 인수는 WBS에서 관리합니다.
운영 배포는 프리뷰 인수 후 별도로 진행합니다.
