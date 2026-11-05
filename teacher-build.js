// 교사 화면 · 「자료 추가」 탭: 이 수업의 활동 목록(쪽 옮기기·끌어 순서 바꾸기), 시뮬레이션 편집기,
// 「설명 및 질문」 작성기(칸마다 활동 하나로 저장), 저장 버튼 상태(editBase).

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
    s = { key, box: simScaled(f), playing: false };
    // 작은 슬라이드·크게 본 슬라이드 위의 같은 시뮬레이션도 이 버튼을 따라 돌고 멈춘다
    s.play = simPlayButton(f, (on) => { s.playing = on; document.querySelectorAll('.act-slide .sim-over[data-sim="' + a.id + '"], .slide-view .sim-over[data-sim="' + a.id + '"]').forEach(simOverPause); });
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
const rowKey = (a) => JSON.stringify({ ...a, html: (a.html || "").length, page: 0, page_to: 0, sort: 0, sim_place: 0 });

// 활동 칸의 「수정/수정 중」 표시만 지금 편집 중인 활동에 맞춘다
function markEditingRow(row, a) {
  const on = !!(editing && (editing.blocks ? editing.blocks.some((b) => b.id === a.id) : editing.id === a.id));
  row.classList.toggle("on", on);
  const btn = row.querySelector(".act-edit");
  if (btn) { btn.className = "act-edit " + (on ? "primary" : "ghost"); btn.textContent = on ? "수정 중" : "수정"; }
}

// 활동 목록의 쪽 칸: 「시작 ~ 끝 쪽」을 늘 같은 모양으로 보이고, 숫자를 눌러 키보드로 고친다(한 쪽짜리는 시작 = 끝)
function pageCell(a) {
  if (a.page == null || !lesson.slide_count) return h("strong", { class: "act-page" }, whereText(a));
  const num = (v, label, set) => {
    const el = h("input", { type: "text", inputmode: "numeric", maxlength: 3, class: "act-num", value: v, "aria-label": label,
      onkeydown(ev) { if (ev.key === "Enter") el.blur(); else if (ev.key === "Escape") { el.value = v; el.blur(); } },
      onchange() { const n = parseInt(el.value, 10); if (n >= 1 && n !== v) set(n); else el.value = v; } });
    return el;
  };
  const end = a.page_to > a.page ? a.page_to : a.page;
  return h("div", { class: "act-page range" },
    // 시작을 끝보다 뒤로 고치면 한 쪽짜리로, 끝을 시작보다 앞으로 고치면 둘을 맞바꾼다
    num(a.page, "시작 쪽", (n) => changeLayout(() => setPages(a, n, n <= end ? end : n))),
    h("span", { class: "act-tilde" }, "~"),
    num(end, "끝 쪽", (n) => changeLayout(() => setPages(a, Math.min(a.page, n), Math.max(a.page, n)))),
    h("span", { class: "act-unit" }, "쪽"));
}

// 쪽을 from~to 로(같으면 한 쪽). page_to 칸이 없는 예전 데이터베이스에서는 여러 쪽으로 늘리지 못한다
function setPages(a, from, to) {
  const max = Math.max(slideTotal(lesson), 1);
  from = Math.max(1, Math.min(from, max));
  to = Math.max(from, Math.min(to, max));
  if (to > from && !("page_to" in a)) { alert(PAGE_TO_SETUP); return; }
  a.page = from;
  if ("page_to" in a) a.page_to = to > from ? to : null;
}

// 쪽 n 에 끌어 놓으면: 여러 쪽에 걸친 활동은 길이를 그대로 옮기고, 그 쪽 활동들의 맨 뒤에 놓는다
function dropLayout(a, n) {
  const span = a.page_to > a.page ? a.page_to - a.page : 0;
  const sort = Math.max(-1, ...activities.filter((x) => x !== a && x.page === n).map((x) => x.sort ?? 0)) + 1;
  return { page: n, to: n + span, sort };
}

