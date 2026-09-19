# 미니 PC 사용량 관측

WBS: [docs #116](https://github.com/toilet-project/docs/issues/116). 관리자 `수집·서비스 상태`에서 호스트 전체의 현재 사용량과 KST 일별 추이를 확인한다. 웹 브라우저가 닫혀 있어도 Linux systemd timer가 1분마다 수집한다.

## 수집·저장 경계

```
Ubuntu /proc, /sys, 파일시스템 통계 + 작은 HTTPS 상태 요청
  → 전용 비로그인 사용자로 collect.py 실행 (1분)
  → 호스트 SQLite: 분 기록 30일 / KST 일별 요약 365일
  → 원자적으로 교체하는 exports/*.json
  → 관리자 컨테이너의 읽기 전용 디렉터리
  → 기존 Cloudflare Access 안의 관리자 GET API
```

운영 MySQL, 공개 API 코드, R2, Docker 소켓은 수집에 사용하지 않는다. 기본 1분 주기에서 최대 약 43,200개의 분 기록과 365개의 일 요약을 유지한다. 기록은 개인·회원·접속 IP·환경변수·프로세스 명령행을 포함하지 않는다. 카운터 기준점에 필요한 부팅 ID는 비공개 SQLite에만 보관한다. 요약 파일만 컨테이너에 마운트하고 디렉터리 전체 권한을 외부에 열지 않는다.

SQLite의 오래된 행과 과거 날짜 JSON은 매번 정리한다. SQLite 빈 페이지를 재사용하고 incremental vacuum을 수행한다. 별도 vacuum 전체 재작성·원본 서비스 캐시 삭제는 하지 않는다. 첫 30일 실제 저장 용량은 운영 인수에서 관찰한다. systemd는 CPU 10%, 메모리 128MiB, 실행 20초 상한을 둔다. 상한에 걸리면 기록 공백으로 나타난다.

## 측정값을 읽는 법

이 화면은 현재 자원 사용량 → 일별 사용 추이 → 연결 상태·증설 판단 순서로 구성한다. 상단 카드에는 최근 측정값과 한국 시간 기준 오늘 평균·최대를 함께 표시한다. 평균·최대는 실제 수집된 구간만 사용하며, 오늘 기록이 없으면 `—`로 표시한다. 과거 기간 조회는 아래 일별 표에만 적용되며 상단 카드는 항상 오늘 기준이다. 네트워크 카드의 평균·최대는 송신 속도 기준이다.

서비스 상태 요약은 운영 홈, 배치 실행은 배치 이력, Cloudflare 사용량은 전용 화면에서 확인한다. 상단 바로가기로 연결하며 이 화면에서 해당 요약 API를 중복 조회하지 않는다.

| 지표 | 기준 |
|---|---|
| CPU | 전체 코어 누적 카운터의 직전 구간 차이. guest 중복 합산 제외, idle·iowait는 사용률에서 제외 |
| 메모리 | `(MemTotal - MemAvailable) / MemTotal`. 즉시 회수 가능한 Linux 파일 캐시를 모두 부족 메모리로 계산하지 않음 |
| 디스크 | 실제 사용 블록 / (실제 사용 블록 + 일반 사용자 가용 블록). df의 가용 용량 기준, 예약 블록은 분리 |
| 스왑·압력 | 스왑 사용량 및 PSI some avg60. 스왑이 존재한다는 이유만으로 증설을 권하지 않음 |
| 송수신 | 기본 경로의 인터페이스 1개만 수집. Docker 가상 인터페이스를 합산하지 않음. LAN 전송은 포함 |
| LAN 속도 | 랜선 협상 속도. 인터넷 상품 속도와 별개 |
| 회선 사용률 | 확인한 다운로드·업로드 기준을 각각 입력했을 때만 계산. 기본값 미설정 |
| 통신 점검 | geupddong.com/version.json과 api.geupddong.com/api/health를 최대 3초 제한으로 확인. API는 JSON 상태 UP까지 확인 |

매번 speedtest를 실행하지 않는다. HTTPS 점검은 외부 연결·Tunnel·API 가용성을 관찰하는 것으로, 인터넷 전체 가용성이나 실제 사용자 요청의 P95 지연을 보장하지 않는다. Cloudflare CDN에서 처리한 트래픽은 미니 PC의 NIC 사용량에 포함되지 않는다.

첫 표본, 부팅 변경, 인터페이스 변경, 감소한 카운터, 90초 초과 공백, 시계 급변에서는 해당 차분을 `null`로 기록한다. 없는 값과 미수집 구간을 0으로 표시하지 않는다. 누적 트래픽은 측정된 구간만 합산하므로 공백이 있는 날에는 하루 전체 전송량보다 작을 수 있다. 그래프는 미수집 구간에서 끊어진다.

일평균·P95는 유효 구간 길이로 가중한다. 자정을 가로지른 구간은 두 날짜에 비례 배분한다. 메모리·디스크는 매 수집 시점 측정치로 직전 구간을 대표하므로 분 사이 순간 피크를 놓칠 수 있다. 오늘의 수집률은 자정부터 지금까지의 시간 기준이다. 과거 기록을 소급 생성하지 않는다.

80%는 보편적인 증설 확정선이 아닌 초기 관찰 기준이다. CPU·메모리·회선 기준 80% 이상이 연속 표본상 15분 지속되면 원인 점검을 안내한다. 높은 일별 P95와 응답 지연이 여러 날 겹치는지 확인하고, 배치 최적화·메모리 누수·디스크 정리·회선 병목을 조사한 뒤 해당 자원을 늘린다. 디스크/inode 90%는 즉시 공간 점검 안내다.

호스트가 완전히 꺼지면 자기 장애를 전송할 수 없다. 기존 외부 가용성 감시와 5분 서비스 장애 점검은 함께 유지한다. 기록이 3분 이상 오래됐거나 미래 시각이면 화면에서 정상 판단을 중단한다.

## 운영 적용 순서

상위 저장 디렉터리는 `0751`로 설정해 일반 배포 계정도 `exports` 디렉터리의 존재를 확인할 수 있게 한다. 상위 디렉터리 목록 조회와 원본 기록 읽기는 허용하지 않는다. `exports`는 `0750`, SQLite·JSON 파일은 `0640`이며 관리자 컨테이너에는 요약 디렉터리만 읽기 전용으로 전달한다. 기존 설치가 `0750`이면 설치 스크립트를 다시 적용해 상위 디렉터리의 통과 권한만 보완한다.

1. 최신 main과 관리자 #107 등 다른 배포와 충돌을 다시 확인한다. 이 PR은 operations 파일과 새 host 파일 중심이며 다른 데이터 관리 UI를 변경하지 않는다.
2. 검토한 `operations/host-monitor` 파일을 기존 Cloudflare Tunnel로 전달한다. 기존 DDNS를 사용하지 않는다.
3. `sudo sh operations/host-monitor/install.sh`는 전용 비로그인 계정·파일·systemd 정의만 설치한다. 설치만으로 타이머를 켜지 않는다. 기존 config는 덮어쓰지 않는다.
4. `/etc/geupddong-host-monitor.json`에서 `interface`(기본 경로 자동 선택 또는 명시), `diskPath`, 확인한 `downloadMbps`/`uploadMbps`를 설정한다. 500Mbps 인터넷이라도 업로드 속도를 추측해 입력하지 않는다. 값은 비밀정보가 아니다.
5. `sudo systemctl enable --now geupddong-host-monitor.timer`로 시작하고 2~3회 자연 실행을 확인한다. 저장은 `/var/snap/docker/common/geupddong-host-monitor`에서 이뤄진다. Snap Docker 접근 가능 경로를 사용한다.
6. 관리자 저장소 변수 `HOST_METRICS_ENABLED=true`로 설정한 뒤 승인된 main 병합/배포를 진행한다. deploy.yml이 exports 디렉터리가 실재하는지 확인하고 `/var/lib/geupddong-host-metrics`에 **읽기 전용 디렉터리 바인드**한다. 개별 파일 바인드는 원자적 파일 교체를 따라가지 못하므로 사용하지 않는다. 컨테이너는 현재 root로 실행된다. 향후 비root 전환 시 전용 그룹 읽기 권한을 명시적으로 맞춘다.
7. `/api/admin/v1/operations/host?days=7`의 status OK, 최근 기록, 데이터 경계, 2회 사이 CPU/트래픽 차분을 확인한다. 관리자 경계 밖에서는 Cloudflare Access가 차단해야 한다.
8. 일별 집계는 실제 날짜가 지난 뒤 누적 확인한다. 첫날은 설치 시점 이전이 미수집으로 표시된다. 정기 동작과 자연 수집률이 확인된 뒤 WBS의 운영 체크를 완료한다.

수집 주기는 이번 버전에서 60초로 고정한다. timer만 임의로 늘리면 90초 이상 차분이 무효 처리되므로, 변경 시 collector·API 메타데이터·보관량·검사를 함께 변경한다.

## API와 보관 위치

- `GET /api/admin/v1/operations/host?days=7|30|90|365`: 현재·일별 요약, `Cache-Control: no-store`
- `GET /api/admin/v1/operations/host/history?date=YYYY-MM-DD`: KST 최근 30일 분 기록
- `HOST_METRICS_DIRECTORY`: 관리자 런타임 환경변수, 기본 빈 값(연결 비활성)
- `HOST_METRICS_ENABLED`: GitHub 저장소 변수, 기본 미설정(바인드 비활성)
- 추가 비밀키 없음. 수집 설정과 SQLite는 호스트에 남고 요약만 관리자에서 읽는다.

파일은 고정 경로·날짜만 허용하고 2MB 읽기 제한, 버전 확인, 날짜 범위 제한을 적용한다. 수집 장애·JSON 손상은 이 화면에서 확인 필요 상태가 되며 기존 API·DB 점검을 실패시키지 않는다.

## 되돌리기

수집 중지는 `sudo systemctl disable --now geupddong-host-monitor.timer`로 처리한다. 실행 중 작업이 있으면 서비스도 중지한다. `HOST_METRICS_ENABLED=false` 후 관리자 재배포로 읽기 연결을 제거한다. 이미 보관된 기록은 자동 삭제하지 않는다. 관리자 이미지 자체의 문제면 기존 배포 파이프라인이 보관한 이미지·compose·env로 복귀한다. 원래 공개 서비스·DB·캐시는 변경하지 않는다.

## 검증 명령

```
python3 -m unittest discover -s operations/host-monitor -p 'test_*.py' -v
python3 operations/host-monitor/collect.py --once-stdout
./gradlew test
node scripts/verify-admin-home.cjs
node scripts/verify-deployment-safety.cjs
node scripts/verify-tunnel-transport.cjs
```

첫 명령은 합성 파일만 사용한다. `--once-stdout`는 실제 Linux 호스트에서 1초 구간을 읽고 종료하며, 파일·DB·타이머를 만들지 않는다. 운영 정기 수집과 구별해서 사용한다. 배포 검사에는 yaml 모듈, Bash, Python이 필요하며 Docker·네트워크·비밀값은 테스트 대역으로 대체된다.

참고: [Linux /proc](https://docs.kernel.org/filesystems/proc.html), [PSI](https://docs.kernel.org/accounting/psi.html).
