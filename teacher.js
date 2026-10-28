// 교사 화면(버전 2): 로그인 → 수업 고르기 → [수업 진행] [자료 추가] [학생 관리] [수업 설정]
// 수업 진행·학생 관리 탭은 3초마다 응답을 다시 읽어 온다.

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

if (!sb) notConfigured(app);
else {
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      passwordRecovery = true;
      showPasswordRecovery();
    }
  });
  init();
}

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
// 탭 기호(선 그림): 수업 진행 ▶ · 자료 추가 ＋ · 학생 관리 사람들 · 수업 설정 조절기 · 전체 수업 관리 폴더 · 기타 관리 계기판
const TAB_ICONS = {
  run: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  build: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  students: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  manage: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  etc: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5l4-4"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
};
function tabIcon(k) {
  const el = h("span", { class: "tab-icon", "aria-hidden": "true" });
  el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + TAB_ICONS[k] + "</svg>";
  return el;
}
function draw() {
  clearTimeout(timer);
  const pick = h("select", {
    "aria-label": "수업 고르기",
    async onchange() {
      if (pick.value === "new") { lesson = null; tab = "settings"; }
      else lesson = lessons.find((l) => l.id === pick.value);
      await loadLesson();
    },
  }, lessons.map((l) => h("option", { value: l.id, selected: lesson && l.id === lesson.id }, (l.kind === "survey" ? "[설문] " : "") + l.title + " (" + l.code + ")")),
    h("option", { value: "new", selected: !lesson }, "+ 새 수업 만들기"));
  const tabs = [["run", "수업 진행"], ["build", "자료 추가"], ["students", "학생 관리"], ["settings", "수업 설정"], ["manage", "전체 수업 관리"], ["etc", "기타 관리"]];
  if (!tabs.some(([k]) => k === tab)) tab = "run";
  main = h("main", { class: "wide" });
  app.replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "top-title" }, h("span", { class: "eyebrow" }, "교사용"), pick),
      h("nav", { class: "tabs" }, tabs.map(([k, label]) => h("button", {
        type: "button", class: tab === k ? "tab on" : "tab", disabled: !lesson && k !== "settings" && k !== "manage" && k !== "etc",
        onclick() { tab = k; localStorage.setItem("cra-tab", k); draw(); },
      }, tabIcon(k), h("span", {}, label)))),
      h("button", { class: "link", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃")),
    main);
  if (!lesson && tab !== "manage" && tab !== "etc") tab = "settings";
  if (grid && (tab !== "students" || !lesson || lesson.code !== grid.code)) stopGrid();
  ({ run: drawRun, build: drawBuild, students: drawStudents, settings: drawSettings, manage: drawManage, etc: drawEtc })[tab]();
  schedule();
}

// ---------- 전체 수업 관리 ----------
// 역대 모든 수업을 폴더로 정리한다. 수업 카드를 끌어 폴더에 넣거나 순서를 바꾸고, 골라서 불러오거나 슬라이드를 PDF로 받는다.
let folders = [];
let pickedId = null;

async function drawManage() {
  const { data, error } = await sb.from("lesson_folders").select("*").order("sort").order("created_at");
  if (tab !== "manage") return;
  folders = error ? [] : data;
  const msg = h("p", { class: "msg" });
  const groups = [...folders.map((f) => ({ id: f.id, name: f.name })), { id: null, name: "폴더 없음" }];
  const inGroup = (gid) => lessons
    .filter((l) => (folders.some((f) => f.id === l.folder_id) ? l.folder_id : null) === gid)
    .sort((x, y) => (x.sort || 0) - (y.sort || 0) || x.created_at.localeCompare(y.created_at));
  const picked = () => lessons.find((l) => l.id === pickedId) || null;

  // 끌어 놓기: 수업 카드 위에 놓으면 그 앞에, 폴더 빈 곳에 놓으면 맨 뒤에 넣고 그 폴더 순서를 다시 매겨 저장한다
  async function moveLesson(id, gid, beforeId) {
    const l = lessons.find((x) => x.id === id);
    if (!l || id === beforeId) return;
    const list = inGroup(gid).filter((x) => x.id !== id);
    const at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
    list.splice(at < 0 ? list.length : at, 0, l);
    const changes = list.map((x, i) => ({ x, change: { folder_id: gid, sort: i } }))
      .filter(({ x, change }) => (x.folder_id || null) !== change.folder_id || (x.sort || 0) !== change.sort);
    changes.forEach(({ x, change }) => Object.assign(x, change));
    drawManage();
    for (const { x, change } of changes) {
      const r = await sb.from("lessons").update(change).eq("id", x.id);
      if (r.error) return alert("옮기지 못했습니다: " + r.error.message);
    }
  }
  const dropZone = (el, gid, beforeId) => {
    el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("drop-on"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop-on"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drop-on");
      const id = e.dataTransfer.getData("text/plain");
      if (id) moveLesson(id, gid, beforeId);
    });
  };

  // 불러오기: 이 수업을 지금 수업으로 바꾸기만 하고 화면은 그대로 둔다(버튼이 「불러오기 완료」로 바뀜)
  const loadPicked = async (btn) => {
    const l = picked();
    if (!l || l.id === lesson?.id) return;
    if (btn) { btn.disabled = true; btn.textContent = "불러오는 중…"; }
    lesson = l;
    await loadLesson();   // 위쪽 수업 고르기 칸과 다른 탭이 이 수업으로 바뀐다
    flash("「" + l.title + "」 수업을 불러왔습니다.");
  };
  const card = (l) => {
    const el = h("article", {
      class: "lesson-card" + (l.id === pickedId ? " picked" : ""), draggable: "true", tabindex: "0",
      onclick() { pickedId = l.id; drawManage(); },
      ondblclick() { pickedId = l.id; loadPicked(); },
      onkeydown(e) { if (e.key === "Enter") { pickedId = l.id; drawManage(); } },
      ondragstart(e) { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); },
      ondragend() { el.classList.remove("dragging"); },
    },
      h("strong", {}, (l.kind === "survey" ? "[설문] " : "") + l.title),
      h("span", { class: "muted small" }, l.code + " · " + (l.slide_count ? slideTotal(l) + "쪽" : "슬라이드 없음") + " · " + new Date(l.created_at).toLocaleDateString()),
      l.id === lesson?.id ? h("span", { class: "tag ok" }, "지금 수업") : null,
      // 첫 슬라이드(끌기를 방해하지 않게 그림 자체는 끌 수 없게)
      l.slide_count && !isPptx(l)
        ? h("img", { class: "lesson-thumb", src: slideSrc(l, 1, true), alt: l.title + " 첫 슬라이드", loading: "lazy", draggable: "false" })
        : h("div", { class: "lesson-thumb empty" }, l.kind === "survey" ? "설문" : isPptx(l) ? "PowerPoint 자료" : "슬라이드 없음"));
    dropZone(el, (folders.some((f) => f.id === l.folder_id) ? l.folder_id : null), l.id);
    return el;
  };

  const folderBox = (g) => {
    const items = inGroup(g.id);
    const list = h("div", { class: "lesson-list" }, items.length ? items.map(card) : h("p", { class: "muted small" }, "여기로 수업을 끌어 놓으세요."));
    dropZone(list, g.id, null);
    const f = folders.find((x) => x.id === g.id);
    return h("section", { class: "card stack folder" },
      h("div", { class: "row between" },
        h("h2", {}, (g.id ? "📁 " : "") + g.name, h("span", { class: "muted small" }, " · " + items.length + "개")),
        f ? h("div", { class: "row" },
          h("button", { class: "link", type: "button", async onclick() {
            const name = (prompt("폴더 이름", f.name) || "").trim();
            if (!name || name === f.name) return;
            const r = await sb.from("lesson_folders").update({ name: name.slice(0, 60) }).eq("id", f.id);
            if (r.error) return alert(r.error.message);
            drawManage();
          } }, "이름 바꾸기"),
          h("button", { class: "link danger", type: "button", async onclick() {
            if (!confirm("「" + f.name + "」 폴더를 지울까요? 안의 수업은 지워지지 않고 「폴더 없음」으로 옮겨집니다.")) return;
            const r = await sb.from("lesson_folders").delete().eq("id", f.id);
            if (r.error) return alert(r.error.message);
            lessons.forEach((l) => { if (l.folder_id === f.id) l.folder_id = null; });
            drawManage();
          } }, "폴더 지우기")) : null),
      list);
  };

  const newName = h("input", { type: "text", maxlength: 60, placeholder: "새 폴더 이름 (예: 2학기 물리)" });
  const addFolder = async () => {
    const name = newName.value.trim();
    if (!name) { newName.focus(); return; }
    const r = await sb.from("lesson_folders").insert({ name, sort: folders.length });
    if (r.error) { msg.textContent = "폴더를 만들지 못했습니다: " + r.error.message; return; }
    drawManage();
  };
  newName.addEventListener("keydown", (e) => { if (e.key === "Enter") addFolder(); });

  const p = picked();
  const moveSel = p ? h("select", { "aria-label": "옮길 폴더", async onchange() { await moveLesson(p.id, moveSel.value || null, null); } },
    groups.map((g) => h("option", { value: g.id || "", selected: (folders.some((f) => f.id === p.folder_id) ? p.folder_id : null) === g.id }, g.name))) : null;
  main.replaceChildren(h("div", { class: "stack manage" },
    h("section", { class: "card stack" },
      h("div", { class: "row between wrap" },
        h("h2", {}, "전체 수업 " + lessons.length + "개"),
        h("div", { class: "folder-add" }, newName, h("button", { class: "ghost", type: "button", onclick: addFolder }, "+ 폴더 추가"))),
      h("p", { class: "muted small" }, "수업 카드를 끌어 폴더에 넣거나 순서를 바꿀 수 있습니다. 카드를 눌러 고른 뒤 「불러오기」(또는 두 번 누르기)를 하면 그 수업이 지금 수업이 됩니다. 화면은 그대로이고, 다른 탭에서 바로 그 수업을 씁니다."),
      error ? h("p", { class: "error" }, "폴더 기능을 쓰려면 Supabase에서 새 setup.sql을 실행해야 합니다.") : null,
      p ? h("div", { class: "row wrap picked-bar" },
        h("strong", {}, "고른 수업: " + p.title + " (" + p.code + ")"),
        p.id === lesson?.id
          ? h("button", { class: "primary", type: "button", disabled: true }, "불러오기 완료")
          : h("button", { class: "primary", type: "button", onclick(e) { loadPicked(e.currentTarget); } }, "불러오기"),
        h("button", { class: "ghost", type: "button", onclick() { exportSlidesPdf(p, msg); } }, "슬라이드 PDF 받기"),
        h("div", { class: "folder-add" }, h("span", { class: "muted small" }, "폴더"), moveSel))
        : h("p", { class: "muted small" }, "수업을 하나 고르면 「불러오기」와 「슬라이드 PDF 받기」 버튼이 나옵니다."),
      msg),
    groups.map(folderBox)));
}

// ---------- 기타 관리 ----------
// 이 웹앱이 쓰는 바깥 서비스(Supabase · Cloudflare · GitHub)의 무료 한도에 견준 사용량을 원 띠 그래프와 표로 보여 준다.
// 받는 곳은 셋: Supabase 함수 resource_usage(DB 안 숫자), Worker /usage(Supabase 관리 API·Cloudflare 숫자), GitHub 공개 API.
// 탭을 열면 5분 넘게 지난 것만, 「동기화」를 누르면 모두 다시 받는다. 탭을 열어 두면 DB 안 숫자(접속 중 학생 등)만 30초마다 새로 받는다
// (창이 가려져 있으면 받지 않고, 다시 보일 때 받는다)
// (Worker는 KV 목록 읽기 하루 1,000번, GitHub는 이 PC에서 시간당 60번 한도라 저절로 다시 받지 않는다).
const GITHUB_REPO = "wathaphia/class-response";
const MB = 1024 * 1024, GB = 1024 * MB;
// 기타 관리의 시각·날짜·달은 모두 한국 시간(UTC+9). kstIso(t)는 그 시각의 한국 벽시계를 ISO 꼴로(끝의 Z는 무시)
const KST_MS = 9 * 3600000, TZ = "Asia/Seoul";
const kstIso = (t = Date.now()) => new Date(+t + KST_MS).toISOString();
const kstMonthStart = (t = Date.now(), add = 0) => { const d = new Date(+t + KST_MS); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) - KST_MS; };
const kstClock = (t, o = {}) => new Date(t).toLocaleTimeString("ko-KR", { timeZone: TZ, ...o });
// 동기화: 자동은 1시간마다(이 탭이 화면에 보일 때만), 「동기화」 버튼은 마지막 동기화 뒤 10분이 지나야 다시 누를 수 있다.
// 받은 값은 이 브라우저에 남겨 두어(cra-usage) 새로 고침해도 다시 받지 않는다.
const ETC_AUTO_MS = 60 * 60 * 1000;
const ETC_MANUAL_MS = 10 * 60 * 1000;
const ETC_CHECK_MS = 30000;
let usage = {};            // 받는 곳 이름 → { data, at, net } 또는 { error, at, net }. net = 이 동기화가 브라우저에서 보낸 요청 수·받은 양
try { usage = JSON.parse(localStorage.getItem("cra-usage")) || {}; } catch {}
let usageBusy = false;
let etcTimer = null;

async function usageDb(net) {
  net.requests++;
  const { data, error } = await sb.rpc("resource_usage");
  if (error) throw new Error(/resource_usage/.test(error.message) ? "Supabase SQL Editor에서 setup.sql을 한 번 더 실행하세요." : error.message);
  net.bytes += JSON.stringify(data).length;
  return data;
}
async function usageWorker(net) {
  const url = typeof TURN_URL === "string" ? TURN_URL.trim().replace(/\/$/, "") : "";
  if (!url) throw new Error("config.js에 TURN_URL이 없습니다.");
  const { data } = await sb.auth.getSession();
  net.requests++;
  const r = await fetch(url + "/usage", {
    method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + (data.session ? data.session.access_token : "") }, body: "{}",
  });
  if (!r.ok) throw new Error("Worker 응답 " + r.status);
  const text = await r.text();
  net.bytes += text.length;
  const d = JSON.parse(text);
  if (!d.turn) throw new Error("Worker를 새로 배포해야 합니다(PC에서 class-tools\\usage-setup.ps1 실행).");
  return d;
}
async function usageGithub(net) {
  const gh = async (path) => {
    net.requests++;
    const r = await fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub 응답 " + r.status + (r.status === 403 ? "(이 PC 시간당 60번 한도, 잠시 뒤 다시)" : ""));
    const text = await r.text();
    net.bytes += text.length;
    return JSON.parse(text);
  };
  const monthStart = kstIso().slice(0, 8) + "01T00:00:00%2B09:00";
  const [repo, rate, month, recent, alive] = await Promise.all([
    gh("/repos/" + GITHUB_REPO),
    gh("/rate_limit"),   // 이 요청은 한도에 세지 않는다
    gh("/repos/" + GITHUB_REPO + "/actions/runs?per_page=1&created=%3E%3D" + monthStart),
    gh("/repos/" + GITHUB_REPO + "/actions/runs?per_page=6"),
    gh("/repos/" + GITHUB_REPO + "/actions/workflows/keep-alive.yml/runs?per_page=1"),
  ]);
  // 브라우저에 남겨 둘 것만 추린다(실행 기록 하나가 수 KB라)
  const run = (r) => r && { name: r.name, created_at: r.created_at, conclusion: r.conclusion, status: r.status };
  return {
    repo: { size: repo.size, pushed_at: repo.pushed_at, default_branch: repo.default_branch, open_issues_count: repo.open_issues_count },
    rate: rate.resources.core, runsThisMonth: month.total_count, recent: recent.workflow_runs.map(run), alive: run(alive.workflow_runs[0]),
  };
}
const USAGE_SOURCES = { db: usageDb, worker: usageWorker, github: usageGithub };

const lastSync = () => Math.max(0, ...Object.values(usage).map((u) => u.at || 0));
const staleSources = () => Object.keys(USAGE_SOURCES).filter((k) => !usage[k] || Date.now() - usage[k].at >= ETC_AUTO_MS);
const manualWait = () => Math.max(0, lastSync() + ETC_MANUAL_MS - Date.now());

async function syncUsage(names) {
  if (usageBusy || !names.length) return;
  usageBusy = true;
  if (tab === "etc") paintEtc();
  await Promise.all(names.map(async (k) => {
    const net = { requests: 0, bytes: 0 };
    try { usage[k] = { data: await USAGE_SOURCES[k](net), at: Date.now(), net }; }
    catch (e) { usage[k] = { error: e.message || String(e), at: Date.now(), net }; }
  }));
  usageBusy = false;
  try { localStorage.setItem("cra-usage", JSON.stringify(usage)); } catch {}
  if (tab === "etc") paintEtc();
}

function drawEtc() {
  paintEtc();
  etcCheck();
}
// 30초마다 시계만 본다(네트워크는 쓰지 않음): 1시간 지난 것이 있으면 자동 동기화, 아니면 버튼의 남은 시간만 고친다
function etcCheck() {
  clearTimeout(etcTimer);
  if (tab !== "etc") return;
  if (!document.hidden && staleSources().length) syncUsage(staleSources());
  else if (!usageBusy && main) { const b = main.querySelector(".sync-btn"); if (b) b.replaceWith(syncButton()); }
  etcTimer = setTimeout(etcCheck, ETC_CHECK_MS);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && tab === "etc") etcCheck(); });

function syncButton() {
  const wait = manualWait();
  const syncIcon = h("span", { class: "sync-icon" + (usageBusy ? " spin" : ""), "aria-hidden": "true" });
  syncIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>';
  return h("button", {
    class: "primary sync-btn", type: "button", disabled: usageBusy || wait > 0,
    title: wait > 0 ? "동기화는 10분에 한 번만 할 수 있습니다(무료 한도를 아끼려고)" : "지금 모든 사용량을 다시 받습니다",
    onclick() { if (manualWait() <= 0) syncUsage(Object.keys(USAGE_SOURCES)); },
  }, syncIcon, usageBusy ? "동기화 중…" : wait > 0 ? Math.ceil(wait / 60000) + "분 뒤 다시 동기화" : "동기화");
}

function usageAmount(n, fmt) {
  if (fmt === "days") return n + "일";
  if (fmt !== "bytes") return Number(n).toLocaleString();
  if (n < 1024) return Math.round(n) + "B";
  if (n < MB) return (n / 1024).toFixed(0) + "KB";
  if (n < GB) return (n / MB).toFixed(1) + "MB";
  return (n / GB).toFixed(2) + "GB";
}
const shortTime = (t) => new Date(t).toLocaleString("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 원 띠 그래프 하나: 회색 띠 위에 쓴 만큼 색 띠(여유 초록 · 60% 넘으면 주황 · 85% 넘으면 빨강). 색과 함께 글자로도 상태를 적는다.
const USAGE_LEVEL = { ok: "여유", warn: "주의", bad: "위험" };
function usageRing(it) {
  const known = !it.missing && it.used != null && it.limit > 0;
  const p = known ? it.used / it.limit : 0;
  const level = p >= 0.85 ? "bad" : p >= 0.6 ? "warn" : "ok";
  const c = 2 * Math.PI * 40;
  const pct = !known ? "—" : p > 0 && p < 0.01 ? "<1%" : Math.round(p * 100) + "%";
  const ring = h("span", { class: "ring", "aria-hidden": "true" });
  ring.innerHTML = '<svg viewBox="0 0 100 100"><circle class="ring-track" cx="50" cy="50" r="40"/>'
    + (known && p > 0 ? '<circle class="ring-bar ' + level + '" cx="50" cy="50" r="40" transform="rotate(-90 50 50)" stroke-dasharray="' + Math.max(Math.min(p, 1) * c, 0.5).toFixed(2) + " " + c.toFixed(2) + '"/>' : "")
    + '<text x="50" y="50">' + pct + "</text></svg>";
  const amount = known ? usageAmount(it.used, it.fmt) + " / " + usageAmount(it.limit, it.fmt) : it.missing || "알 수 없음";
  const left = known ? "남음 " + usageAmount(Math.max(it.limit - it.used, 0), it.fmt) : "";
  return h("figure", { class: "usage-item" + (known ? "" : " unknown"), title: it.label + " · " + it.period + "\n" + amount + (left ? " · " + left : "") + (it.hint ? "\n" + it.hint : "") },
    ring,
    h("figcaption", {},
      h("strong", {}, it.label),
      h("span", { class: "small" }, amount),
      left ? h("span", { class: "muted small" }, left) : null,
      h("span", { class: "usage-tags" },
        h("span", { class: "tag info" }, it.period),
        known ? h("span", { class: "tag " + level }, (level === "ok" ? "● " : level === "warn" ? "▲ " : "■ ") + USAGE_LEVEL[level]) : null),
      it.hint ? h("span", { class: "muted small" }, it.hint) : null));
}
const usageTable = (head, rows) => h("div", { class: "table-wrap usage-table" },
  h("table", {}, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((x) => h("td", {}, x)))))));
const usageBlock = (title, ...kids) => h("div", { class: "usage-block" }, h("h4", {}, title), ...kids);

// 이번 달 전송량을 지금까지의 시간당 평균으로 월말까지 늘려 본다(6시간 넘게 모였을 때만)
function egressProjection(m) {
  if (!m || !m.hours || m.hours < 6 || !m.until) return null;
  const until = Date.parse(m.until);
  const left = Math.max(0, (kstMonthStart(until - 1, 1) - until) / 3600000);
  return { bytes: m.bytes + m.bytes / m.hours * left, cached: m.cached + m.cached / m.hours * left };
}
// 날짜 묶음의 하루가 언제 바뀌는지: Worker가 한국 시간으로 나누기 전(kstSince 전)에 모인 날은 UTC 날짜 = 한국 오전 9시~다음 날 오전 9시
const DAY9 = "오전 9시~다음 날 오전 9시";
function egressDayNote(m, k) {
  const since = m && m.kstSince ? kstIso(Date.parse(m.kstSince)).slice(0, 10) : null;
  return !since || k < since ? " (" + DAY9 + ")" : k === since ? " (일부 " + DAY9 + ")" : "";
}
const egressHasDay9 = (m) => !!(m && m.days && Object.keys(m.days).some((k) => egressDayNote(m, k)));
const EGRESS_SRC = { site: "사이트(학생·교사 화면)", test: "브라우저 시험(이 PC)", tool: "올리기 도구(PowerShell)", other: "기타(Office 뷰어 등)" };