// ---------- 목록에서 바꾼 쪽·순서·얹은 자리 ----------
// 쪽 칸 고치기·끌어 옮기기·크게 본 슬라이드에서 시뮬레이션 옮기기는 바로 저장하지 않고 모아 두었다가 「저장하기」로 한 번에 보낸다.
// 「되돌리기」는 바꾸기 전 모습을 최대 LAYOUT_UNDO_MAX 번까지 되살린다.
const LAYOUT_UNDO_MAX = 20;
const layoutOf = (a) => ({ page: a.page ?? null, page_to: a.page_to ?? null, sort: a.sort ?? 0, sim_place: a.sim_place ?? null });
let layoutDraft = null;   // { lesson, base: Map(id → 저장된 값 JSON), undo: [Map(id → 값)] }
function layoutFor() {
  if (!layoutDraft || layoutDraft.lesson !== lesson.id) layoutDraft = { lesson: lesson.id, base: new Map(), undo: [] };
  for (const a of activities) if (!layoutDraft.base.has(a.id)) layoutDraft.base.set(a.id, JSON.stringify(layoutOf(a)));
  return layoutDraft;
}
const layoutChanged = (a) => !!layoutDraft && layoutDraft.base.has(a.id) && layoutDraft.base.get(a.id) !== JSON.stringify(layoutOf(a));
const layoutDirty = () => !!layoutDraft && activities.some(layoutChanged);
// 값을 넣되, page_to 칸이 없는 활동에 칸을 새로 만들지 않는다(pageTo 가 칸이 있는지를 이것으로 본다)
function applyLayout(a, v) {
  for (const k in v) if (k in a || v[k] != null) a[k] = v[k];
}
const layoutSnap = () => JSON.stringify(activities.map((a) => [a.id, layoutOf(a)]));
function changeLayout(fn) {
  const d = layoutFor(), before = layoutSnap();
  fn();
  if (layoutSnap() !== before) {
    d.undo.push(new Map(JSON.parse(before)));
    if (d.undo.length > LAYOUT_UNDO_MAX) d.undo.shift();
    syncEditingLayout();
  }
  drawBuild();
}
function undoLayout() {
  const d = layoutDraft;
  if (!d || d.lesson !== lesson.id || !d.undo.length) return;
  const snap = d.undo.pop();
  for (const a of activities) if (snap.has(a.id)) applyLayout(a, snap.get(a.id));
  syncEditingLayout();
  drawBuild();
}
function revertLayout() {
  if (!layoutDraft) return;
  for (const a of activities) if (layoutChanged(a)) applyLayout(a, JSON.parse(layoutDraft.base.get(a.id)));
  layoutDraft.undo = [];
  syncEditingLayout();
}
// 그 활동 하나만 고치는 중이면 편집기의 표시 위치·얹은 자리도 맞춘다(편집기의 「저장됨」 상태는 그대로)
function syncEditingLayout() {
  if (!editing) return;
  const id = editing.blocks ? (editing.blocks.length === 1 ? editing.blocks[0].id : null) : editing.id;
  const a = id && activities.find((x) => x.id === id);
  if (!a) return;
  const change = { page: a.page ?? null, page_to: a.page_to ?? null };
  if (!editing.blocks && editing.sim_place && a.sim_place) change.sim_place = a.sim_place;
  Object.assign(editing, change);
  rebase(editing, (base) => Object.assign(base, change));
}
async function saveLayout() {
  const d = layoutDraft, L = lesson;
  if (!d) return;
  const jobs = activities.filter(layoutChanged).map((a) => {
    const was = JSON.parse(d.base.get(a.id)), now = layoutOf(a), change = {};
    for (const k in now) if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) change[k] = now[k];
    if (!("page_to" in a)) delete change.page_to;
    return { a, change, was: d.base.get(a.id) };
  });
  if (!jobs.length) return;
  // 먼저 저장한 것으로 적어 두어, 보내는 사이 다시 그려도 「저장하기」가 또 뜨지 않게 한다(실패한 것만 되돌려 다시 뜨게)
  jobs.forEach((j) => d.base.set(j.a.id, JSON.stringify(layoutOf(j.a))));
  d.undo = [];
  if (lesson === L && tab === "build") drawBuild();
  const done = await Promise.all(jobs.map((j) => Object.keys(j.change).length ? sb.from("activities").update(j.change).eq("id", j.a.id) : {}));
  const bad = done.map((r, i) => [r, jobs[i]]).filter(([r]) => r.error);
  bad.forEach(([, j]) => d.base.set(j.a.id, j.was));
  if (lesson === L && tab === "build") drawBuild();
  if (bad.length) alert("바꾼 자리를 저장하지 못했습니다: " + bad[0][0].error.message);
  else flash("저장했습니다.");
}
// 「자료 추가」를 떠날 때(다른 탭·다른 수업) 저장하지 않은 변경을 묻는다. activities 는 아직 떠나는 수업의 것.
// 떠나면 기록을 버린다: 다른 탭(슬라이드 편집 등)에서 쪽이 바뀌어도 돌아와서 새로 센다
function leaveLayout() {
  if (layoutDirty()) {
    if (confirm("「자료 추가」에서 옮긴 쪽·순서·자리를 아직 저장하지 않았습니다. 저장할까요?\n(취소를 누르면 옮기기 전으로 돌아갑니다.)")) saveLayout();
    else revertLayout();
  }
  layoutDraft = null;
}
addEventListener("beforeunload", (ev) => { if (layoutDirty()) ev.preventDefault(); });
// 서버에서 다시 받은 목록으로 바꾸되, 저장하지 않은 변경은 남긴다(saved: 방금 편집기로 저장한 활동 — 쪽·자리는 저장됐으니 순서만)
function takeActivities(data, saved = []) {
  const d = layoutDraft && layoutDraft.lesson === lesson.id ? layoutDraft : null;
  const old = new Map(activities.map((a) => [a.id, a]));
  const list = data || [];
  if (d) for (const a of list) {
    const o = old.get(a.id), pending = o && layoutChanged(o) ? layoutOf(o) : null;
    d.base.set(a.id, JSON.stringify(layoutOf(a)));
    if (pending) applyLayout(a, saved.includes(a.id) ? { sort: pending.sort } : pending);
  }
  activities = sortActivities(list);
}

