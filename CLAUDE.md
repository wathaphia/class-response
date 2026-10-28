# 코드 지도 (Claude용)

정적 사이트(GitHub Pages, 빌드 없음). 스크립트는 `<script>` 로 차례대로 불러오며 모두 한 전역 공간을 쓴다(모듈 아님).
같은 이름의 최상위 `const`/`let` 을 두 파일에 두면 SyntaxError가 나니 새 이름을 만들 때 `grep` 으로 먼저 확인한다.

## 작업 요령 (토큰 절약)
- 파일 전체를 읽지 말고 `grep -n "function 이름\|이름 ="` 로 위치를 찾은 뒤 그 근처만 `offset/limit` 으로 읽는다.
- 탭 하나를 고칠 때는 아래 표의 그 탭 파일만 본다. 공유 상태·틀은 `teacher.js`, 그리기 도우미(`h`, 슬라이드, 시뮬레이션)는 `common.js`.
- 브라우저 시험은 바꾼 곳에 맞는 시나리오만 돌린다(아래 표). 모두 돌리는 것은 merge 직전 한 번.
- 로그가 필요하면 `CLASS_DEBUG=1` (평소에는 무해한 broadcast 끊김을 개수로만 적는다).

## 파일
| 파일 | 내용 | 주요 함수 | e2e 시나리오 |
|---|---|---|---|
| `config.js` | Supabase 주소·키, TURN Worker 주소 | | |
| `common.js` | 교사·학생 공용: `h()` DOM 도우미, 데이터 쓰기 감시(`watchedFetch`→`onDataWrite`), 슬라이드 단계·주소(`slideSrc`), WebRTC/TURN(`iceServers`, `relayFirst`), 시뮬레이션 재생·얹기·전체 화면(`withSimPause`, `renderSimLayer`, `openSimFull`), 답 요약 | `reloadIfStale`(맨 위) | 모두 |
| `teacher.js` | 공유 상태(`lessons` `lesson` `activities` `students` `responses` `tab` `editing` `me`), 시작(DOMContentLoaded→`init`), 로그인, 데이터 읽기/저장(`loadLesson` `loadResponses` `save`), 탭 틀 `draw` | | teacher |
| `teacher-library.js` | 「전체 수업 관리」 폴더·카드, 슬라이드 PDF | `drawManage` `exportSlidesPdf` | manage |
| `teacher-etc.js` | 「기타 관리」 사용량 원 그래프·표, 동기화 규칙/비용, 한국 시간(`kstIso`) | `drawEtc` `syncUsage` `supabaseView` `cloudflareView` `syncCostView` | etc |
| `teacher-run.js` | 「수업 진행」 슬라이드·제출 현황·접속 표시(Presence) | `drawRun` `setPage` `drawRoster` `showJoin` | teacher |
| `teacher-build.js` | 「자료 추가」 활동 목록(쪽 옮기기·끌기, 칸 재사용 `syncRows`), 시뮬레이션 편집기, 설명·질문 작성기(`composeEditor`), 저장 버튼 상태(`editBase`) | `drawBuild` `editor` `toCompose` | sim-over |
| `teacher-students.js` | 「학생 관리」 표, 학생 화면 크게 보기(교사 전용 채널 `:t`, 시뮬레이션 WebRTC), 일괄 미리보기 그리드 | `drawStudents` `watchStudentScreen` `startGrid` `simRtc` | live-android, live-iphone, live-relay |
| `teacher-settings.js` | 「수업 설정」, 슬라이드 올리기(PPTX/PDF→JPG 1280/1024), 저장소(R2 `r2Call` / Supabase), CSV | `drawSettings` `uploadSlides` `slideHome` `downloadCSV` | manage |
| `student.js` | 학생: 입장, 상태 받기(`poll`, `student_state` RPC, `nudge`→`pollSoon`), 화면·활동 카드, 화면 보기 동의·전송(`startMirror` `sendScreenData`) | `start` `render` `cardFor` `buildForm` | live-* |
| `app.css` | 모든 모양 | | |
| `setup.sql` | 표·보안 규칙·RPC(`student_state`, `resource_usage`). Supabase에 직접 적용(`class-tools\supabase-sql.ps1`) | | |

저장소 밖: Worker(TURN·/usage·/s/ R2) `C:\Users\neptu\class-tools\cf-worker\src\index.js`, 시험 `class-tools\e2e\run.js`, 슬라이드 올리기 `class-tools\class-publish.ps1`.

## 규칙
- JS/CSS를 바꾸면 `node C:\Users\neptu\class-tools\bump-version.js <이름>` (teacher-*.js 포함 모든 `?v=` 변경).
- 새 교사 탭 파일을 만들면 `teacher.html` 의 불러오기 순서와 이 표, `teacher.js` 머리 주석에 함께 적는다.
