// 교사 화면(버전 2): 로그인 → 수업 고르기 → [수업 진행] [질문·설문 만들기] [학생 관리] [수업 설정]
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

function sortActivities(list) {
  return list.slice().sort((x, y) => (x.page ?? 1e9) - (y.page ?? 1e9) || x.sort - y.sort || x.created_at.localeCompare(y.created_at));
}

async function loadResponses() {
  if (!lesson) return;
  // 이 수업에 들어온 학생(학생 계정은 웹앱 전체에 하나, 수업마다 참여 기록이 따로 있다)
  const st = await sb.rpc("teacher_students", { p_lesson: lesson.id });
  if (st.error) return fatal(st.error);
  students = (st.data || []).sort((x, y) => x.class_no.localeCompare(y.class_no, "ko", { numeric: true }) || x.name.localeCompare(y.name, "ko"));
  const ids = activities.map((a) => a.id);
  if (!ids.length) { responses = []; return; }
  const rs = await sb.from("responses").select("*").in("activity_id", ids);
  if (rs.error) return fatal(rs.error);
  responses = rs.data;
}

function schedule() {
  clearTimeout(timer);
  if (!lesson || (tab !== "run" && tab !== "students")) return;
  timer = setTimeout(async () => {
    await loadResponses();
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
  const tabs = [["run", "수업 진행"], ["build", "질문·설문 만들기"], ["students", "학생 관리"], ["settings", "수업 설정"], ["manage", "전체 수업 관리"]];
  if (!tabs.some(([k]) => k === tab)) tab = "run";
  main = h("main", { class: "wide" });
  app.replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "top-title" }, h("span", { class: "eyebrow" }, "교사용"), pick),
      h("nav", { class: "tabs" }, tabs.map(([k, label]) => h("button", {
        type: "button", class: tab === k ? "tab on" : "tab", disabled: !lesson && k !== "settings" && k !== "manage",
        onclick() { tab = k; localStorage.setItem("cra-tab", k); draw(); },
      }, label))),
      h("button", { class: "link", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃")),
    main);
  if (!lesson && tab !== "manage") tab = "settings";
  ({ run: drawRun, build: drawBuild, students: drawStudents, settings: drawSettings, manage: drawManage })[tab]();
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
        ? h("img", { class: "lesson-thumb", src: slideSrc(l, 1), alt: l.title + " 첫 슬라이드", loading: "lazy", draggable: "false" })
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
  const stageSim = L.slide_count > 0 ? shown.find((a) => a.kind === "sim" && a.sim_full && onPage(a, sn)) : null;
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
  const overs = L.slide_count > 0 && !isPptx(L) && !stageSim ? shown.filter((a) => isOverSim(a) && onPage(a, sn)) : [];
  syncSimLayer(run.simLayer, run.img);
  renderSimLayer(run.simLayer, overs, {
    load: (a) => a.html, ver: (a) => (a.html || "").length + ":" + a.title, editable: true,
    onMove: (a, p) => setActivity(a, { sim_place: p }),
  });
  drawRoster(shown.filter((a) => a.kind !== "sim"));
  run.panel.replaceChildren(...(shown.length ? shown.map(runBlock)
    : [h("p", { class: "card muted" }, sn + "쪽에는 활동이 없습니다. 「질문·설문 만들기」에서 추가하세요.")]));
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
      ? h("p", { class: "error small" }, "쪽이 정해지지 않아 슬라이드에 붙지 않습니다. 「질문·설문 만들기」에서 이 시뮬레이션을 고쳐 쪽 번호를 정하고 저장하세요.") : null,
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
    h("p", { class: a.shared ? "pill on" : "pill" }, a.shared ? "학생에게 공개 중 (" + (a.named ? "이름과 함께" : "이름 없이") + ")" : "학생에게는 보이지 않음"),
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

// ---------- 질문·설문 만들기 ----------
const newId = () => Math.random().toString(36).slice(2, 8);
const newQuestion = (type) => ({ id: newId(), type: type || "choice", text: "", options: ["", ""] });

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
      h("p", { class: "sum-q" }, (i + 1) + ". " + q.text, h("span", { class: "muted small" }, " · " + (TYPE_NAME[q.type] || q.type))),
      (q.type === "choice" || q.type === "multi") ? h("ul", { class: "preview-options" }, (q.options || []).filter(Boolean).map((o) =>
        h("li", { class: a.kind === "quiz" && [].concat(q.answer ?? []).includes(o) ? "right" : "" }, o,
          a.kind === "quiz" && [].concat(q.answer ?? []).includes(o) ? h("strong", { class: "right-mark" }, " ✓정답") : null))) : null)));
}