// 목록 머리의 [되돌리기] [저장하기]: 늘 보이고, 바꾼 것이 있을 때만 누를 수 있다. 되돌리기는 연달아 누르므로 불응기(common.js)에서 뺀다
function layoutBar() {
  const d = layoutDraft && layoutDraft.lesson === lesson.id ? layoutDraft : null;
  const dirty = layoutDirty();
  return h("div", { class: "act-tools" },
    h("button", { type: "button", class: "ghost act-undo", "data-rapid": "", disabled: !(d && d.undo.length), title: "바꾸기 전으로 되돌립니다(최대 " + LAYOUT_UNDO_MAX + "번).", onclick: undoLayout }, "↶ 되돌리기"),
    h("button", { type: "button", class: "act-save " + (dirty ? "primary" : "ghost"), disabled: !dirty, onclick: saveLayout }, dirty ? "저장하기" : "저장됨"));
}

// 끌어서 순서 바꾸기(dragSort, teacher.js): 같은 쪽 활동끼리만 자리를 바꾸고, 왼쪽 작은 슬라이드 위에 놓으면 그 쪽으로 옮긴다.
// 다른 쪽 슬라이드 위에 있는 동안은 놓일 자리를 점선 칸으로 미리 보인다(dropPreview)
const pageGroup = (a) => (a.page ?? "") + "|" + (a.page_to > a.page ? a.page_to : "");
function sortRows(grid) {
  dragSort(grid, {
    items: () => activities.map((a) => grid.querySelector(':scope > .act-row[data-id="' + a.id + '"]')).filter(Boolean),
    group: (row) => pageGroup(row.act),
    over(ev, row) {
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".act-slide[data-n]");
      const n = cell && grid.contains(cell) ? +cell.dataset.n : 0;
      // 제 쪽 슬라이드 위에서는 보통의 순서 바꾸기
      return n && n <= Math.max(slideTotal(lesson), 1) && !(row && row.act.page === n) ? cell : null;
    },
    hover: (cell, row) => dropPreview(grid, cell, row),
    dropOver(cell, row) {
      const a = row.act, d = dropLayout(a, +cell.dataset.n);
      changeLayout(() => { setPages(a, d.page, d.to); if (a.page === d.page) a.sort = d.sort; });
    },
    onDrop: (rows) => changeLayout(() => rows.forEach((r, i) => { r.act.sort = i; })),
    scroller: () => main.querySelector(".act-scroll"),
  });
}