// 날마다 전송량 막대 그래프. 축척을 고정한다: 세로 0~500MB, 가로 그달 1일~말일(날마다·달마다 같은 눈으로 견줄 수 있게).
// 점선은 「하루 몫」(5GB ÷ 그달 날 수). 500MB를 넘는 날은 막대를 위에서 자르고 값을 적는다.
const EGRESS_DAY_MAX = 500 * MB;
function egressDayChart(title, m, field) {
  const ref = new Date(+(m && m.until ? Date.parse(m.until) - 1 : Date.now()) + KST_MS);
  const y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
  const n = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const key = (d) => y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const today = kstIso().slice(0, 10);
  const budget = 5 * GB / n;
  const W = 640, H = 210, L = 52, R = 10, T = 16, B = 26, pw = W - L - R, ph = H - T - B, base = T + ph;
  const yOf = (v) => T + ph * (1 - Math.min(v, EGRESS_DAY_MAX) / EGRESS_DAY_MAX);
  const slot = pw / n, bw = Math.max(3, Math.min(14, slot * 0.62));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = "";
  for (let v = 0; v <= EGRESS_DAY_MAX; v += 100 * MB) {
    svg += '<line class="eg-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yOf(v) + '" y2="' + yOf(v) + '"/>'
      + '<text class="eg-tick" x="' + (L - 6) + '" y="' + yOf(v) + '">' + (v ? v / MB + "MB" : "0") + "</text>";
  }
  let total = 0;
  for (let d = 1; d <= n; d++) {
    const k = key(d), v = m && m.days && m.days[k] ? m.days[k][field] || 0 : null;
    const x = L + (d - 1) * slot + (slot - bw) / 2;
    let bar = "";
    if (v > 0) {
      total += v;
      const top = yOf(v), r = Math.min(4, bw / 2, base - top);
      bar = '<path class="eg-bar" d="M' + x + "," + base + "V" + (top + r) + "Q" + x + "," + top + " " + (x + r) + "," + top
        + "H" + (x + bw - r) + "Q" + (x + bw) + "," + top + " " + (x + bw) + "," + (top + r) + "V" + base + 'Z"/>';
      if (v > EGRESS_DAY_MAX) bar += '<text class="eg-over" x="' + (x + bw / 2) + '" y="' + (T - 4) + '">' + esc(usageAmount(v, "bytes")) + "</text>";
    }
    const tip = (mo + 1) + "/" + d + (v == null ? "" : egressDayNote(m, k)) + " · " + (v == null ? (k > today ? "아직 안 옴" : "집계 없음") : usageAmount(v, "bytes"));
    // 막대보다 넓은 칸 전체가 마우스 대상(얇은 막대도 가리키기 쉽게)
    svg += '<g class="eg-day"><title>' + esc(tip) + "</title>"
      + '<rect class="eg-hit" x="' + (L + (d - 1) * slot) + '" y="' + T + '" width="' + slot + '" height="' + ph + '"/>' + bar + "</g>";
    if (d === 1 || d % 5 === 0 || k === today)
      svg += '<text class="eg-day-label' + (k === today ? " now" : "") + '" x="' + (L + (d - 0.5) * slot) + '" y="' + (H - 8) + '">' + d + "</text>";
  }
  const by = yOf(budget);
  svg += '<line class="eg-budget" x1="' + L + '" x2="' + (W - R) + '" y1="' + by + '" y2="' + by + '"/>'
    + '<text class="eg-budget-label" x="' + (L + 4) + '" y="' + (by - 4) + '">하루 몫 ' + esc(usageAmount(budget, "bytes")) + "</text>"
    + '<line class="eg-axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '"/>';
  const box = h("div", { class: "eg-chart", role: "img", "aria-label": title + " " + (mo + 1) + "월 날마다 막대 그래프, 이번 달 합계 " + usageAmount(total, "bytes") });
  box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' + svg + "</svg>";
  return h("figure", { class: "eg-figure" },
    h("figcaption", {}, h("strong", {}, title), h("span", { class: "muted small" }, " " + (mo + 1) + "월 합계 " + usageAmount(total, "bytes") + " / 5GB")),
    h("div", { class: "eg-scroll" }, box));
}
// 무료 5GB가 두 가지(전송량·캐시 전송량)라 따로 본다: 날마다 얼마나, 누가, 무엇이 많이 나갔는지
function egressView(m, ep, e24, top) {
  const amt = (n) => usageAmount(n || 0, "bytes");
  const days = m && m.days ? Object.entries(m.days).sort((a, b) => b[0].localeCompare(a[0])) : [];
  const srcs = m && m.srcs ? Object.entries(m.srcs).sort((a, b) => (b[1].bytes + b[1].cached) - (a[1].bytes + a[1].cached)) : [];
  const fileName = (p) => p.replace(/^\/storage\/v1\/object\/public\/slides\/\*\/\*\//, "슬라이드 ").replace(/^\/rest\/v1\/rpc\//, "함수 ").replace(/^\/rest\/v1\//, "표 ");
  return h("div", { class: "usage-blocks" },
    m ? h("div", { class: "usage-block wide" }, h("h4", {}, "날마다 전송량 그래프(하루 = 한국 시간 0시~24시 · 세로 축 0~500MB 고정)"),
      h("div", { class: "eg-pair" }, egressDayChart("캐시 전송량", m, "cached"), egressDayChart("전송량", m, "bytes")),
      h("p", { class: "muted small" }, "막대에 마우스를 올리면 그날 값이 나옵니다. 점선은 한 달 5GB를 날마다 고르게 쓸 때의 하루 몫입니다."
        + (egressHasDay9(m) ? " 「" + DAY9 + "」이 붙은 날은 한국 시간 기준으로 바꾸기 전에 모여, 그날 오전 9시부터 다음 날 오전 9시까지를 묶은 값입니다." : "")
        + (m.from && Date.parse(m.from) > kstMonthStart(Date.parse(m.until || m.from) - 1) + 3600000 ? " " + shortTime(m.from) + " 전 날짜는 집계가 없습니다." : ""))) : null,
    usageBlock("전송량 한눈에(무료 각 5GB)",
      usageTable(["", "전송량", "캐시 전송량"], [
        ["이번 달 지금까지", m ? amt(m.bytes) : "—", m ? amt(m.cached) : "—"],
        ["월말 예상", ep ? amt(ep.bytes) : "—", ep ? amt(ep.cached) : "—"],
        ["최근 24시간", e24 ? amt(e24.bytes) : "—", e24 ? amt(e24.cached) : "—"],
        ["한도까지 남음", m ? amt(Math.max(0, 5 * GB - m.bytes)) : "—", m ? amt(Math.max(0, 5 * GB - m.cached)) : "—"],
      ]),
      e24 && e24.unsized ? h("p", { class: "muted small" }, "최근 24시간 요청 " + e24.requests.toLocaleString() + "건 중 " + e24.unsized.toLocaleString() + "건은 크기가 기록되지 않아 「전송량」에서 빠졌습니다.") : null),
    days.length ? usageBlock("날마다 전송량(하루 = 한국 시간 0시~24시)",
      usageTable(["날짜", "전송량", "캐시 전송량"], days.map(([d, v]) => [d.slice(5).replace("-", "/") + egressDayNote(m, d), amt(v.bytes), amt(v.cached)]))) : null,
    srcs.length ? usageBlock("누가 받았나(이번 달)",
      usageTable(["어디서", "전송량", "캐시 전송량"], srcs.map(([k, v]) => [EGRESS_SRC[k] || k, amt(v.bytes), amt(v.cached)]))) : null,
    top && top.length ? usageBlock("최근 24시간 많이 나간 것",
      usageTable(["주소", "요청", "전송량"], top.filter((x) => x.bytes > 0).map((x) => [fileName(x.path), x.requests.toLocaleString() + "건", amt(x.bytes)]))) : null);
}

// Supabase: DB 안 숫자(db) + Worker가 관리 API로 모은 전송량·요청 수·서비스 상태(worker.supabase)
function supabaseView() {
  const d = usage.db && usage.db.data, w = usage.worker && usage.worker.data, s = w && w.supabase;
  if (!d) return usage.db && usage.db.error ? h("p", { class: "banner bad" }, "불러오지 못했습니다: " + usage.db.error) : h("p", { class: "muted small" }, "불러오는 중…");
  const noApi = !w ? "Worker 응답 없음" : !s ? "관리 토큰 필요" : null;
  const m = s && s.egressMonth;
  const since = m && Date.parse(m.from) > kstMonthStart() + 3600000 ? shortTime(m.from) + "부터 집계" : null;
  const ep = egressProjection(m);
  // 무료 프로젝트는 7일 동안 요청이 없으면 잠든다: 최근 7일 요청 기록 중 마지막으로 요청이 있었던 날로 센다
  const lastDay = s && s.apiCounts && [...s.apiCounts].reverse().find((x) => x.total_rest_requests + x.total_auth_requests + x.total_storage_requests + x.total_realtime_requests > 0);
  const idle = lastDay ? Math.max(0, Math.floor((Date.now() - Date.parse(lastDay.timestamp + "Z")) / 86400000)) : null;
  const items = [
    { label: "데이터베이스", used: d.db_bytes, limit: 500 * MB, fmt: "bytes", period: "누적" },
    { label: "파일 저장소", used: d.storage_bytes, limit: GB, fmt: "bytes", period: "누적", hint: d.storage_files + "개 파일 · 새 슬라이드는 Cloudflare R2에 저장(여기 남은 것은 예전 사본·PPTX)" },
    { label: "전송량", used: m ? m.bytes : null, limit: 5 * GB, fmt: "bytes", period: "이번 달", missing: noApi || (m ? null : "첫 집계 기다리는 중(매시 5분)"),
      hint: (ep ? "월말 예상 " + usageAmount(ep.bytes, "bytes") + " · " : "") + (since || "CDN 캐시를 거치지 않은 응답") },
    { label: "캐시 전송량", used: m ? m.cached : null, limit: 5 * GB, fmt: "bytes", period: "이번 달", missing: noApi || (m ? null : "첫 집계 기다리는 중(매시 5분)"),
      hint: (ep ? "월말 예상 " + usageAmount(ep.cached, "bytes") + " · " : "") + (since ? since + " · " : "") + "CDN 캐시에서 나간 슬라이드 그림 등" },
    { label: "접속 중 학생", used: d.online, limit: 200, period: "실시간", hint: "실시간 동시 연결 한도 200" },
    { label: "DB 연결", used: d.db_conn, limit: d.db_conn_max, period: "실시간" },
    { label: "로그인 사용자(MAU)", used: d.mau, limit: 50000, period: "이번 달", hint: "교사 계정 기준(학생은 세지 않음)" },
    { label: "일시정지까지", used: idle, limit: 7, fmt: "days", period: "실시간", missing: noApi, hint: "요청 없이 7일이 지나면 프로젝트가 잠듦(keep-alive가 매일 깨움)" },
  ];
  const KIND = { rest: "데이터", storage: "파일", auth: "로그인", realtime: "실시간", other: "기타" };
  const HEALTH = { db: "데이터베이스", auth: "로그인", rest: "데이터 API", realtime: "실시간", storage: "파일 저장소" };
  const e24 = s && s.egress24h;
  const stale = s && (!s.egressLast || Date.now() - Date.parse(s.egressLast) > 3 * 3600000);
  return [
    h("div", { class: "usage-grid" }, items.map(usageRing)),
    s && stale ? h("p", { class: "banner bad egress-stale" }, "전송량 매시 집계가 " + (s.egressLast ? shortTime(s.egressLast) + " 뒤로 멈춰 있습니다" : "아직 한 번도 되지 않았습니다")
      + ". 무료 요금제 로그는 하루만 남으므로 그보다 오래 멈추면 그동안의 전송량은 이번 달 합계에서 빠집니다.") : null,
    s ? egressView(m, ep, e24, s.top24h) : null,
    s && s.health ? h("div", { class: "usage-tags start" }, h("span", { class: "small" }, "서비스 상태"),
      s.health.map((x) => h("span", { class: "tag " + (x.healthy ? "ok" : "bad") }, (x.healthy ? "● " : "■ ") + (HEALTH[x.name] || x.name) + " " + (x.healthy ? "정상" : x.status)))) : null,
    h("div", { class: "usage-blocks" },
      e24 ? usageBlock("최근 24시간 요청·전송량",
        usageTable(["종류", "요청", "전송량"], Object.entries(e24.kinds).sort((a, b) => b[1].bytes - a[1].bytes)
          .map(([k, v]) => [KIND[k] || k, v.requests.toLocaleString() + "건", usageAmount(v.bytes, "bytes")])
          .concat([["합계", e24.requests.toLocaleString() + "건", usageAmount(e24.bytes + e24.cached, "bytes") + " (캐시 " + usageAmount(e24.cached, "bytes") + ")"]]))) : null,
      s && s.apiCounts ? usageBlock("최근 7일 요청 수(하루 = 한국 시간 " + DAY9 + ")",
        usageTable(["날짜", "데이터", "파일", "로그인", "실시간"], [...s.apiCounts].reverse().map((x) => [
          new Date(x.timestamp + "Z").toLocaleDateString("ko-KR", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short" }),
          x.total_rest_requests.toLocaleString(), x.total_storage_requests.toLocaleString(), x.total_auth_requests.toLocaleString(), x.total_realtime_requests.toLocaleString()]))) : null,
      d.tables ? usageBlock("표별 크기",
        usageTable(["표", "줄 수", "크기"], d.tables.map((t) => [t.name, Number(t.rows).toLocaleString(), usageAmount(t.bytes, "bytes")]))) : null),
    h("p", { class: "small" }, "학생 " + d.students + "명 · 수업 " + d.lessons + "개 · 응답 " + d.responses + "개"),
    h("p", { class: "muted small" }, (noApi === "관리 토큰 필요" ? "전송량·요청 수·서비스 상태는 Worker에 Supabase 관리 토큰이 들어가야 보입니다(PC에서 class-tools\\usage-setup.ps1 실행). " : "")
      + "전송량은 응답 크기가 적힌 것만 더합니다. 데이터 API의 압축 응답과 실시간 연결은 크기가 기록되지 않아 빠지므로 「전송량」은 실제보다 적게 나옵니다(슬라이드 그림인 「캐시 전송량」은 정확함). 실시간 메시지 수(월 200만 건)는 Supabase가 어떤 API로도 내주지 않습니다."
      + (s && s.errors && s.errors.length ? " (일부 못 받음: " + s.errors.join(", ") + ")" : "")),
  ];
}

function cloudflareView() {
  const u = usage.worker;
  if (!u) return h("p", { class: "muted small" }, "불러오는 중…");
  if (u.error) return h("p", { class: "banner bad" }, "불러오지 못했습니다: " + u.error);
  const d = u.data, a = d.analytics, r2 = d.r2;
  const missing = a ? null : "분석 토큰 필요";
  const daily = "Cloudflare 하루 한도는 한국 시간 오전 9시에 초기화", day9 = "오전 9시부터";
  const items = [
    { label: "중계(TURN) 접속 발급", used: d.turn.issued, limit: d.turn.limit, period: "이번 달", hint: "오늘 " + (d.turn.today || 0) + "장 · 다 쓰면 직접 연결(STUN)만 씀" },
    { label: "중계(TURN) 전송량", used: a && a.turnBytesMonth, limit: 1000 * GB, fmt: "bytes", period: "이번 달", missing },
    { label: "Worker 요청", used: a && a.workerRequestsToday, limit: 100000, period: day9, hint: daily + " · 슬라이드 그림 1장도 1번", missing },
    { label: "R2 슬라이드 저장", used: r2 && r2.bytes, limit: 10 * GB, fmt: "bytes", period: "누적", missing: r2 ? null : d.r2Error ? "못 받음" : "Worker 새로 배포 필요",
      hint: r2 && r2.objects.toLocaleString() + "개 파일" + (r2.from === "list" ? "(버킷 목록으로 셈)" : "") },
    { label: "R2 올리기·목록(Class A)", used: a && a.r2ClassAMonth, limit: 1000000, period: "이번 달", missing: a && a.r2ClassAMonth == null ? "Worker 새로 배포 필요" : missing, hint: "슬라이드 올리기 · 파일 목록" },
    { label: "R2 읽기(Class B)", used: a && a.r2ClassBMonth, limit: 10000000, period: "이번 달", missing: a && a.r2ClassBMonth == null ? "Worker 새로 배포 필요" : missing, hint: "학생 기기가 슬라이드 그림을 받은 횟수 · 내보내는 전송량은 무료" },
    { label: "KV 읽기", used: a && a.kvReadsToday, limit: 100000, period: day9, hint: daily, missing },
    { label: "KV 쓰기", used: a && a.kvWritesToday, limit: 1000, period: day9, hint: daily + " · 중계 접속 1장마다 2번", missing },
    { label: "KV 목록", used: a && a.kvListsToday, limit: 1000, period: day9, missing: a && a.kvListsToday == null ? "Worker 새로 배포 필요" : missing, hint: daily + " · 기타 관리 동기화 1번마다 1번" },
    { label: "KV 저장", used: a && a.kvBytes, limit: GB, fmt: "bytes", period: "누적", missing: a && a.kvBytes == null ? (a.kvListsToday == null ? "Worker 새로 배포 필요" : "아직 집계 없음") : missing,
      hint: a && a.kvKeys != null ? a.kvKeys.toLocaleString() + "개 키 · 하루 한 번 집계(한국 오전 9시에 날짜 바뀜)" : "하루 한 번 집계(한국 오전 9시에 날짜 바뀜)" },
  ];
  const hist = (d.turn.history || []).slice().reverse();
  return [
    h("div", { class: "usage-grid" }, items.map(usageRing)),
    hist.length ? h("div", { class: "usage-blocks" }, usageBlock("달마다 중계 접속 발급",
      usageTable(["달", "발급", "한도 대비"], hist.map((x) => [x.month, x.issued.toLocaleString() + "장", Math.round(x.issued / d.turn.limit * 100) + "%"])))) : null,
    a ? null : h("p", { class: "muted small" }, "중계 전송량·Worker 요청·R2 요청·KV 사용량은 Cloudflare 읽기 전용 분석 토큰이 있어야 보입니다(PC에서 class-tools\\usage-setup.ps1 실행)."
      + (d.analyticsError && d.analyticsError !== "no token" ? " (" + d.analyticsError + ")" : "")),
  ];
}

// 동기화 비용: 이 탭이 사용량을 받느라 무료 한도를 얼마나 쓰는지. 마지막 동기화에서 잰 값 × 하루 자동 동기화 횟수(이 탭을 하루 종일 켜 둔 최악의 경우).
// Worker 매시 집계(cron)는 탭과 상관없이 하루 24번 돈다. 아직 Worker가 재지 않았으면 코드대로 센 값(CRON_COST)을 쓴다.
const AUTO_PER_DAY = 86400000 / ETC_AUTO_MS;
const CRON_COST = { kvRead: 2, kvList: 0, kvWrite: 2, r2ClassA: 0, sbRest: 0, sbApi: 1, cfApi: 0 };
function syncCostView() {
  const net = (k) => usage[k] && usage[k].net;
  const db = net("db"), wk = net("worker"), gh = net("github");
  if (!db && !wk && !gh) return h("p", { class: "muted small" }, usageBusy ? "불러오는 중…" : "아직 동기화한 적이 없습니다.");
  const w = usage.worker && usage.worker.data;
  const c = w && w.cost;
  const m = w && w.supabase && w.supabase.egressMonth;
  const cron = (m && m.cron) || CRON_COST;
  const noCost = c ? null : "Worker 새로 배포 필요";
  const day = (perSync, perCron = 0) => AUTO_PER_DAY * perSync + 24 * perCron;
  const ghCounted = gh ? Math.max(0, gh.requests - 1) : 0;   // rate_limit 요청은 한도에 세지 않는다
  const dbBytes = db ? db.bytes : 0;
  const items = [
    { label: "Worker 요청", used: day(wk ? 1 : 0, 1), limit: 100000, period: "하루", hint: "동기화 " + AUTO_PER_DAY + "번 + 매시 집계 24번" },
    { label: "KV 읽기", used: c && day(c.kvRead, cron.kvRead), limit: 100000, period: "하루", missing: noCost },
    { label: "KV 목록", used: c && day(c.kvList, cron.kvList), limit: 1000, period: "하루", missing: noCost },
    { label: "KV 쓰기", used: c && day(c.kvWrite, cron.kvWrite), limit: 1000, period: "하루", missing: noCost, hint: "거의 다 매시 집계가 씀" },
    { label: "R2 목록(Class A)", used: c && day(c.r2ClassA) * 30, limit: 1000000, period: "한 달", missing: noCost },
    { label: "Supabase 전송량", used: day(dbBytes) * 30, limit: 5 * GB, fmt: "bytes", period: "한 달", hint: "DB 함수 응답 " + usageAmount(dbBytes, "bytes") + " × " + AUTO_PER_DAY * 30 + "번(압축 전)" },
    { label: "GitHub API", used: ghCounted, limit: 60, period: "1시간", hint: "자동은 1시간에 1번 · 버튼을 10분마다 눌러도 최대 " + ghCounted * 6 + "건" },
  ];
  const n = (v) => (v == null ? "—" : Number(v).toLocaleString());
  const times = (v, unit = "번") => (v == null ? "—" : n(v) + unit);
  const rows = [
    ["교사 브라우저 → Supabase DB 함수", "DB 크기·연결·학생 수 계산(Supabase 서버)", db ? times(db.requests, "건") + " · " + usageAmount(db.bytes, "bytes") : "—", db ? times(day(db.requests), "건") : "—"],
    ["교사 브라우저 → Worker", "Cloudflare·Supabase 사용량 모으기", wk ? times(wk.requests, "건") + " · " + usageAmount(wk.bytes, "bytes") : "—", wk ? times(day(wk.requests), "건") : "—"],
    ["└ Worker → KV 읽기 · 목록 · 쓰기", "TURN 장수·전송량 합계 읽기", c ? n(c.kvRead) + " · " + n(c.kvList) + " · " + n(c.kvWrite) : "—", c ? n(day(c.kvRead)) + " · " + n(day(c.kvList)) + " · " + n(day(c.kvWrite)) : "—"],
    ["└ Worker → R2 목록", "슬라이드 저장량(분석에 아직 없을 때만)", c ? times(c.r2ClassA) : "—", c ? times(day(c.r2ClassA)) : "—"],
    ["└ Worker → Supabase 교사 확인", "교사만 보게(데이터 API 1건)", c ? times(c.sbRest, "건") : "—", c ? times(day(c.sbRest), "건") : "—"],
    ["└ Worker → Supabase 관리 API", "로그 집계·요청 수·서비스 상태(Supabase 서버 계산 · 프로젝트 전송량에 안 셈)", c ? times(c.sbApi, "건") : "—", c ? times(day(c.sbApi), "건") : "—"],
    ["└ Worker → Cloudflare 분석", "Worker·KV·R2·TURN 사용량(Cloudflare 서버 계산)", c ? times(c.cfApi, "건") : "—", c ? times(day(c.cfApi), "건") : "—"],
    ["교사 브라우저 → GitHub API", "저장소·자동 실행 정보(한도에 세는 것 " + ghCounted + "건)", gh ? times(gh.requests, "건") + " · " + usageAmount(gh.bytes, "bytes") : "—", gh ? times(day(gh.requests), "건") : "—"],
  ];
  return [
    h("p", { class: "small" }, "자동 동기화는 1시간마다(이 탭이 열려 있고 화면에 보일 때만), 「동기화」 버튼은 마지막 동기화 뒤 10분이 지나야 다시 됩니다. "
      + "계산은 각 서비스 서버가 하고(Supabase DB 함수 · Supabase 로그 · Cloudflare 분석) 이 브라우저는 받은 숫자로 그림만 그립니다. 학생 기기는 쓰지 않습니다."),
    h("div", { class: "usage-grid" }, items.map(usageRing)),
    h("p", { class: "muted small" }, "원 그래프는 이 탭을 하루 종일 켜 둔 최악의 경우(자동 동기화 하루 " + AUTO_PER_DAY + "번 + 매시 집계 24번)가 무료 한도에서 차지하는 몫입니다."),
    h("div", { class: "usage-blocks" },
      h("div", { class: "usage-block wide" }, h("h4", {}, "동기화 1번에 드는 것(마지막 동기화에서 잼)"), usageTable(["어디로", "하는 일", "1번", "하루(자동 " + AUTO_PER_DAY + "번)"], rows)),
      h("div", { class: "usage-block wide" }, h("h4", {}, "Worker 매시 집계(매시 5분 · 탭과 상관없음)"), usageTable(["무엇", "1번", "하루(24번)"], [
        ["KV 읽기 · 쓰기", n(cron.kvRead) + " · " + n(cron.kvWrite), n(24 * cron.kvRead) + " · " + n(24 * cron.kvWrite)],
        ["Supabase 관리 API(전송량 로그)", times(cron.sbApi, "건"), times(24 * cron.sbApi, "건")],
        ["Worker 실행", "1번", "24번"],
      ]), h("p", { class: "muted small" }, m && m.cron ? "마지막 집계 " + shortTime(m.cron.at) + "에 잰 값" : "아직 Worker가 재지 않아 코드대로 센 값입니다."))),
  ];
}

function githubView() {
  const u = usage.github;
  if (!u) return h("p", { class: "muted small" }, "불러오는 중…");
  if (u.error) return h("p", { class: "banner bad" }, "불러오지 못했습니다: " + u.error);
  const { repo, rate, runsThisMonth, recent, alive } = u.data;
  // 공개 저장소에 60일 동안 아무 변화가 없으면 GitHub가 예약 실행(keep-alive)을 멈춘다 → Supabase가 7일 뒤 잠든다
  const idleDays = Math.floor((Date.now() - Date.parse(repo.pushed_at)) / 86400000);
  const RESULT = { success: "성공", failure: "실패", cancelled: "취소", skipped: "건너뜀" };
  const items = [
    { label: "저장소(사이트) 크기", used: repo.size * 1024, limit: GB, fmt: "bytes", period: "누적", hint: "GitHub Pages 사이트 한도 1GB" },
    { label: "keep-alive 멈춤까지", used: idleDays, limit: 60, fmt: "days", period: "실시간", hint: "마지막 변경 " + shortTime(repo.pushed_at) + " · 60일 지나면 멈춤" },
    { label: "GitHub API(이 PC)", used: rate.used, limit: rate.limit, period: "1시간", hint: kstClock(rate.reset * 1000) + "에 초기화" },
  ];
  return [
    h("div", { class: "usage-grid" }, items.map(usageRing)),
    h("div", { class: "usage-blocks" }, usageBlock("최근 자동 실행(Actions)",
      usageTable(["작업", "시각", "결과"], recent.map((r) => [r.name, shortTime(r.created_at), RESULT[r.conclusion] || r.conclusion || (r.status === "in_progress" ? "실행 중" : r.status)])))),
    h("p", { class: "small" }, "이번 달 Actions 실행 " + runsThisMonth + "회(공개 저장소라 무료) · "
      + (alive ? "keep-alive 마지막 실행 " + shortTime(alive.created_at) + " " + (RESULT[alive.conclusion] || alive.conclusion || alive.status) : "keep-alive 실행 기록 없음")
      + " · 기본 가지 " + repo.default_branch + " · 열린 PR·이슈 " + repo.open_issues_count + "개"),
    h("p", { class: "muted small" }, "GitHub Pages 전송량(월 100GB 권장)은 GitHub가 어떤 API로도 내주지 않습니다."),
  ];
}

function paintEtc() {
  if (tab !== "etc" || !main) return;
  const last = lastSync();
  const section = (name, what, body) => h("section", { class: "card stack usage-card" },
    h("div", {}, h("h3", {}, name), h("span", { class: "muted small" }, what)), body);
  main.replaceChildren(h("div", { class: "stack" },
    h("div", { class: "row between" },
      h("div", {},
        h("h2", {}, "기타 관리"),
        h("p", { class: "muted small" }, "이 웹앱이 쓰는 바깥 서비스의 무료 한도 대비 사용량 · 초록 여유, 주황 주의(60% 이상), 빨강 위험(85% 이상)")),
      h("div", { class: "row" },
        last ? h("span", { class: "muted small" }, "마지막 동기화 " + kstClock(last) + " · 다음 자동 " + kstClock(last + ETC_AUTO_MS, { hour: "2-digit", minute: "2-digit" }) + " (한국 시간)") : null,
        syncButton())),
    section("Supabase", "데이터베이스 · 파일 · 전송량 · 로그인", supabaseView()),
    section("Cloudflare", "중계 서버(TURN) · Worker · R2 슬라이드 저장소 · KV", cloudflareView()),
    section("GitHub", "사이트 · 자동 실행", githubView()),
    section("동기화 비용", "이 탭이 사용량을 받느라 쓰는 무료 한도", syncCostView())));
}

// 슬라이드 PDF: 슬라이드마다 한 쪽. 애니메이션 단계 그림 수업이면 각 슬라이드의 마지막 단계(모두 나타난 화면)를 쓴다.
async function loadJsPdf() {
  if (!window.jspdf) {
    await new Promise((ok, fail) => document.head.append(h("script", {
      src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
      onload: ok, onerror: () => fail(new Error("PDF 도구를 불러오지 못했습니다")),
    })));
  }
  return window.jspdf.jsPDF;
}
function pdfPages(l) {
  const steps = slideSteps(l);
  if (!steps) return Array.from({ length: l.slide_count }, (_, i) => i + 1);
  let first = 1;
  return steps.map((n) => { const p = first + n - 1; first += n; return p; });
}
async function exportSlidesPdf(l, msg) {
  if (!l.slide_count) { msg.textContent = "슬라이드가 없는 수업입니다."; return; }
  if (isPptx(l)) { msg.textContent = "PowerPoint 파일 그대로 올린 수업은 여기서 PDF로 바꿀 수 없습니다. PowerPoint에서 PDF로 저장해 주세요."; return; }
  try {
    const JsPdf = await loadJsPdf();
    const pages = pdfPages(l);
    let doc = null;
    for (const [i, pg] of pages.entries()) {
      msg.textContent = "PDF 만드는 중 " + (i + 1) + " / " + pages.length;
      const blob = await (await fetch(slideSrc(l, pg))).blob();
      const bmp = await createImageBitmap(blob);
      const w = bmp.width, hh = bmp.height;
      const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
      const orient = w >= hh ? "landscape" : "portrait";
      if (!doc) doc = new JsPdf({ orientation: orient, unit: "px", format: [w, hh], hotfixes: ["px_scaling"] });
      else doc.addPage([w, hh], orient);
      doc.addImage(url, /png/i.test(blob.type) ? "PNG" : "JPEG", 0, 0, w, hh);
    }
    doc.save((l.title || l.code).replace(/[\\/:*?"<>|]/g, "_") + "_슬라이드.pdf");
    msg.textContent = "PDF를 받았습니다 (" + pages.length + "쪽).";
  } catch (e) {
    msg.textContent = "PDF를 만들지 못했습니다: " + (e.message || e);
  }
}

// ---------- 수업 진행 ----------
let run = null;

function drawRun() {
  const img = h("img", { class: "slide", alt: "" });
  const where = h("span", { class: "where" });
  // 화살표 두 개: 애니메이션 한 단계씩 앞뒤로(그 슬라이드의 애니메이션이 끝나면 다음 슬라이드로). 키보드 ← → 와 같다
  const prev = h("button", { class: "ghost arrow", type: "button", title: "애니메이션 이전 (←)", "aria-label": "애니메이션 이전", onclick() { setPage(lesson.page - 1); } }, "◀");
  const next = h("button", { class: "primary arrow", type: "button", title: "애니메이션 다음 (→)", "aria-label": "애니메이션 다음", onclick() { setPage(lesson.page + 1); } }, "▶");
  const deckBtn = h("button", { class: "ghost", type: "button", title: "Office 온라인 뷰어로 원본 애니메이션을 재생합니다(학생 화면은 따라오지 않음)",
    onclick() { openPptxFull({ slide_dir: "pptx:" + deckUrl(lesson), slide_count: slideTotal(lesson) }, slideNo(lesson, lesson.page)); } }, "원본 애니메이션 보기");
  const openBtn = h("button", { type: "button", onclick() { setLesson({ open: !lesson.open }); } });
  const openText = h("span", {});
  const simStage = h("div", { class: "sim-stage", hidden: true });
  const simLayer = h("div", { class: "sim-layer" });   // 슬라이드 위에 얹는 시뮬레이션(끌어서 옮기기)
  const stage = h("div", { class: "stage" }, img, simStage, simLayer);
  const resync = () => { if (run && run.img === img) syncSimLayer(simLayer, img); };
  img.addEventListener("load", resync);
  stage.addEventListener("fullscreenchange", () => setTimeout(resync, 50));
  const panel = h("div", { class: "stack" });
  const roster = h("section", { class: "card stack" });
  const hasSlides = lesson.slide_count > 0;
  main.classList.add("run-page");
  main.replaceChildren(h("div", { class: "run" },
    h("div", { class: "run-left stack" },
      hasSlides ? stage : h("p", { class: "card muted" }, lesson.kind === "survey" ? "설문 전용입니다. 학생 화면에는 모든 설문이 보입니다." : "슬라이드가 없는 수업입니다. 학생 화면에는 모든 활동이 보입니다."),
      // 접속 QR·CSV 버튼도 화살표 줄에 함께 둔다(왼쪽이 창 한 화면에 들어가도록 줄 수를 줄임)
      h(hasSlides ? "nav" : "div", { class: hasSlides ? "pager" : "row" },
        hasSlides ? [prev, where, next, h("span", { class: "spacer" })] : null,
        h("button", { class: "ghost", type: "button", onclick: showJoin }, "학생 접속 주소·QR"),
        h("button", { class: "ghost", type: "button", onclick() { downloadCSV(activities, lesson.code + "_전체응답"); } }, "전체 응답 CSV"),
        hasSlides ? [deckBtn, h("button", { class: "ghost", type: "button", onclick() { if (stage.requestFullscreen) stage.requestFullscreen(); } }, "전체 화면")] : null),
      hasSlides ? h("p", { class: "muted small" }, slideSteps(lesson)
        ? "학생 화면은 여기서 띄운 쪽과 애니메이션 단계를 따라갑니다. 키보드 ← → 는 PowerPoint처럼 애니메이션을 하나씩 넘깁니다."
        : "학생 화면은 여기서 띄운 쪽을 따라갑니다. 키보드 ← → 로도 넘길 수 있습니다.") : null),
    h("aside", { class: "run-right stack" },
      h("section", { class: "card row between" }, openText, openBtn),
      roster,
      panel)));
  run = { img, stage, simStage, simLayer, simKey: "", pptKey: "", where, prev, next, deckBtn, openBtn, openText, panel, roster, blocks: new Map() };
  refreshRun();
  pinRun();
}

// 수업 진행을 넓은 화면에서 창 높이에 맞춘다: 왼쪽(슬라이드)은 고정, 오른쪽(제출·명단·활동)만 안에서 스크롤.
let runPin = null;
function pinRun() {
  if (runPin) { runPin.ro.disconnect(); removeEventListener("resize", runPin.fit); runPin = null; }
  const box = main.querySelector(".run");
  if (!box) return;
  const head = app.querySelector(".top");
  const credit = document.querySelector(".credit");
  const left = box.querySelector(".run-left");
  const stage = left && left.querySelector(".stage");
  const fit = () => {
    if (!box.isConnected) return;
    if (!matchMedia("(min-width: 1100px)").matches) {
      box.classList.remove("pinned"); box.style.height = "";
      if (stage) stage.style.maxWidth = "";
      return;
    }
    box.classList.add("pinned");
    // 머리말, main 위쪽 여백(1rem), 맨 아래 만든 사람 줄을 뺀 나머지
    const used = (head ? head.getBoundingClientRect().height : 0) + 16 + (credit ? credit.getBoundingClientRect().height : 0);
    box.style.height = Math.max(320, Math.floor(innerHeight - used)) + "px";
    // 왼쪽이 스크롤 없이 한 화면에 들어가도록, 화살표·버튼·안내 줄을 뺀 높이에 맞춰 슬라이드(16:9) 너비를 줄인다
    if (stage) {
      const others = [...left.children].filter((el) => el !== stage);
      const gap = parseFloat(getComputedStyle(left).rowGap) || 0;
      const rest = others.reduce((s, el) => s + el.getBoundingClientRect().height, 0) + gap * others.length;
      stage.style.maxWidth = Math.max(240, Math.floor((left.clientHeight - rest - 2) * 16 / 9)) + "px";
    }
  };
  const ro = new ResizeObserver(fit);
  if (head) ro.observe(head);
  if (credit) ro.observe(credit);
  if (left) for (const el of left.children) if (el !== stage) ro.observe(el);
  addEventListener("resize", fit);
  runPin = { ro, fit };
  fit();
}

function refreshRun() {
  if (!run) return;
  const L = lesson;
  if (L.slide_count > 0) {
    if (isPptx(L)) {
      const key = L.slide_dir + ":" + L.page;
      run.img.hidden = true;
      if (run.pptKey !== key) {
        run.stage.querySelector(".pptx-frame")?.remove();
        run.stage.insertBefore(pptxFrame(L, L.page), run.simStage);
        run.pptKey = key;
      }
    } else {
      run.stage.querySelector(".pptx-frame")?.remove();
      run.pptKey = "";
      run.img.hidden = false;
      const last = run.lastPage || L.page;
      swapSlide(run.img, slideSrc(L, L.page), slideFx(L), slideNo(L, last) === slideNo(L, L.page) ? (last === L.page ? 1 : 0) : Math.sign(L.page - last));
      run.lastPage = L.page;
      run.img.alt = "슬라이드 " + L.page;
    }
    run.where.textContent = slideLabel(L, L.page);
    run.prev.disabled = L.page <= 1;
    run.next.disabled = L.page >= L.slide_count;
    run.deckBtn.hidden = !deckUrl(L);
    if (L.page < L.slide_count) new Image().src = slideSrc(L, L.page + 1);
  }
  run.openText.replaceChildren(h("strong", {}, L.open ? "제출 받는 중" : "제출 닫힘"),
    h("span", { class: "muted small" }, " · 입장 " + students.length + "명"));
  run.openBtn.className = L.open ? "ghost" : "primary";
  run.openBtn.textContent = L.open ? "제출 마감" : "제출 열기";

  const sn = slideNo(L, L.page);
  const shown = activities.filter((a) => L.slide_count === 0 || onPage(a, sn) || a.page == null);
  // 「슬라이드 자리에 띄우기」 시뮬레이션: 교사 화면에서도 슬라이드 대신 띄운다(다시 그릴 때마다 새로 띄우지 않게 key로 확인)
  const stageSim = L.slide_count > 0 ? shown.find((a) => a.kind === "sim" && a.sim_full && onPage(a, sn)) || shown.find((a) => a.sim_full && allPagesSim(a)) || null : null;
  const simKey = stageSim ? stageSim.id + ":" + (stageSim.html || "").length + ":" + stageSim.title : "";
  if (!isPptx(L)) run.img.hidden = !!stageSim;
  const pptFrame = run.stage.querySelector(".pptx-frame");
  if (pptFrame) pptFrame.hidden = !!stageSim;
  run.simStage.hidden = !stageSim;
  if (simKey !== run.simKey) {
    run.simKey = simKey;
    run.simStage.replaceChildren(...(stageSim ? [simFrame(stageSim.html, stageSim.title)] : []));
  }
  // 슬라이드 위에 얹는 시뮬레이션: 위쪽 막대를 끌어 옮기면 바로 저장되고 학생 화면에도 그 자리에 보인다
  const overs = L.slide_count > 0 && !isPptx(L) && !stageSim ? shown.filter((a) => isOverSim(a) && simOnSlide(a, sn)) : [];
  syncSimLayer(run.simLayer, run.img);
  renderSimLayer(run.simLayer, overs, {
    load: (a) => a.html, ver: (a) => (a.html || "").length + ":" + a.title, editable: true,
    onMove: (a, p) => setActivity(a, { sim_place: p }),
  });
  drawRoster(shown.filter((a) => a.kind !== "sim"));
  run.panel.replaceChildren(...(shown.length ? shown.map(runBlock)
    : [h("p", { class: "card muted" }, sn + "쪽에는 활동이 없습니다. 「자료 추가」에서 추가하세요.")]));
}

addEventListener("resize", () => { if (run && run.simLayer) syncSimLayer(run.simLayer, run.img); });

// ---------- 실시간 접속 표시 ----------
// 학생 화면은 수업 채널에 접속 상태(보고 있음/다른 앱·탭)만 알린다(Supabase Presence). 화면 데이터는 보내지 않는다.
// 채널에 붙기 전에는 예전처럼 마지막 접속 시각(20초)으로 판단한다.
const ONLINE_MS = 20000;
const PRESENCE_TEXT = { on: "수업 화면을 보고 있음", away: "접속했지만 다른 앱·탭에 있음", off: "접속 안 함" };
let presence = {};   // 학생 id 또는 학번·이름 키 → { away }
function presenceOf(s) {
  if (!screenChannel || screenChannel.state !== "joined") return s.last_seen && Date.now() - Date.parse(s.last_seen) < ONLINE_MS ? "on" : "off";
  const p = presence[s.id] || presence[screenKey(s)];
  return p ? (p.away ? "away" : "on") : "off";
}
function setDot(el, st) {
  el.className = "presence " + st;
  el.title = PRESENCE_TEXT[st];
  el.setAttribute("aria-label", PRESENCE_TEXT[st]);
}
function presenceDot(s) {
  const el = h("span", { "data-sid": s.id });
  setDot(el, presenceOf(s));
  return el;
}
function updatePresence() {
  presence = {};
  for (const [k, metas] of Object.entries(screenChannel ? screenChannel.presenceState() : {})) presence[k] = { away: metas.every((m) => m.away) };
  document.querySelectorAll(".presence[data-sid]").forEach((el) => {
    const s = students.find((x) => x.id === el.dataset.sid);
    if (s) setDot(el, presenceOf(s));
  });
  if (tab === "run" && run) refreshRun();
}

// 접속한 학생: 초록 = 수업 화면을 보고 있음, 주황 = 다른 앱·탭, ✓ = 이 쪽 활동에 답함
function rosterChips(shown, big) {
  const ids = new Set(shown.map((a) => a.id));
  return h("div", { class: "roster" + (big ? " big" : "") }, students.map((s) => {
    const st = presenceOf(s);
    const done = shown.length && responses.some((r) => r.student_id === s.id && ids.has(r.activity_id));
    return h("span", { class: "chip" + (st === "on" ? " on" : st === "away" ? " away" : "") + (done ? " done" : ""), title: PRESENCE_TEXT[st] }, nameOf(s));
  }));
}

function drawRoster(shown) {
  const online = students.filter((s) => presenceOf(s) !== "off").length;
  run.roster.replaceChildren(
    h("div", { class: "row between" },
      h("h2", {}, "접속 중 " + online + "명", h("span", { class: "muted small" }, " · 입장 " + students.length + "명")),
      h("button", { class: "ghost", type: "button", onclick() { openModal("입장한 학생", rosterChips(shown, true)); } }, "크게 보기")),
    students.length ? rosterChips(shown) : h("p", { class: "muted small" }, "아직 입장한 학생이 없습니다."),
    students.length ? h("p", { class: "muted small" }, "초록: 수업 화면을 보고 있음 · 주황: 다른 앱·탭 · ✓: " + (lesson.slide_count ? "이 쪽" : "") + " 활동에 답함") : h("span", {}));
}

function runBlock(a) {
  if (a.kind === "sim") return h("section", { class: "card stack" },
    h("div", { class: "row between" },
      h("div", {}, h("p", { class: "muted small" }, "시뮬레이션 · " + whereText(a)), h("h2", {}, a.title)),
      h("button", { class: "primary", type: "button", onclick() { showFloatingSim(a.title, a.html, a.id + ":" + (a.html || "").length); } }, "화면에 띄우기"),
      h("button", { class: "ghost", type: "button", onclick() { openSimFull(a.title, a.html); } }, "크게 실행")),
    lesson.slide_count && (a.sim_place || a.sim_full) && a.page == null
      ? h("p", { class: "error small" }, "쪽이 정해지지 않아 슬라이드에 붙지 않습니다. 「자료 추가」에서 이 시뮬레이션을 고쳐 쪽 번호를 정하고 저장하세요.") : null,
    h("p", { class: "pill" }, !lesson.slide_count ? "학생 화면: 카드로 보임" : a.sim_full ? "학생 화면: 슬라이드 자리에 크게 보임"
      : a.sim_place ? "학생 화면: 슬라이드 위에 얹어 보임(왼쪽 화면에서 끌어 옮기기)" : "학생 화면: 슬라이드 아래 카드로 보임"));
  if (isInfoActivity(a)) return h("section", { class: "card stack" },
    h("div", { class: "row between" },
      h("div", {}, h("p", { class: "muted small" }, "설명 카드 · " + whereText(a)), h("h2", {}, a.title)),
      h("button", { type: "button", class: a.shared ? "ghost" : "primary", async onclick() { await setActivity(a, { shared: !a.shared }); } }, a.shared ? "공개 끝내기" : "학생에게 공개")),
    h("p", { class: a.shared ? "pill on" : "pill" }, a.shared ? "학생에게 공개 중" : "학생에게는 보이지 않음"),
    linkedDescription(a.questions[0].text));
  const docs = docsOf(a);
  const scored = docs.filter((d) => d.r.total);
  const avg = scored.length ? (scored.reduce((s, d) => s + d.r.score / d.r.total, 0) / scored.length * 100).toFixed(0) + "점" : null;
  return h("section", { class: "card stack" },
    h("div", { class: "row between" },
      h("div", {},
        h("p", { class: "muted small" }, KIND_NAME[a.kind] + " · " + whereText(a)),
        h("h2", {}, a.title)),
      h("button", {
        type: "button", class: a.shared ? "ghost" : "primary",
        async onclick() { await setActivity(a, { shared: !a.shared }); },
      }, a.shared ? "공개 끝내기" : "학생에게 공개")),
    h("p", { class: a.shared ? "pill on" : "pill" }, a.shared ? "학생에게 공개 중 (" + nameModeText(a) + ")" : "학생에게는 보이지 않음"),
    h("p", { class: "muted small" }, "응답 " + docs.length + " / " + students.length + "명" + (avg ? " · 평균 " + avg : "")),
    summaryView(a.questions, docs),
    h("div", { class: "row" },
      h("button", { class: "ghost", type: "button", onclick() { openModal(a.title, h("div", { class: "big-view" }, summaryView(a.questions, docsOf(a)))); } }, "크게 보기"),
      h("button", { class: "ghost", type: "button", onclick() { openModal(a.title + " · 학생별", responseTable(a)); } }, "학생별 표"),
      h("button", { class: "ghost", type: "button", onclick() { downloadCSV([a], lesson.code + "_" + a.title); } }, "CSV")));
}

function responseTable(a) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "학번"), h("th", {}, "이름"), a.kind === "quiz" ? h("th", {}, "점수") : null,
      a.questions.map((q, i) => h("th", {}, (i + 1) + ". " + q.text)), h("th", {}, "저장"))),
    h("tbody", {}, students.map((s) => {
      const r = responses.find((x) => x.activity_id === a.id && x.student_id === s.id);
      return h("tr", { class: r ? "" : "missing" }, h("td", {}, s.class_no), h("td", {}, s.name),
        a.kind === "quiz" ? h("td", {}, r && r.total ? r.score + "/" + r.total : "") : null,
        a.questions.map((q) => h("td", {}, r ? answerText(r.answers[q.id]) : "")),
        h("td", {}, r ? fmtTime(r.updated_at) : "미제출"));
    }))));
}