function drawBuild() {
  const ids = new Set(activities.map((a) => a.id));
  for (const id of buildSimFrames.keys()) if (!ids.has(id)) buildSimFrames.delete(id);
  const list = activities.length ? activities.map((a) => h("div", { class: "act-row" + (editing && editing.id === a.id ? " on" : "") },
    h("div", { class: "act-head stack" },
      h("p", { class: "muted small" }, activityName(a) + " · " + whereText(a)),
      h("h3", {}, a.title),
      a.kind === "sim" && a.html ? buildSimFrame(a).play : null,
      h("button", { type: "button", class: editing && editing.id === a.id ? "primary" : "ghost",
        onclick() { editing = JSON.parse(JSON.stringify(a)); drawBuild(); main.querySelector(".editor")?.scrollIntoView({ block: "start" }); } },
        editing && editing.id === a.id ? "고치는 중" : "고치기")),
    h("div", { class: "act-body" }, activityPreview(a)))) : h("p", { class: "muted small" }, "아직 활동이 없습니다.");
  const kindList = lesson.kind === "survey" ? { survey: "정답 없는 설문", quiz: "정답·자동 채점" } : { slide: "쪽 아래에 붙는 질문", survey: "정답 없는 설문", quiz: "정답·자동 채점" };
  const kinds = h("div", { class: "kinds" }, Object.entries(kindList).map(([k, sub]) =>
    h("button", {
      type: "button", class: "kind",
      onclick() {
        editing = { kind: k, title: "", page: lesson.slide_count ? slideNo(lesson, lesson.page) : null, show_answer: true, named: false, shared: false, questions: [newQuestion(k === "survey" ? "long" : "choice")] };
        drawBuild();
      },
    }, h("strong", {}, KIND_NAME[k]), h("span", {}, sub))),
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "survey", title: "", page: lesson.slide_count ? slideNo(lesson, lesson.page) : null, show_answer: false, named: false, shared: false,
        questions: [{ id: newId(), type: "info", text: "" }] };
      drawBuild();
    } }, h("strong", {}, "설명 카드"), h("span", {}, "글과 외부 링크만 표시")),
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "sim", title: "", page: lesson.slide_count ? slideNo(lesson, lesson.page) : null, sim_full: lesson.slide_count > 0, html: "", questions: [] };
      drawBuild();
    } }, h("strong", {}, "시뮬레이션"), h("span", {}, "html 파일을 슬라이드 사이에")));
  main.replaceChildren(h("div", { class: "build" },
    h("aside", { class: "stack" },
      h("section", { class: "card stack" }, h("h2", {}, "새로 만들기"), kinds)),
    h("div", { class: "build-main stack" },
      editing ? editor() : null,
      h("section", { class: "card stack" }, h("h2", {}, "이 수업의 활동"),
        editing ? null : h("p", { class: "muted small" }, "왼쪽에서 새로 만들거나, 아래 활동의 「고치기」를 누르세요."),
        list))));
}

