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
| `common.js` | 공용: `h()`, 쓰기 감시(`watchedFetch`→`onDataWrite`), 슬라이드(`slideSrc`), WebRTC/TURN(`iceServers` `relayFirst`), 시뮬레이션(`withSimPause` `renderSimLayer`(swapSlide 의 slideswap 에 맞춰 들어오기·물러나기(fx-out-*) 같은 효과 `simBoxFx`) `openSimFull`), 답 요약 | `reloadIfStale`(맨 위), 요청 단추 0.5초 불응기(`REQ_COOLDOWN_MS`, 빠르게 눌러야 하는 단추는 `data-rapid`) | 모두 |
| `teacher.js` | 공유 상태(`lessons` `lesson` `activities` `students` `responses` `tab` `editing` `me`), `init`, 로그인(로그인·가입하기(「학생에서 승격되었습니까? 예」 → 학번·이름 → `request_teacher_signup`)·비밀번호 재설정: 없는 계정이면 email_has_account 로 막고 「연결된 계정이 없습니다.」, 있으면 메일 링크(PASSWORD_RECOVERY, 30분, 개발자 Gmail로 보냄 class-tools\mail-hook) → 로그인된 채 「프로필」 새 비밀번호 칸 `passwordRecovery`), `loadLesson` `loadResponses` `save`, 탭 틀 `draw`/`topBar`: 위 줄 탭 + 「수업/편집 모드」 스위치 `.mode-switch`(cra-edit) + 「설정」 → 아래 줄 `.sub-tabs`(프로필·전체 수업·개발자만 전체 선생님 및 학생·기타 관리·패치 노트). 탭 설정 `TAB_DEFAULTS` `SHOW_DEFAULT` `tabLayout` `tabShown`, 계정 저장 `saveTabCustom`(user_metadata.tabs), 탭 꾸미기 모드 `startTabEdit` `custTab` `custDrag` | `tabLayout` `goTab` | teacher |
| `teacher-library.js` | 「전체 수업」(`drawLibrary` 의 `.manage-pane`) 폴더·카드·「+ 수업 추가」·개발자용 「학생용 기본 수업」(별 `.star-btn`, 맨 위 칸, `set_default_lesson`)··「공유받은 수업」·「수업 삭제」(주인·개발자), 슬라이드 PDF | `drawManage` `exportSlidesPdf` | manage |
| `teacher-profile.js` | 관찰자는 `devOnly(fn)`(teacher.js)로 개발자 단추를 막는다. 「프로필」(한 칸): 내 정보·교사 ID·로그아웃·비밀번호(프로필에서 열면 현재 비밀번호 확인 `checkPassword`)·「탭 꾸미기」 단추·나에게 공유된 수업. `drawLibrary`. 「전체 선생님 및 학생」(개발자만 `drawPeople`): 선생님 관리(표 맨 아래 「추가」 줄, 가입 요청 승인·거절 `decide_teacher_request`), 공동 작업자(`add_collaborator` 개발자만), 승격 표, 모든 학생 — 표마다 줄 고르기·전체 선택(`peoplePick` `bulkBar` `pickCell`, 한꺼번에 승격 `promoteMany`·삭제·빼기·자격 해제) | `drawProfile` `paintProfile` `drawPeople` `addCollaborator` | manage, promote |
| `teacher-etc.js` | 「기타 관리」 사용량 원(초기화 단위 순서·꼬리표 색 `periodGroup`, 빈 곳 누르면 선택 해제, 누르면 자세히 `usageDetail`, 평균 몫(남은 양 ÷ 초기화까지 남은 시간 올림, 달 1일당·하루 1시간당)·예상 `usageStat`, 맨 위 「소진 주의」 요약, 로컬 기록 cra-usage-hist), 캐시 전송량 막대(자세히 안, 오늘 = 매시 집계 + Worker `egressTail`), Supabase 아래 표(`egressView` 전송량·날마다·누가·종류별, 서비스 상태, 7일 요청 수, 표별 크기), 동기화(`lastSync()`)/비용, `kstIso` | `drawEtc` `syncUsage` `usageRings` `supabaseView` `egressView` `cloudflareView` `githubView` `syncCostView` | etc |
| `teacher-bugs.js` | 「기타 관리」 아래 「버그 제보」(`bug_reports`, 1인 5개) | `drawBugs` `paintBugs` | etc |
| `teacher-patch.js` | 「패치 노트」 탭(개발자만, 기타 관리 옆): 맨 위 시기별 타임라인(`PATCH_ERAS`, 폭에 맞춰 줄을 꺾어 이음, 가로 스크롤 없음) + 날짜별 상자. 기록은 `patch-notes.js` 의 `PATCH_NOTES`(PR 합칠 때 맨 위에 한 줄, 시기가 바뀌면 `PATCH_ERAS` 끝 줄도) | `drawPatch` `patchTimeline` | etc |
| `teacher-run.js` | 「수업 진행」 슬라이드·제출 현황·Presence, 「수업 시작하기」 50분/「시간 연장하기」(30분 밑, TURN 새로) — 이때만 TURN·화면 보기, 아래 줄 오른쪽 끝의 「수업용 화면 띄우기」 창(`openPresent`)·「동기화」(`presentResync`, 가운데 알림 `centerNote`; 무대 그리기 `paintStage` 공유, 시뮬레이션은 교사 화면 것을 비춤 `presentMirrorSync`: SIM_AGENT 장면·캔버스 WebRTC → 비추개 `.sim-mirror`) | `classOn` `startClass` `extendClass` `endClass` `drawRun` `setPage` `drawRoster` `drawJoin` `deskTag` | class, teacher |
| `teacher-build.js` | 「자료 추가」 활동 목록(옮기기·끌기, `syncRows`, 「슬라이드와 함께 보기」 `layoutBySlide` cra-build-slides: 카드 절반 크기, 얹은 시뮬레이션은 작은 슬라이드 위에, 카드의 재생 버튼을 따름 `paused`), 시뮬레이션 편집기, 작성기(`composeEditor`), 저장 상태(`editBase`) | `drawBuild` `editor` `toCompose` | sim-over |
| `teacher-students.js` | 「학생 관리」 승격 표(`promotedCard`, `promote_student` `demote_student`, 개발자만), 학생 표, 화면 크게 보기(교사 전용 채널 `:t`; PC 화면 전체 WebRTC, 휴대폰은 화면 복사 + 시뮬레이션 WebRTC), 일괄 미리보기 | `drawStudents` `promoteStudent` `watchStudentScreen` `startGrid` `simRtc` `deskAnswer` | promote, live-* |
| `teacher-settings.js` | 「슬라이드 편집」, 올리기(PPTX/PDF→JPG 1280/1024), 저장소(R2 `r2Call`/Supabase), CSV | `drawSettings` `uploadSlides` `slideHome` `downloadCSV` | manage |
| `student.js` | 입장(수업 코드(?c= > `default_lesson_code` > 마지막 코드) + 학번(번호) + 이름, `student_join_no` RPC: 같은 학번+이름이면 같은 학생, 이 수업에 이름만으로 왔던 학생은 학번을 채움), `poll`(`student_state` RPC, `nudge`→`pollSoon`), 카드, 화면 보기 동의·전송(`startMirror` `sendScreenData`), PC 전체 화면 공유(`startDesk`→`offerDesk`, 공유 중엔 화면 복사 안 보냄), 공유 전 가림막 `renderDeskGate`, Presence `desk`·`multi` | `start` `render` `cardFor` `buildForm` | live-* |
| `app.css` | 모든 모양 | | |
| `setup.sql` | 표·보안 규칙(`can_lesson` `owns_lesson`: 주인·공동 작업자·개발자)·RPC(`student_join_no`(예전 `student_join` 은 옛 화면용으로 남김) `student_state` `resource_usage` `my_profile`, `add_collaborator` 개발자만, 재설정 초기화 `admin_reset_quota`, 새 수업 개발자 공동 작업 `lessons_admin_collab`, 교사 빠지면 수업 이전 `teachers_hand_over`), `bug_reports`, 인증 메일 기록 `mail_log`(→ resource_usage `mail_day`), 승격 학생 가입 요청 `teacher_requests`(승격 이메일 비우면 `pending-…@promoted.invalid`, `isPendingEmail`). `supabase-sql.ps1` 로 적용 | | |