async function setPage(n) {
  n = Math.min(Math.max(n, 1), Math.max(lesson.slide_count, 1));
  if (n === lesson.page) return;
  await setLesson({ page: n });
}

async function setLesson(change) {
  Object.assign(lesson, change);
  refreshRun();
  const { error } = await sb.from("lessons").update(change).eq("id", lesson.id);
  if (error) fatal(error);
}

async function setActivity(a, change) {
  Object.assign(a, change);
  refreshRun();
  const { error } = await sb.from("activities").update(change).eq("id", a.id);
  if (error) fatal(error);
}

function joinUrl(l) {
  return new URL("index.html?c=" + encodeURIComponent(l.code), location.href).href;
}

function showJoin() {
  const url = joinUrl(lesson);
  const qr = h("div", { class: "qr" });
  openModal("학생 접속", h("div", { class: "join" }, qr,
    h("div", { class: "stack" },
      h("p", { class: "join-code" }, "수업 코드 ", h("strong", {}, lesson.code)),
      h("p", { class: "join-url" }, url),
      h("button", { class: "ghost", type: "button", onclick(e) { navigator.clipboard.writeText(url).then(() => { e.target.textContent = "복사했습니다"; }); } }, "주소 복사"))));
  if (window.QRCode) new QRCode(qr, { text: url, width: 320, height: 320 });
  else qr.textContent = "QR을 만들지 못했습니다(인터넷 연결 확인).";
}