function simEditor() {
  const e = editing;
  // 화면에 보이는 쪽 번호가 그대로 저장되게 한다(예전에는 칸을 고치지 않으면 빈 값=「언제든」으로 저장되어 슬라이드에 얹히지 않았다)
  if (lesson.slide_count && e.page == null) e.page = slideNo(lesson, lesson.page);
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
  } });
  const pageIn = h("input", { type: "number", min: 1, max: Math.max(slideTotal(lesson), 1), value: e.page ?? slideNo(lesson, lesson.page), class: "num", "aria-label": "시작 쪽", oninput() { e.page = parseInt(pageIn.value, 10) || 1; } });
  const pageToIn = h("input", { type: "number", min: 1, max: Math.max(slideTotal(lesson), 1), value: e.page_to > e.page ? e.page_to : "", placeholder: "(한 쪽만)", class: "num", "aria-label": "끝 쪽", oninput() { e.page_to = parseInt(pageToIn.value, 10) || null; } });
  async function saveSim() {
    e.title = e.title.trim();
    if (!e.title) { msg.textContent = "제목을 입력하세요."; return; }
    if (!(e.html || "").trim()) { msg.textContent = "html 파일을 고르거나 코드를 붙여넣으세요."; return; }
    if (e.html.length > 500000) { msg.textContent = "코드가 너무 깁니다(최대 50만 자)."; return; }
    if (lesson.slide_count && (e.sim_full || e.sim_place) && !(e.page >= 1)) { msg.textContent = "몇 쪽 슬라이드에 넣을지 적어 주세요."; return; }
    const row = { kind: "sim", title: e.title, page: lesson.slide_count ? e.page : null, html: e.html, sim_full: !!e.sim_full && lesson.slide_count > 0,
      sim_place: lesson.slide_count && !e.sim_full && e.sim_place ? e.sim_place : null, show_answer: false, named: false, questions: [] };
    const to = row.page != null && e.page_to > row.page ? Math.min(e.page_to, slideTotal(lesson)) : null;
    if (to != null || activities.some((x) => "page_to" in x)) row.page_to = to;
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
    h("label", {}, "제목", title),
    h("label", {}, "html 파일 올리기", file),
    h("label", {}, "또는 코드 붙여넣기", code), size,
    lesson.slide_count ? h("div", { class: "row wrap" },
      h("label", {}, "어디에 넣을까요?", h("div", { class: "row" }, pageIn, h("span", {}, "쪽부터"), pageToIn, h("span", {}, "쪽까지")))) : null,
    lesson.slide_count ? h("fieldset", { class: "options" }, h("legend", {}, "어떻게 보일까요?"),
      [["over", "슬라이드 위에 얹기", "테두리 없이 슬라이드의 한 자리에 붙습니다. 「수업 진행」 화면에서 위쪽 막대를 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꿉니다."],
        ["full", "슬라이드 자리에 크게", "그 쪽에서는 슬라이드 대신 시뮬레이션이 크게 보입니다."],
        ["card", "슬라이드 아래 카드", "슬라이드 아래에 카드로 보입니다."]].map(([k, name, sub]) =>
        h("label", { class: "option" },
          h("input", { type: "radio", name: "sim-place", checked: k === (e.sim_full ? "full" : e.sim_place ? "over" : "card"),
            onchange() { e.sim_full = k === "full"; e.sim_place = k === "over" ? (e.sim_place || { ...SIM_PLACE_DEFAULT }) : null; } }),
          h("span", {}, h("strong", {}, name), " · ", h("span", { class: "muted small" }, sub))))) : null,
    lesson.slide_count ? h("p", { class: "muted small" }, "슬라이드 사이에 따로 넣으려면 PPT에 「시뮬레이션」 같은 빈 슬라이드를 한 장 끼워 두고, 그 쪽에 「슬라이드 자리에 크게」로 넣으세요.") : null,
    h("p", { class: "muted small" }, "시뮬레이션은 격리된 칸에서 실행되어 이 웹앱의 로그인 정보에 접근할 수 없습니다. 학생은 이 카드에 답을 입력하지 않습니다."),
    msg,
    h("div", { class: "row between" },
      e.id ? h("button", { class: "ghost danger", type: "button", async onclick() {
        if (!confirm("「" + e.title + "」 시뮬레이션을 지울까요?")) return;
        const { error } = await sb.from("activities").delete().eq("id", e.id);
        if (error) { msg.textContent = error.message; return; }
        activities = activities.filter((a) => a.id !== e.id); editing = null; drawBuild();
      } }, "지우기") : h("span", {}),
      h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick() { if ((e.html || "").trim()) openSimFull(e.title || "미리보기", e.html); else msg.textContent = "먼저 html을 넣으세요."; } }, "미리보기"),
        h("button", { class: "ghost", type: "button", onclick() { editing = null; drawBuild(); } }, "닫기"),
        h("button", { class: "primary", type: "button", onclick: saveSim }, "저장"))));
}

