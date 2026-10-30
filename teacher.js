// 교사 화면(버전 2): 로그인(로그인 · 가입하기) → 수업 고르기 → 위 줄 탭 [접속 QR] [수업 진행] [학생 관리] [자료 추가] [슬라이드 편집] [버그 제보] (「수업용 화면 띄우기」 창은 「수업 진행」 아래 줄)
// 오른쪽 위 「수업 모드/편집 모드」 스위치(지금 모드 이름만)로 모드를 바꾸면 그 모드에 보이게 정한 탭만 나온다(SHOW_DEFAULT, 탭 꾸미기에서 바꿈).
// 「설정」 단추를 누르면 아래 줄 탭 [프로필] [전체 수업] (+ 개발자만 [전체 선생님 및 학생] [기타 관리] [패치 노트]).
// 탭 이름·순서·두 줄 자리·모드별 보이기는 프로필의 「탭 꾸미기」(startTabEdit: 탭 이름 바로 고치기, 끌어 옮기기)에서 바꾸고 교사 계정(user_metadata.tabs)에 저장한다.
// 수업 진행·학생 관리 탭은 3초마다 응답을 다시 읽어 온다.
//
// 교사 화면 스크립트는 탭별로 나뉘어 teacher.html 이 이 순서로 불러온다(모두 같은 전역 공간을 쓴다):
//   teacher.js          공유 상태 · 시작 · 로그인 · 데이터 읽기/쓰기 · 탭 틀(이 파일)
//   teacher-library.js  전체 수업(수업 삭제 포함) · 슬라이드 PDF
//   teacher-profile.js  프로필 · 전체 수업 틀 · (개발자) 전체 선생님 및 학생(선생님 관리 · 공동 작업자 · 모든 학생)
//   teacher-etc.js      기타 관리(사용량)
//   teacher-patch.js    패치 노트(시기별 타임라인 · 날짜별 상자, 기록은 patch-notes.js)
//   teacher-bugs.js     버그 제보
//   teacher-run.js      수업 진행 · 실시간 접속 표시
//   teacher-build.js    자료 추가 · 설명 및 질문 작성기
//   teacher-students.js 학생 관리 · 학생 화면 보기 · 일괄 미리보기
//   teacher-settings.js 슬라이드 편집 · 슬라이드 저장소 · CSV
// 다른 파일의 함수를 쓰므로 시작(init)은 모든 파일을 불러온 뒤(DOMContentLoaded)에 한다.

const app = document.getElementById("app");
const POLL_MS = 3000;

let lessons = [];
let lesson = null;        // 지금 고른 수업(없으면 새 수업 만들기)
let activities = [];
let students = [];
let responses = [];
let editMode = localStorage.getItem("cra-edit") === "1";   // 수업 모드 / 편집 모드: 탭마다 어느 모드에서 보일지는 「탭 꾸미기」에서 정한다
// 탭 두 줄: 위 줄(main) + 「설정」을 누르면 나오는 아래 줄(sub). 개발자 전용 탭(ADMIN_TABS)은 다른 선생님에게는 아예 없다.
// 탭 꾸미기: { main: [키…], sub: [키…], names: { 키: 이름 }, show: { 키: { class, edit } } }. 교사 계정(user_metadata.tabs)에 저장한다
const TAB_DEFAULTS = [["join", "접속 QR"], ["run", "수업 진행"], ["students", "학생 관리"], ["build", "자료 추가"], ["settings", "슬라이드 편집"], ["bugs", "버그 제보"],
  ["profile", "프로필"], ["library", "전체 수업"], ["people", "전체 선생님 및 학생"], ["etc", "기타 관리"], ["patch", "패치 노트"]];