// ---------- 자료 추가 ----------
const newId = () => Math.random().toString(36).slice(2, 8);
const newQuestion = (type) => ({ id: newId(), type: type || "choice", text: "", options: ["", ""], anon: true });

// 만들기 탭의 시뮬레이션 미리보기 칸. 다시 그려도 같은 칸을 다시 써서 시뮬레이션이 처음부터 다시 시작하지 않게 한다.
// 처음에는 멈춘 상태이고, 제목 아래 재생/일시정지 버튼(play)으로 돌린다. 넓은 화면으로 그려 줄여 보여 준다(box).
const buildSimFrames = new Map();
function buildSimFrame(a) {
  const key = a.id + ":" + (a.html || "").length;
  let s = buildSimFrames.get(a.id);
  if (!s || s.key !== key) {
    const f = simFrame(withSimPause(a.html || ""), a.title);
    s = { key, box: simScaled(f), play: simPlayButton(f) };
    buildSimFrames.set(a.id, s);
  }
  return s;
}

// 활동 내용 미리보기: 시뮬레이션은 실행 화면, 설명 카드는 글, 질문은 질문과 보기
function activityPreview(a) {
  if (a.kind === "sim") return a.html ? buildSimFrame(a).box : h("p", { class: "muted small" }, "html이 없습니다.");
  if (isInfoActivity(a)) return linkedDescription(a.questions[0].text);
  const intro = activityDescription(a);
  return h("div", { class: "stack" }, intro ? linkedDescription(intro) : null,
    (a.questions || []).map((q, i) => h("div", { class: "sum-block" },
      h("p", { class: "sum-q" }, (i + 1) + ". " + q.text, h("span", { class: "muted small" }, " · " + (isChoice(q) ? "객관식" : "서술형"))),
      (q.type === "choice" || q.type === "multi") ? h("ul", { class: "preview-options" }, (q.options || []).filter(Boolean).map((o) =>
        h("li", { class: a.kind === "quiz" && [].concat(q.answer ?? []).includes(o) ? "right" : "" }, o,
          a.kind === "quiz" && [].concat(q.answer ?? []).includes(o) ? h("strong", { class: "right-mark" }, " ✓정답") : null))) : null)));
}

// 오른쪽 활동 목록이 바뀌었는지 가리는 표시(시뮬레이션 html은 길이만 본다)
// 활동 칸 하나의 내용 열쇠. 쪽·순서는 빼서, 쪽만 옮기거나 순서만 바꾸면 칸을 새로 만들지 않는다
const rowKey = (a) => JSON.stringify({ ...a, html: (a.html || "").length, page: 0, page_to: 0, sort: 0 });

// 활동 칸의 「수정/수정 중」 표시만 지금 편집 중인 활동에 맞춘다
function markEditingRow(row, a) {
  const on = !!(editing && (editing.blocks ? editing.blocks.some((b) => b.id === a.id) : editing.id === a.id));
  row.classList.toggle("on", on);
  const btn = row.querySelector(".act-edit");
  if (btn) { btn.className = "act-edit " + (on ? "primary" : "ghost"); btn.textContent = on ? "수정 중" : "수정"; }
}

// 활동 목록의 쪽 칸: 숫자와 「쪽」을 나눠 두고, ▲▼를 누르거나 숫자를 고쳐 쪽을 옮긴다(여러 쪽에 걸친 활동은 끝 쪽도 함께)
function pageCell(a) {
  if (a.page == null || !lesson.slide_count) return h("strong", { class: "act-page" }, whereText(a));
  const max = Math.max(slideTotal(lesson), 1);
  const num = h("input", { type: "text", inputmode: "numeric", maxlength: 3, class: "act-num", value: a.page, "aria-label": "쪽 번호",
    onkeydown(ev) { if (ev.key === "Enter") num.blur(); else if (ev.key === "Escape") { num.value = a.page; num.blur(); } },
    onchange() { const n = parseInt(num.value, 10); if (n >= 1) movePage(a, n); else num.value = a.page; } });
  const step = (d) => h("button", { type: "button", class: "act-step", "aria-label": d > 0 ? "한 쪽 뒤로" : "한 쪽 앞으로",
    disabled: d > 0 ? a.page >= max : a.page <= 1, onclick() { movePage(a, a.page + d); } }, d > 0 ? "▲" : "▼");
  return h("div", { class: "act-page split" },
    h("div", { class: "act-spin" }, step(1), num, step(-1)),
    h("span", { class: "act-unit" }, (a.page_to > a.page ? "~" + a.page_to : "") + "쪽"));
}

async function movePage(a, n) {
  const max = Math.max(slideTotal(lesson), 1);
  n = Math.max(1, Math.min(n, max));
  if (n === a.page) { drawBuild(); return; }
  const change = { page: n };
  if (a.page_to > a.page) { const to = Math.min(a.page_to + n - a.page, max); change.page_to = to > n ? to : null; }
  Object.assign(a, change);
  // 이 활동만 고치는 중이면 편집기의 표시 위치도 맞춘다
  if (editing && (editing.blocks ? editing.blocks.length === 1 && editing.blocks[0].id === a.id : editing.id === a.id)) {
    Object.assign(editing, change);
    rebase(editing, (base) => Object.assign(base, change));
  }
  drawBuild();
  const { error } = await sb.from("activities").update(change).eq("id", a.id);
  if (error) alert("쪽을 바꾸지 못했습니다: " + error.message);
}

// 끌어서 순서 바꾸기: 같은 쪽 활동끼리만. 다른 쪽 활동 위에 놓으면 그 쪽이 앞이면 맨 앞, 뒤면 맨 뒤로 간다
let dragActId = null;
const pageGroup = (a) => (a.page ?? "") + "|" + (a.page_to > a.page ? a.page_to : "");
function dragRow(row, a) {
  const after = (ev) => {
    const r = row.getBoundingClientRect();
    const cols = getComputedStyle(row.parentNode).gridTemplateColumns.split(" ").length;
    return cols > 1 ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  };
  const clear = () => main.querySelectorAll(".act-row.drop-before, .act-row.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
  // 입력칸·버튼·시뮬레이션 칸에서 누르면 끌지 않는다(숫자를 고치거나 버튼을 누를 수 있게)
  row.addEventListener("mousedown", (ev) => { row.draggable = !ev.target.closest("input, textarea, button, select, a, iframe"); });
  row.addEventListener("dragstart", (ev) => { dragActId = a.id; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", a.id); row.classList.add("dragging"); });
  row.addEventListener("dragend", () => { dragActId = null; row.classList.remove("dragging"); row.draggable = false; clear(); });
  row.addEventListener("dragover", (ev) => {
    if (!dragActId || dragActId === a.id) return;
    ev.preventDefault();
    clear();
    row.classList.add(after(ev) ? "drop-after" : "drop-before");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const id = dragActId, last = after(ev);
    clear();
    dragActId = null;
    if (id && id !== a.id) reorderActivity(id, a.id, last);
  });
}

async function reorderActivity(id, targetId, after) {
  const src = activities.find((x) => x.id === id), target = activities.find((x) => x.id === targetId);
  if (!src || !target) return;
  const group = activities.filter((x) => pageGroup(x) === pageGroup(src));
  const rest = group.filter((x) => x !== src);
  const at = pageGroup(target) === pageGroup(src) ? rest.indexOf(target) + (after ? 1 : 0)
    : activities.indexOf(target) < activities.indexOf(group[0]) ? 0 : rest.length;
  rest.splice(at, 0, src);
  const changed = rest.map((x, i) => [x, i]).filter(([x, i]) => x.sort !== i);
  if (!changed.length) return;
  changed.forEach(([x, i]) => { x.sort = i; });
  drawBuild();
  const done = await Promise.all(changed.map(([x, i]) => sb.from("activities").update({ sort: i }).eq("id", x.id)));
  const bad = done.find((r) => r.error);
  if (bad) alert("순서를 저장하지 못했습니다: " + bad.error.message);
}

function drawBuild() {
  activities = sortActivities(activities);
  const ids = new Set(activities.map((a) => a.id));
  for (const id of buildSimFrames.keys()) if (!ids.has(id)) buildSimFrames.delete(id);
  const startPage = lesson.slide_count ? slideNo(lesson, lesson.page) : null;
  const kinds = h("div", { class: "kinds" },
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "sim", title: "", page: startPage, sim_full: false, sim_place: lesson.slide_count ? { ...SIM_PLACE_DEFAULT } : null, html: "", questions: [] };
      drawBuild();
    } }, h("strong", {}, "시뮬레이션")),
    // 설명 및 질문: 설명 칸·질문 칸을 여러 개 만들고, 저장하면 칸마다 활동 하나가 된다
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "compose", page: startPage, page_to: null, blocks: [] };
      drawBuild();
    } }, h("strong", {}, "설명 및 질문")));
  const asideKids = [h("section", { class: "card stack" }, h("h2", {}, "새로 만들기"), kinds), editing ? editor() : null];
  const hint = () => editing ? null : h("p", { class: "muted small" }, "왼쪽에서 새로 만들거나, 활동의 「수정」을 누르세요.");
  const listTitle = "이 수업의 활동" + (activities.length ? " (" + activities.length + "개)" : "");
  const box = main.querySelector(".build");
  // 같은 수업이면 왼쪽만 다시 그리고 오른쪽 활동 칸은 그대로 두고 맞춘다(syncRows).
  // 오른쪽을 다시 붙이면 시뮬레이션 칸(iframe)이 처음부터 다시 실행되어 깜빡인다.
  if (box && box.dataset.lesson === String(lesson.id)) {
    const aside = box.querySelector(":scope > aside");
    const y = aside.scrollTop;
    aside.replaceChildren(...asideKids.filter(Boolean));
    aside.scrollTop = y;
    box.querySelector(".act-list h2").textContent = listTitle;
    box.querySelector(".act-hint").replaceChildren(...[hint()].filter(Boolean));
    syncRows(box.querySelector(".act-grid"));
    return;
  }
  const grid = h("div", { class: "act-grid" });
  syncRows(grid);
  // 다시 그려도 왼쪽(편집기)·오른쪽(활동 목록)의 스크롤 자리를 지킨다
  const keep = [".build > aside", ".act-scroll"].map((q) => main.querySelector(q)?.scrollTop || 0);
  main.classList.add("build-page");
  main.replaceChildren(h("div", { class: "build", "data-lesson": lesson.id },
    h("aside", { class: "stack" }, asideKids),
    h("div", { class: "build-main stack" },
      h("section", { class: "card stack act-list" },
        h("div", { class: "row between" }, h("h2", {}, listTitle),
          h("div", { class: "act-hint" }, hint())),
        h("div", { class: "act-scroll" }, grid)))));
  [".build > aside", ".act-scroll"].forEach((q, i) => { const el = main.querySelector(q); if (el) el.scrollTop = keep[i]; });
  pinBuild();
}

// 활동 목록 칸을 activities에 맞춘다. 내용이 그대로인 칸은 쪽 칸만 새로 그리고, 순서는 CSS order로만 바꾼다
// (칸을 DOM에서 옮기거나 다시 만들면 그 안의 시뮬레이션이 처음부터 다시 불러와진다)
function syncRows(grid) {
  const old = new Map([...grid.querySelectorAll(":scope > .act-row")].map((r) => [r.dataset.id, r]));
  grid.querySelector(":scope > .act-empty")?.remove();
  activities.forEach((a, i) => {
    const key = rowKey(a);
    let row = old.get(String(a.id));
    old.delete(String(a.id));
    if (row && row.dataset.key === key) row.querySelector(".act-page").replaceWith(pageCell(a));
    else {
      const fresh = activityRow(a);
      if (row) row.replaceWith(fresh); else grid.append(fresh);
      row = fresh;
    }
    row.act = a;
    row.dataset.key = key;
    row.style.order = i;
    markEditingRow(row, a);
  });
  old.forEach((r) => r.remove());
  if (!activities.length) grid.append(h("p", { class: "muted small act-empty" }, "아직 활동이 없습니다."));
}

function activityRow(a) {
  const row = h("div", { class: "act-row", "data-id": a.id },
    h("div", { class: "act-head stack" },
      // 맨 위: 쪽(크게) | 종류(위)·제목(아래)
      h("div", { class: "act-id" },
        pageCell(a),
        h("div", { class: "act-name" },
          h("p", { class: "muted small" }, activityName(a)),
          h("h3", {}, a.title))),
      h("div", { class: "act-btns" },
        a.kind === "sim" && a.html ? buildSimFrame(a).play : null,
        h("button", { type: "button", class: "act-edit",
          onclick() {
            // 칸을 다시 쓰므로 지금 활동(row.act)을 고친다
            const copy = JSON.parse(JSON.stringify(row.act));
            editing = copy.kind === "sim" ? copy : toCompose(copy);
            drawBuild();
            main.querySelector(".editor")?.scrollIntoView({ block: "start" });
          } }))),
    h("div", { class: "act-body" }, activityPreview(a)));
  dragRow(row, a);
  return row;
}

// 만들기 탭을 넓은 화면에서 창 높이에 맞춘다: 페이지는 스크롤되지 않고, 왼쪽(새로 만들기·편집기)과
// 오른쪽 활동 목록(한 화면에 2×2 네 칸)만 안에서 스크롤한다.
let buildPin = null;
function pinBuild() {
  if (buildPin) { buildPin.ro.disconnect(); removeEventListener("resize", buildPin.fit); buildPin = null; }
  const box = main.querySelector(".build");
  if (!box) return;
  const head = app.querySelector(".top");
  const credit = document.querySelector(".credit");
  const fit = () => {
    if (!box.isConnected) return;
    if (!matchMedia("(min-width: 1100px)").matches) { box.classList.remove("pinned"); box.style.height = ""; return; }
    box.classList.add("pinned");
    // 머리말, main 위쪽 여백(1rem), 맨 아래 만든 사람 줄을 뺀 나머지
    const used = (head ? head.getBoundingClientRect().height : 0) + 16 + (credit ? credit.getBoundingClientRect().height : 0);
    box.style.height = Math.max(420, Math.floor(innerHeight - used)) + "px";
  };
  const ro = new ResizeObserver(fit);
  if (head) ro.observe(head);
  if (credit) ro.observe(credit);
  addEventListener("resize", fit);
  buildPin = { ro, fit };
  fit();
}