function editor() {
  const e = editing;
  if (e.kind === "sim") return simEditor();
  if (isInfoActivity(e)) {
    const msg = h("p", { class: "error" });
    const title = h("input", { type: "text", maxlength: 100, value: e.title, placeholder: "예: 활동 안내", oninput() { e.title = title.value; } });
    const body = h("textarea", { rows: 10, maxlength: 5000, placeholder: "설명과 링크를 입력하세요. https:// 주소는 학생 화면에서 클릭할 수 있습니다.", oninput() { e.questions[0].text = body.value; } }, e.questions[0].text || "");
    return h("section", { class: "card stack editor" },
      h("h2", {}, e.id ? "설명 카드 고치기" : "설명 카드 만들기"),
      h("label", {}, "제목", title), h("label", {}, "설명문", body),
      h("p", { class: "muted small" }, "학생은 이 카드에 답을 입력하지 않습니다."), msg,
      h("div", { class: "row between" },
        e.id ? h("button", { class: "ghost danger", type: "button", async onclick() {
          if (!confirm("설명 카드를 지울까요?")) return;
          const { error } = await sb.from("activities").delete().eq("id", e.id);
          if (error) { msg.textContent = error.message; return; }
          activities = activities.filter((a) => a.id !== e.id); editing = null; drawBuild();
        } }, "카드 지우기") : h("span", {}),
        h("div", { class: "row" },
          h("button", { class: "ghost", type: "button", onclick() { editing = null; drawBuild(); } }, "닫기"),
          h("button", { class: "primary", type: "button", async onclick() {
            e.title = e.title.trim(); e.questions[0].text = e.questions[0].text.trim();
            if (!e.title || !e.questions[0].text) { msg.textContent = "제목과 설명문을 입력하세요."; return; }
            const row = { kind: "survey", title: e.title, page: e.page, show_answer: false, named: false, questions: e.questions };
            if (!e.id) { row.lesson_id = lesson.id; row.sort = activities.length; }
            const saved = await save("activities", row, e.id);
            if (!saved) return;
            const { data } = await sb.from("activities").select("*").eq("lesson_id", lesson.id);
            activities = sortActivities(data || []); editing = JSON.parse(JSON.stringify(saved)); drawBuild(); flash("저장했습니다.");
          } }, "저장"))));
  }
  if (e.description === undefined) e.description = activityDescription(e);
  const hasResponses = e.id && responses.some((r) => r.activity_id === e.id);
  const msg = h("p", { class: "error" });
  const redraw = () => { const y = scrollY; drawBuild(); scrollTo(0, y); };

  const title = h("input", { type: "text", maxlength: 100, value: e.title, placeholder: "예: 예상해 보기", oninput() { e.title = title.value; } });
  const description = h("textarea", { rows: 5, maxlength: 2000, placeholder: "설문 전체에 대한 설명을 입력하세요. 웹 주소는 학생 화면에서 링크가 됩니다.", oninput() { e.description = description.value; } }, e.description || "");
  const pageIn = h("input", { type: "number", min: 1, max: Math.max(slideTotal(lesson), 1), value: e.page ?? slideNo(lesson, lesson.page), class: "num", "aria-label": "시작 쪽", oninput() { e.page = parseInt(pageIn.value, 10) || 1; } });
  // 여러 쪽에 걸쳐 같은 질문을 띄울 때 끝 쪽. 비우면 시작 쪽 한 쪽에만 보인다
  const pageToIn = h("input", { type: "number", min: 1, max: Math.max(slideTotal(lesson), 1), value: e.page_to > e.page ? e.page_to : "", placeholder: "(한 쪽만)", class: "num", "aria-label": "끝 쪽", oninput() { e.page_to = parseInt(pageToIn.value, 10) || null; } });
  const placeSel = h("select", {
    onchange() { e.page = placeSel.value === "page" ? (parseInt(pageIn.value, 10) || 1) : null; redraw(); },
  }, h("option", { value: "page", selected: e.page != null }, "슬라이드 쪽 아래"), h("option", { value: "any", selected: e.page == null }, "언제든 (모든 쪽 아래 목록)"));

  const qs = e.questions.map((q, i) => {
    const typeSel = h("select", {
      "aria-label": "질문 종류",
      onchange() { q.type = typeSel.value; if (q.type === "choice" || q.type === "multi") { q.options = q.options && q.options.length ? q.options : ["", ""]; } delete q.answer; redraw(); },
    }, Object.entries(TYPE_NAME).map(([k, v]) => h("option", { value: k, selected: q.type === k }, v)));
    const move = (d) => { const j = i + d; if (j < 0 || j >= e.questions.length) return; [e.questions[i], e.questions[j]] = [e.questions[j], e.questions[i]]; redraw(); };
    const text = h("input", { type: "text", maxlength: 300, value: q.text, placeholder: "질문을 입력하세요", oninput() { q.text = text.value; } });
    const choice = q.type === "choice" || q.type === "multi";
    const opts = choice ? h("textarea", {
      rows: Math.max(3, q.options.length + 1),
      onchange() {
        q.options = opts.value.split("\n").map((x) => x.trim()).filter(Boolean);
        if (q.answer != null) {
          q.answer = q.type === "choice" ? (q.options.includes(q.answer) ? q.answer : undefined) : [].concat(q.answer).filter((x) => q.options.includes(x));
          if (q.answer === undefined || (Array.isArray(q.answer) && !q.answer.length)) delete q.answer;
        }
        redraw();
      },
    }, q.options.filter(Boolean).join("\n")) : null;
    const answerPick = e.kind === "quiz" && choice && q.options.filter(Boolean).length ? h("fieldset", { class: "options" },
      h("legend", {}, "정답 표시" + (q.type === "multi" ? " (모두 고르기)" : "")),
      q.options.filter(Boolean).map((o) => h("label", { class: "option" + ([].concat(q.answer ?? []).includes(o) ? " right" : "") },
        h("input", {
          type: q.type === "choice" ? "radio" : "checkbox", name: "ans-" + q.id, checked: [].concat(q.answer ?? []).includes(o),
          onchange(ev) {
            if (q.type === "choice") q.answer = o;
            else {
              const now = q.options.filter((x) => (x === o ? ev.target.checked : [].concat(q.answer ?? []).includes(x)));
              if (now.length) q.answer = now; else delete q.answer;
            }
            redraw();
          },
        }), h("span", {}, o)))) : null;
    const explain = e.kind === "quiz" ? h("input", { type: "text", maxlength: 300, value: q.explain || "", placeholder: "해설 (선택)", oninput() { q.explain = explain.value.trim() || undefined; } }) : null;
    return h("article", { class: "q-edit stack" },
      h("div", { class: "row" }, h("strong", {}, "질문 " + (i + 1)), typeSel, h("span", { class: "spacer" }),
        h("button", { class: "link", type: "button", onclick() { move(-1); } }, "위로"),
        h("button", { class: "link", type: "button", onclick() { move(1); } }, "아래로"),
        h("button", { class: "link danger", type: "button", onclick() { if (e.questions.length > 1) { e.questions.splice(i, 1); redraw(); } } }, "삭제")),
      h("label", {}, "질문", text),
      choice ? h("label", {}, "보기 (한 줄에 하나씩)", opts) : null,
      answerPick,
      explain ? h("label", {}, "해설", explain) : null,
      e.kind === "quiz" && !choice ? h("p", { class: "muted small" }, "글로 답하는 질문은 자동 채점하지 않습니다.") : null);
  });

  async function saveActivity() {
    e.title = e.title.trim();
    if (!e.title) { msg.textContent = "제목을 입력하세요."; return; }
    for (const [i, q] of e.questions.entries()) {
      q.text = (q.text || "").trim();
      delete q.description;
      delete q.intro;
      if (!q.text) { msg.textContent = (i + 1) + "번 질문을 입력하세요."; return; }
      if (q.type === "choice" || q.type === "multi") {
        q.options = q.options.map((x) => x.trim()).filter(Boolean);
        if (q.options.length < 2) { msg.textContent = (i + 1) + "번 질문의 보기를 두 개 이상 적으세요."; return; }
        if (new Set(q.options).size !== q.options.length) { msg.textContent = (i + 1) + "번 질문에 같은 보기가 두 번 있습니다."; return; }
      } else { delete q.options; delete q.answer; }
    }
    if (e.questions.length && e.description.trim()) e.questions[0].intro = e.description.trim();
    const row = { kind: e.kind, title: e.title, page: e.page, show_answer: e.show_answer, named: e.named, questions: e.questions };
    // 끝 쪽: 시작 쪽보다 뒤일 때만 쓴다. (page_to 칸이 없는 예전 데이터베이스에서도 한 쪽짜리는 저장되도록 필요할 때만 보낸다)
    const to = e.page != null && e.page_to > e.page ? Math.min(e.page_to, Math.max(slideTotal(lesson), e.page)) : null;
    // 데이터베이스에 page_to 칸이 있을 때만(불러온 활동에 그 칸이 보일 때만) 보낸다
    const hasPageTo = activities.some((x) => "page_to" in x);
    if (to != null && activities.length && !hasPageTo) {
      msg.textContent = "여러 쪽에 걸친 질문을 쓰려면 먼저 Supabase에서 setup.sql을 한 번 실행해야 합니다. 끝 쪽 칸을 비우면 지금도 저장할 수 있습니다.";
      return;
    }
    if (to != null || hasPageTo) row.page_to = to;
    if (!e.id) { row.lesson_id = lesson.id; row.sort = activities.length; }
    const saved = await save("activities", row, e.id);
    if (!saved) return;
    const { data } = await sb.from("activities").select("*").eq("lesson_id", lesson.id);
    activities = sortActivities(data || []);
    editing = JSON.parse(JSON.stringify(saved));
    drawBuild();
    flash("저장했습니다.");
  }

  async function removeActivity() {
    if (!confirm("「" + e.title + "」을(를) 지울까요? 학생 응답도 함께 지워집니다.")) return;
    const { error } = await sb.from("activities").delete().eq("id", e.id);
    if (error) { msg.textContent = error.message; return; }
    activities = activities.filter((a) => a.id !== e.id);
    editing = null;
    drawBuild();
  }

  return h("section", { class: "card stack editor" },
    h("p", { class: "muted small" }, KIND_NAME[e.kind] + (e.id ? " 고치기" : " 새로 만들기")),
    hasResponses ? h("p", { class: "banner" }, "이미 학생 응답이 있습니다. 질문이나 보기를 바꾸면 기존 응답과 맞지 않을 수 있습니다.") : null,
    h("div", { class: "row wrap" },
      h("label", { class: "grow" }, "제목", title),
      lesson.slide_count ? h("label", {}, "어디에 보일까요?", h("div", { class: "row" }, placeSel, e.page != null ? pageIn : null, e.page != null ? h("span", {}, "쪽부터") : null,
        e.page != null ? pageToIn : null, e.page != null ? h("span", {}, "쪽까지") : null)) : null),
      lesson.slide_count && e.page != null ? h("p", { class: "muted small grow" }, "끝 쪽을 적으면 그 사이 쪽마다 같은 질문이 보이고, 학생이 쓴 답도 이어서 보입니다.") : null,
    h("label", {}, "설문 설명문 (선택)", description),
    h("div", { class: "row wrap" },
      e.kind === "quiz" ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: e.show_answer, onchange(ev) { e.show_answer = ev.target.checked; } }), "제출 뒤 정답과 해설 보여 주기") : null,
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: e.named, onchange(ev) { e.named = ev.target.checked; } }), "학생에게 공개할 때 이름 표시")),
    qs,
    h("div", { class: "row" }, Object.entries(TYPE_NAME).map(([k, v]) =>
      h("button", { class: "ghost", type: "button", onclick() { e.questions.push(newQuestion(k)); redraw(); } }, "+ " + v))),
    msg,
    h("div", { class: "row between" },
      e.id ? h("button", { class: "ghost danger", type: "button", onclick: removeActivity }, "활동 지우기") : h("span", {}),
      h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick() { editing = null; drawBuild(); } }, "닫기"),
        h("button", { class: "primary", type: "button", onclick: saveActivity }, "저장"))));
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
  }
  screenChannelKey = key;
  screenChannel = sb.channel(key, { config: { broadcast: { self: false } } });
  screenChannel.on("broadcast", { event: "signal" }, ({ payload }) => handleTeacherScreenSignal(payload));
  screenChannel.on("presence", { event: "sync" }, updatePresence);
  screenChannelReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("화면 공유 연결을 준비하지 못했습니다. 새로고침해 주세요.")), 10000);
    screenChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(screenChannel); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error("화면 공유 채널에 연결하지 못했습니다.")); }
    });
  });
  return screenChannelReady;
}

