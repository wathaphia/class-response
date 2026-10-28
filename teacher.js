// 교사 화면(버전 2): 로그인 → 수업 고르기 → [수업 진행] [자료 추가] [학생 관리] · 설정▾[수업 설정 · 전체 수업 · 기타 관리]
// 수업 진행·학생 관리 탭은 3초마다 응답을 다시 읽어 온다.
//
// 교사 화면 스크립트는 탭별로 나뉘어 teacher.html 이 이 순서로 불러온다(모두 같은 전역 공간을 쓴다):
//   teacher.js          공유 상태 · 시작 · 로그인 · 데이터 읽기/쓰기 · 탭 틀(이 파일)
//   teacher-library.js  전체 수업 · 슬라이드 PDF
//   teacher-etc.js      기타 관리(사용량)
//   teacher-run.js      수업 진행 · 실시간 접속 표시
//   teacher-build.js    자료 추가 · 설명 및 질문 작성기
//   teacher-students.js 학생 관리 · 학생 화면 보기 · 일괄 미리보기
//   teacher-settings.js 수업 설정 · 슬라이드 저장소 · CSV
// 다른 파일의 함수를 쓰므로 시작(init)은 모든 파일을 불러온 뒤(DOMContentLoaded)에 한다.

const app = document.getElementById("app");
const POLL_MS = 3000;

let lessons = [];
let lesson = null;        // 지금 고른 수업(없으면 새 수업 만들기)
let activities = [];
let students = [];
let responses = [];
let tab = localStorage.getItem("cra-tab") || "run";
let timer = null;
let editing = null;       // 만들기 탭에서 고치는 중인 활동(사본)
let main = null;
let me = null;            // 로그인한 교사(auth user)
let passwordRecovery = false;
let screenChannel = null;
let screenChannelKey = "";
let screenChannelReady = null;
let screenDataCh = null;   // 학생이 보내는 화면 내용·신호를 받는 교사 전용 채널(:t)
const screenWatchers = new Map();

addEventListener("DOMContentLoaded", () => {
  if (!sb) return notConfigured(app);
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      passwordRecovery = true;
      showPasswordRecovery();
    }
  });
  // 눌러서 펼친 설정 메뉴는 바깥을 누르면 접는다
  document.addEventListener("click", (e) => {
    const m = app.querySelector(".set-menu.open");
    if (m && !m.contains(e.target)) m.classList.remove("open");
  });
  init();
});