function simEditor() {
  const e = editing;
  const msg = h("p", { class: "error" });
  const title = h("input", { type: "text", maxlength: 100, value: e.title, placeholder: "예: 열의 전도 시뮬레이션", oninput() { e.title = title.value; } });
  const code = h("textarea", { rows: 8, class: "mono", spellcheck: "false", placeholder: "<!DOCTYPE html> 로 시작하는 코드를 통째로 붙여넣거나, 위에서 html 파일을 고르세요.", oninput() { e.html = code.value; size.textContent = sizeText(); } }, e.html || "");
  const sizeText = () => (e.html ? (e.html.length / 1000).toFixed(0) + "천 자 / 최대 500천 자" : "");
  const size = h("span", { class: "muted small" }, sizeText());
  const file = h("input", { type: "file", accept: ".html,.htm,text/html", async onchange() {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 2000000) { msg.textContent = "파일이 너무 큽니다. html 파일 하나로 된 시뮬레이션만 올릴 수 있습니다."; return; }
    e.html = await f.text();
    code.value = e.html;
    size.textContent = sizeText();
    if (!e.title.trim()) { e.title = f.name.replace(/\.html?$/i, ""); title.value = e.title; }
    msg.textContent = "";
    syncSave();
  } });
  const place = placeField(e);
  async function saveSim() {
    e.title = e.title.trim();
    if (!e.title) { msg.textContent = "제목을 입력하세요."; return; }
    if (!(e.html || "").trim()) { msg.textContent = "html 파일을 고르거나 코드를 붙여넣으세요."; return; }
    if (e.html.length > 500000) { msg.textContent = "코드가 너무 깁니다(최대 50만 자)."; return; }
    const row = { kind: "sim", title: e.title, page: lesson.slide_count ? e.page : null, html: e.html, sim_full: !!e.sim_full && lesson.slide_count > 0,
      sim_place: lesson.slide_count && !e.sim_full && e.sim_place ? e.sim_place : null, show_answer: false, named: false, questions: [] };
    const to = pageTo(e);
    if (to === false) { msg.textContent = PAGE_TO_SETUP; return; }
    if (to !== undefined) row.page_to = to;
    if (!e.id) { row.lesson_id = lesson.id; row.sort = activities.length; }
    const saved = await save("activities", row, e.id);
    if (!saved) return;
    const { data } = await sb.from("activities").select("*").eq("lesson_id", lesson.id);
    activities = sortActivities(data || []);
    editing = JSON.parse(JSON.stringify(saved));
    drawBuild();
    flash("저장했습니다.");
  }
  return h("section", { class: "card stack editor" },
    h("h2", {}, e.id ? "시뮬레이션 고치기" : "시뮬레이션 넣기"),
    place,
    lesson.slide_count ? h("fieldset", { class: "options" }, h("legend", {}, "어떻게 보일까요?"),
      [["over", "슬라이드 위에 얹기"], ["full", "슬라이드 자리에 크게"], ["card", "슬라이드 아래 카드"]].map(([k, name]) =>
        h("label", { class: "option" },
          h("input", { type: "radio", name: "sim-place", checked: k === (e.sim_full ? "full" : e.sim_place ? "over" : "card"),
            onchange() { e.sim_full = k === "full"; e.sim_place = k === "over" ? (e.sim_place || { ...SIM_PLACE_DEFAULT }) : null; } }),
          h("strong", {}, name)))) : null,
    h("label", {}, "제목", title),
    h("label", {}, "html 파일 올리기", file),
    h("label", {}, "또는 코드 붙여넣기", code), size,
    lesson.slide_count ? h("p", { class: "muted small" }, "슬라이드 사이에 따로 넣으려면 PPT에 「시뮬레이션」 같은 빈 슬라이드를 한 장 끼워 두고, 그 쪽에 「슬라이드 자리에 크게」로 넣으세요.") : null,
    h("p", { class: "muted small" }, "시뮬레이션은 격리된 칸에서 실행되어 이 웹앱의 로그인 정보에 접근할 수 없습니다. 학생은 이 카드에 답을 입력하지 않습니다."),
    msg,
    editorButtons(saveSim, msg, "「" + e.title + "」 시뮬레이션을 지울까요?",
      h("button", { class: "ghost", type: "button", onclick() { if ((e.html || "").trim()) openSimFull(e.title || "미리보기", e.html, { autoplay: true }); else msg.textContent = "먼저 html을 넣으세요."; } }, "미리보기")));
}

// 저장 버튼 상태: 저장한 활동을 열고 아무것도 바꾸지 않았으면 회색 「저장됨」(누를 수 없음), 바꾸면 파란 「저장」.
// 편집기를 처음 그릴 때(또는 저장한 뒤) 편집 내용을 기준(editBase)으로 적어 두고 지금 내용과 비교한다.
const editBase = new WeakMap();
const editSnap = (e) => JSON.stringify(e);
const isSavedEdit = (e) => (e.blocks ? e.blocks.some((b) => b.id) : !!e.id);
// 저장하지 않고 데이터베이스에 바로 반영된 변경(쪽 옮기기, 칸 삭제)은 기준에도 넣는다
function rebase(e, change) {
  if (!editBase.has(e)) return;
  const base = JSON.parse(editBase.get(e));
  change(base);
  editBase.set(e, editSnap(base));
}
function syncSave(btn = main.querySelector(".editor .save-btn")) {
  if (!btn || !editing) return;
  const clean = isSavedEdit(editing) && editBase.get(editing) === editSnap(editing);
  btn.disabled = clean;
  btn.textContent = clean ? "저장됨" : "저장";
  btn.title = clean ? "바꾼 내용이 없습니다." : "";
}

// 편집기 맨 아래 버튼: [닫기] [저장] [삭제]. 삭제는 저장한 활동에만 있다(학생 응답도 함께 지워짐)
function editorButtons(onSave, msg, askText, ...extra) {
  const e = editing;
  const saveBtn = h("button", { class: "primary save-btn", type: "button", onclick: onSave }, "저장");
  syncSave(saveBtn);
  return h("div", { class: "row end" }, extra,
    h("button", { class: "ghost", type: "button", onclick() { editing = null; drawBuild(); } }, "닫기"),
    saveBtn,
    e.id && askText ? h("button", { class: "ghost danger", type: "button", async onclick() {
      if (!confirm(askText)) return;
      const { error } = await sb.from("activities").delete().eq("id", e.id);
      if (error) { msg.textContent = error.message; return; }
      activities = activities.filter((a) => a.id !== e.id); editing = null; drawBuild();
    } }, "삭제") : null);
}

// 켜고 끄는 상자 버튼(체크박스 대신 글씨가 든 상자라 누르는 자리가 넓다). onchange(켜짐)
function toggleBox(text, on, onchange, cls) {
  const b = h("button", { type: "button", class: "tog" + (cls ? " " + cls : ""), onclick() { set(!b.classList.contains("on")); onchange(b.classList.contains("on")); } }, text);
  const set = (v) => { b.classList.toggle("on", v); b.setAttribute("aria-pressed", String(v)); };
  set(!!on);
  b.set = set;
  return b;
}

// 표시 위치: 「모든 페이지」를 켜면 쪽과 상관없이 늘 보이고(학생 화면의 「언제든 할 수 있는 활동」), 끄면 n쪽부터 n쪽까지.
function placeField(e) {
  if (!lesson.slide_count) return Object.assign(document.createDocumentFragment(), { refresh() {} });
  const max = Math.max(slideTotal(lesson), 1);
  const pageIn = h("input", { type: "number", min: 1, max, value: e.page ?? slideNo(lesson, lesson.page), class: "num page-num", "aria-label": "시작 쪽",
    oninput() { e.page = parseInt(pageIn.value, 10) || 1; } });
  // 여러 쪽에 걸쳐 같은 활동을 띄울 때 끝 쪽. 비우면 시작 쪽 한 쪽에만 보인다
  const pageToIn = h("input", { type: "number", min: 1, max, value: e.page_to > e.page ? e.page_to : "", class: "num page-num", "aria-label": "끝 쪽",
    oninput() { e.page_to = parseInt(pageToIn.value, 10) || null; } });
  const hint = h("p", { class: "muted small" });
  const all = toggleBox("모든 페이지", e.page == null, (on) => { e.page = on ? null : parseInt(pageIn.value, 10) || 1; refresh(); });
  const refresh = () => {
    const on = e.page == null;
    all.set(on);
    if (!on) pageIn.value = e.page;
    pageIn.disabled = pageToIn.disabled = on;
    hint.textContent = on ? "모든 쪽에서 보입니다." : "끝 쪽을 비우면 시작 쪽에만 보입니다.";
  };
  refresh();
  return Object.assign(h("div", { class: "place" },
    h("span", { class: "field-name" }, "표시 위치"),
    h("div", { class: "place-row" }, all, pageIn, h("span", {}, "쪽부터"), pageToIn, h("span", {}, "쪽까지")),
    hint), { refresh });
}

function editor() {
  if (editing.kind !== "sim" && editing.kind !== "compose") editing = toCompose(editing);
  if (!editBase.has(editing)) editBase.set(editing, editSnap(editing));
  const el = editing.kind === "sim" ? simEditor() : composeEditor();
  // 입력·선택·버튼(켜고 끄기 등)이 편집 내용을 바꾼 뒤에 저장 버튼을 맞춘다
  const later = () => setTimeout(() => syncSave(), 0);
  ["input", "change", "click"].forEach((t) => el.addEventListener(t, later));
  return el;
}

// ---------- 설명 및 질문 ----------
// 편집기에서는 설명 칸·질문 칸을 몇 개든 만들고, 저장하면 칸마다 활동 하나가 된다(표시 위치는 모두 같음).
const infoBlock = (b) => ({ bid: newId(), type: "info", title: "", text: "", ...b });
const questionBlock = (b) => ({ bid: newId(), type: "q", show_answer: true, title: "", q: newQuestion("choice"), ...b });

// 저장된 활동 하나를 편집기 칸으로. 예전 활동의 설명문(intro)은 앞의 설명 칸으로 꺼내고,
// 질문이 여럿이면 질문마다 칸을 만든다(첫 칸만 원래 활동을 고치고, 나머지는 저장할 때 새 활동이 된다)
function toCompose(a) {
  const base = { kind: "compose", page: a.page ?? null, page_to: a.page_to ?? null };
  if (isInfoActivity(a)) return { ...base, blocks: [infoBlock({ id: a.id, qid: a.questions[0].id, title: a.title, text: a.questions[0].text || "" })] };
  const blocks = [];
  const intro = activityDescription(a);
  if (intro) blocks.push(infoBlock({ text: intro }));
  (a.questions || []).forEach((q0, i) => {
    const q = { ...q0 };
    delete q.intro;
    delete q.description;
    // 예전 퀴즈는 정답이 있는 질문을 퀴즈로 본다(q.quiz는 편집할 때만 쓰고 저장하지 않는다)
    q.quiz = a.kind === "quiz" && q.answer != null;
    q.anon = isAnon(a, q);
    if (isChoice(q) && !(q.options && q.options.length)) q.options = ["", ""];
    // 첫 칸은 활동의 제목을 그대로 보여 준다. 나머지 칸은 비워 두어 저장할 때 「질문 n」이 된다
    blocks.push(questionBlock({ id: i === 0 ? a.id : null, kind: a.kind, show_answer: a.show_answer, title: i === 0 ? a.title || "" : "", q }));
  });
  return { ...base, blocks };
}

function composeEditor() {
  const e = editing;
  const msg = h("p", { class: "error" });
  const redraw = (focus) => { drawBuild(); if (focus) main.querySelector('.editor [data-focus="' + focus + '"]')?.focus(); };
  const hasResponses = e.blocks.some((b) => b.id && responses.some((r) => r.activity_id === b.id));
  // 제목을 비운 질문은 「질문 n」, 설명은 「설명 n」. n은 이 수업에 이미 있는 같은 종류(이 편집기 칸 말고) 다음 번호부터
  const others = activities.filter((a) => a.kind !== "sim" && !e.blocks.some((b) => b.id === a.id));
  const qBase = others.filter((a) => !isInfoActivity(a)).length, iBase = others.filter(isInfoActivity).length;
  const autoTitle = (n) => "질문 " + (qBase + n);
  const autoInfo = (n) => "설명 " + (iBase + n);
  let qn = 0, inN = 0;
  const blockEls = e.blocks.map((b) => {
    // 칸 오른쪽 위 「삭제」: 저장한 칸이면 그 활동을 바로 지운다
    const del = h("button", { type: "button", class: "blk-del", async onclick() {
      if (b.id) {
        if (!confirm("이 " + (b.type === "info" ? "설명" : "질문") + "을 지울까요? 학생 응답도 함께 지워집니다.")) return;
        const { error } = await sb.from("activities").delete().eq("id", b.id);
        if (error) { msg.textContent = error.message; return; }
        activities = activities.filter((a) => a.id !== b.id);
        rebase(e, (base) => { base.blocks = base.blocks.filter((x) => x.bid !== b.bid); });
      }
      e.blocks = e.blocks.filter((x) => x !== b);
      redraw();
    } }, "삭제");
    return b.type === "info" ? infoEdit(b, autoInfo(++inN), del) : questionEdit(b, autoTitle(++qn), del, redraw);
  });

  async function saveAll() {
    msg.textContent = "";
    const blankQ = (q) => !(q.text || "").trim() && !(isChoice(q) && q.options.some((x) => x.trim()));
    const blankI = (b) => !b.title.trim() && !b.text.trim();
    // 먼저 모두 확인하고(번호는 화면에 보이는 번호), 아무것도 적지 않은 칸은 뺀다
    const rows = [];
    let qi = 0, ii = 0;
    for (const b of e.blocks) {
      if (b.type === "info") {
        ii++;
        if (blankI(b)) continue;
        const text = b.text.trim();
        const title = b.title.trim() || autoInfo(ii);
        if (!text) { msg.textContent = "「" + title + "」의 설명문을 입력하세요."; return; }
        rows.push([b, { kind: "survey", title, show_answer: false, named: false,
          questions: [{ id: b.qid || newId(), type: "info", text }] }]);
        continue;
      }
      qi++;
      const q = b.q;
      if (blankQ(q)) continue;
      const title = (b.title || "").trim() || autoTitle(qi), name = "「" + title + "」";
      q.text = (q.text || "").trim();
      if (!q.text) { msg.textContent = name + "의 질문을 입력하세요."; return; }
      if (isChoice(q)) {
        const opts = q.options.map((x) => x.trim()).filter(Boolean);
        if (opts.length < 2) { msg.textContent = name + "의 항목을 두 개 이상 적으세요."; return; }
        if (new Set(opts).size !== opts.length) { msg.textContent = name + "에 같은 항목이 두 번 있습니다."; return; }
        const right = [].concat(q.answer ?? []).map((x) => String(x).trim()).filter((x) => opts.includes(x));
        if (q.quiz && !right.length) { msg.textContent = name + "(퀴즈)의 정답을 고르세요."; return; }
        q.options = opts;
        if (q.quiz) q.answer = q.type === "multi" ? right : right[0];
        else { delete q.answer; delete q.explain; }
      } else { delete q.options; delete q.answer; delete q.explain; q.quiz = false; }
      const { quiz, ...clean } = q;
      // 퀴즈를 켠 질문은 퀴즈(한 번만 제출, 서버에서 채점). 아니면 예전 종류(슬라이드 질문·설문)를 그대로 둔다
      // named는 예전 화면을 위해 남긴다. 실제 익명 여부는 질문의 anon
      rows.push([b, { kind: quiz ? "quiz" : b.kind === "slide" ? "slide" : "survey", title,
        show_answer: !!b.show_answer, named: !q.anon, questions: [clean] }]);
    }
    if (!rows.length) { msg.textContent = "설명이나 질문을 입력하세요."; return; }
    const to = pageTo(e);
    if (to === false) { msg.textContent = PAGE_TO_SETUP; return; }
    // 새 활동은 같은 쪽 활동들의 맨 뒤에 편집기 순서대로 붙인다
    let next = Math.max(-1, ...activities.filter((a) => (a.page ?? null) === (e.page ?? null)).map((a) => a.sort ?? 0)) + 1;
    for (const [b, row] of rows) {
      row.page = e.page;
      if (to !== undefined) row.page_to = to;
      if (!b.id) { row.lesson_id = lesson.id; row.sort = next++; }
      const s = await save("activities", row, b.id);
      if (!s) return;
      b.id = s.id;
      if (b.type === "info") b.qid = row.questions[0].id;
      b.title = row.title; // 자동으로 붙인 「질문 n」·「설명 n」도 칸에 남겨, 다시 저장해도 번호가 바뀌지 않게
    }
    e.blocks = e.blocks.filter((b) => b.id);
    editBase.set(e, editSnap(e));
    const { data } = await sb.from("activities").select("*").eq("lesson_id", lesson.id);
    activities = sortActivities(data || []);
    drawBuild();
    flash(rows.length > 1 ? rows.length + "개를 저장했습니다." : "저장했습니다.");
  }

  return h("section", { class: "card stack editor" },
    h("h2", {}, e.blocks.some((b) => b.id) ? "설명 및 질문 고치기" : "설명 및 질문 만들기"),
    hasResponses ? h("p", { class: "banner" }, "이미 학생 응답이 있습니다. 질문이나 항목을 바꾸면 기존 응답과 맞지 않을 수 있습니다.") : null,
    placeField(e),
    blockEls,
    h("button", { type: "button", class: "add-box", onclick() { const b = infoBlock(); e.blocks.push(b); redraw(b.bid); } }, "+ 설명 추가"),
    h("button", { type: "button", class: "add-box", onclick() { const b = questionBlock(); e.blocks.push(b); redraw(b.bid); } }, "+ 질문 추가"),
    msg,
    editorButtons(saveAll, msg, null));
}

// 설명 칸: 위 줄은 제목(비우면 auto, 예: 「설명 1」이 제목이 됨)과 삭제, 그 아래 설명문. 학생은 답하지 않는다
function infoEdit(b, auto, del) {
  const title = h("input", { type: "text", class: "blk-title", maxlength: 100, value: b.title || "", placeholder: auto, "aria-label": "설명 제목",
    title: "비우면 「" + auto + "」이 제목이 됩니다.", "data-focus": b.bid, oninput() { b.title = title.value; } });
  const body = h("textarea", { rows: 5, maxlength: 5000, placeholder: "설명과 링크를 입력하세요. https:// 주소는 학생 화면에서 클릭할 수 있습니다.", oninput() { b.text = body.value; } }, b.text || "");
  return h("article", { class: "blk info-edit stack" },
    h("div", { class: "blk-top" }, title, del),
    h("label", {}, "설명문", body));
}

// 질문 칸: 위 줄은 제목(비우면 auto, 예: 「질문 1」이 제목이 됨)과 삭제. 그 아래 익명 · 객관식|서술형 · 퀴즈, 항목(+ 항목 추가), 퀴즈면 정답·해설·제출 뒤 보여 주기
function questionEdit(b, auto, del, redraw) {
  const q = b.q;
  const title = h("input", { type: "text", class: "blk-title", maxlength: 100, value: b.title || "", placeholder: auto, "aria-label": "질문 제목",
    title: "비우면 「" + auto + "」이 제목이 됩니다.", oninput() { b.title = title.value; } });
  const choice = isChoice(q);
  // 객관식 ↔ 서술형. 서술형은 자동 채점하지 않으므로 퀴즈도 꺼진다
  const setType = (toChoice) => {
    if (toChoice === choice) return;
    q.type = toChoice ? "choice" : "long";
    if (toChoice) q.options = q.options && q.options.length ? q.options : ["", ""];
    else { q.quiz = false; delete q.explain; }
    delete q.answer;
    redraw();
  };
  const seg = h("div", { class: "seg", role: "group", "aria-label": "질문 종류" },
    h("button", { type: "button", class: choice ? "on" : "", "aria-pressed": String(choice), onclick() { setType(true); } }, "객관식"),
    h("button", { type: "button", class: choice ? "" : "on", "aria-pressed": String(!choice), onclick() { setType(false); } }, "서술형"));
  const quizBtn = h("button", {
    type: "button", class: "quiz-toggle" + (q.quiz ? " on" : ""), "aria-pressed": String(!!q.quiz), disabled: !choice,
    title: choice ? "정답을 정하면 학생이 제출할 때 자동으로 채점합니다." : "객관식 질문만 퀴즈로 채점할 수 있습니다.",
    onclick() { q.quiz = !q.quiz; if (!q.quiz) { delete q.answer; delete q.explain; } redraw(); },
  }, "퀴즈");
  const anon = toggleBox("익명", q.anon, (on) => { q.anon = on; }, "anon-tog");
  anon.title = "켜 두면 학생에게 공개할 때 이 질문의 답에 이름이 보이지 않습니다.";
  // 서술형은 질문 칸을 크게 해 객관식(항목 두 개)과 높이를 맞춘다(종류를 바꿔도 아래가 밀리지 않게)
  const text = choice
    ? h("input", { type: "text", maxlength: 300, value: q.text, placeholder: "질문을 입력하세요", "data-focus": b.bid, oninput() { q.text = text.value; } })
    : h("textarea", { class: "q-long", maxlength: 300, placeholder: "질문을 입력하세요", "data-focus": b.bid, oninput() { q.text = text.value; } }, q.text || "");
  const answers = () => [].concat(q.answer ?? []);
  const optRows = choice ? q.options.map((o, j) => {
    const input = h("input", { type: "text", maxlength: 200, value: o, placeholder: "항목 " + (j + 1), "data-focus": q.id + "-" + j, "aria-label": (j + 1) + "번 항목",
      oninput() {
        // 정답으로 고른 항목의 글을 고치면 정답도 따라 바뀐다
        const old = q.options[j];
        q.options[j] = input.value;
        if (q.answer != null) q.answer = Array.isArray(q.answer) ? q.answer.map((x) => (x === old ? input.value : x)) : q.answer === old ? input.value : q.answer;
      } });
    const pick = q.quiz ? h("label", { class: "check ans-pick" },
      h("input", {
        type: q.type === "multi" ? "checkbox" : "radio", name: "ans-" + q.id, checked: o !== "" && answers().includes(o),
        onchange(ev) {
          const v = q.options[j];
          if (q.type !== "multi") { q.answer = v; return; }
          const now = new Set(answers());
          if (ev.target.checked) now.add(v); else now.delete(v);
          const list = q.options.filter((x) => now.has(x));
          if (list.length) q.answer = list; else delete q.answer;
        },
      }), "정답") : null;
    // 항목이 두 개뿐이면 지울 수 없다(연한 회색 상자로 보임)
    const few = q.options.length <= 2;
    const del = h("button", { type: "button", class: "opt-del", "aria-label": (j + 1) + "번 항목 지우기", disabled: few,
      title: few ? "항목은 두 개 이상 있어야 합니다." : "이 항목 지우기",
      onclick() {
        const [gone] = q.options.splice(j, 1);
        if (q.answer != null) {
          const left = answers().filter((x) => x !== gone);
          if (!left.length) delete q.answer; else q.answer = q.type === "multi" ? left : left[0];
        }
        redraw();
      } }, "×");
    return h("div", { class: "opt-row" }, pick, input, del);
  }) : null;
  const multi = choice ? toggleBox("복수 선택", q.type === "multi", (on) => {
    q.type = on ? "multi" : "choice";
    if (q.answer != null) q.answer = on ? answers() : answers()[0];
    redraw();
  }) : null;
  const explain = q.quiz ? h("input", { type: "text", maxlength: 300, value: q.explain || "", placeholder: "해설 (선택)", oninput() { q.explain = explain.value.trim() || undefined; } }) : null;
  return h("article", { class: "blk q-edit stack" },
    h("div", { class: "blk-top" }, title, del),
    h("div", { class: "q-head" }, anon, seg, quizBtn),
    h("label", {}, "질문", text),
    choice ? h("div", { class: "opt-list" }, h("span", { class: "field-name" }, "항목" + (q.quiz ? " (정답을 고르세요)" : "")), optRows,
      h("div", { class: "row between" }, multi,
        h("button", { class: "ghost", type: "button", onclick() { q.options.push(""); redraw(q.id + "-" + (q.options.length - 1)); } }, "+ 항목 추가"))) : null,
    explain ? h("label", {}, "해설", explain) : null,
    q.quiz ? toggleBox("제출 뒤 정답·해설 보여 주기", b.show_answer, (on) => { b.show_answer = on; }, "show-ans") : null);
}

