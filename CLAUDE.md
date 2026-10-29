# 코드 지도 (Claude용)

정적 사이트(GitHub Pages, 빌드 없음). 스크립트는 `<script>` 로 차례대로 불러와 한 전역 공간을 쓴다(모듈 아님) → 같은 이름의 최상위 `const`/`let` 이 두 파일에 있으면 SyntaxError. 새 이름은 `grep` 으로 먼저 확인.
탭 하나를 고칠 때는 아래 표의 그 파일만 본다(공유 상태·틀 `teacher.js`, 그리기 도우미 `common.js`). 읽기·보고 요령은 사용자 전역 CLAUDE.md.

## 시험 (무료 한도 아끼기)
- `class-tools\e2e\run.ps1 auto -Repo <작업트리>` 가 바뀐 파일에 맞는 시나리오만 가벼운 순서(`class`·`promote` 먼저)로 돌린다. 모든 시나리오는 `common.js`·`student.js`·`teacher.js` 데이터 부분·`setup.sql` 을 바꿨을 때만.
- `live-relay`·`live-iphone` 은 그 경로를 바꿨을 때만. TURN 발급은 가짜(STUN만), `live-relay` 만 진짜.
- 시험 학생은 교사 권한으로 바로 만들고 지운다. 승격 시험 이메일은 `.invalid`(메일 한도 보호).
- SQL은 바꾼 부분만 `supabase-sql.ps1 -File`(setup.sql 전체 재실행 금지), 바꾸기 전 함수 정의를 `class-tools\backup` 에.
- 실패하면 그 시나리오만 다시. FPS 같은 흔들리는 값은 한 번 더 돌려 보고 판단. 로그 전체는 `CLASS_DEBUG=1`.

## 파일
| 파일 | 내용 | 주요 함수 | 시나리오 |
|---|---|---|---|
| `config.js` | Supabase 주소·키, TURN Worker 주소 | | |
| `common.js` | 공용: `h()`, 쓰기 감시(`watchedFetch`→`onDataWrite`), 슬라이드(`slideSrc`), WebRTC/TURN(`iceServers` `relayFirst`), 시뮬레이션(`withSimPause` `renderSimLayer`(swapSlide 의 slideswap 에 맞춰 들어오기·물러나기(fx-out-*) 같은 효과 `simBoxFx`) `openSimFull`), 답 요약 | `reloadIfStale`(맨 위) | 모두 |
| `teacher.js` | 공유 상태(`lessons` `lesson` `activities` `students` `responses` `tab` `editing` `me`), `init`, 로그인, `loadLesson` `loadResponses` `save`, 탭 틀 `draw`(접속 QR·수업 진행·학생 관리·수업용 화면 띄우기(편집 모드에선 없음) + 「설정」 메뉴 + 「프로필」; 「수업 모드/편집 모드」 바꾸기 `.mode-swap`, `editMode` cra-edit `.editing` 이면 설정 탭이 위로), 탭 이름·순서 `tabCustom`, 끌어 정렬 `dragSort` | | teacher |
| `teacher-library.js` | 「전체 수업」(프로필 화면 `.manage-pane`) 폴더·카드·「+ 수업 추가」·「공유받은 수업」, 슬라이드 PDF | `drawManage` `exportSlidesPdf` | manage |
| `teacher-profile.js` | 「프로필」: 내 정보·교사 ID·로그아웃·비밀번호, 탭 꾸미기(`tabsCard`), 공동 작업자(`add_collaborator`, `my_profile.colleagues`), 개발자(`is_admin`)의 선생님 관리 | `drawProfile` `paintProfile` `addCollaborator` | manage, promote |
| `teacher-etc.js` | 「기타 관리」 사용량 원(누르면 자세히 `usageDetail`, 평균 몫·예상 `usageStat`, 맨 위 「소진 주의」 요약, 로컬 기록 cra-usage-hist), 캐시 전송량 막대(자세히 안, 오늘 = 매시 집계 + Worker `egressTail`), 동기화(`lastSync()`)/비용, `kstIso` · 「버그 제보」(`bug_reports`, 1인 5개) | `drawEtc` `syncUsage` `usageRings` `supabaseView` `cloudflareView` `syncCostView` `drawBugs` `paintBugs` | etc |
| `teacher-run.js` | 「수업 진행」 슬라이드·제출 현황·Presence, 「수업 시작하기」 50분/「시간 연장하기」(30분 밑, TURN 새로) — 이때만 TURN·화면 보기, 평소 탭 줄의 「수업용 화면 띄우기」 창(`openPresent`, 무대 그리기 `paintStage` 공유, 시뮬레이션은 교사 화면 것을 비춤 `presentMirrorSync`: SIM_AGENT 장면·캔버스 WebRTC → 비추개 `.sim-mirror`) | `classOn` `startClass` `extendClass` `endClass` `drawRun` `setPage` `drawRoster` `drawJoin` `deskTag` | class, teacher |
| `teacher-build.js` | 「자료 추가」 활동 목록(옮기기·끌기, `syncRows`, 「슬라이드와 함께 보기」 `layoutBySlide` cra-build-slides: 카드 절반 크기, 얹은 시뮬레이션은 작은 슬라이드 위에, 카드의 재생 버튼을 따름 `paused`), 시뮬레이션 편집기, 작성기(`composeEditor`), 저장 상태(`editBase`) | `drawBuild` `editor` `toCompose` | sim-over |
| `teacher-students.js` | 「학생 관리」 승격 표(`promotedCard`, `promote_student` `demote_student`, 개발자만), 학생 표, 화면 크게 보기(교사 전용 채널 `:t`; PC 화면 전체 WebRTC, 휴대폰은 화면 복사 + 시뮬레이션 WebRTC), 일괄 미리보기 | `drawStudents` `promoteStudent` `watchStudentScreen` `startGrid` `simRtc` `deskAnswer` | promote, live-* |
| `teacher-settings.js` | 「슬라이드 편집」, 올리기(PPTX/PDF→JPG 1280/1024), 저장소(R2 `r2Call`/Supabase), CSV | `drawSettings` `uploadSlides` `slideHome` `downloadCSV` | manage |
| `student.js` | 입장, `poll`(`student_state` RPC, `nudge`→`pollSoon`), 카드, 화면 보기 동의·전송(`startMirror` `sendScreenData`), PC 전체 화면 공유(`startDesk`→`offerDesk`, 공유 중엔 화면 복사 안 보냄), 공유 전 가림막 `renderDeskGate`, Presence `desk`·`multi` | `start` `render` `cardFor` `buildForm` | live-* |
| `app.css` | 모든 모양 | | |
| `setup.sql` | 표·보안 규칙(`can_lesson` `owns_lesson`: 주인·공동 작업자·개발자)·RPC(`student_state` `resource_usage` `my_profile`), `bug_reports`. `supabase-sql.ps1` 로 적용 | | |

저장소 밖: Worker `class-tools\cf-worker\src\index.js`(TURN·/usage·/s/ R2), 시험 `class-tools\e2e\`(지도 `class-tools\CLAUDE.md`), 슬라이드 올리기 `class-tools\class-publish.ps1`, 기능 내력 `class-tools\docs\product-history.md`.

## 규칙
- JS/CSS를 바꾸면 `node C:\Users\neptu\class-tools\bump-version.js <이름> [작업트리]` (모든 `?v=` 변경).
- 새 교사 탭 파일은 `teacher.html` 불러오기 순서·이 표·`teacher.js` 머리 주석에 함께 적는다.
