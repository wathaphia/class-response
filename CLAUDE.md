# 코드 지도 (Claude용)

정적 사이트(GitHub Pages, 빌드 없음). 스크립트는 `<script>` 로 불러와 한 전역 공간을 쓴다(모듈 아님) → 같은 이름의 최상위 `const`/`let` 이 두 파일에 있으면 SyntaxError. 새 이름은 `grep` 으로 먼저 확인.
탭 하나를 고칠 때는 아래 표의 그 파일만 본다. 기능 세부는 `class-tools\docs\product-history.md` 의 「코드 지도 세부」.

## 시험 (무료 한도 아끼기)
- `class-tools\e2e\run.ps1 auto -Repo <작업트리>` 가 바뀐 파일에 맞는 시나리오만 돌린다. 모든 시나리오는 `common.js`·`student.js`·`teacher.js` 데이터 부분·`setup.sql` 을 바꿨을 때만.
- `live-relay`·`live-iphone` 은 그 경로를 바꿨을 때만. TURN 발급은 가짜(STUN만), `live-relay` 만 진짜.
- 선생님 추가 시험 이메일은 `.invalid`(메일 한도 보호).
- SQL은 바꾼 부분만 `supabase-sql.ps1 -File`(setup.sql 전체 재실행 금지), 바꾸기 전 함수 정의를 `class-tools\backup` 에.
- 실패하면 그 시나리오만 다시. 로그 전체는 `CLASS_DEBUG=1`.

## 파일
| 파일 | 내용 | 시나리오 |
|---|---|---|
| `config.js` | Supabase 주소·키, TURN Worker 주소 | |
| `common.js` | 공용 도우미, 쓰기 감시, 슬라이드, WebRTC/TURN, 시뮬레이션 | 모두 |
| `teacher.js` | 공유 상태, 로그인·가입·재설정, 탭 틀 | teacher |
| `teacher-library.js` | 「전체 수업」 폴더·카드, 슬라이드 PDF, 관찰자 사본 | manage |
| `teacher-profile.js` | 「프로필」, 「전체 선생님 및 학생」 | manage, promote |
| `teacher-etc.js` | 「기타 관리」 사용량 원·표, 동기화 | etc |
| `teacher-bugs.js` | 버그 제보 | etc |
| `teacher-patch.js` | 「패치 노트」 탭, 기록은 `patch-notes.js` | etc |
| `teacher-run.js` | 「수업 진행」, 수업용 화면 | class, teacher |
| `teacher-build.js` | 「자료 추가」, 시뮬레이션 편집기, 작성기 | sim-over |
| `teacher-students.js` | 「학생 관리」, 화면 크게 보기 | promote, live-* |
| `teacher-settings.js` | 「슬라이드 편집」, 올리기, CSV | manage |
| `student.js` | 학생 입장, 폴링, 카드, 화면 공유, 선생님 링크(`?t=`) | live-* |
| `404.html` | 선생님별 학생용 링크 `…/아이디` → `index.html?t=아이디` | |
| `app.css` | 모든 모양 | |
| `setup.sql` | 표·보안 규칙·RPC. `supabase-sql.ps1` 로 적용 | |

저장소 밖: Worker `class-tools\cf-worker\src\index.js`, 시험 `class-tools\e2e\`(지도 `class-tools\CLAUDE.md`), 슬라이드 올리기 `class-tools\class-publish.ps1`.

## 규칙
- 버튼: 호버·선택 시 시각 피드백을 주고, 활성화해도 크기·자리가 변하지 않는다(글자 굵기·테두리 두께·`transform` 이동 금지, 글자가 바뀌면 너비 고정, 숨길 땐 `visibility`).
- 나중에 고치기 쉽게 짠다: 화면 그리기와 서버 요청을 섞지 않고, 둘 이상이 쓰는 것은 `common.js` 로, 저장소 키·RPC 이름은 한 곳에 상수로, 로그인 정보는 `loginStore` 로만.
- JS/CSS를 바꾸면 `node C:\Users\neptu\class-project\class-tools\bump-version.js <이름> [작업트리]`.
- 학생 표는 열 단위 권한: 교사도 `token`·`pin_hash` 를 못 읽는다(`select` 에 넣지 말 것). 수업 주인(`owner`)은 개발자만 바꾼다.
- 기타 관리(`teacher-etc.js` `teacher-etc.css`)는 최적화 끝남: 직접 언급이 없으면 전체 최적화·코드 제거 요청에서도 손대지 않는다. 고칠 땐 원·표를 지우지 말고 옮기기만, `etc` 시나리오 꼭 통과. 묶음마다 try/catch(`paintEtc` 의 `section`).
- 패치 노트: 말하지 않아도 PR마다 병합 전에 `patch-notes.js` 맨 위에 [번호, 날, 글, 성격] 한 줄 + 그날 `PATCH_DAYS` 요약(PR 번호를 받은 뒤 커밋), 시기가 바뀌면 `PATCH_ERAS` 끝 줄도.
- 슬라이드 폴더는 수업마다 하나(`교사id/수업id/`): 공동 작업자·개발자도 복사 없이 그 폴더를 고친다(저장소 `can_slide_path`, Worker 같은 검사). `slide_dir` 의 `pdf=k-n` = `k.pdf` 원본이 파일 k…k+n-1 쪽 → `exportSlidesPdf`(common.js)가 그 쪽을 원본 그대로 넣는다.
- 새 교사 탭 파일은 `teacher.html` 불러오기 순서·이 표·`teacher.js` 머리 주석에 함께 적는다.
