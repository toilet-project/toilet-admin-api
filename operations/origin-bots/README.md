# 미니 PC에 도착한 봇 요청 식별

Cloudflare 차단 통계가 아니라 **미니 PC의 기존 Nginx access.log에 기록된 요청**만 별도로 집계한다. 서버에 오지 않은 CDN 캐시 응답·차단 요청은 포함하지 않는다. 실제 연결 상태와 확인 시각은 [WBS](https://github.com/toilet-project/toilet-admin-api/issues/120)에 기록한다.

## 관리자에게 보이는 것

`서비스 이용 분석 → 봇 접근`에서 봇 이름, 식별 상태, 기간별 요청 수, 최초·마지막 접근(KST), 4xx·5xx 응답, 시간대/날짜, 경로 유형을 확인한다. 봇 이름·식별 상태로 좁혀 본다. 기기·유입 필터, 사람의 방문 지표 및 CSV와 섞지 않는다.

| 상태 | 의미 |
|---|---|
| 공식 IP 확인 | Googlebot·Naver Yeti·Bingbot 이름과 해당 기관 공식 크롤러 IP 목록이 일치 |
| 이름만 확인 | 요청이 그 이름을 표명함. IP 검증 미설정·실패·목록 만료·오래된 로그도 이 상태 |
| 공식 IP 불일치 | 신선한 목록과 맞지 않음. 사칭·악성 확정은 아님 |

일반 사용자처럼 보이는 봇까지 모두 식별하는 기능은 아니다. 이름을 숨긴 요청이나 `직접 접속·확인 불가` 전체를 봇으로 처리하지 않는다. 검색엔진을 통한 **사람의 유입**은 계속 일반 방문 통계에 포함한다.

## 개인정보·성능 경계

- 로그의 IP·UA·요청 URL은 서버 메모리에서만 읽고 공식 대역과 비교한다. 분석 저장소에 원문 IP·UA·쿼리·리퍼러·회원 정보는 저장하지 않는다.
- URL은 허용된 경로 **유형** 11개로 묶는다. 화장실 ID·페이지별 정확한 URL을 추적하는 기능은 포함하지 않는다.
- 별도 SQLite에는 시간대·봇·상태·유형·응답군 집계와 로그 inode/offset만 보관한다. MySQL 스키마 변경은 없다. 35일이 지난 집계는 제거하고 SQLite 빈 페이지를 재사용한다.
- 공개 API 요청 중 DNS·외부 API를 호출하지 않는다. 목록은 수집기가 12시간마다 갱신을 시도하고, 실패 시 1시간 이후 재시도한다. 가져온 지 24시간이 지나면 검증에 사용하지 않는다.
- 지난 로그에는 당시 공식 목록이 없을 수 있다. 목록 조회 시각과 요청 시각이 24시간 넘게 다르면 과거 신원 확인으로 소급하지 않는다.
- 매 실행 최대 10만 줄·처리 15초, systemd CPU 10%·메모리 128MiB·전체 40초 상한. cursor와 집계는 같은 트랜잭션으로 저장하며 중복 실행은 잠금으로 막는다.
- 정상 rename + delaycompress 로그 교체를 지원한다. 현재 로그와 `.1`을 읽고 마지막 미완성 행은 다음 실행으로 넘긴다. 누락된 inode·관측된 truncation은 부분 기록 경고로 표시한다. copytruncate는 중간 손실을 완전히 감지할 수 없으므로 지원 보장 대상이 아니다.
- 내보내기는 최근 집계 행 최대 2만 개. 초과·적체·파싱 실패·수집 시작 전 기간은 부분 기록이다. 미연결/수집 실패를 0건으로 표시하지 않는다.

## 운영 적용 전 점검

1. API·관리자 최신 main 및 동시 배포 확인. 별도 승인 전에는 아래 설치/설정 변경을 실행하지 않는다.
2. Nginx가 신뢰하는 Cloudflare/로컬 Tunnel 프록시만 `CF-Connecting-IP`를 전달하며 외부가 그 헤더를 위조해서 직접 접근할 수 없는지 확인한다. 그 전에는 `--trusted-real-ip`를 쓰지 않는다.
3. 수집기 전용 비로그인 계정·그룹 `geupddong-origin-bots`, 로그 읽기용 `adm` 권한만 준비한다. 코드와 systemd 정의는 root 소유 읽기 전용으로 설치한다. Nginx 로그·운영 서비스 설정을 수집기가 쓰지 못하게 한다.
4. `/var/snap/docker/common/geupddong-origin-bots/{state,exports}`를 전용 계정 소유로 만든다. state는 0700, exports는 0750, export 파일은 0640. root 컨테이너에 exports 디렉터리만 읽기 전용으로 바인드한다. 로그 디렉터리·SQLite·Docker 소켓은 연결하지 않는다.
5. 관리자 `ORIGIN_BOTS_DIRECTORY=/var/lib/geupddong-origin-bots`와 위 읽기 전용 디렉터리 바인드를 함께 준비한다. 관리자 저장소 변수 `ORIGIN_BOTS_ENABLED=true`일 때 이후 배포도 이 연결을 유지한다. 설치 전에는 켜지 않는다. 기본 빈 설정이면 기존 페이지는 계속 동작한다.
6. 승인된 배포 후 수동 1회 → timer 활성화 → 2회 이상 offset/누적 변화, 재실행 중복 없음, 기존 방문 지표·서비스 응답 정상, 권한 없는 사용자 차단을 확인한다.
7. 중지 시 timer를 먼저 중지한다. 집계 파일/전용 계정 삭제는 필요할 때 별도 확인하며 기존 Nginx 로그는 삭제하지 않는다.

### 설치와 기존 이미지 연결

- `install.sh --trusted-real-ip-confirmed`: 신뢰 프록시 검토 후 root로 실행한다. 전용 비로그인 계정·최소 파일 권한·systemd 정의만 설치하며 타이머나 관리자 서버는 시작하지 않는다.
- `systemctl start geupddong-origin-bots.service`: 제한된 최초 수집을 확인한다. 최초 실행은 기존 로그를 순서대로 읽으므로 적체가 있으면 부분 기록으로 표시한다.
- `systemctl enable --now geupddong-origin-bots.timer`: 확인 후 1분 주기 수집을 시작한다. CPU 10%·메모리 128MiB 상한을 적용한다.
- `connect_admin.py --admin-commit <실행 중 버전> --api-commit <실행 중 버전> --batch-commit <실행 중 버전>`으로 사전 점검한다. 승인 후 같은 명령에 `--apply-approved`를 더한다. 배포·공유 유지보수 잠금을 잡고 기존 관리자 이미지를 유지한 채 한 개 환경값과 집계 디렉터리의 읽기 전용 바인드만 추가한다. `.env`, API·배치 설정이 바뀌면 중단한다. 실패하면 보관한 관리자 compose로 복원한다.
- 기존 호스트 모니터의 읽기 전용 바인드는 함께 유지한다. 운영 관리자에는 로그·SQLite·Docker 소켓을 연결하지 않는다.
- `ORIGIN_BOTS_ENABLED=true`를 저장소 변수에 반영하고 배포 워크플로 변경을 병합해 다음 배포에서 연결이 사라지지 않도록 한다.

분석 이벤트의 봇 분류·제외와 이 수집기는 별개다. Nginx 요청 건수를 방문자 수에서 빼거나 과거 기록을 삭제하지 않는다. 요청에 202가 반환돼도 분석 테이블에 저장됐다는 뜻은 아니다.

## 공식 판별 근거

- [Google 공식 검증 및 IP 목록](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests)
- [네이버 Yeti 확인 및 IP 목록](https://searchadvisor.naver.com/guide/seo-basic-firewall)
- [Bingbot 검증](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26)

확인한 서버 응답 시각일 뿐, 색인 완료·학습·콘텐츠 보관을 증명하지 않는다. IP 원문은 새 분석 데이터로 영구 보관하지 않는다.