// ---------- 로그인 ----------
async function init() {
  const { data } = await sb.auth.getSession();
  if (passwordRecovery) return showPasswordRecovery();
  if (!data.session) return showLogin();
  me = data.session.user;
  const { data: ok, error } = await sb.rpc("is_teacher");
  if (error || !ok) {
    return app.replaceChildren(h("main", { class: "narrow" }, h("section", { class: "card stack" },
      h("h1", {}, "교사로 등록되지 않은 계정입니다"),
      h("p", {}, (me.email || "") + " 이메일이 teachers 표에 없습니다. setup.sql 맨 아래에 이 이메일을 넣고 다시 실행하세요."),
      error ? h("p", { class: "error" }, error.message) : null,
      h("button", { class: "ghost", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃"))));
  }
  await loadLessons(localStorage.getItem("cra-lesson"));
  document.addEventListener("keydown", (e) => {
    if (tab !== "run" || !lesson || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowRight") setPage(lesson.page + 1);
    if (e.key === "ArrowLeft") setPage(lesson.page - 1);
  });
}

function showLogin() {
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
  const msg = h("p", { class: "msg" });
  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" }, h("p", { class: "eyebrow" }, "교사용"), h("h1", {}, "로그인")),
    h("form", {
      class: "card stack",
      async onsubmit(e) {
        e.preventDefault();
        msg.textContent = "로그인 중…";
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
        if (error) msg.textContent = "로그인하지 못했습니다: " + error.message;
        else init();
      },
    }, h("label", {}, "이메일", email), h("label", {}, "비밀번호", pw),
      h("button", { class: "primary big", type: "submit" }, "로그인"), msg),
    h("button", {
      class: "link",
      type: "button",
      async onclick() {
        const address = email.value.trim();
        if (!address) {
          msg.textContent = "먼저 이메일을 입력해 주세요.";
          email.focus();
          return;
        }
        msg.textContent = "재설정 메일을 보내는 중…";
        const redirectTo = new URL(location.pathname, location.origin).href;
        const { error } = await sb.auth.resetPasswordForEmail(address, { redirectTo });
        msg.textContent = error
          ? "재설정 메일을 보내지 못했습니다: " + error.message
          : "메일함에서 비밀번호 재설정 링크를 확인해 주세요.";
      },
    }, "비밀번호 재설정 메일 보내기"),
    h("p", { class: "muted small center" }, "교사 계정은 Supabase 대시보드 → Authentication → Users 에서 만듭니다.")));
}

function showPasswordRecovery() {
  const password = h("input", { type: "password", autocomplete: "new-password", required: true });
  const confirm = h("input", { type: "password", autocomplete: "new-password", required: true });
  const msg = h("p", { class: "msg" });
  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" }, h("p", { class: "eyebrow" }, "교사용"), h("h1", {}, "새 비밀번호 설정")),
    h("form", {
      class: "card stack",
      async onsubmit(e) {
        e.preventDefault();
        if (password.value !== confirm.value) {
          msg.textContent = "비밀번호가 서로 다릅니다.";
          return;
        }
        msg.textContent = "비밀번호를 저장하는 중…";
        const { error } = await sb.auth.updateUser({ password: password.value });
        if (error) {
          msg.textContent = "비밀번호를 저장하지 못했습니다: " + error.message;
          return;
        }
        passwordRecovery = false;
        await sb.auth.signOut();
        app.replaceChildren(h("main", { class: "narrow" },
          h("section", { class: "card stack" },
            h("h1", {}, "비밀번호를 변경했습니다."),
            h("p", {}, "새 비밀번호로 다시 로그인해 주세요."),
            h("button", { class: "primary big", type: "button", onclick: showLogin }, "로그인으로 이동"))));
      },
    }, h("label", {}, "새 비밀번호", password), h("label", {}, "새 비밀번호 확인", confirm),
      h("button", { class: "primary big", type: "submit" }, "비밀번호 저장"), msg)));
}

// ---------- 데이터 ----------
async function loadLessons(selectId) {
  const { data, error } = await sb.from("lessons").select("*").order("created_at");
  if (error) return fatal(error);
  lessons = data;
  lesson = lessons.find((l) => l.id === selectId) || lessons[0] || null;
  if (!lesson) tab = "settings";
  await loadLesson();
}

async function loadLesson() {
  selectedSlides.clear();
  activities = [];
  students = [];
  responses = [];
  editing = null;
  if (lesson) {
    localStorage.setItem("cra-lesson", lesson.id);
    const { data, error } = await sb.from("activities").select("*").eq("lesson_id", lesson.id);
    if (error) return fatal(error);
    activities = sortActivities(data);
    await loadResponses();
    ensureTeacherScreenChannel().catch(() => {});   // 실시간 접속 표시를 위해 수업 채널에 미리 붙는다
  }
  draw();
}

// 쪽 오름차순(같은 쪽이면 끝 쪽이 앞선 것 → 만든 순서), 「언제든」은 맨 뒤
function sortActivities(list) {
  const pg = (v) => (v == null || v === "" ? 1e9 : Number(v));
  return list.slice().sort((x, y) => pg(x.page) - pg(y.page) || pg(x.page_to ?? x.page) - pg(y.page_to ?? y.page) ||
    (x.sort ?? 0) - (y.sort ?? 0) || String(x.created_at || "").localeCompare(String(y.created_at || "")));
}

// 응답은 처음과 1분마다 전체를, 그 사이 3초마다는 바뀐 것(updated_at)만 받는다.
// 응답이 많은 수업에서 3초마다 전체를 받으면 Supabase 전송량을 크게 쓴다. 10초를 겹쳐 받아 늦게 저장된 것도 놓치지 않는다.
let respSince = null;
let respTick = 0;
async function loadResponses(changedOnly = false) {
  if (!lesson) return;
  // 이 수업에 들어온 학생(학생 계정은 웹앱 전체에 하나, 수업마다 참여 기록이 따로 있다)
  const st = await sb.rpc("teacher_students", { p_lesson: lesson.id });
  if (st.error) return fatal(st.error);
  students = (st.data || []).sort((x, y) => x.class_no.localeCompare(y.class_no, "ko", { numeric: true }) || x.name.localeCompare(y.name, "ko"));
  const ids = activities.map((a) => a.id);
  if (!ids.length) { responses = []; respSince = null; return; }
  const part = changedOnly && respSince && ++respTick % 20 !== 0;
  let q = sb.from("responses").select("*").in("activity_id", ids);
  if (part) q = q.gte("updated_at", respSince);
  const rs = await q;
  if (rs.error) return fatal(rs.error);
  if (part) {
    const key = (r) => r.student_id + ":" + r.activity_id;
    const got = new Map(rs.data.map((r) => [key(r), r]));
    const keep = new Set(ids);
    responses = responses.filter((r) => !got.has(key(r)) && keep.has(r.activity_id)).concat(rs.data);
  } else {
    responses = rs.data;
    respTick = 0;
  }
  const last = Math.max(0, ...responses.map((r) => Date.parse(r.updated_at) || 0));
  respSince = last ? new Date(last - 10000).toISOString() : null;
}

// 교사가 수업 내용을 바꾸면 학생 화면에 바로 새로 받으라고 알린다(여러 번 바꿔도 0.3초에 한 번)
let nudgeTimer = null;
onDataWrite = () => {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { if (screenChannel) screenChannel.send({ type: "broadcast", event: "nudge", payload: {} }).catch(() => {}); }, 300);
};

function schedule() {
  clearTimeout(timer);
  if (!lesson || (tab !== "run" && tab !== "students")) return;
  timer = setTimeout(async () => {
    await loadResponses(true);
    if (tab === "run") refreshRun();
    if (tab === "students") drawStudents();
    schedule();
  }, POLL_MS);
}

function fatal(error) {
  console.error(error);
  const box = h("p", { class: "banner bad" }, "서버 오류: " + (error.message || error) + " · 새로고침해 보세요.");
  (main || app).prepend(box);
}

async function save(table, row, id) {
  const q = id ? sb.from(table).update(row).eq("id", id) : sb.from(table).insert(row);
  const { data, error } = await q.select();
  if (error) {
    alert("저장하지 못했습니다: " + error.message +
      (/page_to/.test(error.message) ? " · 여러 쪽에 걸친 질문을 쓰려면 Supabase SQL Editor에서 setup.sql을 한 번 실행하세요. 끝 쪽 칸을 비우면 지금도 저장됩니다." : ""));
    return null;
  }
  return data[0];
}

const nameOf = (s) => s.class_no + " " + s.name;
const studentById = (id) => students.find((s) => s.id === id);
const docsOf = (a) => responses.filter((r) => r.activity_id === a.id && studentById(r.student_id))
  .map((r) => ({ name: nameOf(studentById(r.student_id)), answers: r.answers, r }));
const whereText = (a) => a.page == null ? "언제든" : a.page_to > a.page ? a.page + "~" + a.page_to + "쪽" : a.page + "쪽";

// ---------- 틀 ----------
// 탭 기호(선 그림): 수업 진행 ▶ · 자료 추가 ＋ · 학생 관리 사람들 · 수업 설정 조절기 · 전체 수업 폴더 · 기타 관리 계기판 · 설정 톱니
const TAB_ICONS = {
  run: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  build: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  students: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  manage: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  etc: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5l4-4"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
function tabIcon(k) {
  const el = h("span", { class: "tab-icon", "aria-hidden": "true" });
  el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + TAB_ICONS[k] + "</svg>";
  return el;
}
function draw() {
  clearTimeout(timer);
  // 왼쪽 위: 수업 코드(바꿀 수 없음) · 제목(바로 고쳐 쓰고 Enter 또는 칸을 벗어나면 저장) · 다른 수업으로 옮기기/새 수업 · 학생 접속 QR
  const pick = h("select", {
    "aria-label": "수업 고르기", title: "다른 수업으로 옮기거나 새 수업을 만듭니다",
    async onchange() {
      if (!pick.value) return;
      if (pick.value === "new") { lesson = null; tab = "settings"; }
      else lesson = lessons.find((l) => l.id === pick.value);
      await loadLesson();
    },
  }, h("option", { value: "", selected: true, hidden: true }, "수업 이동 · 추가"),
    lessons.map((l) => h("option", { value: l.id }, (lesson && l.id === lesson.id ? "✓ " : "") + (l.kind === "survey" ? "[설문] " : "") + l.title + " (" + l.code + ")")),
    h("option", { value: "new" }, "+ 새 수업 만들기"));
  const titleBox = h("input", {
    type: "text", class: "lesson-title", maxlength: 100, "aria-label": "수업 제목", disabled: !lesson,
    value: lesson ? lesson.title : "", placeholder: lesson ? "수업 제목" : "새 수업 (수업 설정에서 만듭니다)",
    onkeydown(e) { if (e.key === "Enter") titleBox.blur(); else if (e.key === "Escape") { titleBox.value = lesson.title; titleBox.blur(); } },
    async onchange() {
      const t = titleBox.value.trim();
      if (!t || t === lesson.title) { titleBox.value = lesson.title; return; }
      const saved = await save("lessons", { title: t }, lesson.id);
      if (!saved) { titleBox.value = lesson.title; return; }
      lesson.title = saved.title;
      const same = lessons.find((l) => l.id === lesson.id);
      if (same) same.title = saved.title;
      flash("제목을 저장했습니다.");
    },
  });
  const lessonBox = h("div", { class: "lesson-box" },
    h("span", { class: "lesson-code", title: "수업 코드(바꿀 수 없음)" }, lesson ? lesson.code : "새 수업"), titleBox, pick);
  const tabs = [["run", "수업 진행"], ["build", "자료 추가"], ["students", "학생 관리"]];
  // 설정 단추에 마우스를 올리면(누르거나 키보드로 들어가도) 아래로 펼쳐지는 세 탭
  const setTabs = [["settings", "수업 설정"], ["manage", "전체 수업"], ["etc", "기타 관리"]];
  if (![...tabs, ...setTabs].some(([k]) => k === tab)) tab = "run";
  const go = (k) => { tab = k; localStorage.setItem("cra-tab", k); draw(); };
  const menu = h("div", { class: "set-menu" },
    h("button", {
      type: "button", class: setTabs.some(([k]) => k === tab) ? "tab set-btn on" : "tab set-btn", "aria-haspopup": "menu",
      onclick() { menu.classList.toggle("open"); },
    }, tabIcon("gear"), h("span", {}, "설정"), h("span", { class: "set-caret", "aria-hidden": "true" })),
    h("div", { class: "set-drop", role: "menu" }, setTabs.map(([k, label]) => h("button", {
      type: "button", role: "menuitem", class: tab === k ? "set-item on" : "set-item",
      onclick() {
        go(k);
        // 고른 뒤에는 마우스가 아직 위에 있어도 접어 두고, 메뉴를 벗어나거나 설정 단추에 다시 올리면 펼칠 수 있다.
        // (클릭 직후 커서는 숨은 메뉴 자리에 있어 메뉴 「안」으로 치지 않으므로 mouseleave만으로는 풀리지 않는다)
        const m = app.querySelector(".set-menu");
        const open = () => m.classList.remove("shut");
        m.classList.add("shut");
        m.addEventListener("mouseleave", open, { once: true });
        m.querySelector(".set-btn").addEventListener("mouseenter", open, { once: true });
      },
    }, tabIcon(k), h("span", {}, label)))));
  main = h("main", { class: "wide" });
  app.replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "top-title" }, h("span", { class: "eyebrow" }, "교사용"), lessonBox,
        lesson ? h("button", { class: "ghost qr-btn", type: "button", title: "학생 접속 주소·QR 크게 보기", onclick: showJoin }, "접속 QR") : null),
      h("nav", { class: "tabs" }, tabs.map(([k, label]) => h("button", {
        type: "button", class: tab === k ? "tab on" : "tab", disabled: !lesson,
        onclick() { go(k); },
      }, tabIcon(k), h("span", {}, label)))),
      h("div", { class: "top-actions" }, menu,
        h("button", { class: "link", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃"))),
    main);
  if (!lesson && tab !== "manage" && tab !== "etc") tab = "settings";
  if (grid && (tab !== "students" || !lesson || lesson.code !== grid.code)) stopGrid();
  ({ run: drawRun, build: drawBuild, students: drawStudents, settings: drawSettings, manage: drawManage, etc: drawEtc })[tab]();
  schedule();
}
