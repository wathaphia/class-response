# 코드 지도 (Claude용)

정적 사이트(GitHub Pages, 빌드 없음). 스크립트는 `<script>` 로 차례대로 불러오며 모두 한 전역 공간을 쓴다(모듈 아님).
같은 이름의 최상위 `const`/`let` 을 두 파일에 두면 SyntaxError가 나니 새 이름을 만들 때 `grep` 으로 먼저 확인한다.

## 작업 요령 (토큰 절약)
- 파일 전체를 읽지 말고 `grep -n "function 이름\|이름 ="` 로 위치를 찾은 뒤 그 근처만 `offset/limit` 으로 읽는다.
- 탭 하나를 고칠 때는 아래 표의 그 탭 파일만 본다. 공유 상태·틀은 `teacher.js`, 그리기 도우미(`h`, 슬라이드, 시뮬레이션)는 `common.js`.
- 브라우저 시험은 바꾼 곳에 맞는 시나리오만 돌린다(아래 표).

## 무료 한도 아끼기 (시험·확인할 때)
- **가벼운 시나리오부터**: `class`(수업 시작·연장·끝만), `promote`(승격·공동 작업자 목록) → 통과하면 바꾼 파일에 해당하는 큰 시나리오만. 모든 시나리오는 `common.js`·`student.js`·`teacher.js` 데이터 부분을 바꿨을 때만.
- **live-relay·live-iphone 은 그 경로를 바꿨을 때만**. 시험은 TURN 발급을 가짜(STUN만)로 대신하고 `live-relay` 만 진짜로 받는다(끝에 「TURN 발급: 가짜 n번 · 진짜 n번」).
- **시험 학생은 교사 권한으로 바로 만들고 지운다**(학생 화면을 띄우지 않음). 승격 시험 이메일은 `.invalid` 라 메일·계정이 생기지 않는다(Supabase 무료 메일 한도 보호).
- **SQL은 바꾼 부분만** `supabase-sql.ps1 -File` 로 적용한다(setup.sql 전체를 다시 돌리지 않음). 바꾸기 전 함수 정의를 `class-tools\backup` 에 남긴다.
- 실패하면 그 시나리오만 다시 돌리고, FPS 같은 흔들리는 값은 한 번 더 돌려 본 뒤 판단한다.
- 로그가 필요하면 `CLASS_DEBUG=1` (평소에는 무해한 broadcast 끊김을 개수로만 적는다).

