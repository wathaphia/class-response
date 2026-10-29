// 교사 화면 · 「전체 수업」(프로필 화면 오른쪽 2/3, teacher-profile.js): 폴더 정리, 수업 카드 끌어 옮기기, 골라 불러오기, 슬라이드 PDF 받기.
// 공유 상태(lessons·lesson·me…)와 틀(h·section 등)은 teacher.js, common.js 에 있다.

// ---------- 전체 수업 ----------
// 역대 모든 수업을 폴더로 정리한다. 수업 카드를 끌어 폴더에 넣거나 순서를 바꾸고, 골라서 불러오거나 슬라이드를 PDF로 받는다.
let folders = [];
let pickedId = null;

async function drawManage() {
  const { data, error } = await sb.from("lesson_folders").select("*").eq("owner", me.id).order("sort").order("created_at");
  const pane = main && main.querySelector(".manage-pane");
  if (tab !== "profile" || !pane) return;
  folders = error ? [] : data;
  const msg = h("p", { class: "msg" });
  // 다른 선생님 수업(공유받은 것, 개발자는 모든 선생님 것)은 내 폴더에 넣지 않고 따로 묶는다(끌어 옮기기 없음)
  const mine = (l) => l.owner === me.id;
  const others = lessons.filter((l) => !mine(l));
  const OTHERS = "others";
  const groups = [...folders.map((f) => ({ id: f.id, name: f.name })), { id: null, name: "폴더 없음" }];
  const inGroup = (gid) => lessons
    .filter((l) => gid === OTHERS ? !mine(l) : mine(l) && (folders.some((f) => f.id === l.folder_id) ? l.folder_id : null) === gid)
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
      class: "lesson-card" + (l.id === pickedId ? " picked" : ""), draggable: mine(l) ? "true" : "false", tabindex: "0",
      onclick() { pickedId = l.id; drawManage(); },
      ondblclick() { pickedId = l.id; loadPicked(); },
      onkeydown(e) { if (e.key === "Enter") { pickedId = l.id; drawManage(); } },
      ondragstart(e) { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; el.classList.add("dragging"); },
      ondragend() { el.classList.remove("dragging"); },
    },
      h("strong", {}, (l.kind === "survey" ? "[설문] " : "") + l.title),
      h("span", { class: "muted small" }, l.code + " · " + (l.slide_count ? slideTotal(l) + "쪽" : "슬라이드 없음") + " · " + new Date(l.created_at).toLocaleDateString()),
      l.id === lesson?.id ? h("span", { class: "tag ok" }, "지금 수업") : null,
      mine(l) ? null : h("span", { class: "tag info" }, "공유받음"),
      // 첫 슬라이드(끌기를 방해하지 않게 그림 자체는 끌 수 없게)
      l.slide_count && !isPptx(l)
        ? h("img", { class: "lesson-thumb", src: slideSrc(l, 1, true), alt: l.title + " 첫 슬라이드", loading: "lazy", draggable: "false" })
        : h("div", { class: "lesson-thumb empty" }, l.kind === "survey" ? "설문" : isPptx(l) ? "PowerPoint 자료" : "슬라이드 없음"));
    if (mine(l)) dropZone(el, (folders.some((f) => f.id === l.folder_id) ? l.folder_id : null), l.id);
    return el;
  };

  const folderBox = (g) => {
    const items = inGroup(g.id);
    const list = h("div", { class: "lesson-list" }, items.length ? items.map(card) : h("p", { class: "muted small" }, "여기로 수업을 끌어 놓으세요."));
    if (g.id !== OTHERS) dropZone(list, g.id, null);
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
  const moveSel = p && mine(p) ? h("select", { "aria-label": "옮길 폴더", async onchange() { await moveLesson(p.id, moveSel.value || null, null); } },
    groups.map((g) => h("option", { value: g.id || "", selected: (folders.some((f) => f.id === p.folder_id) ? p.folder_id : null) === g.id }, g.name))) : null;
  pane.replaceChildren(h("div", { class: "stack manage" },
    h("section", { class: "card stack" },
      h("div", { class: "row between wrap" },
        h("h2", {}, "전체 수업 " + lessons.length + "개"),
        h("div", { class: "row wrap" },
          h("div", { class: "folder-add" }, newName, h("button", { class: "ghost", type: "button", onclick: addFolder }, "+ 폴더 추가")),
          // 새 수업: 지금 수업을 비우고 「슬라이드 편집」의 만들기 칸으로 간다
          h("button", { class: "primary new-lesson", type: "button", async onclick() {
            newFrom = { id: lesson && lesson.id, tab };   // 「취소」하면 이 수업·탭으로 돌아간다
            lesson = null; tab = "settings"; localStorage.setItem("cra-tab", tab);
            await loadLesson();
          } }, "+ 수업 추가"))),
      h("p", { class: "muted small" }, "수업 카드를 끌어 폴더에 넣거나 순서를 바꿀 수 있습니다. 카드를 눌러 고른 뒤 「불러오기」(또는 두 번 누르기)를 하면 그 수업이 지금 수업이 됩니다. 화면은 그대로이고, 다른 탭에서 바로 그 수업을 씁니다."),
      error ? h("p", { class: "error" }, "폴더 기능을 쓰려면 Supabase에서 새 setup.sql을 실행해야 합니다.") : null,
      p ? h("div", { class: "row wrap picked-bar" },
        h("strong", {}, "고른 수업: " + p.title + " (" + p.code + ")"),
        p.id === lesson?.id
          ? h("button", { class: "primary", type: "button", disabled: true }, "불러오기 완료")
          : h("button", { class: "primary", type: "button", onclick(e) { loadPicked(e.currentTarget); } }, "불러오기"),
        h("button", { class: "ghost", type: "button", onclick() { exportSlidesPdf(p, msg); } }, "슬라이드 PDF 받기"),
        moveSel ? h("div", { class: "folder-add" }, h("span", { class: "muted small" }, "폴더"), moveSel) : null)
        : h("p", { class: "muted small" }, "수업을 하나 고르면 「불러오기」와 「슬라이드 PDF 받기」 버튼이 나옵니다."),
      msg),
    groups.map(folderBox),
    others.length ? folderBox({ id: OTHERS, name: profile && profile.admin ? "다른 선생님 수업(개발자 권한 · 공유받은 것 포함)" : "공유받은 수업" }) : null));
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