// 끌던 활동을 쪽 n 에 놓으면 그 줄 몇째 칸이 될지 셈해, 그 줄 칸들을 비켜 세우고 빈 점선 칸을 보인다
function dropPreview(grid, cell, row) {
  grid.querySelector(":scope > .act-ghost")?.remove();
  layoutBySlide(grid);
  if (!cell || !row || !grid.classList.contains("by-slide")) return;
  const a = row.act, d = dropLayout(a, +cell.dataset.n);
  const moved = { ...a, page: d.page, sort: d.sort };
  const total = Math.max(slideTotal(lesson), 1);
  const list = sortActivities(activities.map((x) => (x === a ? moved : x))).filter((x) => x.page != null && slideRow(x, total) === d.page);
  list.forEach((x, i) => {
    if (x === moved) grid.append(h("div", { class: "act-ghost", style: "grid-row:" + d.page + ";grid-column:" + (i + 2) }, "여기로"));
    else { const r = grid.querySelector(':scope > .act-row[data-id="' + x.id + '"]'); if (r) r.style.gridColumn = i + 2; }
  });
}

// 「슬라이드와 함께 보기」에서 누른 슬라이드를 왼쪽(새로 만들기 아래)에 크게 보인다. 그 위에 얹은 시뮬레이션은 끌어 옮기고 크기를 바꿀 수 있다
let slideView = null;   // { lesson, n }
const viewN = () => {
  const total = Math.max(slideTotal(lesson), 1);
  return slideView && slideView.lesson === lesson.id && bySlide && lesson.slide_count > 0 && !isPptx(lesson) && slideView.n <= total ? slideView.n : 0;
};
const lastStepOf = (n) => { const steps = slideSteps(lesson); return pageOfSlide(lesson, n) + (steps ? steps[n - 1] - 1 : 0); };   // 애니메이션이 모두 끝난 모습
function fillSlideView(slot) {
  const n = viewN();
  if (!n) { slot.replaceChildren(); return; }
  const key = lesson.slide_dir + "|" + n;
  let card = slot.querySelector(":scope > .slide-view");
  // 같은 슬라이드면 그대로 두고 시뮬레이션 자리만 맞춘다(다시 만들면 iframe 이 처음부터 다시 불러와진다)
  if (!card || card.dataset.key !== key) {
    card = h("section", { class: "card stack slide-view", "data-key": key },
      h("div", { class: "row between" }, h("h2", {}, n + "쪽"),
        h("button", { type: "button", class: "ghost", onclick() { slideView = null; drawBuild(); } }, "닫기")),
      h("div", { class: "slide-view-pic" }, h("img", { src: slideSrc(lesson, lastStepOf(n)), alt: "슬라이드 " + n }), h("div", { class: "sim-layer" })),
      h("p", { class: "muted small slide-view-hint" }));
    slot.replaceChildren(card);
  }
  const list = activities.filter((a) => isOverSim(a) && simOnSlide(a, n));
  renderSimLayer(card.querySelector(".sim-layer"), list, { load: (a) => a.html, ver: (a) => (a.html || "").length + ":" + a.title, editable: true,
    onMove: (a, p) => changeLayout(() => { const x = activities.find((y) => y.id === a.id); if (x) x.sim_place = p; }),
    paused: (a) => !buildSimFrame(a).playing });
  card.querySelector(".slide-view-hint").textContent = list.length
    ? "시뮬레이션을 끌어 옮기거나 오른쪽 아래 모서리를 끌어 크기를 바꾸세요. 「저장하기」를 눌러야 저장됩니다."
    : "이 쪽 위에 얹은 시뮬레이션이 없습니다.";
}

