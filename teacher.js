// 교사 화면(버전 2): 로그인 → 수업 고르기 → [접속 QR] [수업 진행] [학생 관리] [수업용 화면 띄우기(창)] · 설정▾[자료 추가 · 슬라이드 편집 · 기타 관리] · 프로필(내 정보 + 전체 수업)
// 오른쪽 위 프로필 왼쪽 「수업 모드 | 편집 모드」에서 편집 모드로 바꾸면 [수업 진행] [학생 관리] [자료 추가] [슬라이드 편집] [기타 관리] [버그 제보] 탭이 모두 위에 나온다(접속 QR·설정·수업용 화면 띄우기는 숨김).
// 탭 순서·이름은 프로필의 「탭 꾸미기」에서 바꾼다(tabCustom, cra-tabs).
// 수업 진행·학생 관리 탭은 3초마다 응답을 다시 읽어 온다.
//
// 교사 화면 스크립트는 탭별로 나뉘어 teacher.html 이 이 순서로 불러온다(모두 같은 전역 공간을 쓴다):
//   teacher.js          공유 상태 · 시작 · 로그인 · 데이터 읽기/쓰기 · 탭 틀(이 파일)
//   teacher-library.js  전체 수업(프로필 오른쪽) · 슬라이드 PDF
//   teacher-profile.js  프로필 · 공동 작업자 · (개발자) 선생님 관리
//   teacher-etc.js      기타 관리(사용량) · 버그 제보
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
let editMode = localStorage.getItem("cra-edit") === "1";   // 편집 모드: 자료 추가·슬라이드 편집·기타 관리를 위쪽 탭으로 꺼낸다
// 탭 꾸미기(프로필): { order: [탭 키…], names: { 키: 이름 } }. 이 브라우저에만 저장한다
let tabCustom = (() => { try { return JSON.parse(localStorage.getItem("cra-tabs")) || {}; } catch { return {}; } })();
const TAB_DEFAULTS = [["join", "접속 QR"], ["run", "수업 진행"], ["students", "학생 관리"], ["build", "자료 추가"], ["settings", "슬라이드 편집"], ["etc", "기타 관리"], ["bugs", "버그 제보"]];
const tabName = (k) => (tabCustom.names && tabCustom.names[k]) || (TAB_DEFAULTS.find(([x]) => x === k) || [, k])[1];
const tabSort = (list) => {
  const at = (k) => { const i = (tabCustom.order || []).indexOf(k); return i < 0 ? 99 + TAB_DEFAULTS.findIndex(([x]) => x === k) : i; };
  return list.map((k) => [k, tabName(k)]).sort((a, b) => at(a[0]) - at(b[0]));
};
function saveTabCustom(c) { tabCustom = c; try { localStorage.setItem("cra-tabs", JSON.stringify(c)); } catch {} }
let tab = (localStorage.getItem("cra-tab") || "run").replace(/^manage$/, "profile");   // 예전 「전체 수업」 탭은 프로필 안으로
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
    // 선생님으로 승격된 학생: 승격할 때 받은 이메일로 처음 한 번 계정을 만든다(확인 메일의 링크를 눌러야 로그인됨)
    h("button", {
      class: "link",
      type: "button",
      async onclick() {
        const address = email.value.trim();
        if (!address || pw.value.length < 6) {
          msg.textContent = "승격할 때 등록한 이메일과 새 비밀번호(6자 이상)를 넣고 다시 눌러 주세요.";
          (address ? pw : email).focus();
          return;
        }
        msg.textContent = "계정을 만드는 중…";
        const { error } = await sb.auth.signUp({ email: address, password: pw.value, options: { emailRedirectTo: new URL(location.pathname, location.origin).href } });
        msg.textContent = error
          ? "계정을 만들지 못했습니다: " + error.message
          : "메일함에서 확인 링크를 누른 뒤 로그인해 주세요. (선생님으로 승격된 이메일만 교사 화면을 쓸 수 있습니다.)";
      },
    }, "선생님으로 승격된 학생: 처음 계정 만들기"),
    h("p", { class: "muted small center" }, "교사 계정은 Supabase 대시보드 → Authentication → Users 에서 만들거나, 「학생 관리」에서 승격된 학생이 위 단추로 직접 만듭니다.")));
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
  // 평소: 접속 QR · 수업 진행 · 학생 관리 · 수업용 화면 띄우기 + 설정▾(자료 추가 · 슬라이드 편집 · 기타 관리)
  // 편집 모드: 설정 안의 탭이 모두 위로 나오고 버그 제보가 붙는다(접속 QR과 설정 단추는 숨김). 순서·이름은 「탭 꾸미기」를 따른다
  const tabs = tabSort(editMode ? ["run", "students", "build", "settings", "etc", "bugs"] : ["join", "run", "students"]);
  // 설정 단추에 마우스를 올리면(누르거나 키보드로 들어가도) 아래로 펼쳐지는 탭
  const setTabs = editMode ? [] : tabSort(["build", "settings", "etc"]);
  if (![...tabs, ...setTabs, ["profile"]].some(([k]) => k === tab)) tab = "run";
  const go = (k) => { tab = k; localStorage.setItem("cra-tab", k); draw(); };
  const menu = h("div", { class: "set-menu" },
    h("button", {
      type: "button", class: setTabs.some(([k]) => k === tab) ? "tab set-btn on" : "tab set-btn", "aria-haspopup": "menu",
      onclick() { menu.classList.toggle("open"); },
    }, tabIcon("gear"), h("span", {}, "설정"), h("span", { class: "set-caret", "aria-hidden": "true" })),
    h("div", { class: "set-drop", role: "menu" }, setTabs.map(([k, label]) => h("button", {
      type: "button", role: "menuitem", class: tab === k ? "set-item on" : "set-item", disabled: !lesson && k === "build",
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
  // 수업 모드 ⇄ 편집 모드: 두 칸 중 하나를 고르면 그 모드로 바뀐다(누를 때마다 서로 바꾸기)
  const setMode = (on) => { if (on === editMode) return; editMode = on; localStorage.setItem("cra-edit", on ? "1" : "0"); draw(); };
  const editBtn = h("div", { class: editMode ? "mode-swap editing" : "mode-swap", role: "group", "aria-label": "화면 모드" },
    h("button", { type: "button", class: editMode ? "" : "on", "aria-pressed": String(!editMode), "aria-label": "수업 모드", title: "수업 모드: 접속 QR·수업 진행·학생 관리와 수업용 화면 띄우기",
      onclick() { setMode(editMode ? false : true); } }, tabIcon("run"), h("span", {}, "수업")),
    h("button", { type: "button", class: editMode ? "on" : "", "aria-pressed": String(editMode), "aria-label": "편집 모드", title: "편집 모드: 자료 추가·슬라이드 편집·기타 관리·버그 제보를 위쪽 탭으로",
      onclick() { setMode(editMode ? false : true); } }, tabIcon("edit"), h("span", {}, "편집")));
  main = h("main", { class: "wide" });
  app.replaceChildren(
    h("header", { class: editMode ? "top editing" : "top" },
      h("div", { class: "top-title" }, h("span", { class: "eyebrow" }, "교사용"), lessonBox),
      h("nav", { class: "tabs" }, tabs.map(([k, label]) => h("button", {
        type: "button", class: tab === k ? "tab on" : "tab", "data-k": k, title: label, disabled: !lesson && k !== "settings" && k !== "etc" && k !== "bugs",
        onclick() { go(k); },
      }, tabIcon(k), h("span", {}, label))),
        // 평소에만: 탭 줄 끝의 「수업용 화면 띄우기」(teacher-run.js openPresent, 탭이 아니라 창을 연다)
        editMode ? null : h("button", {
          type: "button", class: "tab present-btn", disabled: !lesson, title: "슬라이드만 따라 보여 주는 창을 엽니다(TV·빔 프로젝터용, 한 개만)",
          onclick() { openPresent(); },
        }, tabIcon("present"), h("span", {}, "수업용 화면 띄우기"))),
      // 오른쪽 위: 설정▾(편집 모드에서는 없음) · 수업 모드|편집 모드 · 프로필. 모드 단추는 늘 프로필 바로 왼쪽
      h("div", { class: "top-actions" }, setTabs.length ? menu : null, editBtn,
        // 프로필: 내 정보 · 로그아웃 · 비밀번호 재설정 · 공동 작업자 · 전체 수업
        h("button", { class: tab === "profile" ? "tab profile-btn on" : "tab profile-btn", type: "button", title: (me.email || "") + " · 프로필", onclick() { go("profile"); } },
          h("span", { class: "avatar", "aria-hidden": "true" }, ((me.email || "?")[0]).toUpperCase()), h("span", {}, "프로필")))),
    main);
  if (!lesson && tab !== "profile" && tab !== "etc") tab = "settings";
  if (grid && (tab !== "students" || !lesson || lesson.code !== grid.code)) stopGrid();
  ({ join: drawJoin, run: drawRun, build: drawBuild, students: drawStudents, settings: drawSettings, profile: drawProfile, etc: drawEtc, bugs: drawBugs })[tab]();
  schedule();
}