const MAIN_TABS = ["join", "run", "students", "build", "settings", "bugs"];
const SUB_TABS = ["profile", "library", "people", "etc", "patch"];
const ADMIN_TABS = ["people", "etc", "patch"];
const SHOW_DEFAULT = { join: { class: true, edit: false }, build: { class: false, edit: true }, settings: { class: false, edit: true }, bugs: { class: false, edit: true } };
const NO_LESSON_TABS = ["settings", "bugs", "profile", "library", "people", "etc", "patch"];   // 수업을 고르지 않아도 열리는 탭
let tabCustom = {};
const isAdmin = () => !!(profile && profile.admin);
const tabName = (k, c = tabCustom) => (c.names && c.names[k]) || (TAB_DEFAULTS.find(([x]) => x === k) || [, k])[1];
const tabShown = (k, mode, c = tabCustom) => { const s = (c.show && c.show[k]) || SHOW_DEFAULT[k] || {}; return s[mode] !== false; };
// 저장된 순서를 지금 쓸 수 있는 탭으로 맞춘다(없는 탭은 원래 줄 끝에, 프로필은 늘 아래 줄)
function tabLayout(c = tabCustom) {
  const ok = (k) => TAB_DEFAULTS.some(([x]) => x === k) && (isAdmin() || !ADMIN_TABS.includes(k));
  const main = (c.main || MAIN_TABS).filter((k) => ok(k) && k !== "profile");
  const sub = (c.sub || SUB_TABS).filter((k) => ok(k) && !main.includes(k));
  if (!sub.includes("profile")) sub.unshift("profile");
  for (const k of MAIN_TABS) if (ok(k) && !main.includes(k) && !sub.includes(k)) main.push(k);
  for (const k of SUB_TABS) if (ok(k) && !main.includes(k) && !sub.includes(k)) sub.push(k);
  return { main, sub };
}
function loadTabCustom() {
  let c = me && me.user_metadata && me.user_metadata.tabs;
  if (!c) {   // 예전에 이 브라우저에만 저장한 이름은 옮겨 온다
    try { const old = JSON.parse(localStorage.getItem("cra-tabs")); if (old && old.names) c = { names: old.names }; } catch {}
  }
  tabCustom = c || {};
}
async function saveTabCustom(c) {
  const { data, error } = await sb.auth.updateUser({ data: { tabs: c } });
  if (error) { alert("탭 설정을 저장하지 못했습니다: " + error.message); return false; }
  tabCustom = c;
  if (data && data.user) me = data.user;
  return true;
}
let tabEdit = null;   // 탭 꾸미기 중: { draft, base }
let tab = (localStorage.getItem("cra-tab") || "run").replace(/^manage$/, "library");
let timer = null;
let editing = null;       // 만들기 탭에서 고치는 중인 활동(사본)
let main = null;
let me = null;            // 로그인한 교사(auth user)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let passwordRecovery = false;   // 비밀번호 재설정 메일의 링크로 들어옴: 로그인된 채로 「프로필」의 새 비밀번호 칸을 연다
let booted = false;              // init 을 끝까지 마쳤는지(탭을 그릴 수 있는지)
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
      if (booted) goTab("profile");   // 아직 시작 중이면 init 끝에서 연다
    }
  });
  init();
});