const isChoice = (q) => q.type === "choice" || q.type === "multi";

// 저장할 끝 쪽. undefined = 보내지 않음, null/숫자 = 보냄, false = 데이터베이스에 page_to 칸이 없어 저장할 수 없음
// (page_to 칸이 없는 예전 데이터베이스에서도 한 쪽짜리는 저장되도록 필요할 때만 보낸다)
const PAGE_TO_SETUP = "여러 쪽에 걸친 활동을 쓰려면 먼저 Supabase에서 setup.sql을 한 번 실행해야 합니다. 끝 쪽 칸을 비우면 지금도 저장할 수 있습니다.";
function pageTo(e) {
  const to = e.page != null && e.page_to > e.page ? Math.min(e.page_to, Math.max(slideTotal(lesson), e.page)) : null;
  const hasPageTo = activities.some((x) => "page_to" in x);
  if (to != null && activities.length && !hasPageTo) return false;
  return to != null || hasPageTo ? to : undefined;
}

function flash(text) {
  const el = h("p", { class: "toast" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------- 학생 관리 ----------
function ensureTeacherScreenChannel() {
  const key = screenChannelName(lesson.code);
  if (screenChannel && screenChannelKey === key) return screenChannelReady;
  if (screenChannel) {
    for (const watch of [...screenWatchers.values()]) watch.close();
    sb.removeChannel(screenChannel);
    sb.removeChannel(screenDataCh);
  }
  screenChannelKey = key;
  // 수업 채널: 교사 → 학생 신호와 접속 상태. 학생이 보내는 것은 교사 전용 채널(:t)로만 온다.
  screenChannel = sb.channel(key, { config: { broadcast: { self: false } } });
  screenChannel.on("broadcast", { event: "signal" }, ({ payload }) => handleTeacherScreenSignal(payload));   // 새로고침 전 예전 학생 화면용
  screenChannel.on("presence", { event: "sync" }, updatePresence);
  screenDataCh = sb.channel(screenDataChannelName(lesson.code), { config: { broadcast: { self: false } } });
  screenDataCh.on("broadcast", { event: "signal" }, ({ payload }) => handleTeacherScreenSignal(payload));
  const join = (ch) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("화면 공유 연결을 준비하지 못했습니다. 새로고침해 주세요.")), 10000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error("화면 공유 채널에 연결하지 못했습니다.")); }
    });
  });
  screenChannelReady = Promise.all([join(screenChannel), join(screenDataCh)]).then(() => screenChannel);
  return screenChannelReady;
}

async function sendTeacherScreenSignal(payload) {
  if (screenChannel) await screenChannel.send({ type: "broadcast", event: "signal", payload });
}

async function handleTeacherScreenSignal(message) {
  if (!message || message.to !== "teacher") return;
  const watch = screenWatchers.get(message.from);
  if (!watch) {
    const t = grid && grid.tiles.get(message.from);
    if (t) gridSignal(t, message).catch(() => {});
    return;
  }
  try {
    if (message.type === "mirror") {
      await showMirror(watch, message);
    } else if (message.type === "sim") {
      await takeSimFrame(watch, message);
    } else if (message.type === "sim-rtc") {
      await simRtc(watch, message);
    } else if (message.type === "offer" && message.sdp) {
      await watch.pc.setRemoteDescription(message.sdp);
      for (const candidate of watch.queued) await watch.pc.addIceCandidate(candidate);
      watch.queued = [];
      await watch.pc.setLocalDescription(await watch.pc.createAnswer());
      await sendTeacherScreenSignal({ type: "answer", from: "teacher", to: message.from, sdp: watch.pc.localDescription });
      watch.status.textContent = "학생 화면에 연결했습니다.";
    } else if (message.type === "candidate" && message.candidate) {
      if (watch.pc.remoteDescription) await watch.pc.addIceCandidate(message.candidate);
      else watch.queued.push(message.candidate);
    } else if (message.type === "video-stopped") {
      watch.video.srcObject = null;
      watch.video.hidden = true;
    } else if (message.type === "stopped") {
      watch.status.textContent = "학생이 보여 주기를 멈췄거나 거절했습니다. 다시 요청하려면 창을 닫고 다시 여세요.";
      watch.video.srcObject = null;
      watch.video.hidden = true;
    }
  } catch (e) {
    watch.status.textContent = "화면 연결 오류: " + e.message;
  }
}

// 학생이 보낸 화면을 그리기 전에 스크립트·외부 문서·이벤트 속성을 걷어 낸다.
// keepStyle: 시뮬레이션은 자기 스타일(style·link)이 있어야 모양이 맞으므로 남긴다.
function cleanDoc(html, keepStyle) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script, iframe, object, embed, base, meta, frame" + (keepStyle ? "" : ", link, style")).forEach((el) => el.remove());
  d.querySelectorAll("*").forEach((el) => [...el.attributes].forEach((a) => {
    const bad = /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value) || (/^\s*data:/i.test(a.value) && a.name !== "src");
    if (bad) el.removeAttribute(a.name);
  }));
  return d;
}
function cleanMirror(html, doc) {
  return [...cleanDoc(html, false).body.childNodes].map((n) => doc.importNode(n, true));
}

// 학생 시뮬레이션 장면: k번 시뮬레이션의 마지막 상태를 기억해 두고, 수업 화면이 다시 그려져 자리가 새로 생겨도 바로 다시 칠한다.
// 장면마다 문서를 새로 불러오지 않고 내용·그림만 바꿔 깜박임과 지연을 줄인다.
function simView(watch, k) {
  const doc = watch.frame.contentDocument;
  const hole = doc && doc.querySelector('.sim-mirror[data-k="' + k + '"]');
  if (!hole) return null;
  let v = hole.querySelector("iframe");
  if (!v) {
    v = doc.createElement("iframe");
    v.setAttribute("sandbox", "allow-same-origin");   // 스크립트는 막고 교사 화면이 내용만 넣는다
    v.setAttribute("srcdoc", '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    v.style.cssText = "border:0;display:block;background:#fff;transform-origin:0 0";
    hole.style.cssText = "overflow:hidden;border:1px solid #d0d7e2;border-radius:8px;background:#fff;min-height:60px";
    hole.append(v);
    v.addEventListener("load", () => { v.dataset.ready = "1"; paintSim(watch, k); }, { once: true });
  }
  return v;
}

function paintSim(watch, k) {
  const s = watch.sims.get(k);
  const v = s && simView(watch, k);
  if (!v || !v.dataset.ready || !v.contentDocument) return;
  const d = v.contentDocument;
  if (v.dataset.ver !== String(s.ver)) {
    const c = cleanDoc("<!doctype html><html><head>" + (s.head || "") + "</head><body>" + (s.body || "") + "</body></html>", true);
    d.head.innerHTML = c.head.innerHTML;
    d.body.innerHTML = c.body.innerHTML;
    d.body.setAttribute("style", s.bs || "");
    v.dataset.ver = String(s.ver);
  }
  for (const [i, url] of Object.entries(s.canvases)) {
    d.querySelectorAll('img[data-cra-canvas="' + i + '"]').forEach((img) => { if (img.getAttribute("src") !== url) img.setAttribute("src", url); });
  }
  const scale = Math.min(1, (v.parentNode.clientWidth || 400) / (s.w || 400));
  v.style.width = s.w + "px";
  v.style.height = s.h + "px";
  v.style.transform = "scale(" + scale + ")";
  v.parentNode.style.height = Math.round(s.h * scale) + "px";
  // 영상으로 받는 캔버스는 그림 자리를 영상으로 바꾼다(수업 화면이 다시 그려지면 다시 끼운다)
  if (s.stream && s.vidIdx != null) {
    const img = d.querySelector('img[data-cra-canvas="' + s.vidIdx + '"]');
    if (img) {
      const vid = d.createElement("video");
      vid.muted = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.className = img.className;
      vid.setAttribute("style", (img.getAttribute("style") || "") + ";object-fit:contain;background:#000");
      vid.srcObject = s.stream;
      img.replaceWith(vid);
      vid.play().catch(() => {});
    }
  }
  if (d.scrollingElement) { d.scrollingElement.scrollTop = s.sy || 0; d.scrollingElement.scrollLeft = s.sx || 0; }
}

// 시뮬레이션 영상(WebRTC): 학생 시뮬레이션의 가장 큰 캔버스를 15~30 FPS 영상으로 받는다.
// 연결되면 학생 쪽은 그 캔버스의 JPEG 전송을 멈추고, 연결되지 않으면(학교망이 막는 등) 그림 전송이 그대로 이어진다.
async function teacherIce() {
  const { data } = await sb.auth.getSession();
  return iceServers({ headers: data.session ? { Authorization: "Bearer " + data.session.access_token } : {} });
}
async function simRtc(watch, m) {
  const send = (rtc, extra) => sendTeacherScreenSignal({ type: "sim-rtc", from: "teacher", to: m.from, k: m.k, rtc, ...extra });
  if (m.rtc === "offer" && m.sdp) {
    watch.rtc.get(m.k)?.pc?.close();
    const r = { pc: null, queued: [] };
    watch.rtc.set(m.k, r);   // 접속 정보를 받는 동안 온 연결 후보도 모아 둔다
    const pc = new RTCPeerConnection({ iceServers: await teacherIce(), iceTransportPolicy: forceRelay() ? "relay" : "all" });
    r.pc = pc;
    pc.ontrack = (e) => {
      const s = watch.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
      s.stream = e.streams[0] || new MediaStream([e.track]);
      s.vidIdx = m.idx;
      watch.sims.set(m.k, s);
      (watch.paint || paintSim)(watch, m.k);
    };
    pc.onicecandidate = (e) => e.candidate && send("ice", { candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") send("ok");
      if (pc.connectionState === "failed") { send("fail"); watch.videoText = ""; }
    };
    await pc.setRemoteDescription(m.sdp);
    for (const c of r.queued) await pc.addIceCandidate(c).catch(() => {});
    r.queued = [];
    await pc.setLocalDescription(await pc.createAnswer());
    await send("answer", { sdp: pc.localDescription.toJSON() });
  } else if (m.rtc === "ice" && m.candidate) {
    const r = watch.rtc.get(m.k);
    if (!r) return;
    if (r.pc && r.pc.remoteDescription) await r.pc.addIceCandidate(m.candidate).catch(() => {});
    else r.queued.push(m.candidate);
  }
}

// 영상의 실제 FPS와 지연(왕복 시간의 절반 + 재생 대기 시간)을 1초마다 WebRTC 통계에서 읽는다
async function readRtcStats(watch) {
  for (const r of watch.rtc.values()) {
    if (!r.pc || r.pc.connectionState !== "connected") continue;
    let fps = 0, rtt = 0, jb = 0, relay = false;
    const stats = await r.pc.getStats();
    stats.forEach((x) => {
      if (x.type === "inbound-rtp" && x.kind === "video") {
        fps = x.framesPerSecond || 0;
        if (x.jitterBufferEmittedCount) jb = (x.jitterBufferDelay / x.jitterBufferEmittedCount) * 1000;
      }
      // 실제로 쓰는 연결 쌍의 양 끝 중 하나라도 중계 서버면 「중계」(후보 목록에 중계가 있다는 것만으로는 아님)
      if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") {
        rtt = (x.currentRoundTripTime || 0) * 1000;
        relay = [x.localCandidateId, x.remoteCandidateId].some((id) => stats.get(id)?.candidateType === "relay");
      }
    });
    watch.videoText = "영상 " + Math.round(fps) + " FPS · 지연 약 " + Math.round(rtt / 2 + jb) + " ms" + (relay ? " (중계)" : " (직접 연결)");
    watch.simInfo.textContent = watch.videoText;
    return;
  }
}

async function takeSimFrame(watch, m) {
  const s = watch.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
  if (typeof m.body === "string") { s.head = m.head; s.body = m.body; s.bs = m.bs; s.ver++; }
  Object.assign(s.canvases, m.canvases || {});
  Object.assign(s, { w: m.w, h: m.h, sx: m.sx, sy: m.sy });
  const now = Date.now();
  s.times = s.times.filter((t) => now - t < 2000).concat(now);
  watch.sims.set(m.k, s);
  await watch.ready;
  paintSim(watch, m.k);
  // 지연은 학생 기기 시계 기준이라 두 기기 시계가 어긋나면 조금 틀릴 수 있다
  const lag = m.t ? now - m.t : null;
  watch.simInfo.textContent = watch.videoText || ("시뮬레이션 " + (s.times.length / 2).toFixed(1) + " FPS"
    + (lag != null && lag >= 0 && lag < 60000 ? " · 지연 " + Math.round(lag) + " ms" : ""));
}

async function showMirror(watch, m) {
  await watch.ready;
  const doc = watch.frame.contentDocument;
  if (!doc || !doc.body) return;
  if (typeof m.html === "string" && m.html !== watch.html) {
    watch.html = m.html;
    doc.body.replaceChildren(...cleanMirror(m.html, doc));
    for (const k of watch.sims.keys()) paintSim(watch, k);   // 새로 생긴 자리에 시뮬레이션 다시 칠하기
  }
  const el = doc.scrollingElement;
  if (el && typeof m.scroll === "number") el.scrollTop = m.scroll * (el.scrollHeight - el.clientHeight);
  watch.frame.style.maxWidth = m.narrow ? "420px" : "";
  watch.status.replaceChildren(
    h("span", { class: "mirror-state" + (m.away ? " away" : "") }, m.away ? "다른 앱이나 탭으로 나가 있음" : "수업 화면을 보고 있음"),
    m.where ? " · " + m.where : "", " · " + new Date().toLocaleTimeString() + " 갱신 · ", watch.simInfo);
}

async function watchStudentScreen(s) {
  if (screenWatchers.size) return alert("실시간 화면은 한 번에 한 명씩 볼 수 있습니다. 먼저 열린 화면 창을 닫아 주세요.");
  const tile = grid && grid.tiles.get(s.id);
  if (tile) tileReset(tile, "크게 보는 중");   // 크게 보는 동안 학생은 원래 화질로 보내고, 닫으면 작은 화면으로 돌아온다
  try {
    await ensureTeacherScreenChannel();
    const video = h("video", { class: "screen-preview", autoplay: true, playsinline: true, muted: true, controls: true, hidden: true });
    const status = h("p", { class: "muted small" }, "학생 화면에 요청을 보냈습니다. 수업 중 보기에 동의한 학생은 바로 보이고, 아니면 학생이 허용할 때까지 기다립니다.");
    const simInfo = h("span", {});
    // 학생이 보낸 화면은 스크립트를 쓸 수 없는 iframe 안에만 그린다(allow-scripts 없음)
    const frame = h("iframe", { class: "mirror-frame", sandbox: "allow-same-origin", title: nameOf(s) + " 수업 화면",
      srcdoc: '<!doctype html><meta charset="utf-8"><base href="' + location.href.replace(/"/g, "") + '"><link rel="stylesheet" href="app.css">'
        + "<style>body{margin:0;padding:8px;background:#f6f7fb}body *{pointer-events:none}</style><body></body>" });
    const ready = new Promise((ok) => frame.addEventListener("load", ok, { once: true }));
    const pc = new RTCPeerConnection({ iceServers: await teacherIce(), iceTransportPolicy: forceRelay() ? "relay" : "all" });
    const close = openModal(nameOf(s) + " · 실시간 화면", h("div", { class: "stack" }, status, frame, video,
      h("p", { class: "muted small" }, "학생의 수업 화면(보고 있는 쪽, 쓰고 있는 답)은 바뀔 때마다, 시뮬레이션은 초당 최대 5장으로 갱신됩니다. 노트북·태블릿·휴대폰 모두 됩니다. PC에서 학생이 「PC 화면 전체 공유」까지 누르면 아래에 영상도 나옵니다.")), () => {
      const back = grid && grid.tiles.get(s.id);
      if (back) { tileReset(back, "작은 화면으로 돌아오는 중…"); askTile(back); }
      else sendTeacherScreenSignal({ type: "stop", from: "teacher", to: s.id, key: screenKey(s) });
      pc.close();
      clearInterval(watch.statsTimer);
      for (const r of watch.rtc.values()) r.pc?.close();
      screenWatchers.delete(s.id);
      screenWatchers.delete(screenKey(s));
    });
    const watch = { pc, video, status, frame, ready, html: "", sims: new Map(), simInfo, rtc: new Map(), videoText: "", queued: [], close };
    watch.statsTimer = setInterval(() => readRtcStats(watch).catch(() => {}), 1000);
    screenWatchers.set(s.id, watch);
    screenWatchers.set(screenKey(s), watch);   // 예전 setup.sql 이면 학생이 학번·이름으로 답한다
    pc.ontrack = (e) => { video.srcObject = e.streams[0]; video.hidden = false; };
    pc.onicecandidate = (e) => e.candidate && sendTeacherScreenSignal({ type: "candidate", from: "teacher", to: s.id, key: screenKey(s), candidate: e.candidate });
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState)) status.textContent = "연결이 끊겼습니다. 학생에게 다시 요청해 주세요.";
    };
    await sendTeacherScreenSignal({ type: "request", from: "teacher", to: s.id, key: screenKey(s) });
  } catch (e) {
    alert(e.message || e);
  }
}

// ---------- 실시간 화면 일괄 미리보기 ----------
// 학생 관리 표의 「일괄 미리보기」 열에 화면 보기에 동의한 학생들의 수업 화면을 작게(320×180, 240p 미만) 띄운다.
// 학생은 가벼운 방식으로 보낸다: 시뮬레이션 캔버스는 WebRTC 영상 6 FPS·높이 180 이하(약 70 kbps, 중계 서버 우선),
// 영상이 막히면 그림 초당 2장(가로 320). 수업 화면(쪽·답)은 바뀔 때만. 화면 내용은 교사만 듣는 채널(:t)로 받는다.
let grid = null;   // { code, ready, keep, tiles: Map(학생 id → 칸) }

function startGrid() {
  grid = { code: lesson.code, tiles: new Map(), ready: false };
  const g = grid;
  // 학생 화면이 「아직 보고 있음」을 알 수 있게 15초마다 한 번(모두에게 한 메시지)
  g.keep = setInterval(() => {
    const ids = [...g.tiles.values()].filter((t) => t.asked).flatMap((t) => [t.s.id, screenKey(t.s)]);
    if (ids.length) sendTeacherScreenSignal({ type: "grid-keep", from: "teacher", to: "grid", ids }).catch(() => {});
  }, 15000);
  ensureTeacherScreenChannel().then(() => {
    if (grid !== g) return;
    g.ready = true;
    drawStudents();
  }).catch((e) => { if (grid === g) { stopGrid(); drawStudents(); alert(e.message || e); } });
}

