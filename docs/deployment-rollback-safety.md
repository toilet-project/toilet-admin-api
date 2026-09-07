# 관리자 배포 안전성 보완

상태: 로컬 feature 검증용. main 병합은 운영 배포를 실행하므로 별도 승인 후 진행한다. Tunnel 연결 변경과 분리한 변경이다.

## 변경

- 기존 SSH host/port/key와 애플리케이션·DB 로직 유지.
- 커밋 SHA 태그를 빌드하고 Compose에서도 같은 SHA 사용. latest 태그는 호환용 게시만 유지.
- Actions concurrency와 서버 프로세스 수명 동안의 flock으로 중복 배포 방지. 진행 중 배포를 취소하지 않으며 pending 실행의 순서/모든 실행 보존을 보장하지 않는다.
- set -eu/umask077, 변경 전 설정·현재 image ID·rollback tag 보관. 기존 파일 삭제·자동 만료 삭제 없음.
- 이미지 prune와 remove-orphans 제거. 이 workflow에서 다른 컨테이너/이미지를 정리하지 않는다.
- Compose config/pull/up 실패 시 중단. 실제 local actuator health가 UP이어야 성공 처리한다.
- 자동 rollback/재시도 없음. SSH timeout 후 원격 배포가 계속될 수 있으므로 서버부터 확인한다.

## 검증

`scripts/verify-deployment-safety.cjs`는 YAML과 Bash 구문을 검사하고 Docker/curl/flock/sleep을 가짜 함수로 대체한다. JSON health 판정에는 Python을 사용한다. 실제 Secret·서버·Docker·인터넷은 사용하지 않는다.

필요한 실행 환경: Node, yaml 모듈, Bash, Python 3. `DEPLOY_YAML_MODULE`, `DEPLOY_BASH`, `DEPLOY_PYTHON` 환경변수로 설치 경로를 지정한 뒤 `node scripts/verify-deployment-safety.cjs`를 실행한다. 시험용 임시 파일은 합성 데이터만 포함하고 보관한다.

정상·최초 배포·lock 충돌·image 확인 실패·Compose config/pull/up 실패·health HTTP 실패/DOWN/잘못된 JSON 총10가지 시나리오. 기존 설정 백업, 실패 이후 up 미실행, 최대30회 health, 배포 up 최대1회를 검사한다. 실제 flock 경합이나 Docker 배포 성공을 대신하지 않는다.

## 운영 적용 전 확인

1. 다른 배포 없음·main 차이 재검토·서버 flock/curl/python3/Compose --wait 지원 확인.
2. 기존 이미지와 설정을 보관할 공간 확인. 이미지 tag는 외부의 image prune -a나 디스크 유실을 막는 별도 백업이 아니다.
3. 기존 DB 설정/환경변수 생성 방식을 유지했으며 일반 Secret 문자열의 shell escaping 전면 개선은 이번 범위 밖이다.
4. main 병합·배포 승인. 이 변경은 관리자 재기동을 포함할 수 있다. DB 원상복원 기능이 아니며 애플리케이션 버전 rollback을 DB rollback과 혼동하지 않는다.
5. 실제 서버 백업 권한·SHA 이미지·health·로그인 읽기 화면을 인수한다. 그 전에는 운영 위험 해소 완료로 체크하지 않는다.

## 수동 복구 절차

추가 workflow 실행 중지 → 원격 배포 프로세스/lock 상태 확인 → 정확한 rollback-preparation 폴더 선정 → 현재 설정 별도 보존 → image-id/tag와 로컬 이미지 존재 확인 → 백업 Compose/env 복구 검토 → Compose image를 보존된 image ID/tag로 명시 → config 검사 → 승인 후 해당 관리자 서비스만 up → local health·Access 뒤 로그인 읽기 확인.

예전 Compose가 latest를 가리키는 경우 파일만 복원하고 pull하면 새 이미지가 내려올 수 있다. 보존 image ID/tag를 명시하고 복구 중 pull하지 않는다. 정확한 운영 경로/대상은 실행 직전 확인하므로 자동 복구 스크립트나 광범위 삭제 명령은 제공하지 않는다.

## 근거

- [Compose up --wait](https://docs.docker.com/reference/cli/docker/compose/up/): healthcheck가 없는 서비스의 running 상태와 실제 앱 준비 완료는 다르다.
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency): 저장소 내 같은 그룹을 제어하며 모든 저장소를 전역 직렬화하지 않는다.