// ---------- 로그인 ----------
// fresh: 방금 로그인 칸에서 들어옴. 아니면 저장된 로그인(자동 로그인·새로 고침)으로 들어온 것.
async function init(fresh) {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  me = data.session.user;
  // 저장된 로그인은 서버에 계정이 아직 있는지 확인한다(지워진 계정이면 getUser 가 실패)
  const gone = fresh || passwordRecovery ? null : (await sb.auth.getUser()).error;
  const { data: ok, error } = gone ? { data: false, error: gone } : await sb.rpc("is_teacher");
  if (error || !ok) {
    if (passwordRecovery) return showPasswordRecovery();   // 교사 화면을 못 쓰는 계정: 비밀번호만 바꾼다
    if (!fresh) return autoLoginFailed(gone ? "로그인하지 못했습니다: " + gone.message : "교사로 등록되지 않은 계정입니다");
    return app.replaceChildren(h("main", { class: "narrow" }, h("section", { class: "card stack" },
      h("h1", {}, "교사로 등록되지 않은 계정입니다"),
      h("p", {}, (me.email || "") + " 이메일이 teachers 표에 없습니다. 승격된 학생이라면 개발자가 가입 요청을 승인한 뒤 다시 로그인해 주세요."),
      error ? h("p", { class: "error" }, error.message) : null,
      h("button", { class: "ghost", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃"))));
  }
  await loadProfile();   // 개발자인지 알아야 탭 줄을 그린다
  loadTabCustom();
  await loadLessons(localStorage.getItem("cra-lesson"));
  booted = true;
  if (passwordRecovery) goTab("profile");   // 재설정 메일의 링크로 들어옴: 「프로필」의 새 비밀번호 칸으로
  document.addEventListener("keydown", (e) => {
    if (tab !== "run" || !lesson || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowRight") setPage(lesson.page + 1);
    if (e.key === "ArrowLeft") setPage(lesson.page - 1);
  });
}

// 자동 로그인할 수 없는 계정(지워짐·교사 목록에서 빠짐): 알림을 띄웠다가 사라지면 로그인 칸으로
async function autoLoginFailed(text) {
  me = null;
  app.replaceChildren();
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  centerNote(text, () => showLogin());
}

// 「로그인 | 가입하기」. 가입하기: 이메일·비밀번호 → 「이메일 인증」(확인 메일) → 메일의 링크를 누른 뒤 「가입하기」로 들어온다.
// 교사 화면은 teachers 표에 있는 이메일(선생님 추가·승격된 학생)만 쓸 수 있다.
// 비밀번호 재설정 메일: 한 사람(이메일)이 하루(한국 시간) 3번까지, 3초 간격. 서버(claim_password_reset)가 세고 쓴 횟수를 돌려준다.
const RESET_COOLDOWN = 3;
async function sendResetMail(address, btn, msgEl) {
  const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
  btn.disabled = true;
  try {
    const { data: q, error: qErr } = await sb.rpc("claim_password_reset", { p_email: address });
    if (qErr) { msgEl.textContent = "재설정 메일을 보내지 못했습니다: " + qErr.message; return; }
    // 연결된 계정이 없으면 메일을 보내지 않고 가운데 알림만(메일 한도 보호)
    if (q.reason === "no_account") { msgEl.textContent = ""; centerNote("연결된 계정이 없습니다."); return; }
    const count = "오늘 3번 중 " + q.used + "번 사용";
    if (q.reason === "limit") { msgEl.textContent = "오늘은 더 보낼 수 없습니다(" + count + "). 내일 다시 해 주세요."; return; }
    if (q.reason === "cooldown") { msgEl.textContent = "3초 뒤에 다시 눌러 주세요(" + count + ")."; return; }
    msgEl.textContent = "재설정 메일을 보내는 중…";
    const { error } = await sb.auth.resetPasswordForEmail(address, { redirectTo: new URL(location.pathname, location.origin).href });
    if (!error) { msgEl.textContent = "메일함에서 비밀번호 재설정 링크를 확인해 주세요(30분 동안 쓸 수 있습니다). · " + count; return; }
    // 메일이 안 나갔으면 받아 간 한 번을 돌려준다(안 보낸 것만 지워짐)
    const { data: back } = await sb.rpc("release_password_reset", { p_email: address });
    msgEl.textContent = "재설정 메일을 보내지 못했습니다: " + error.message + " · 오늘 3번 중 " + (back ? q.used - 1 : q.used) + "번 사용";
  } finally {
    for (let s = RESET_COOLDOWN; s > 0; s--) { btn.textContent = label + " (" + s + "초)"; await new Promise((r) => setTimeout(r, 1000)); }
    btn.textContent = label;
    btn.disabled = false;
  }
}

function showLogin(signup) {
  const here = new URL(location.pathname, location.origin).href;
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const pw = h("input", { type: "password", autocomplete: signup ? "new-password" : "current-password", minlength: signup ? 6 : null, required: true });
  const msg = h("p", { class: "msg" });
  const join = h("button", { class: "primary big", type: "submit", disabled: !!signup }, signup ? "가입하기" : "로그인");
  const remember = rememberBox("teacher");
  // 가입하기: 「학생에서 승격되었습니까?」 예 → 학번·이름을 더 받아 승격된 학생과 맞는지 보고 가입 요청을 남긴다(개발자가 승인)
  let promoted = false;
  const classNo = h("input", { type: "text", autocomplete: "off", placeholder: "예: 10203" });
  const name = h("input", { type: "text", autocomplete: "off", placeholder: "이름" });
  const studentBox = h("div", { class: "stack", hidden: true }, h("label", {}, "학번", classNo), h("label", {}, "이름", name));
  const pick = (yes) => {
    promoted = yes;
    studentBox.hidden = !yes;
    for (const b of askBtns) { const on = (b.dataset.v === "yes") === yes; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); }
    (yes ? classNo : email).focus();
  };
  const askBtns = [["yes", "예"], ["no", "아니오"]].map(([v, t]) => h("button", { type: "button", role: "radio", "data-v": v, class: v === "no" ? "on" : "", "aria-checked": String(v === "no"), onclick() { pick(v === "yes"); } }, t));
  const ask = signup ? h("div", { class: "stack promoted-ask" }, h("span", {}, "학생에서 승격되었습니까?"),
    h("div", { class: "seg", role: "radiogroup", "aria-label": "학생에서 승격되었습니까?" }, askBtns)) : null;
  const verify = signup ? h("button", {
    class: "ghost", type: "button",
    async onclick() {
      const address = email.value.trim();
      if (promoted && (!classNo.value.trim() || !name.value.trim())) { msg.textContent = "학번과 이름을 넣어 주세요."; (classNo.value.trim() ? name : classNo).focus(); return; }
      if (!address || pw.value.length < 6) { msg.textContent = "이메일과 비밀번호(6자 이상)를 넣고 다시 눌러 주세요."; (address ? pw : email).focus(); return; }
      if (!EMAIL_RE.test(address)) { centerNote("이메일 형식이 올바르지 않습니다"); email.focus(); return; }
      verify.disabled = true;
      if (promoted) {
        msg.textContent = "승격된 학생인지 확인하는 중…";
        const { data: r, error: rpcError } = await sb.rpc("request_teacher_signup", { p_class_no: classNo.value, p_name: name.value, p_email: address });
        if (rpcError || r.error) {
          verify.disabled = false;
          const why = { pending: "이미 다른 이메일로 가입 요청이 들어가 있습니다. 개발자에게 알려 주세요", no_match: "학번 또는 이름을 다시 확인해 주세요", bad_email: "이메일 형식이 올바르지 않습니다", email_taken: "그 이메일은 다른 선생님이 씁니다" };
          const text = rpcError ? "가입 요청을 보내지 못했습니다" : why[r.error] || r.error;
          centerNote(text);
          msg.textContent = rpcError ? text + ": " + rpcError.message : "";
          return;
        }
      }
      msg.textContent = "인증 메일을 보내는 중…";
      const { error } = await sb.auth.signUp({ email: address, password: pw.value, options: { emailRedirectTo: here } });
      verify.disabled = false;
      if (error) { msg.textContent = "인증 메일을 보내지 못했습니다: " + error.message; return; }
      join.disabled = false;
      if (promoted) centerNote("가입 요청을 보냈습니다");
      msg.textContent = promoted ? "메일함에서 인증 링크를 누르고, 개발자가 가입 요청을 승인하면 「가입하기」로 들어올 수 있습니다."
        : "메일함에서 인증 링크를 누른 뒤 「가입하기」를 눌러 주세요.";
    },
  }, "이메일 인증") : null;
  const resetIn = h("input", { type: "email", autocomplete: "username", placeholder: "가입한 이메일" });
  const resetMsg = h("p", { class: "msg" });
  const resetBtn = h("button", { class: "ghost", type: "submit" }, "비밀번호 재설정 이메일 보내기");
  const resetBox = h("form", {
    class: "card stack", hidden: true,
    async onsubmit(e) {
      e.preventDefault();
      const address = resetIn.value.trim();
      if (!address) { resetMsg.textContent = "이메일을 입력해 주세요."; resetIn.focus(); return; }
      resetMsg.textContent = "";
      await sendResetMail(address, resetBtn, resetMsg);
    },
  }, h("label", {}, "이메일", resetIn), resetBtn, h("p", { class: "muted small" }, "한 사람이 하루 3번까지 보낼 수 있습니다."), resetMsg);
  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" }, h("p", { class: "eyebrow" }, "교사용"), h("h1", {}, signup ? "가입하기" : "로그인")),
    h("div", { class: "seg login-seg", role: "tablist" },
      h("button", { type: "button", role: "tab", "aria-selected": String(!signup), class: signup ? "" : "on", onclick() { if (signup) showLogin(false); } }, "로그인"),
      h("button", { type: "button", role: "tab", "aria-selected": String(!!signup), class: signup ? "on" : "", onclick() { if (!signup) showLogin(true); } }, "가입하기")),
    h("form", {
      class: "card stack",
      async onsubmit(e) {
        e.preventDefault();
        msg.textContent = "로그인 중…";
        setRememberLogin("teacher", remember.querySelector("input").checked);   // 세션을 어디에 둘지 로그인 전에 정한다
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
        if (!error) return init(true);
        msg.textContent = signup && /confirm/i.test(error.message)
          ? "아직 이메일 인증을 마치지 않았습니다. 메일함의 인증 링크를 먼저 눌러 주세요."
          : (signup ? "가입하지 못했습니다: " : "로그인하지 못했습니다: ") + error.message;
      },
    }, ask, studentBox, h("label", {}, "이메일", email), h("label", {}, "비밀번호" + (signup ? " (6자 이상)" : ""), pw), verify, join, remember, msg),
    signup ? null : h("p", { class: "center" }, h("button", {
      class: "link", type: "button",
      onclick() { resetBox.hidden = !resetBox.hidden; if (!resetBox.hidden) { resetIn.value = email.value.trim(); resetIn.focus(); } },
    }, "비밀번호 재설정")),
    signup ? null : resetBox));
  email.focus();
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
  clearTimeout(timer);   // 앞 수업의 응답 새로 받기가 새 수업 값을 덮지 않게
  respSince = null;
  const L = lesson;
  if (L) {
    try { localStorage.setItem("cra-lesson", L.id); } catch {}
    const { data, error } = await sb.from("activities").select("*").eq("lesson_id", L.id);
    if (lesson !== L) return;   // 받는 사이 다른 수업을 골랐다(그쪽 loadLesson 이 그린다)
    if (error) return fatal(error);
    activities = sortActivities(data);
    await loadResponses();
    if (lesson !== L) return;
    ensureTeacherScreenChannel().catch(() => {});   // 실시간 접속 표시를 위해 수업 채널에 미리 붙는다
    armClass();
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
  const L = lesson;
  if (!L) return;
  // 이 수업에 들어온 학생(학생 계정은 웹앱 전체에 하나, 수업마다 참여 기록이 따로 있다)
  const st = await sb.rpc("teacher_students", { p_lesson: L.id });
  if (lesson !== L) return;   // 그사이 수업이 바뀌었으면 버린다
  if (st.error) return fatal(st.error);
  students = (st.data || []).sort((x, y) => x.class_no.localeCompare(y.class_no, "ko", { numeric: true }) || x.name.localeCompare(y.name, "ko"));
  const ids = activities.map((a) => a.id);
  if (!ids.length) { responses = []; respSince = null; return; }
  const part = changedOnly && respSince && ++respTick % 20 !== 0;
  let q = sb.from("responses").select("*").in("activity_id", ids);
  if (part) q = q.gte("updated_at", respSince);
  const rs = await q;
  if (lesson !== L) return;
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

const nameOf = (s) => ((s.class_no || "") + " " + s.name).trim();   // 이름만으로 들어온 학생은 학번이 비어 있다
// 승격할 때 이메일을 비워 두면 들어가는 자리표시 이메일(가입 요청을 승인하면 진짜 이메일로 바뀐다)
const isPendingEmail = (e) => /@promoted\.invalid$/.test(e || "");
const studentById = (id) => students.find((s) => s.id === id);
const docsOf = (a) => responses.filter((r) => r.activity_id === a.id && studentById(r.student_id))
  .map((r) => ({ name: nameOf(studentById(r.student_id)), answers: r.answers, r }));
const whereText = (a) => a.page == null ? "언제든" : a.page_to > a.page ? a.page + "~" + a.page_to + "쪽" : a.page + "쪽";

// ---------- 틀 ----------
// 탭 기호(선 그림): 접속 QR 네모 칸 · 수업 진행 ▶ · 자료 추가 ＋ · 학생 관리 사람들 · 슬라이드 편집 조절기 · 기타 관리 계기판 · 설정 톱니바퀴
const TAB_ICONS = {
  join: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14v1"/>',
  present: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  edit: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  run: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  build: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  students: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  bugs: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M9 4.5l1.5 2.5M15 4.5L13.5 7M3.5 13H7M17 13h3.5M4.5 8.5L7 10M19.5 8.5L17 10M4.5 18.5L7 16.5M19.5 18.5L17 16.5"/>',
  etc: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5l4-4"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
  patch: '<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M10 12.5h5.5M10 16h5.5"/>',
  profile: '<circle cx="12" cy="8.5" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  library: '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  people: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 16.5a3.5 3.5 0 0 1 7 0M14.5 10h3.5M14.5 13.5h3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
function tabIcon(k) {
  const el = h("span", { class: "tab-icon", "aria-hidden": "true" });
  el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + TAB_ICONS[k] + "</svg>";
  return el;
}

// 끌어서 순서 바꾸기(휴대폰 홈 화면처럼): 누른 채 6px 넘게 움직이면 그 칸이 마우스를 따라오고, 놓일 자리는 비워 두며
// 자리가 바뀔 칸들은 미리 그 자리로 옮겨 가볍게 들썩인다. 놓일 자리는 끄는 칸의 가운데에서 가장 가까운 칸으로 정하므로
// 칸 위에 정확히 올리지 않아도 된다. 칸은 DOM에서 옮기지 않고 translate 로만 움직인다(시뮬레이션 iframe 이 다시 불러와지지 않게).
// opts: items() 지금 보이는 순서의 칸들 · group(el) 같은 값끼리만 바꿈 · unit(el) 함께 움직이는 묶음(같은 값이 이어진 칸들)
//       onDrop(새 순서의 칸 배열, 같은 group 만) · over(ev) 정렬 대신 다른 곳에 놓을 자리(있으면 그 요소) · dropOver(자리, el)
//       scroller 끄는 동안 가장자리에서 저절로 스크롤할 칸
function dragSort(box, opts) {
  const unitOf = opts.unit || ((x) => x);
  const groupOf = opts.group || (() => "");
  box.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || down.target.closest("input, textarea, select, a, iframe, [contenteditable], .no-drag")) return;
    const all = opts.items();
    const el = all.find((x) => x.contains(down.target));
    if (!el) return;
    const list = all.filter((x) => groupOf(x) === groupOf(el));
    let st = null, last = down, raf = 0, overEl = null;
    // zoom 을 건 칸(슬라이드와 함께 보기의 절반 크기 카드)은 translate 도 그만큼 줄어드니 나눠 준다
    const zoom = new Map(list.map((x) => [x, parseFloat(getComputedStyle(x).zoom) || 1]));
    const shift = (x, dx, dy) => { x.style.translate = dx || dy ? dx / zoom.get(x) + "px " + dy / zoom.get(x) + "px" : ""; };
    const rel = (r, b) => ({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height });
    const begin = () => {
      const b = box.getBoundingClientRect();
      const slots = list.map((x) => rel(x.getBoundingClientRect(), b));
      const units = [];
      list.forEach((x, i) => { const u = unitOf(x); if (units.length && units[units.length - 1].key === u) units[units.length - 1].idx.push(i); else units.push({ key: u, idx: [i] }); });
      const s = units.findIndex((u) => u.idx.includes(list.indexOf(el)));
      const me = slots[list.indexOf(el)];
      st = { slots, units, s, order: units.map((_, i) => i), start: { x: down.clientX - b.left, y: down.clientY - b.top }, grab: { x: me.x + me.w / 2, y: me.y + me.h / 2 } };
      box.classList.add("sorting");
      list.forEach((x) => x.classList.add("sort-item"));
      units[s].idx.forEach((i) => list[i].classList.add("sort-lift"));
      try { box.setPointerCapture(down.pointerId); } catch {}
    };
    const layout = (order) => {
      const flat = order.flatMap((u) => st.units[u].idx);   // 새 순서의 원래 번호
      const at = new Map(flat.map((orig, k) => [orig, k]));
      list.forEach((x, i) => {
        if (st.units[st.s].idx.includes(i)) return;
        const to = st.slots[at.get(i)], from = st.slots[i];
        const dx = to.x - from.x, dy = to.y - from.y;
        shift(x, dx, dy);
        x.classList.toggle("sort-shift", !!(dx || dy));
      });
      return at;
    };
    const move = () => {
      const b = box.getBoundingClientRect();
      const p = { x: last.clientX - b.left, y: last.clientY - b.top };
      const d = { x: p.x - st.start.x, y: p.y - st.start.y };
      st.units[st.s].idx.forEach((i) => shift(list[i], d.x, d.y));
      const o = opts.over && opts.over(last);
      if (overEl !== o) { overEl && overEl.classList.remove("drop"); overEl = o || null; overEl && overEl.classList.add("drop"); }
      if (o) { st.order = st.units.map((_, i) => i); layout(st.order); return; }
      const c = { x: st.grab.x + d.x, y: st.grab.y + d.y };
      let best = 0, bd = Infinity;
      st.slots.forEach((r, i) => { const dd = (r.x + r.w / 2 - c.x) ** 2 + (r.y + r.h / 2 - c.y) ** 2; if (dd < bd) { bd = dd; best = i; } });
      // 같은 묶음 칸들 위·아래로 벗어나면(다른 묶음 위) 맨 앞·맨 뒤
      if (c.y > Math.max(...st.slots.map((r) => r.y + r.h))) best = st.slots.length - 1;
      else if (c.y < Math.min(...st.slots.map((r) => r.y))) best = 0;
      const u = st.units.findIndex((x) => x.idx.includes(best));
      const order = st.units.map((_, i) => i).filter((i) => i !== st.s);
      order.splice(u === st.s ? st.s : u, 0, st.s);
      st.order = order;
      layout(order);
    };
    const edge = () => {
      raf = 0;
      if (!st) return;
      const sc = opts.scroller ? opts.scroller() : null;
      const r = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      const v = last.clientY < r.top + 40 ? -10 : last.clientY > r.bottom - 40 ? 10 : 0;
      if (v) { if (sc) sc.scrollTop += v; else scrollBy(0, v); move(); raf = requestAnimationFrame(edge); }
    };
    const onMove = (ev) => {
      last = ev;
      if (!st) {
        if (Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < 6) return;
        begin();
      }
      ev.preventDefault();
      move();
      if (!raf) raf = requestAnimationFrame(edge);
    };
    const finish = () => {
      list.forEach((x) => { x.classList.remove("sort-item", "sort-lift", "sort-shift"); x.style.translate = ""; });
      box.classList.remove("sorting");
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      if (!st) return;
      cancelAnimationFrame(raf);
      // 끈 뒤 바로 따라오는 click(선택 단추 등)은 먹는다
      const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
      box.addEventListener("click", eat, true);
      setTimeout(() => box.removeEventListener("click", eat, true), 0);
      if (overEl) { overEl.classList.remove("drop"); finish(); opts.dropOver(overEl, el); return; }
      // 끌던 칸을 빈자리로 미끄러뜨린 뒤 새 순서를 알린다
      const at = layout(st.order);
      const s = st.units[st.s].idx;
      s.forEach((i) => {
        const to = st.slots[at.get(i)], from = st.slots[i];
        list[i].classList.remove("sort-lift");
        shift(list[i], to.x - from.x, to.y - from.y);
      });
      const changed = st.order.some((u, i) => u !== i);
      const order = st.order.flatMap((u) => st.units[u].idx).map((i) => list[i]);
      st = null;
      setTimeout(() => {
        list.forEach((x) => { x.style.transition = "none"; });
        finish();
        if (changed) opts.onDrop(order);
        requestAnimationFrame(() => list.forEach((x) => { x.style.transition = ""; }));
      }, 180);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  });
}

function draw() {
  clearTimeout(timer);
  const { main: mainTabs, sub: subTabs } = tabLayout();
  const mode = editMode ? "edit" : "class";
  const open = [...mainTabs.filter((k) => tabShown(k, mode)), ...subTabs];
  if (!open.includes(tab)) tab = open[0] || "profile";
  if (!lesson && !NO_LESSON_TABS.includes(tab)) tab = mainTabs.includes("settings") && tabShown("settings", mode) ? "settings" : "library";
  main = h("main", { class: "wide" });
  main.inert = !!tabEdit;
  app.classList.toggle("tab-editing", !!tabEdit);
  app.replaceChildren(topBar(), main);
  if (grid && (tab !== "students" || !lesson || lesson.code !== grid.code)) stopGrid();
  ({ join: drawJoin, run: drawRun, build: drawBuild, students: drawStudents, settings: drawSettings, profile: drawProfile, library: drawLibrary, people: drawPeople, etc: drawEtc, patch: drawPatch, bugs: drawBugs })[tab]();
  schedule();
}

// 탭 꾸미기 중에는 위쪽 틀만 다시 그린다(아래 화면은 흐리게 멈춰 둔다)
function repaintTop() {
  const old = app.querySelector("header.top");
  if (old) old.replaceWith(topBar());
}

function goTab(k) {
  if (tabEdit) return;
  tab = k;
  localStorage.setItem("cra-tab", k);
  if (tabLayout().sub.includes(k)) localStorage.setItem("cra-subtab", k);
  draw();
}

function topBar() {
  // 왼쪽 위: 수업 코드(바꿀 수 없음) · 제목(바로 고쳐 쓰고 Enter 또는 칸을 벗어나면 저장). 수업 옮기기·새 수업은 「전체 수업」에서
  const titleBox = h("input", {
    type: "text", class: "lesson-title", maxlength: 100, "aria-label": "수업 제목", disabled: !lesson,
    value: lesson ? lesson.title : "", placeholder: lesson ? "수업 제목" : "새 수업 (슬라이드 편집에서 만듭니다)",
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
    h("span", { class: "lesson-code", title: "수업 코드(바꿀 수 없음)" }, lesson ? lesson.code : "새 수업"), titleBox);
  const { main: mainTabs, sub: subTabs } = tabEdit ? tabEdit.draft : tabLayout();
  const mode = editMode ? "edit" : "class";
  const tabBtn = (k) => h("button", {
    type: "button", class: tab === k ? "tab on" : "tab", "data-k": k, title: tabName(k), disabled: !lesson && !NO_LESSON_TABS.includes(k),
    onclick() { goTab(k); },
  }, tabIcon(k), h("span", {}, tabName(k)));
  const mainRow = tabEdit ? mainTabs.map((k) => custTab(k, "main")) : mainTabs.filter((k) => tabShown(k, mode)).map(tabBtn);
  // 수업 모드 ⇄ 편집 모드 스위치: 지금 모드 이름만 보인다
  const modeSwitch = h("button", {
    type: "button", role: "switch", "aria-checked": String(editMode), class: editMode ? "mode-switch editing" : "mode-switch",
    title: editMode ? "누르면 수업 모드로 바꿉니다" : "누르면 편집 모드로 바꿉니다",
    onclick() { editMode = !editMode; localStorage.setItem("cra-edit", editMode ? "1" : "0"); draw(); },
  }, h("span", { class: "knob", "aria-hidden": "true" }), h("span", { class: "mode-name" }, editMode ? "편집 모드" : "수업 모드"));
  const inSub = subTabs.includes(tab);
  // 설정: 누르면 아래 줄 탭(프로필 · 전체 수업 · …)이 열린다
  const setBtn = h("button", {
    class: inSub ? "tab profile-btn on" : "tab profile-btn", type: "button", title: (me.email || "") + " · 설정",
    onclick() { const last = localStorage.getItem("cra-subtab"); goTab(subTabs.includes(last) ? last : "profile"); },
  }, gearIcon(), h("span", {}, "설정"));
  const subRow = tabEdit || inSub ? h("nav", { class: "tabs sub-tabs", "aria-label": "설정 탭" },
    tabEdit ? subTabs.map((k) => custTab(k, "sub")) : subTabs.map(tabBtn), tabEdit ? tabEditBar() : null) : null;
  return h("header", { class: "top" + (editMode ? " editing" : "") + (subRow ? " has-sub" : "") },
    h("div", { class: "top-title" }, h("span", { class: "eyebrow" }, "교사용"), lessonBox),
    h("nav", { class: "tabs main-tabs" }, mainRow),
    h("div", { class: "top-actions" }, modeSwitch, setBtn),
    subRow);
}

// 「설정」 단추의 톱니바퀴: 올리면 살짝 돌고 멈춘다(app.css .gear)
function gearIcon() {
  const g = h("span", { class: "gear", "aria-hidden": "true" });
  g.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  return g;
}

// ---------- 탭 꾸미기 ----------
// 탭 이름을 누르면 그 자리에 글자 커서가 생겨 바로 고친다. 글자 커서가 없을 때 탭을 끌면 두 줄 사이를 자유롭게 옮긴다.
// 위 줄 탭에는 「수업」「편집」 작은 단추가 붙어 그 모드에서 보일지 정한다. 탭 줄 말고는 흐리게 막아 둔다.
function startTabEdit() {
  const { main: m, sub } = tabLayout();
  const draft = { main: m, sub, names: {}, show: {} };
  for (const [k] of TAB_DEFAULTS) {
    if (tabCustom.names && tabCustom.names[k]) draft.names[k] = tabCustom.names[k];
    draft.show[k] = { class: tabShown(k, "class"), edit: tabShown(k, "edit") };
  }
  tabEdit = { draft, base: JSON.stringify(draft) };
  draw();
}
const tabEditDirty = () => !!tabEdit && JSON.stringify(tabEdit.draft) !== tabEdit.base;
function endTabEdit() { tabEdit = null; draw(); }

function tabEditBar() {
  const dirty = tabEditDirty();
  return h("div", { class: "tab-edit-bar" },
    h("button", {
      type: "button", class: "primary save-tabs", disabled: !dirty,
      async onclick(e) {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "저장 중…";
        if (await saveTabCustom(JSON.parse(JSON.stringify(tabEdit.draft)))) tabEdit.base = JSON.stringify(tabEdit.draft);
        repaintTop();
      },
    }, dirty ? "저장하기" : "저장됨"),
    h("button", {
      type: "button", class: "ghost cancel-tabs",
      onclick() {
        if (tabEditDirty() && !confirm("바꾼 탭 설정을 저장하지 않고 버릴까요?")) return;
        endTabEdit();
      },
    }, "취소"));
}
// 이름을 바꾸는 동안에는 저장 단추만 다시 그린다(글자 커서가 그대로 있도록)
function paintTabEditBar() {
  const bar = app.querySelector(".tab-edit-bar");
  if (bar) bar.replaceWith(tabEditBar());
}

function custTab(k, row) {
  const d = tabEdit.draft;
  const label = h("span", { class: "tab-label", contenteditable: "plaintext-only", spellcheck: "false", "aria-label": tabName(k, {}) + " 탭 이름" }, tabName(k, d));
  label.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); label.blur(); }
  });
  label.addEventListener("input", () => {
    let t = label.textContent.replace(/\s+/g, " ");
    if (t.length > 20) { t = t.slice(0, 20); label.textContent = t; }
    t = t.trim();
    if (t && t !== tabName(k, {})) d.names[k] = t; else delete d.names[k];
    paintTabEditBar();
  });
  label.addEventListener("blur", () => { if (!label.textContent.trim()) label.textContent = tabName(k, {}); });
  const modeBtn = (m, text) => h("button", {
    type: "button", class: d.show[k][m] ? "mini on" : "mini", "data-m": m, "aria-pressed": String(d.show[k][m]), title: text + " 모드에서 " + (d.show[k][m] ? "보임" : "숨김"),
    onclick() { d.show[k][m] = !d.show[k][m]; repaintTop(); },
  }, text);
  const el = h("div", { class: "tab cust" + (row === "main" && !d.show[k].class && !d.show[k].edit ? " hidden-both" : ""), "data-k": k },
    tabIcon(k), label, row === "main" ? h("span", { class: "mode-picks" }, modeBtn("class", "수업"), modeBtn("edit", "편집")) : null);
  el.addEventListener("pointerdown", (e) => custDrag(e, el, label));
  return el;
}

// 끌기: 놓일 줄은 마우스와 세로로 가까운 줄, 자리는 가로 위치로 정하고 칸을 그 자리로 옮겨 둔다. 끌지 않고 떼면 누른 곳에 글자 커서를 둔다.
// 프로필은 늘 아래 줄에 둔다.
function custDrag(e, el, label) {
  if (e.button !== 0 || e.target.closest(".mode-picks")) return;
  if (document.activeElement === label && label.contains(e.target)) return;   // 고치는 중: 글자 선택·커서 옮기기
  e.preventDefault();
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  const x0 = e.clientX, y0 = e.clientY;
  const k = el.dataset.k;
  let ghost = null, dx = 0, dy = 0;
  const rows = () => [...app.querySelectorAll("header.top nav.main-tabs, header.top nav.sub-tabs")].filter((n) => k !== "profile" || n.classList.contains("sub-tabs"));
  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      const r = el.getBoundingClientRect();
      dx = x0 - r.left;
      dy = y0 - r.top;
      ghost = el.cloneNode(true);
      ghost.classList.add("drag-ghost");
      ghost.style.width = r.width + "px";
      document.body.append(ghost);
      el.classList.add("drag-slot");
    }
    ghost.style.left = ev.clientX - dx + "px";
    ghost.style.top = ev.clientY - dy + "px";
    const nav = rows().reduce((best, n) => {
      const r = n.getBoundingClientRect();
      const dist = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
      return !best || dist < best.dist ? { n, dist } : best;
    }, null).n;
    const items = [...nav.querySelectorAll(":scope > .tab.cust")].filter((x) => x !== el);
    const before = items.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.bottom + 4 && (ev.clientY < r.top - 4 || ev.clientX < r.left + r.width / 2); })
      || nav.querySelector(":scope > .tab-edit-bar");
    if (before) { if (el.nextElementSibling !== before) nav.insertBefore(el, before); } else if (nav.lastElementChild !== el) nav.append(el);
  };
  const up = (ev) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    if (!ghost) {   // 누르기만 함: 누른 곳에 글자 커서
      label.focus();
      const at = document.caretPositionFromPoint ? document.caretPositionFromPoint(ev.clientX, ev.clientY)
        : document.caretRangeFromPoint ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
      const node = at && (at.offsetNode || at.startContainer);
      const r = document.createRange();
      if (node && label.contains(node)) r.setStart(node, at.offset != null ? at.offset : at.startOffset);
      else { r.selectNodeContents(label); r.collapse(false); }
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    ghost.remove();
    const keys = (cls) => [...app.querySelectorAll("header.top nav." + cls + " > .tab.cust")].map((x) => x.dataset.k);
    tabEdit.draft.main = keys("main-tabs");
    tabEdit.draft.sub = keys("sub-tabs");
    repaintTop();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}