function drawBuild() {
  activities = sortActivities(activities);
  layoutFor();
  const ids = new Set(activities.map((a) => a.id));
  for (const id of buildSimFrames.keys()) if (!ids.has(id)) buildSimFrames.delete(id);
  // 새로 만들 때 쪽 칸은 비워 둔다. 아직 저장하지 않은 것을 쓰다가 종류를 바꾸면 적어 둔 쪽은 그대로 가져간다
  const where = () => editing && !isSavedEdit(editing) ? { page: editing.page ?? null, page_to: editing.page_to ?? null }
    : { page: lesson.slide_count ? "" : null, page_to: null };
  const kinds = h("div", { class: "kinds" },
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "sim", title: "", ...where(), sim_full: false, sim_place: lesson.slide_count ? { ...SIM_PLACE_DEFAULT } : null, html: "", questions: [] };
      drawBuild();
    } }, h("strong", {}, "시뮬레이션")),
    // 설명 및 질문: 설명 칸·질문 칸을 여러 개 만들고, 저장하면 칸마다 활동 하나가 된다
    h("button", { type: "button", class: "kind", onclick() {
      editing = { kind: "compose", ...where(), blocks: [] };
      drawBuild();
    } }, h("strong", {}, "설명 및 질문")));
  const newCard = h("section", { class: "card stack" }, h("h2", {}, "새로 만들기"), kinds);
  const hint = () => editing ? null : h("p", { class: "muted small" }, "왼쪽에서 새로 만들거나, 활동의 「수정」을 누르세요.");
  const listTitle = "이 수업의 활동" + (activities.length ? " (" + activities.length + "개)" : "");
  // 왼쪽: 새로 만들기 | 크게 본 슬라이드 | 편집기. 크게 본 슬라이드는 같은 쪽이면 그대로 둔다(fillSlideView)
  const fillAside = (aside) => {
    aside.querySelector(":scope > .new-slot").replaceChildren(newCard);
    fillSlideView(aside.querySelector(":scope > .slide-view-slot"));
    aside.querySelector(":scope > .editor-slot").replaceChildren(...[editing ? editor() : null].filter(Boolean));
  };
  const box = main.querySelector(".build");
  // 같은 수업이면 왼쪽만 다시 그리고 오른쪽 활동 칸은 그대로 두고 맞춘다(syncRows).
  // 오른쪽을 다시 붙이면 시뮬레이션 칸(iframe)이 처음부터 다시 실행되어 깜빡인다.
  if (box && box.dataset.lesson === String(lesson.id)) {
    const aside = box.querySelector(":scope > aside");
    const y = aside.scrollTop;
    fillAside(aside);
    aside.scrollTop = y;
    box.querySelector(".act-list h2").textContent = listTitle;
    box.querySelector(".act-tools").replaceWith(layoutBar());
    box.querySelector(".act-hint").replaceChildren(...[hint()].filter(Boolean));
    syncRows(box.querySelector(".act-grid"));
    return;
  }
  const grid = h("div", { class: "act-grid" });
  syncRows(grid);
  sortRows(grid);
  // 다시 그려도 왼쪽(편집기)·오른쪽(활동 목록)의 스크롤 자리를 지킨다
  const keep = [".build > aside", ".act-scroll"].map((q) => main.querySelector(q)?.scrollTop || 0);
  const aside = h("aside", { class: "stack" }, h("div", { class: "new-slot" }), h("div", { class: "slide-view-slot" }), h("div", { class: "editor-slot" }));
  fillAside(aside);
  main.classList.add("build-page");
  main.replaceChildren(h("div", { class: "build", "data-lesson": lesson.id },
    aside,
    h("div", { class: "build-main stack" },
      h("section", { class: "card stack act-list" },
        h("div", { class: "row between" },
          h("div", { class: "act-list-head" }, h("h2", {}, listTitle),
            lesson.slide_count ? h("label", { class: "act-toggle" }, h("input", { type: "checkbox", checked: bySlide, onchange(ev) {
              bySlide = ev.target.checked;
              try { localStorage.setItem("cra-build-slides", bySlide ? "1" : "0"); } catch {}
              drawBuild();
            } }), "슬라이드와 함께 보기") : null,
            layoutBar()),
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
  layoutBySlide(grid);
}

// 「슬라이드와 함께 보기」: 슬라이드 n은 n번째 줄 맨 왼쪽, 그 쪽 활동은 목록 순서대로 오른쪽으로(여러 쪽에 걸친 활동은 첫 쪽에),
// 「언제든」 활동은 맨 아래 줄. 칸은 grid-row/grid-column으로만 옮긴다(DOM에서 옮기면 시뮬레이션이 다시 불러와짐)
let bySlide = (() => { try { return localStorage.getItem("cra-build-slides") === "1"; } catch { return false; } })();
const slideRow = (a, total) => (a.page == null ? total + 1 : Math.min(Math.max(a.page, 1), total));
function layoutBySlide(grid) {
  const on = bySlide && lesson.slide_count > 0;
  const total = on ? Math.max(slideTotal(lesson), 1) : 0;
  grid.classList.toggle("by-slide", on);
  const anytime = on && activities.some((a) => a.page == null);
  const key = on ? lesson.slide_dir + "|" + total + "|" + anytime : "";
  if (grid.dataset.slides !== key) {
    grid.dataset.slides = key;
    grid.querySelectorAll(":scope > .act-slide").forEach((el) => el.remove());
    for (let n = 1; on && n <= total + (anytime ? 1 : 0); n++) grid.append(slideCell(n, total));
  }
  const picked = viewN();
  grid.querySelectorAll(":scope > .act-slide").forEach((el) => el.classList.toggle("picked", +el.dataset.n === picked));
  const overs = on ? activities.filter(isOverSim) : [];
  grid.querySelectorAll(":scope > .act-slide .sim-layer").forEach((layer) => {
    const n = +layer.closest(".act-slide").dataset.n, list = overs.filter((a) => simOnSlide(a, n));
    renderSimLayer(layer, list, { load: (a) => a.html, ver: (a) => (a.html || "").length + ":" + a.title, editable: false, paused: (a) => !buildSimFrame(a).playing });
  });
  const col = new Map();
  for (const a of activities) {
    const row = grid.querySelector(':scope > .act-row[data-id="' + a.id + '"]');
    if (!row) continue;
    if (!on) { row.style.gridRow = row.style.gridColumn = ""; continue; }
    const r = slideRow(a, total), c = (col.get(r) || 1) + 1;
    col.set(r, c);
    row.style.gridRow = r;
    row.style.gridColumn = c;
  }
}

// 왼쪽 열의 작은 슬라이드. 활동을 여기로 끌어 놓으면 그 쪽으로 옮기고(sortRows 의 over), 누르면 왼쪽에 크게 보인다(slideView)
function slideCell(n, total) {
  const label = n > total ? "언제든" : n + "쪽";
  const real = n <= total && !isPptx(lesson);
  // 슬라이드 위에 얹은 시뮬레이션은 수업 화면처럼 그 자리에 함께 보인다(layoutBySlide 가 .sim-layer 를 채움)
  const pic = !real ? h("div", { class: "act-slide-blank" }, label)
    : h("div", { class: "act-slide-pic" }, h("img", { src: slideSrc(lesson, lastStepOf(n), true), alt: "슬라이드 " + n, loading: "lazy" }), h("div", { class: "sim-layer" }));
  return h("div", { class: "act-slide" + (real ? " pickable" : ""), "data-n": n, style: "grid-row:" + n + ";grid-column:1",
    title: real ? "눌러서 왼쪽에 크게 보기" : null,
    onclick: real ? () => {
      slideView = viewN() === n ? null : { lesson: lesson.id, n };
      drawBuild();
      if (slideView) main.querySelector(".slide-view")?.scrollIntoView({ block: "nearest" });
    } : null }, pic, h("span", {}, label));
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
      // 오른쪽: 수정, 그 아래 같은 크기로 재생
      h("div", { class: "act-btns" },
        h("button", { type: "button", class: "act-edit",
          onclick() {
            // 칸을 다시 쓰므로 지금 활동(row.act)을 고친다
            const copy = JSON.parse(JSON.stringify(row.act));
            editing = copy.kind === "sim" ? copy : toCompose(copy);
            drawBuild();
            main.querySelector(".editor")?.scrollIntoView({ block: "start" });
          } }),
        a.kind === "sim" && a.html ? buildSimFrame(a).play : null)),
    h("div", { class: "act-body" }, activityPreview(a)));
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
    if (lesson.slide_count && e.page === "") { msg.textContent = PAGE_EMPTY; return; }
    const row = { kind: "sim", title: e.title, page: lesson.slide_count ? e.page : null, html: e.html, sim_full: !!e.sim_full && lesson.slide_count > 0,
      sim_place: lesson.slide_count && !e.sim_full && e.sim_place ? e.sim_place : null, show_answer: false, named: false, questions: [] };
    const to = pageTo(e);
    if (to === false) { msg.textContent = PAGE_TO_SETUP; return; }
    if (to !== undefined) row.page_to = to;
    const L = lesson;
    if (!e.id) { row.lesson_id = L.id; row.sort = activities.length; }
    const saved = await save("activities", row, e.id);
    if (!saved) return;
    e.id = saved.id;   // 다시 눌러도 새로 넣지 않고 고친다
    if (lesson !== L) return;   // 그사이 다른 수업으로 옮겼으면 그 화면은 건드리지 않는다
    const { data } = await sb.from("activities").select("*").eq("lesson_id", L.id);
    if (lesson !== L) return;
    takeActivities(data, [e.id]);
    editing = null;   // 저장하면 왼쪽은 「새로 만들기」만 남는다
    if (tab === "build") drawBuild();
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
  // 저장 중에는 단추를 잠가 두 번 눌러도 한 번만 넣는다
  const saveBtn = h("button", { class: "primary save-btn", type: "button", async onclick() {
    if (saveBtn.dataset.busy) return;
    saveBtn.dataset.busy = "1"; saveBtn.disabled = true;
    try { await onSave(); } finally { delete saveBtn.dataset.busy; saveBtn.disabled = false; if (saveBtn.isConnected) syncSave(saveBtn); }
  } }, "저장");
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
  // 새로 만들 때는 비어 있다(""). 저장할 때 비어 있으면 묻는다
  const pageIn = h("input", { type: "number", min: 1, max, value: e.page ?? "", class: "num page-num", "aria-label": "시작 쪽",
    oninput() { e.page = parseInt(pageIn.value, 10) || ""; } });
  // 여러 쪽에 걸쳐 같은 활동을 띄울 때 끝 쪽. 비우면 시작 쪽 한 쪽에만 보인다
  const pageToIn = h("input", { type: "number", min: 1, max, value: e.page_to > e.page ? e.page_to : "", class: "num page-num", "aria-label": "끝 쪽",
    oninput() { e.page_to = parseInt(pageToIn.value, 10) || null; } });
  const hint = h("p", { class: "muted small" });
  const all = toggleBox("모든 페이지", e.page == null, (on) => { e.page = on ? null : parseInt(pageIn.value, 10) || ""; refresh(); });
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
    if (lesson.slide_count && e.page === "") { msg.textContent = PAGE_EMPTY; return; }
    const to = pageTo(e);
    if (to === false) { msg.textContent = PAGE_TO_SETUP; return; }
    // 새 활동은 같은 쪽 활동들의 맨 뒤에 편집기 순서대로 붙인다
    const L = lesson;
    let next = Math.max(-1, ...activities.filter((a) => (a.page ?? null) === (e.page ?? null)).map((a) => a.sort ?? 0)) + 1;
    for (const [b, row] of rows) {
      row.page = e.page;
      if (to !== undefined) row.page_to = to;
      if (!b.id) { row.lesson_id = L.id; row.sort = next++; }
      const s = await save("activities", row, b.id);
      if (!s) return;
      b.id = s.id;
      if (b.type === "info") b.qid = row.questions[0].id;
      b.title = row.title; // 자동으로 붙인 「질문 n」·「설명 n」도 칸에 남겨, 다시 저장해도 번호가 바뀌지 않게
    }
    e.blocks = e.blocks.filter((b) => b.id);
    editBase.set(e, editSnap(e));
    if (lesson !== L) return;
    const { data } = await sb.from("activities").select("*").eq("lesson_id", L.id);
    if (lesson !== L) return;
    takeActivities(data, e.blocks.map((b) => b.id));
    editing = null;   // 저장하면 왼쪽은 「새로 만들기」만 남는다
    if (tab === "build") drawBuild();
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
const PAGE_EMPTY = "표시 위치의 쪽을 입력하세요.";
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