function stopGrid() {
  if (!grid) return;
  const g = grid;
  grid = null;
  clearInterval(g.keep);
  for (const t of g.tiles.values()) {
    tileReset(t);
    if (t.asked && !screenWatchers.has(t.s.id)) sendTeacherScreenSignal({ type: "stop", from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
  }
}

function dropTile(t) {
  tileReset(t);
  grid.tiles.delete(t.s.id);
  if (t.asked && !screenWatchers.has(t.s.id)) sendTeacherScreenSignal({ type: "stop", from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
}

// 영상 연결을 닫고 받은 화면을 비운다(크게 보기로 넘길 때, 끌 때)
function tileReset(t, text) {
  for (const r of t.rtc.values()) r.pc?.close();
  t.rtc.clear();
  t.sims.clear();
  t.seen = 0;
  if (text) t.cap.textContent = text;
}

function askTile(t) {
  t.asked = Date.now();
  // 영상이 막혀 그림으로 보낼 때 전체가 초당 약 7장을 넘지 않게(무료 Supabase 초당 메시지 한도) 학생이 많을수록 천천히
  const every = Math.min(5000, Math.max(500, grid.tiles.size * 150));
  sendTeacherScreenSignal({ type: "request", lite: true, every, from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
}

function gridTile(s) {
  let t = grid.tiles.get(s.id);
  if (t) { t.s = s; return t; }
  const frame = h("iframe", { class: "tile-frame", sandbox: "allow-same-origin", tabindex: "-1", "aria-hidden": "true",
    srcdoc: '<!doctype html><meta charset="utf-8"><base href="' + location.href.replace(/"/g, "") + '"><link rel="stylesheet" href="app.css">'
      + "<style>html{overflow:hidden}body{margin:0;padding:8px;background:#f6f7fb}body.narrow{max-width:420px;margin:0 auto}"
      + ".sim-mirror img,.sim-mirror video{display:block;width:100%;max-height:540px;object-fit:contain;background:#000;border-radius:8px}"
      + ".sim-mirror p{padding:1.5rem;text-align:center;color:#5b6475;background:#fff;border:1px dashed #c9d1de;border-radius:8px}"
      + "body *{pointer-events:none}</style><body></body>" });
  const cap = h("span", { class: "tile-cap" }, "연결 중…");
  t = { s, frame, cap, html: "", drawn: null, scroll: 0, narrow: false, sims: new Map(), rtc: new Map(), seen: 0, asked: 0, videoText: "", simInfo: h("span") };
  t.paint = () => paintTile(t);
  frame.addEventListener("load", () => { t.loaded = true; t.drawn = null; paintTile(t); });
  t.el = h("div", { class: "live-tile" },
    h("div", { class: "tile-view" }, frame,
      h("button", { class: "tile-hit", type: "button", title: nameOf(s) + " 화면 크게 보기", "aria-label": nameOf(s) + " 화면 크게 보기", onclick() { watchStudentScreen(t.s); } },
        h("span", {}, "⤢ 크게 보기"))),
    cap);
  grid.tiles.set(s.id, t);
  return t;
}

async function gridSignal(t, m) {
  t.seen = Date.now();
  t.el.classList.remove("stale");
  if (m.type === "mirror") {
    if (typeof m.html === "string") t.html = m.html;
    t.scroll = typeof m.scroll === "number" ? m.scroll : 0;
    t.narrow = !!m.narrow;
    t.cap.replaceChildren(h("span", { class: "mirror-state" + (m.away ? " away" : "") }, m.away ? "다른 앱·탭" : "수업 화면"),
      m.where ? " · " + m.where : "", " · " + new Date().toLocaleTimeString());
    paintTile(t);
  } else if (m.type === "sim") {
    const sm = t.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
    Object.assign(sm.canvases, m.canvases || {});
    t.sims.set(m.k, sm);
    paintTile(t);
  } else if (m.type === "sim-rtc") {
    await simRtc(t, m);
  } else if (m.type === "stopped") {
    tileReset(t, "학생이 보여 주기를 멈췄습니다");
    t.html = "";
    paintTile(t);
  }
}

// 받은 수업 화면을 작은 칸에 그린다: 1000px 너비로 그려 320px로 줄인다. 시뮬레이션 자리에는 영상(없으면 가장 큰 캔버스 그림).
function paintTile(t) {
  const doc = t.loaded && t.frame.contentDocument;
  if (!doc || !doc.body) return;
  if (t.drawn !== t.html) {
    doc.body.replaceChildren(...(t.html ? cleanMirror(t.html, doc) : []));
    t.drawn = t.html;
  }
  doc.body.classList.toggle("narrow", t.narrow);
  doc.querySelectorAll(".sim-mirror[data-k]").forEach((hole) => {
    const sm = t.sims.get(Number(hole.dataset.k));
    if (sm && sm.stream) {
      let v = hole.querySelector("video");
      if (!v) { v = doc.createElement("video"); v.muted = true; v.autoplay = true; v.playsInline = true; hole.replaceChildren(v); }
      if (v.srcObject !== sm.stream) v.srcObject = sm.stream;
      if (v.paused) v.play().catch(() => {});
      return;
    }
    const urls = sm ? Object.values(sm.canvases).filter(Boolean) : [];
    const url = urls.sort((a, b) => b.length - a.length)[0];
    if (url) {
      let img = hole.querySelector("img");
      if (!img) { img = doc.createElement("img"); hole.replaceChildren(img); }
      if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    } else if (!hole.querySelector("p")) {
      hole.replaceChildren(Object.assign(doc.createElement("p"), { textContent: "시뮬레이션" }));
    }
  });
  const el = doc.scrollingElement;
  if (el) el.scrollTop = t.scroll * (el.scrollHeight - el.clientHeight);
}

// 미리보기 칸: 동의한 학생마다 하나. 접속 중인데 8초 넘게 소식이 없으면 다시 요청한다.
function gridCell(s, now) {
  if (s.monitor !== true) {
    const t = grid.tiles.get(s.id);
    if (t) dropTile(t);
    return h("span", { class: "muted small" }, "동의하지 않아 볼 수 없음");
  }
  const t = gridTile(s);
  if (grid.ready && !screenWatchers.has(s.id) && presenceOf(s) !== "off" && now - t.seen > 8000 && now - t.asked > 8000) askTile(t);
  if (presenceOf(s) === "off" && !t.seen) t.cap.textContent = "접속 안 함";
  if (t.seen && now - t.seen > 12000) { t.el.classList.add("stale"); t.cap.textContent = "응답 없음 · 다시 요청 중"; }
  return t.el;
}

function drawStudents() {
  const now = Date.now();
  const rows = students.map((s) => {
    const mine = responses.filter((r) => r.student_id === s.id);
    const last = mine.reduce((t, r) => (r.updated_at > t ? r.updated_at : t), "");
    const locked = s.locked_until && Date.parse(s.locked_until) > now;
    const status = locked ? h("span", { class: "tag warn" }, "잠김 · " + Math.ceil((Date.parse(s.locked_until) - now) / 60000) + "분 남음")
      : !s.pin_set ? h("span", { class: "tag info" }, "초기화됨 · 새 비밀번호 기다리는 중")
      : h("span", { class: "tag ok" }, "정상");
    return h("tr", { class: locked ? "locked" : "" },
      h("td", {}, presenceDot(s), " ", s.class_no), h("td", {}, s.name),
      h("td", {}, mine.length + " / " + activities.filter((a) => a.kind !== "sim").length), h("td", {}, fmtTime(last)), h("td", {}, status),
      h("td", {}, s.monitor === true ? h("span", { class: "tag ok" }, "동의")
        : s.monitor === false ? h("span", { class: "tag" }, "동의 안 함")
        : h("span", { class: "tag info" }, "아직 안 정함")),
      h("td", { class: "grid-cell", "data-sid": s.id }),
      h("td", { class: "actions" },
        h("button", { class: "ghost", type: "button", onclick() { watchStudentScreen(s); } }, "실시간 화면 보기"),
        h("button", {
          class: locked ? "primary" : "ghost", type: "button", disabled: !s.pin_set && !locked,
          async onclick() {
            if (!confirm(nameOf(s) + " 학생의 비밀번호를 초기화할까요?\n모든 수업에 함께 적용됩니다. 쓴 답은 그대로 남고, 다음에 들어올 때 새 비밀번호를 정합니다.")) return;
            const { error } = await sb.from("students").update({ pin_hash: null, token: null, fails: 0, locked_until: null }).eq("id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
            flash("초기화했습니다.");
          },
        }, "비밀번호 초기화"),
        h("button", {
          class: "link danger", type: "button",
          async onclick() {
            if (!confirm(nameOf(s) + " 학생을 이 수업에서 뺄까요? 이 수업에서 쓴 응답이 지워집니다.\n(다른 수업의 응답과 학생 계정은 남습니다. 학생이 다시 들어오면 다시 참여합니다.)")) return;
            const ids = activities.map((a) => a.id);
            if (ids.length) {
              const r = await sb.from("responses").delete().eq("student_id", s.id).in("activity_id", ids);
              if (r.error) return alert(r.error.message);
            }
            const { error } = await sb.from("lesson_students").delete().eq("lesson_id", lesson.id).eq("student_id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
          },
        }, "이 수업에서 빼기"),
        h("button", {
          class: "link danger", type: "button",
          async onclick() {
            if (!confirm(nameOf(s) + " 학생 계정을 완전히 지울까요?\n모든 수업에서 빠지고, 모든 수업의 응답이 지워집니다. 장난으로 만든 이름을 지울 때 쓰세요.")) return;
            const { error } = await sb.from("students").delete().eq("id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
          },
        }, "계정 삭제")));
  });
  if (grid) for (const t of [...grid.tiles.values()]) if (!students.some((s) => s.id === t.s.id)) dropTile(t);
  const ids = students.map((s) => s.id).join();
  const cells = new Map(grid ? students.map((s) => [s.id, gridCell(s, now)]) : []);
  // 미리보기 중이고 학생 목록이 그대로면 미리보기 칸은 그대로 두고 나머지 칸만 바꾼다(iframe을 옮기면 다시 불러온다)
  const old = grid && main.querySelector(".students-table");
  if (old && old.dataset.ids === ids && old.dataset.grid === "1") {
    const oldRows = [...old.tBodies[0].rows];
    rows.forEach((row, i) => {
      const was = oldRows[i];
      was.className = row.className;
      [...row.cells].forEach((td, j) => {
        if (!td.classList.contains("grid-cell")) was.cells[j].replaceWith(td);
        else if (was.cells[j].firstChild !== cells.get(td.dataset.sid)) was.cells[j].replaceChildren(cells.get(td.dataset.sid));
      });
    });
    main.querySelector(".students-count").textContent = "학생 " + students.length + "명";
    return;
  }
  for (const td of rows.flatMap((row) => [...row.cells])) if (td.dataset.sid && cells.has(td.dataset.sid)) td.append(cells.get(td.dataset.sid));
  const gridHead = h("th", { class: "grid-head" }, h("button", {
    class: grid ? "grid-toggle on" : "grid-toggle", type: "button", "aria-pressed": grid ? "true" : "false",
    title: "화면 보기에 동의한 학생들의 수업 화면을 작게(240p 미만) 한꺼번에 봅니다",
    onclick() { if (grid) stopGrid(); else startGrid(); drawStudents(); },
  }, grid ? "■ 일괄 미리보기 끄기" : "▦ 실시간 화면 일괄 미리보기"));
  main.replaceChildren(h("section", { class: "card stack" },
    h("div", { class: "row between wrap" },
      h("h2", { class: "students-count" }, "학생 " + students.length + "명"),
      h("p", { class: "muted small" }, "학생 계정은 웹앱 전체에 하나라서, 어느 수업에서든 같은 학번·이름·비밀번호를 씁니다. 실시간 화면은 학생이 가입할 때(또는 수업 화면에서) 「화면 보기」에 동의해야 바로 보이며, 이 수업 화면(보고 있는 쪽, 쓰고 있는 답, 시뮬레이션)만 보입니다. 학생은 언제든 동의를 바꿀 수 있습니다. 크게 보기는 한 번에 한 명, 「일괄 미리보기」는 동의한 학생 모두를 작게(240p 미만, 시뮬레이션 영상 10 FPS) 함께 봅니다. 칸을 누르면 크게 봅니다."),
      h("p", { class: "muted small" }, h("span", { class: "presence on" }), " 수업 화면을 보고 있음 · ", h("span", { class: "presence away" }), " 다른 앱·탭에 있음 · ", h("span", { class: "presence off" }), " 접속 안 함 (바로 바뀝니다)")),
    students.length ? h("div", { class: "table-wrap" }, h("table", { class: "students-table", "data-ids": ids, "data-grid": grid ? "1" : "" },
      h("thead", {}, h("tr", {}, ["학번", "이름", "저장한 활동", "마지막 저장", "상태", "화면 보기"].map((t) => h("th", {}, t)), gridHead, h("th", {}))),
      h("tbody", {}, rows))) : h("p", { class: "muted" }, "아직 입장한 학생이 없습니다.")));
}

// ---------- 수업 설정 ----------
function drawSettings() {
  const title = h("input", { type: "text", maxlength: 100, value: lesson ? lesson.title : "", placeholder: "예: 2학년 3반 · 열의 이동" });
  const msg = h("p", { class: "error" });
  let kind = "lesson";
  const kindPick = h("fieldset", { class: "options" }, h("legend", {}, "무엇을 만들까요?"),
    [["lesson", "슬라이드 수업", "PPTX·PDF 슬라이드를 띄우며 쪽마다 질문"], ["survey", "설문만", "슬라이드 없이 설문·퀴즈 링크 하나"]].map(([k, name, sub]) =>
      h("label", { class: "option" }, h("input", { type: "radio", name: "lesson-kind", checked: k === kind, onchange() { kind = k; } }),
        h("span", {}, h("strong", {}, name), " · ", h("span", { class: "muted small" }, sub)))));

  async function submit(ev) {
    ev.preventDefault();
    const t = title.value.trim();
    if (!t) { msg.textContent = "수업 제목을 입력하세요."; return; }
    if (lesson) {
      const saved = await save("lessons", { title: t }, lesson.id);
      if (!saved) return;
      await loadLessons(saved.id);
      flash("저장했습니다.");
      return;
    }
    const { data, error } = await sb.rpc("create_lesson", { p_title: t, p_kind: kind });
    if (error) { msg.textContent = "만들지 못했습니다: " + error.message; return; }
    tab = "settings";
    if (data.kind === "survey") tab = "build";
    await loadLessons(data.id);
    flash(data.kind === "survey" ? "설문을 만들었습니다. 이제 질문을 넣으세요." : "수업을 만들었습니다. 이제 슬라이드를 올리세요.");
    return;
  }

  async function duplicate() {
    const { data: copy, error } = await sb.rpc("create_lesson", { p_title: (lesson.title + " (복사)").slice(0, 100), p_kind: lesson.kind });
    if (error) return alert("복제하지 못했습니다: " + error.message);
    // 슬라이드 그림은 같은 것을 함께 쓴다(원래 수업을 지워도 다른 수업이 쓰는 그림은 남긴다)
    await sb.from("lessons").update({ slide_dir: lesson.slide_dir, slide_count: lesson.slide_count }).eq("id", copy.id);
    if (activities.length) {
      const r = await sb.from("activities").insert(activities.map((a) => ({
        lesson_id: copy.id, kind: a.kind, title: a.title, page: a.page, show_answer: a.show_answer, named: a.named, questions: a.questions, sort: a.sort,
      })));
      if (r.error) alert("활동을 복사하지 못했습니다: " + r.error.message);
    }
    await loadLessons(copy.id);
    flash("복제했습니다. 제목을 고쳐 주세요.");
  }

  async function remove() {
    const typed = prompt("수업을 지우면 활동, 학생, 응답, 슬라이드가 모두 지워집니다.\n지우려면 수업 코드 「" + lesson.code + "」를 입력하세요.");
    if ((typed || "").trim().toUpperCase() !== lesson.code) return;
    await removeSlideFiles(lesson);
    const { error } = await sb.from("lessons").delete().eq("id", lesson.id);
    if (error) return alert(error.message);
    await loadLessons(null);
  }

  // 왼쪽: 설정·슬라이드 올리기·전환 효과 미리보기 / 오른쪽: 전체 슬라이드와 다중 선택 삭제(함께 보면서 고르게)
  const slides = lesson && lesson.kind !== "survey" ? slidesCard() : null;
  main.replaceChildren(h("div", { class: slides && slides.allCard ? "settings-grid" : "stack narrowish" }, h("div", { class: "stack" },
    slides ? slides.fxCard : null,   // 전환 효과 미리보기를 맨 위에(오른쪽 전체 슬라이드와 나란히)
    h("form", { class: "card stack", onsubmit: submit },
      h("h2", {}, lesson ? (lesson.kind === "survey" ? "설문 설정" : "수업 설정") : "새로 만들기"),
      lesson ? null : kindPick,
      lesson ? h("p", { class: "join-code" }, "수업 코드 ", h("strong", {}, lesson.code)) : h("p", { class: "muted small" }, "수업 코드는 겹치지 않게 자동으로 만들어집니다."),
      h("label", {}, "제목", title),
      msg,
      h("button", { class: "primary big", type: "submit" }, lesson ? "제목 저장" : "수업 만들기")),
    slides ? slides.mainCard : null,
    lesson ? h("section", { class: "card stack" },
      h("h2", {}, "학생 접속"),
      h("p", { class: "join-url" }, joinUrl(lesson)),
      h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick: showJoin }, "QR 크게 보기"),
        h("button", { class: "ghost", type: "button", onclick: duplicate }, "다른 반용으로 복제"),
        h("button", { class: "ghost danger", type: "button", onclick: remove }, "수업 지우기"))) : null),
    slides && slides.allCard ? h("div", { class: "settings-slot" }, h("div", { class: "stack settings-right" }, slides.allCard)) : null));
  pinSettingsRight();
}

// 수업 설정 오른쪽(전체 슬라이드·다중 선택 삭제)을 넓은 화면에서 화면에 고정한다(왼쪽을 스크롤해도 움직이지 않게).
// 자리는 그리드의 빈 칸(settings-slot)이 잡고, 패널은 그 칸의 위치·너비에 맞춰 position: fixed로 띄운다.
let pinWatch = null;
function pinSettingsRight() {
  if (pinWatch) { pinWatch.ro.disconnect(); removeEventListener("resize", pinWatch.fit); pinWatch = null; }
  const slot = main.querySelector(".settings-slot");
  if (!slot) return;
  const panel = slot.firstChild;
  const head = app.querySelector(".top");
  const fit = () => {
    if (!slot.isConnected) return;
    if (!matchMedia("(min-width: 901px)").matches) { panel.style.cssText = ""; return; }
    const r = slot.getBoundingClientRect();
    const top = (head ? head.offsetHeight : 0) + 16;
    panel.style.cssText = "left:" + r.left + "px;width:" + r.width + "px;top:" + top + "px;max-height:" + (innerHeight - top - 16) + "px";
  };
  const ro = new ResizeObserver(fit);
  ro.observe(slot);
  if (head) ro.observe(head);
  addEventListener("resize", fit);
  pinWatch = { ro, fit };
  fit();
}

// 단계 그림 미리보기 이름: "3쪽" 또는 "3쪽 · 2/4"
function thumbLabel(i) {
  const p = slidePos(lesson, i);
  return p.slide + "쪽" + (p.steps > 1 ? " · " + (p.step - 1) + "/" + (p.steps - 1) : "");
}

// 슬라이드 올리기: PPTX 한 개는 그대로, PDF 한 개 또는 그림 여러 장은 쪽마다 JPG로 바꿔 Storage에 올린다.
function slidesCard() {
  const file = h("input", { type: "file", accept: ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg", multiple: true });
  const bar = h("progress", { max: 1, value: 0, hidden: true });
  const status = h("p", { class: "msg" });
  const btn = h("button", { class: "primary", type: "button" }, lesson.slide_count ? "다시 올리기 (기존 슬라이드를 바꿈)" : "올리기");
  btn.addEventListener("click", async () => {
    if (!file.files.length) { status.textContent = "PPTX, PDF 또는 그림 파일을 먼저 고르세요."; return; }
    btn.disabled = true;
    bar.hidden = false;
    try {
      const n = await uploadSlides([...file.files], (done, total, what) => {
        bar.max = total;
        bar.value = done;
        status.textContent = what + " " + done + " / " + total;
      });
      flash("슬라이드 " + n + "장을 올렸습니다.");
      await loadLessons(lesson.id);
    } catch (e) {
      status.textContent = "올리지 못했습니다: " + (e.message || e);
      btn.disabled = false;
    }
  });
  const thumbs = h("div", { class: "thumbs" });
  for (let i = 1; i <= lesson.slide_count; i++) {
    const preview = h("div", { class: "thumb-preview" });
    const image = h("img", { class: "thumb-photo", src: slideSrc(lesson, i, true), alt: i + "쪽", loading: "lazy" });
    const hitbox = h("button", {
      class: "thumb-hitbox", type: "button", "aria-label": i + "쪽 선택", "aria-pressed": selectedSlides.has(i),
      onclick() { toggleSlideSelection(i, figure, checkbox, hitbox); },
    });
    const alignHitbox = () => {
      hitbox.style.left = image.offsetLeft + "px";
      hitbox.style.top = image.offsetTop + "px";
      hitbox.style.width = image.offsetWidth + "px";
      hitbox.style.height = image.offsetHeight + "px";
    };
    image.addEventListener("load", alignHitbox);
    preview.append(image, hitbox);
    if (image.complete && image.naturalWidth) alignHitbox();
    const checkbox = h("input", {
      type: "checkbox", checked: selectedSlides.has(i), "aria-label": i + "쪽 선택",
      onchange() { setSlideSelection(i, checkbox.checked, figure, checkbox, hitbox); },
    });
    const figure = h("figure", { class: "thumb" + (selectedSlides.has(i) ? " selected" : "") },
      preview,
      h("label", { class: "thumb-check" }, checkbox, "선택"),
      h("figcaption", {}, h("span", {}, slideSteps(lesson) ? thumbLabel(i) : i + "쪽"),
        h("button", { class: "link danger", type: "button", "aria-label": i + "쪽 삭제", onclick() { deleteSlide([i], status); } }, "삭제")));
    thumbs.append(figure);
  }
  const anim = !!slideSteps(lesson);
  const ppt = isPptx(lesson);   // Office 뷰어로 보여 주는 자료: 쪽 미리보기·삭제·전환 효과 없음
  // 전환 효과 미리보기: 수업 진행처럼 전체 슬라이드를 이 화면에서만 넘겨 본다(수업 쪽·학생 화면은 그대로).
  // 「이전/다음」은 슬라이드 단위, 「◁ ▷」는 애니메이션 단계 단위. 「다시 보기」는 지금 쪽으로 넘어오는 효과를 한 번 더 보여 준다.
  const pv = h("img", { class: "slide", alt: "전환 효과 미리보기" });
  const pvWhere = h("span", { class: "where" });
  let pvAt = 1;   // 미리보기에서 보고 있는 그림 번호
  const pvShow = (to, dir) => {
    to = Math.min(Math.max(to, 1), lesson.slide_count || 1);
    if (dir == null) dir = slideNo(lesson, pvAt) === slideNo(lesson, to) ? (to === pvAt ? 1 : 0) : Math.sign(to - pvAt);
    pvAt = to;
    swapSlide(pv, slideSrc(lesson, to), fxPick.value, dir);
    pvWhere.textContent = slideLabel(lesson, to);
  };
  const pvPlay = () => {
    const here = pvAt;
    const back = slideNo(lesson, here) > 1 ? pageOfSlide(lesson, slideNo(lesson, here) - 1) : pageOfSlide(lesson, Math.min(2, slideTotal(lesson)));
    if (back === here) return;
    pvShow(back, null);
    setTimeout(() => pvShow(here, null), 700);
  };
  const fxPick = h("select", {
    "aria-label": "슬라이드 전환 효과",
    onchange() {
      pvPlay();   // 고르자마자 미리보기, 효과가 끝난 뒤 저장
      setTimeout(async () => {
        const { error } = await sb.from("lessons").update({ slide_dir: withFx(lesson.slide_dir, fxPick.value) }).eq("id", lesson.id);
        if (error) return alert("바꾸지 못했습니다: " + error.message);
        flash("전환 효과: " + SLIDE_FX[fxPick.value]);
        await loadLessons(lesson.id);
      }, 1400);
    },
  }, Object.entries(SLIDE_FX).map(([k, name]) => h("option", { value: k, selected: k === slideFx(lesson) }, name)));
  if (lesson.slide_count && !ppt) { swapSlide(pv, slideSrc(lesson, 1), "none", 1); pvWhere.textContent = slideLabel(lesson, 1); }
  const fxBox = h("section", { class: "card stack fx-box" },
    h("div", { class: "row fx-head" }, h("h2", {}, "슬라이드 전환 효과"), fxPick,
      h("span", { class: "muted small grow" }, "쪽을 넘길 때 교사·학생 화면에 함께 적용됩니다.")),
    h("div", { class: "fx-preview" }, pv),
    h("nav", { class: "pager fx-pager" },
      h("button", { class: "ghost arrow", type: "button", title: "애니메이션 이전", "aria-label": "애니메이션 이전", onclick() { pvShow(pvAt - 1); } }, "◀"),
      pvWhere,
      h("button", { class: "ghost arrow", type: "button", title: "애니메이션 다음", "aria-label": "애니메이션 다음", onclick() { pvShow(pvAt + 1); } }, "▶"),
      h("button", { class: "ghost", type: "button", onclick: pvPlay }, "다시 보기")),
    h("p", { class: "muted small" }, "미리보기는 이 화면에서만 움직이고 수업 쪽과 학생 화면은 바뀌지 않습니다."));
  const allCard = lesson.slide_count && !ppt ? h("section", { class: "card stack all-slides" },
    h("h2", {}, "전체 슬라이드 " + lesson.slide_count + "장"),
    h("div", { class: "row slide-tools" },
      h("button", { class: "danger", type: "button", disabled: !selectedSlides.size, onclick() { deleteSlide([...selectedSlides].sort((a, b) => a - b), status); } }, "선택한 슬라이드 삭제 (" + selectedSlides.size + ")"),
      h("span", { class: "muted small grow" }, "빈 칸이 있거나 쪽 수가 맞지 않으면 →"),
      h("button", { class: "ghost", type: "button", onclick() { deleteSlide(null, status); } }, "번호 다시 맞추기")),
    thumbs) : null;
  const mainCard = h("section", { class: "card stack" },
    h("h2", {}, "슬라이드 " + (lesson.slide_count ? slideTotal(lesson) + "장" + (anim ? " (애니메이션 단계 그림 " + lesson.slide_count + "장)" : "") : "없음")),
    h("p", { class: "muted small" }, "PowerPoint 파일(PPTX), PDF 파일, 그림 파일(PNG·JPG)을 올릴 수 있습니다. PPTX는 애니메이션을 살려 보여 주고, PDF는 쪽마다 그림으로 바뀝니다. 그림은 여러 장을 한 번에 고를 수 있습니다. 예전 형식(PPT)은 PowerPoint에서 PPTX로 다시 저장해 올리세요."),
    h("div", { class: "row" }, file, btn), bar, status,
    anim ? h("p", { class: "muted small" }, "애니메이션 단계 그림 자료입니다(교사 PC의 올리기 도구로 올림). 수업 진행에서 「애니메이션」 버튼으로 클릭 단계를 넘깁니다. 아래 미리보기에서 단계 그림을 골라 지울 수 있고, 한 슬라이드의 단계를 모두 지우면 그 슬라이드가 빠집니다.") : null,
    ppt ? h("p", { class: "muted small" }, "지금은 PPTX 자료입니다. 쪽 미리보기와 쪽 삭제는 PDF·그림으로 올린 자료에서만 쓸 수 있습니다. 쪽을 바꾸려면 PowerPoint에서 고친 뒤 「다시 올리기」하세요.") : null);
  return { mainCard, allCard, fxCard: lesson.slide_count && !ppt ? fxBox : null };
}

async function loadZipJs() {
  if (window.JSZip) return window.JSZip;
  await new Promise((ok, fail) => document.head.append(h("script", {
    src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    onload: ok, onerror: () => fail(new Error("PPTX 처리 도구를 불러오지 못했습니다")),
  })));
  return window.JSZip;
}

async function uploadPptx(file, progress) {
  if (file.size > 50 * 1024 * 1024) throw new Error("PPTX 파일은 50MB 이하로 올려 주세요.");
  const Zip = await loadZipJs();
  const zip = await Zip.loadAsync(file);
  const pages = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  if (!pages || pages > 300) throw new Error("PPTX에서 슬라이드를 읽지 못했거나 300장을 넘습니다.");
  const folder = slideFolder(lesson);
  const old = { home: slideHome(lesson), shared: sharedSlides(lesson) };
  const store = await newSlideStore();
  progress(0, 1, "PPTX 올리는 중");
  await store.put(folder + "deck.pptx", file, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const { error: updateError } = await sb.from("lessons").update({ slide_dir: "pptx:" + store.base + folder + "deck.pptx?v=" + Date.now(), slide_count: pages, page: 1 }).eq("id", lesson.id);
  if (updateError) throw updateError;
  // 교체 전 PDF/JPG가 남지 않게 이 수업 전용 폴더의 이미지 파일만 정리한다.
  await cleanSlideFolder(old, store, folder, (n) => !/^\d+s?\.jpg$/.test(n));
  progress(1, 1, "올리는 중");
  return pages;
}

async function loadPdfJs() {
  if (!window.pdfjsLib) {
    await new Promise((ok, fail) => document.head.append(h("script", { src: "vendor/pdf.min.js", onload: ok, onerror: () => fail(new Error("PDF 도구를 불러오지 못했습니다")) })));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  return window.pdfjsLib;
}

// 학생 기기로 내려가는 그림 크기: 1280px·품질 0.72면 글씨는 또렷하고 1600px·0.85의 약 3분의 1 크기다(Supabase 전송량 절약)
const SLIDE_WIDTH = 1280;
const SLIDE_QUALITY = 0.72;

// 학생 기기·썸네일용 작은 그림(n s.jpg): 휴대폰·태블릿 화면에는 1024px이면 충분하고 1280px보다 약 35% 작다
const SMALL_WIDTH = 1024;

function canvasToJpeg(canvas) {
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("그림으로 바꾸지 못했습니다"))), "image/jpeg", SLIDE_QUALITY));
}
// 한 쪽 → { big: 1280px, small: 1024px } JPG
async function slidePair(canvas) {
  const scale = Math.min(1, SMALL_WIDTH / canvas.width);
  const c = h("canvas", { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) });
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return { big: await canvasToJpeg(canvas), small: await canvasToJpeg(c) };
}

// 파일들을 쪽별 JPG 묶음({ big, small })으로 바꾼다
async function toSlideImages(files, progress) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (pdfs.length > 1) throw new Error("PDF는 한 번에 하나만 올릴 수 있습니다.");
  const out = [];
  if (pdfs.length) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await pdfs[0].arrayBuffer() }).promise;
    if (pdf.numPages > 100) throw new Error("100쪽이 넘습니다(" + pdf.numPages + "쪽).");
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(i - 1, pdf.numPages, "그림으로 바꾸는 중");
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: SLIDE_WIDTH / page.getViewport({ scale: 1 }).width });
      const canvas = h("canvas", { width: Math.round(vp.width), height: Math.round(vp.height) });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push(await slidePair(canvas));
    }
    return out;
  }
  const imgs = files.filter((f) => /^image\/(png|jpeg)$/.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  if (!imgs.length) throw new Error("PPTX, PDF 또는 PNG·JPG 파일을 고르세요.");
  if (imgs.length > 100) throw new Error("100장이 넘습니다.");
  for (const [i, f] of imgs.entries()) {
    progress(i, imgs.length, "그림 줄이는 중");
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, SLIDE_WIDTH / bmp.width);
    const canvas = h("canvas", { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    out.push(await slidePair(canvas));
  }
  return out;
}

const slideFolder = (l) => me.id + "/" + l.id + "/";

// ---------- 슬라이드 저장소 ----------
// 새로 올리는 그림은 Cloudflare R2(Worker의 /s/)에 둔다: 학생 기기로 내려가는 전송량이 무료다.
// R2가 아직 연결되지 않았으면 예전처럼 Supabase Storage(무료 전송량 월 5GB)에 둔다.
// 이미 올린 수업은 주소(slide_dir)가 가리키는 저장소를 그대로 쓴다.
const SB_SLIDES = SB_URL + "/storage/v1/object/public/slides/";
const R2_SLIDES = typeof TURN_URL === "string" && TURN_URL.trim() ? TURN_URL.trim().replace(/\/+$/, "") + "/s/" : "";
let r2Ready = null;
const newSlideStore = async () => {
  r2Ready ??= R2_SLIDES ? fetch(R2_SLIDES + "ping", { cache: "no-store" }).then((r) => r.ok, () => false) : Promise.resolve(false);
  return (await r2Ready) ? r2Store : sbStore;
};
async function r2Call(method, path, body, type) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(R2_SLIDES + path, {
    method, body, headers: { Authorization: "Bearer " + (data.session ? data.session.access_token : ""), "content-type": type || "application/json" },
  });
  if (!r.ok) throw new Error("슬라이드 저장소(R2) 응답 " + r.status);
  return r.json();
}
const r2Store = {
  base: R2_SLIDES,
  put: (path, blob, type) => r2Call("PUT", path, blob, type),
  list: async (folder) => (await r2Call("POST", "", JSON.stringify({ op: "list", prefix: folder }))).names.map((o) => o.name),
  async remove(paths) { for (let i = 0; i < paths.length; i += 1000) await r2Call("POST", "", JSON.stringify({ op: "delete", keys: paths.slice(i, i + 1000) })); },
  move: (from, to) => r2Call("POST", "", JSON.stringify({ op: "move", from, to })),
};
const sbStore = {
  base: SB_SLIDES,
  async put(path, blob, type) {
    // 주소에 ?v=올린시각 이 붙어 1년 캐시해도 새 그림이 보인다
    const { error } = await sb.storage.from("slides").upload(path, blob, { upsert: true, contentType: type, cacheControl: "31536000" });
    if (error) throw error;
  },
  async list(folder) {
    const { data, error } = await sb.storage.from("slides").list(folder.replace(/\/$/, ""), { limit: 1000 });
    if (error) throw error;
    return (data || []).map((o) => o.name);
  },
  async remove(paths) {
    if (!paths.length) return;
    const { error } = await sb.storage.from("slides").remove(paths);
    if (error) throw error;
  },
  async move(from, to) {
    const { error } = await sb.storage.from("slides").move(from, to);
    if (error) throw error;
  },
};