저장소 밖: Worker `class-tools\cf-worker\src\index.js`(TURN·/usage·/s/ R2), 시험 `class-tools\e2e\`(지도 `class-tools\CLAUDE.md`), 슬라이드 올리기 `class-tools\class-publish.ps1`, 기능 내력 `class-tools\docs\product-history.md`.

## 규칙
- 버튼: 모든 버튼은 호버 시 시각 피드백, 눌러 선택할 때 시각 피드백을 주고, 눌러 활성화해도 크기·자리가 변하지 않는다(글자 굵기·테두리 두께·`transform` 이동 금지, 글자가 바뀌면 너비 고정, 숨길 땐 `visibility`). 바닥 피드백은 `app.css` `button:hover`·`button:active`.
- 매 요청마다 나중에 최적화·코드 분리·보안 강화가 쉽게 짠다: 한 가지 일은 한 함수로(화면 그리기와 서버 요청을 섞지 않기), 둘 이상이 쓰는 것은 `common.js` 도우미로, 저장소 키·RPC 이름은 한 곳에 상수로, 로그인 정보는 `loginStore` 로만 다룬다.
- JS/CSS를 바꾸면 `node C:\Users\neptu\class-tools\bump-version.js <이름> [작업트리]` (모든 `?v=` 변경).
- 학생 표는 열 단위 권한: 교사도 `token`·`pin_hash` 를 못 읽는다(`select` 에 넣지 말 것). 수업 주인(`owner`)은 개발자만 바꾼다.
- 기타 관리(`teacher-etc.js`)는 패치마다 깨지기 쉬움: 원·표를 지우지 말고 옮기기만, 고친 뒤 `etc` 시나리오(원 개수·자세히·표 위치) 꼭 통과. 묶음마다 try/catch(`paintEtc` 의 `section`)로 한 곳 실패가 탭 전체를 지우지 않게.
- 기타 관리(`teacher-etc.js` `teacher-etc.css`)는 최적화 끝남(2026-10-30): 전체 최적화·코드 제거 요청에서도 기타 관리를 직접 언급하지 않으면 손대지 않는다.
- 패치 노트: PR마다 `patch-notes.js` 맨 위에 [번호, 날, 글, 성격] 한 줄 + 그날 `PATCH_DAYS` 요약 고치기.
- 새 교사 탭 파일은 `teacher.html` 불러오기 순서·이 표·`teacher.js` 머리 주석에 함께 적는다.