async function sendTeacherScreenSignal(payload) {
  if (screenChannel) await screenChannel.send({ type: "broadcast", event: "signal", payload });
}

async function handleTeacherScreenSignal(message) {
  if (!message || message.to !== "teacher") return;
  const watch = screenWatchers.get(message.from);
  if (!watch) return;
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
      paintSim(watch, m.k);
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
    (await r.pc.getStats()).forEach((x) => {
      if (x.type === "inbound-rtp" && x.kind === "video") {
        fps = x.framesPerSecond || 0;
        if (x.jitterBufferEmittedCount) jb = (x.jitterBufferDelay / x.jitterBufferEmittedCount) * 1000;
      }
      if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") rtt = (x.currentRoundTripTime || 0) * 1000;
      if (x.type === "remote-candidate" && x.candidateType === "relay") relay = true;
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
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const close = openModal(nameOf(s) + " · 실시간 화면", h("div", { class: "stack" }, status, frame, video,
      h("p", { class: "muted small" }, "학생의 수업 화면(보고 있는 쪽, 쓰고 있는 답)은 바뀔 때마다, 시뮬레이션은 초당 최대 5장으로 갱신됩니다. 노트북·태블릿·휴대폰 모두 됩니다. PC에서 학생이 「PC 화면 전체 공유」까지 누르면 아래에 영상도 나옵니다.")), () => {
      sendTeacherScreenSignal({ type: "stop", from: "teacher", to: s.id, key: screenKey(s) });
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
  main.replaceChildren(h("section", { class: "card stack" },
    h("div", { class: "row between wrap" },
      h("h2", {}, "학생 " + students.length + "명"),
      h("p", { class: "muted small" }, "학생 계정은 웹앱 전체에 하나라서, 어느 수업에서든 같은 학번·이름·비밀번호를 씁니다. 실시간 화면은 학생이 가입할 때(또는 수업 화면에서) 「화면 보기」에 동의해야 바로 보이며, 이 수업 화면(보고 있는 쪽, 쓰고 있는 답, 시뮬레이션)만 보입니다. 학생은 언제든 동의를 바꿀 수 있습니다. 한 번에 한 명씩 봅니다."),
      h("p", { class: "muted small" }, h("span", { class: "presence on" }), " 수업 화면을 보고 있음 · ", h("span", { class: "presence away" }), " 다른 앱·탭에 있음 · ", h("span", { class: "presence off" }), " 접속 안 함 (바로 바뀝니다)")),
    students.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["학번", "이름", "저장한 활동", "마지막 저장", "상태", "화면 보기", ""].map((t) => h("th", {}, t)))),
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
    const image = h("img", { class: "thumb-photo", src: slideSrc(lesson, i), alt: i + "쪽", loading: "lazy" });
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
  progress(0, 1, "PPTX 올리는 중");
  const objectPath = folder + "deck.pptx";
  const { error } = await sb.storage.from("slides").upload(objectPath, file, {
    upsert: true, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", cacheControl: "3600",
  });
  if (error) throw error;
  const { data } = sb.storage.from("slides").getPublicUrl(objectPath);
  const { error: updateError } = await sb.from("lessons").update({ slide_dir: "pptx:" + data.publicUrl + "?v=" + Date.now(), slide_count: pages, page: 1 }).eq("id", lesson.id);
  if (updateError) throw updateError;
  // 교체 전 PDF/JPG가 남지 않게 이 수업 전용 폴더의 이미지 파일만 정리한다.
  const { data: old } = await sb.storage.from("slides").list(folder.replace(/\/$/, ""), { limit: 1000 });
  const images = (old || []).filter((o) => /^\d+\.jpg$/.test(o.name)).map((o) => folder + o.name);
  if (images.length) await sb.storage.from("slides").remove(images);
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

const SLIDE_WIDTH = 1600;

function canvasToJpeg(canvas) {
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("그림으로 바꾸지 못했습니다"))), "image/jpeg", 0.85));
}

// 파일들을 쪽별 JPG 묶음으로 바꾼다
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
      out.push(await canvasToJpeg(canvas));
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
    out.push(await canvasToJpeg(canvas));
  }
  return out;
}