// 슬라이드 그림이 들어 있는 저장소와 폴더(주소에서 읽는다). 다른 교사가 올렸거나 복제한 수업이면 원래 수업의 폴더다.
function slideHome(l) {
  const dir = (l.slide_dir || "").replace(/^pptx:/, "").split("?")[0];
  const store = R2_SLIDES && dir.startsWith(R2_SLIDES) ? r2Store : dir.startsWith(SB_SLIDES) ? sbStore : null;
  const m = store && /^(.+\/)(?:\{n\}\.jpg|deck\.pptx)$/.exec(decodeURIComponent(dir.slice(store.base.length)));
  return m ? { store, folder: m[1] } : null;
}
// 같은 그림을 쓰는 다른 수업(복제)이 있는지
const sharedSlides = (l) => lessons.some((x) => x.id !== l.id && (x.slide_dir || "").split("?")[0] === (l.slide_dir || "").split("?")[0]);

// 새로 올린 뒤 이 수업 폴더에 남은 예전 파일을 지운다. 저장소를 옮겼으면(Supabase → R2) 예전 저장소의 파일은 모두 지운다.
async function cleanSlideFolder(old, store, folder, keep) {
  try {
    const gone = (await store.list(folder)).filter((n) => !keep(n)).map((n) => folder + n);
    if (gone.length) await store.remove(gone);
    if (old.home && old.home.store !== store && old.home.folder === folder && !old.shared) {
      const all = await old.home.store.list(folder);
      if (all.length) await old.home.store.remove(all.map((n) => folder + n));
    }
  } catch (e) {
    console.warn("예전 슬라이드 파일 정리 실패", e);
  }
}

// 슬라이드 한 쪽 지우기: 그 쪽 그림을 지우고 뒤쪽 그림을 한 칸씩 앞으로 당긴다.
// 질문의 쪽 번호도 함께 당긴다(지운 쪽에 붙어 있던 질문은 그 자리로 당겨진 다음 슬라이드에 붙는다).
// 저장소에 실제로 있는 그림 목록을 보고 1, 2, 3 … 으로 다시 번호를 매기므로, 중간에 멈춰 꼬인 상태도 바로잡는다.
// k 가 없으면(번호 다시 맞추기) 아무것도 지우지 않고 번호만 맞춘다.
let slideBusy = false;
const selectedSlides = new Set();

function setSlideSelection(page, selected, figure, checkbox, hitbox) {
  if (selected) selectedSlides.add(page);
  else selectedSlides.delete(page);
  figure.classList.toggle("selected", selected);
  checkbox.checked = selected;
  hitbox.setAttribute("aria-pressed", String(selected));
  const bulk = document.querySelector(".slide-tools .danger");
  if (bulk) {
    bulk.disabled = !selectedSlides.size;
    bulk.textContent = "선택한 슬라이드 삭제 (" + selectedSlides.size + ")";
  }
}

function toggleSlideSelection(page, figure, checkbox, hitbox) {
  setSlideSelection(page, !selectedSlides.has(page), figure, checkbox, hitbox);
}

async function deleteSlide(target, status) {
  if (slideBusy) return;
  const targets = target == null ? [] : [...new Set(Array.isArray(target) ? target : [target])].sort((a, b) => a - b);
  const home = slideHome(lesson);
  if (!home || isPptx(lesson)) return alert("이 수업의 슬라이드 위치를 알 수 없습니다. 슬라이드를 다시 올려 주세요.");
  const folder = home.folder;
  const base = lesson.slide_dir.split("?")[0];
  if (folder !== slideFolder(lesson) || sharedSlides(lesson)) {
    return alert("이 슬라이드는 복제한 다른 수업과 함께 쓰고 있어서 한 쪽만 지울 수 없습니다.\n이 수업에서 슬라이드 파일을 「다시 올리기」하면 이 수업만의 슬라이드가 됩니다.");
  }
  if (targets.length) {
    if (!confirm(targets.length + "장의 슬라이드를 지울까요? 남은 슬라이드와 질문 쪽 번호를 맞춥니다.")) return;
  }
  slideBusy = true;
  document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = true; });
  const st = home.store;
  try {
    status.textContent = "슬라이드 목록을 확인하는 중…";
    const names = await st.list(folder);
    let nums = names.map((n) => /^(\d+)\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]).sort((x, y) => x - y);
    // 작은 그림(3s.jpg)도 큰 그림과 함께 지우고 옮긴다
    const smalls = new Set(names.map((n) => /^(\d+)s\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]));
    if (targets.length) {
      const missing = targets.filter((n) => !nums.includes(n));
      if (missing.length) throw new Error(missing.join(", ") + "쪽 그림이 이미 없습니다. 「번호 다시 맞추기」를 눌러 주세요.");
      status.textContent = targets.length + "장의 슬라이드를 지우는 중…";
      await st.remove(targets.flatMap((n) => [folder + n + ".jpg", ...(smalls.has(n) ? [folder + n + "s.jpg"] : [])]));
      for (const n of targets) smalls.delete(n);
      nums = nums.filter((x) => !targets.includes(x));
    }
    const small = /[?&]sm=1/.test(lesson.slide_dir) && nums.every((n) => smalls.has(n));
    // 남은 그림을 1, 2, 3 … 으로 당긴다(작은 번호부터 옮기므로 옮길 자리는 늘 비어 있다)
    for (const [i, num] of nums.entries()) {
      if (num === i + 1) continue;
      status.textContent = "슬라이드 번호를 맞추는 중 " + (i + 1) + " / " + nums.length;
      await st.move(folder + num + ".jpg", folder + (i + 1) + ".jpg");
      if (smalls.has(num)) await st.move(folder + num + "s.jpg", folder + (i + 1) + "s.jpg");
    }
    const left = nums.length;
    // 단계 그림 수업: 남은 그림으로 슬라이드마다 단계 수를 다시 센다. 단계가 모두 지워진 슬라이드는 빠지고,
    // 질문의 쪽 번호(= 슬라이드 번호)는 빠진 슬라이드만큼 당긴다.
    const steps = slideSteps(lesson);
    let anim = "", gone = targets, total = left;
    if (steps) {
      const owner = steps.flatMap((n, s) => Array(n).fill(s + 1));   // 그림 번호 → 슬라이드 번호
      if (nums.every((n) => n <= owner.length)) {
        const keep = steps.map(() => 0);
        for (const n of nums) keep[owner[n - 1] - 1]++;
        gone = keep.map((k, s) => (k ? 0 : s + 1)).filter(Boolean);
        anim = keep.filter(Boolean).map((k) => Math.min(k - 1, 35).toString(36)).join("");
        total = anim.length;
      }
    }
    if (targets.length) {
      const shift = (pg) => (pg == null ? pg : pg - gone.filter((n) => n < pg).length);
      for (const a of activities) {
        if (a.page == null) continue;
        const page = Math.min(shift(a.page), Math.max(total, 1));
        let to = a.page_to > a.page ? Math.min(shift(a.page_to), Math.max(total, 1)) : a.page_to ?? null;
        if (to != null && to <= page) to = null;
        if (page === a.page && to === (a.page_to ?? null)) continue;
        const change = { page };
        if ("page_to" in a) change.page_to = to;
        const u = await sb.from("activities").update(change).eq("id", a.id);
        if (u.error) throw u.error;
      }
    }
    const pageNow = lesson.page - targets.filter((n) => n < lesson.page).length;
    // 이름이 바뀐 그림을 브라우저가 예전 것으로 보이지 않게. 원본 PPTX(deck)는 더 이상 쪽이 맞지 않으므로 뺀다
    const dir = withFx(base + "?v=" + Date.now() + (small ? "&sm=1" : "") + (anim ? "&anim=" + anim : ""), slideFx(lesson));
    const u = await sb.from("lessons").update({ slide_dir: left ? dir : "", slide_count: left, page: Math.min(Math.max(pageNow, 1), Math.max(left, 1)) }).eq("id", lesson.id);
    if (u.error) throw u.error;
    selectedSlides.clear();
    flash(targets.length ? targets.length + "장의 슬라이드를 지웠습니다." : "슬라이드 번호를 맞췄습니다 (" + left + "장).");
    slideBusy = false;
    await loadLessons(lesson.id);
  } catch (e) {
    slideBusy = false;
    document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = false; });
    status.textContent = "멈췄습니다: " + (e.message || e) + " · 「번호 다시 맞추기」를 누르면 남은 그림으로 번호를 다시 맞춥니다.";
    alert(status.textContent);
  }
}

async function uploadSlides(files, progress) {
  if (files.some((f) => /\.ppt$/i.test(f.name))) throw new Error("예전 PowerPoint 형식(PPT)은 올릴 수 없습니다. PowerPoint에서 파일 → 다른 이름으로 저장 → PPTX로 저장해 올리세요.");
  const pptx = files.filter((f) => /\.pptx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  if (pptx.length) {
    if (pptx.length !== 1 || files.length !== 1) throw new Error("PPTX는 한 번에 하나만 올릴 수 있습니다.");
    return uploadPptx(pptx[0], progress);
  }
  const images = await toSlideImages(files, progress);
  const folder = slideFolder(lesson);
  const old = { home: slideHome(lesson), shared: sharedSlides(lesson) };
  const store = await newSlideStore();
  for (const [i, pair] of images.entries()) {
    progress(i, images.length, "올리는 중");
    await store.put(folder + (i + 1) + ".jpg", pair.big, "image/jpeg");
    await store.put(folder + (i + 1) + "s.jpg", pair.small, "image/jpeg");
  }
  progress(images.length, images.length, "올리는 중");
  const dir = withFx(store.base + folder + "{n}.jpg?v=" + Date.now() + "&sm=1", slideFx(lesson));
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: images.length, page: 1 }).eq("id", lesson.id);
  if (error) throw error;
  // 전보다 쪽 수가 줄었으면 남은 그림과 예전 원본 PPTX를 지운다
  await cleanSlideFolder(old, store, folder, (n) => { const m = /^(\d+)s?\.jpg$/.exec(n); return !!m && +m[1] <= images.length; });
  return images.length;
}

// 수업을 지울 때 그 수업의 슬라이드 그림도 지운다(복제한 다른 수업이 같은 그림을 쓰면 남긴다)
async function removeSlideFiles(l) {
  if (!l.slide_count || !l.slide_dir.includes("/" + l.id + "/")) return;
  if (sharedSlides(l)) return;
  // 그림을 올린 교사의 폴더(교사가 여러 명일 수 있으므로 주소에서 읽는다)
  const home = slideHome(l);
  if (!home) return;
  const names = await home.store.list(home.folder);
  if (names.length) await home.store.remove(names.map((n) => home.folder + n));
}

// ---------- CSV ----------
function downloadCSV(acts, fileName) {
  acts = acts.filter((a) => a.kind !== "sim");
  const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const head = ["학번", "이름"];
  acts.forEach((a) => {
    if (a.kind === "quiz") head.push(a.title + " · 점수");
    a.questions.forEach((q, i) => head.push(a.title + " · " + (i + 1) + ". " + q.text));
    head.push(a.title + " · 저장 시각");
  });
  const lines = [head.map(cell).join(",")];
  students.forEach((s) => {
    const row = [s.class_no, s.name];
    acts.forEach((a) => {
      const r = responses.find((x) => x.activity_id === a.id && x.student_id === s.id);
      if (a.kind === "quiz") row.push(r && r.total ? r.score + "/" + r.total : "");
      a.questions.forEach((q) => row.push(r ? answerText(r.answers[q.id]) : ""));
      row.push(r ? new Date(r.updated_at).toLocaleString("ko-KR") : "");
    });
    lines.push(row.map(cell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: fileName.replace(/[\\/:*?"<>|]/g, "_") + ".csv" });
  document.body.append(a);
  a.click();
  a.remove();
}