## 파일
| 파일 | 내용 | 주요 함수 | e2e 시나리오 |
|---|---|---|---|
| `config.js` | Supabase 주소·키, TURN Worker 주소 | | |
| `common.js` | 교사·학생 공용: `h()` DOM 도우미, 데이터 쓰기 감시(`watchedFetch`→`onDataWrite`), 슬라이드 단계·주소(`slideSrc`), WebRTC/TURN(`iceServers`, `relayFirst`), 시뮬레이션 재생·얹기·전체 화면(`withSimPause`, `renderSimLayer`, `openSimFull`), 답 요약 | `reloadIfStale`(맨 위) | 모두 |
| `teacher.js` | 공유 상태(`lessons` `lesson` `activities` `students` `responses` `tab` `editing` `me`), 시작(DOMContentLoaded→`init`), 로그인, 데이터 읽기/저장(`loadLesson` `loadResponses` `save`), 탭 틀 `draw`(위쪽 탭 3개 + 「설정」 펼침 메뉴: 슬라이드 편집·기타 관리 + 맨 오른쪽 「프로필」) | | teacher |
| `teacher-library.js` | 「전체 수업」(프로필 화면 오른쪽 2/3, `.manage-pane`) 폴더·카드·불러오기, 「+ 수업 추가」, 슬라이드 PDF. 남의 수업은 「공유받은 수업」 묶음 | `drawManage` `exportSlidesPdf` | manage |
| `teacher-profile.js` | 「프로필」(오른쪽 위 단추): 내 정보·교사 ID(6자리)·로그아웃·비밀번호 재설정, 공동 작업자(`add_collaborator`, `my_profile` 의 `colleagues`: 「선생님 추가」로 넣은 선생님·승격된 학생 중에서 고름), 개발자(`teachers.is_admin`)의 선생님 관리 | `drawProfile` `paintProfile` `addCollaborator` | manage, promote |
| `teacher-etc.js` | 「기타 관리」 사용량 원 그래프(Supabase 아래는 날마다 캐시 전송량 막대만, 오늘 막대 = 매시 집계 + Worker `egressTail`), 동기화(모든 받는 곳 한꺼번에, 숫자는 `lastSync()` 기준)/비용, 한국 시간(`kstIso`) | `drawEtc` `syncUsage` `supabaseView` `cloudflareView` `syncCostView` | etc |
| `teacher-run.js` | 「수업 진행」 슬라이드·제출 현황·접속 표시(Presence), 「수업 시작하기」(50분, 남은 시간 30분 밑이면 「시간 연장하기」 +50분·TURN 새로 한 장. 이때만 TURN 발급·학생 화면 보기: `classOn` `startClass` `extendClass` `endClass`) | `drawRun` `setPage` `drawRoster` `showJoin` | class, teacher |
| `teacher-build.js` | 「자료 추가」 활동 목록(쪽 옮기기·끌기, 칸 재사용 `syncRows`), 시뮬레이션 편집기, 설명·질문 작성기(`composeEditor`), 저장 버튼 상태(`editBase`) | `drawBuild` `editor` `toCompose` | sim-over |
| `teacher-students.js` | 「학생 관리」 위쪽 승격된 학생 표(`promotedCard`, 승격·해제는 개발자만: `promote_student` `demote_student`), 학생 표(이름 밑 「승격」), 학생 화면 크게 보기(교사 전용 채널 `:t`, PC는 화면 전체 WebRTC 영상 `deskAnswer`, 휴대폰·태블릿은 수업 화면 복사 + 시뮬레이션 WebRTC), 일괄 미리보기 그리드 | `drawStudents` `promoteStudent` `watchStudentScreen` `startGrid` `simRtc` `deskAnswer` | promote, live-android, live-iphone, live-relay, live-desk |
| `teacher-settings.js` | 「슬라이드 편집」, 슬라이드 올리기(PPTX/PDF→JPG 1280/1024), 저장소(R2 `r2Call` / Supabase), CSV | `drawSettings` `uploadSlides` `slideHome` `downloadCSV` | manage |
| `student.js` | 학생: 입장, 상태 받기(`poll`, `student_state` RPC, `nudge`→`pollSoon`), 화면·활동 카드, 화면 보기 동의·전송(`startMirror` `sendScreenData`), PC 전체 화면 공유(`startDesk` 「전체 화면」만 받음 → 교사가 볼 때마다 `offerDesk`, 영상이 가는 동안 수업 화면 복사는 안 보냄), 동의한 PC 학생은 공유 전까지 수업을 가리는 막(`renderDeskGate`), 접속 표시(Presence)에 공유 상태 `desk`·모니터 여러 대 `multi` → 교사 `deskTag`(teacher-run.js) | `start` `render` `cardFor` `buildForm` | live-* |
| `app.css` | 모든 모양 | | |
| `setup.sql` | 표·보안 규칙(수업은 주인·공동 작업자·개발자만: `can_lesson` `owns_lesson`)·RPC(`student_state`, `resource_usage`, `my_profile`). Supabase에 직접 적용(`class-tools\supabase-sql.ps1`) | | |

저장소 밖: Worker(TURN·/usage·/s/ R2) `C:\Users\neptu\class-tools\cf-worker\src\index.js`, 시험 `class-tools\e2e\run.js`, 슬라이드 올리기 `class-tools\class-publish.ps1`.

## 규칙
- JS/CSS를 바꾸면 `node C:\Users\neptu\class-tools\bump-version.js <이름>` (teacher-*.js 포함 모든 `?v=` 변경).
- 새 교사 탭 파일을 만들면 `teacher.html` 의 불러오기 순서와 이 표, `teacher.js` 머리 주석에 함께 적는다.