const slideFolder = (l) => me.id + "/" + l.id + "/";

// 슬라이드 그림이 들어 있는 폴더(주소에서 읽는다). 다른 교사가 올렸거나 복제한 수업이면 원래 수업의 폴더다.
function slideFolderOf(l) {
  const m = /\/public\/slides\/(.+\/)\{n\}/.exec(l.slide_dir || "");
  return m ? decodeURIComponent(m[1]) : null;
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
  const folder = slideFolderOf(lesson);
  if (!folder) return alert("이 수업의 슬라이드 위치를 알 수 없습니다. 슬라이드를 다시 올려 주세요.");
  const base = lesson.slide_dir.split("?")[0];
  if (folder !== slideFolder(lesson) || lessons.some((x) => x.id !== lesson.id && (x.slide_dir || "").split("?")[0] === base)) {
    return alert("이 슬라이드는 복제한 다른 수업과 함께 쓰고 있어서 한 쪽만 지울 수 없습니다.\n이 수업에서 슬라이드 파일을 「다시 올리기」하면 이 수업만의 슬라이드가 됩니다.");
  }
  if (targets.length) {
    if (!confirm(targets.length + "장의 슬라이드를 지울까요? 남은 슬라이드와 질문 쪽 번호를 맞춥니다.")) return;
  }
  slideBusy = true;
  document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = true; });
  const st = sb.storage.from("slides");
  try {
    status.textContent = "슬라이드 목록을 확인하는 중…";
    const listed = await st.list(folder.replace(/\/$/, ""), { limit: 1000 });
    if (listed.error) throw listed.error;
    let nums = (listed.data || []).map((o) => /^(\d+)\.jpg$/.exec(o.name)).filter(Boolean).map((m) => +m[1]).sort((x, y) => x - y);
    if (targets.length) {
      const missing = targets.filter((n) => !nums.includes(n));
      if (missing.length) throw new Error(missing.join(", ") + "쪽 그림이 이미 없습니다. 「번호 다시 맞추기」를 눌러 주세요.");
      status.textContent = targets.length + "장의 슬라이드를 지우는 중…";
      const r = await st.remove(targets.map((n) => folder + n + ".jpg"));
      if (r.error) throw r.error;
      nums = nums.filter((x) => !targets.includes(x));
    }
    // 남은 그림을 1, 2, 3 … 으로 당긴다(작은 번호부터 옮기므로 옮길 자리는 늘 비어 있다)
    for (const [i, num] of nums.entries()) {
      if (num === i + 1) continue;
      status.textContent = "슬라이드 번호를 맞추는 중 " + (i + 1) + " / " + nums.length;
      const r = await st.move(folder + num + ".jpg", folder + (i + 1) + ".jpg");
      if (r.error) throw r.error;
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
    const dir = withFx(base + "?v=" + Date.now() + (anim ? "&anim=" + anim : ""), slideFx(lesson));
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
  for (const [i, blob] of images.entries()) {
    progress(i, images.length, "올리는 중");
    const { error } = await sb.storage.from("slides").upload(folder + (i + 1) + ".jpg", blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
    if (error) throw error;
  }
  progress(images.length, images.length, "올리는 중");
  // 전보다 쪽 수가 줄었으면 남은 그림을 지운다
  const { data: old } = await sb.storage.from("slides").list(folder.replace(/\/$/, ""), { limit: 1000 });
  const extra = (old || []).map((o) => o.name).filter((n) => parseInt(n, 10) > images.length).map((n) => folder + n);
  if (extra.length) await sb.storage.from("slides").remove(extra);
  const dir = withFx(SB_URL + "/storage/v1/object/public/slides/" + folder + "{n}.jpg?v=" + Date.now(), slideFx(lesson));
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: images.length, page: 1 }).eq("id", lesson.id);
  if (error) throw error;
  await sb.storage.from("slides").remove([folder + "deck.pptx"]);
  return images.length;
}

// 수업을 지울 때 그 수업의 슬라이드 그림도 지운다(복제한 다른 수업이 같은 그림을 쓰면 남긴다)
async function removeSlideFiles(l) {
  if (!l.slide_count || !l.slide_dir.includes("/" + l.id + "/")) return;
  if (lessons.some((x) => x.id !== l.id && x.slide_dir.split("?")[0] === l.slide_dir.split("?")[0])) return;
  // 그림을 올린 교사의 폴더(교사가 여러 명일 수 있으므로 주소에서 읽는다)
  const m = /\/public\/slides\/(.+\/)\{n\}/.exec(l.slide_dir);
  const ppt = isPptx(l) && /\/object\/public\/slides\/(.+)\/deck\.pptx/.exec(l.slide_dir);
  if (!m && !ppt) return;
  const folder = decodeURIComponent(m ? m[1] : ppt[1] + "/");
  const { data } = await sb.storage.from("slides").list(folder.replace(/\/$/, ""), { limit: 1000 });
  if (data && data.length) await sb.storage.from("slides").remove(data.map((o) => folder + o.name));
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
