// 교사 화면 · 「전체 수업」(「설정」 아래 줄 탭, teacher-profile.js drawLibrary): 폴더 정리, 수업 카드 끌어 옮기기, 골라 불러오기, 슬라이드 PDF 받기.
// 공유 상태(lessons·lesson·me…)와 틀(h·section 등)은 teacher.js, common.js 에 있다.

// ---------- 전체 수업 ----------
// 역대 모든 수업을 폴더로 정리한다. 수업 카드를 끌어 폴더에 넣거나 순서를 바꾸고, 골라서 불러오거나 슬라이드를 PDF로 받는다.
let folders = [];
let pickedId = null;
// 학생용 기본 수업(개발자만): defaultSaved = 저장된 수업 id(undefined 면 아직 안 읽음), defaultPick = 별로 고른(저장 전) 수업 id
let defaultSaved;
let defaultPick = null;
// 다른 선생님 수업의 내 화면 순서(수업 id 목록, undefined 면 아직 안 읽음). 수업 주인의 순서(lessons.sort)는 건드리지 않는다
let othersOrder;

// 수업을 고른 뒤 카드·단추가 아닌 빈 곳을 누르면 고르기를 풀어 준다
document.addEventListener("click", (e) => {
  if (tab !== "library" || !pickedId || !main) return;
  const t = e.target;
  if (!(t instanceof Element) || !main.contains(t)) return;
  if (t.closest(".lesson-card, .picked-bar, button, input, select, textarea, a, label, [role=button]")) return;
  pickedId = null;
  drawManage();
});

async function saveOthersOrder() {
  return sb.from("others_lesson_order").upsert({ teacher: me.id, lesson_ids: othersOrder });
}

async function drawManage() {
  const { data, error } = await sb.from("lesson_folders").select("*").eq("owner", me.id).order("sort").order("created_at");
  const pane = main && main.querySelector(".manage-pane");
  if (tab !== "library" || !pane) return;
  folders = error ? [] : data;
  const admin = !!(profile && profile.admin);
  const observer = isObserver();   // 다른 선생님 수업은 불러오면 사본으로 열린다. 별·저장·삭제는 알림만 띄운다
  const viewAll = admin || observer;
  if (viewAll && defaultSaved === undefined) {
    const d = await sb.from("student_default").select("lesson_id").maybeSingle();
    defaultSaved = defaultPick = (d.data && d.data.lesson_id) || null;
    if (tab !== "library" || !main.querySelector(".manage-pane")) return;
  }
  if (othersOrder === undefined && lessons.some((l) => l.owner !== me.id)) {
    const o = await sb.from("others_lesson_order").select("lesson_ids").maybeSingle();
    othersOrder = (o.data && o.data.lesson_ids) || [];
    if (tab !== "library" || !main.querySelector(".manage-pane")) return;
  }
  const known = (id) => (lessons.some((l) => l.id === id) ? id : null);   // 지워진 수업은 고른 것이 없는 것으로
  const msg = h("p", { class: "msg" });
  // 다른 선생님 수업(공유받은 것, 개발자는 모든 선생님 것)은 내 폴더에 넣지 않고 따로 묶는다(그 묶음 안에서 순서만 바꾼다)
  const mine = (l) => l.owner === me.id;
  const others = lessons.filter((l) => !mine(l));
  const OTHERS = "others";
  const groups = [...folders.map((f) => ({ id: f.id, name: f.name })), { id: null, name: "폴더 없음" }];
  const groupOf = (l) => mine(l) ? (folders.some((f) => f.id === l.folder_id) ? l.folder_id : null) : OTHERS;
  // 내가 순서를 정한 적 없는 다른 선생님 수업은 뒤로
  const othersRank = (l) => { const i = (othersOrder || []).indexOf(l.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const inGroup = (gid) => {
    const list = lessons.filter((l) => groupOf(l) === gid)
      .sort((x, y) => (x.sort || 0) - (y.sort || 0) || x.created_at.localeCompare(y.created_at));
    return gid === OTHERS ? list.sort((x, y) => othersRank(x) - othersRank(y)) : list;
  };
  const picked = () => lessons.find((l) => l.id === pickedId) || null;

  // 새 순서를 저장한다. 다른 선생님 수업은 내 화면 순서만, 내 수업은 폴더와 순서를 수업에 저장한다.
  // 칸은 끌어 놓을 때 이미 옮겨 두었다(sortCards). 다시 그리면 폴더 목록을 받는 동안 옛 배치가 보이므로, 폴더가 바뀔 때(개수·빈 칸 안내가 달라짐)만 다시 그린다
  async function saveGroup(gid, list) {
    if (gid === OTHERS) {
      othersOrder = list.map((x) => x.id);
      const r = await saveOthersOrder();
      if (r.error) alert("순서를 저장하지 못했습니다: " + r.error.message);
      return;
    }
    const changes = list.map((x, i) => ({ x, change: { folder_id: gid, sort: i } }))
      .filter(({ x, change }) => (x.folder_id || null) !== change.folder_id || (x.sort || 0) !== change.sort);
    const moved = changes.some(({ x, change }) => (x.folder_id || null) !== change.folder_id);
    changes.forEach(({ x, change }) => Object.assign(x, change));
    if (moved) drawManage();
    for (const { x, change } of changes) {
      const r = await sb.from("lessons").update(change).eq("id", x.id);
      if (r.error) return alert("옮기지 못했습니다: " + r.error.message);
    }
  }
  // 다른 폴더로 옮기기: targetId 카드의 앞(after 면 뒤)에, 없으면 맨 뒤에 넣는다
  function moveLesson(id, gid, targetId, after) {
    const l = lessons.find((x) => x.id === id);
    if (!l) return;
    const list = inGroup(gid).filter((x) => x.id !== id);
    const at = targetId ? list.findIndex((x) => x.id === targetId) : -1;
    list.splice(at < 0 ? list.length : at + (after ? 1 : 0), 0, l);
    return saveGroup(gid, list);
  }
  // 끌어서 순서 바꾸기(dragSort, teacher.js): 「자료 추가」 활동과 같은 방식. 내 수업은 다른 폴더 칸 위에 놓으면 그 폴더로, 다른 선생님 수업은 그 묶음 안에서만
  const sortCards = (list, gid) => {
    let lastEv = null;
    dragSort(list, {
      items: () => [...list.querySelectorAll(":scope > .lesson-card")],
      over(ev) {
        lastEv = ev;
        if (gid === OTHERS) return null;
        const box = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("section.folder[data-gid]");
        return box && !box.contains(list) ? box : null;
      },
      dropOver(box, el) {
        // 그 폴더에서 놓은 곳과 가장 가까운 카드의 앞이나 뒤로
        const dist = (r) => (r.left + r.width / 2 - lastEv.clientX) ** 2 + (r.top + r.height / 2 - lastEv.clientY) ** 2;
        let near = null, bd = Infinity;
        box.querySelectorAll(".lesson-card").forEach((c) => { const d = dist(c.getBoundingClientRect()); if (d < bd) { bd = d; near = c; } });
        const r = near && near.getBoundingClientRect();
        const after = near && lastEv.clientX > r.left + r.width / 2;
        if (near) near[after ? "after" : "before"](el);
        else box.querySelector(".lesson-list").replaceChildren(el);   // 빈 폴더: 안내 문구 자리에
        moveLesson(el.dataset.id, box.dataset.gid || null, near && near.dataset.id, after);
      },
      onDrop(cards) {
        list.append(...cards);
        saveGroup(gid, cards.map((c) => lessons.find((x) => x.id === c.dataset.id)));
      },
    });
  };

  // 불러오기: 이 수업을 지금 수업으로 바꾸기만 하고 화면은 그대로 둔다(버튼이 「불러오기 완료」로 바뀜)
  const loadPicked = async (btn) => {
    const l = picked();
    if (!l || l.id === lesson?.id) return;
    if (!canOpenLesson(l)) return openObserverCopy(l, btn, msg);
    if (btn) { btn.disabled = true; btn.textContent = "불러오는 중…"; }
    lesson = l;
    await loadLesson();   // 위쪽 수업 고르기 칸과 다른 탭이 이 수업으로 바뀐다
    flash("「" + l.title + "」 수업을 불러왔습니다.");
  };
  // 첫 슬라이드 오른쪽 위 별: 누르면 학생용 기본 수업으로 고른다(다시 누르면 해제). 저장은 맨 위 칸의 「저장」.
  const star = (l) => {
    const on = known(defaultPick) === l.id;
    const b = h("button", {
      class: "star-btn no-drag" + (on ? " on" : ""), type: "button", "aria-pressed": String(on),
      title: on ? "학생용 기본 수업에서 빼기" : "학생용 기본 수업으로 고르기", "aria-label": on ? "학생용 기본 수업에서 빼기" : "학생용 기본 수업으로 고르기",
      onclick: devOnly((e) => { e.stopPropagation(); defaultPick = on ? null : l.id; drawManage(); }),
      ondblclick(e) { e.stopPropagation(); },
      onkeydown(e) { e.stopPropagation(); },
    });
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3L2.85 9.45l6.32-.92z"/></svg>';
    return b;
  };
  const card = (l) =>
    h("article", {
      class: "lesson-card" + (l.id === pickedId ? " picked" : ""), "data-id": l.id, tabindex: "0",
      onclick() { pickedId = l.id; drawManage(); },
      ondblclick() { pickedId = l.id; loadPicked(); },
      onkeydown(e) { if (e.key === "Enter") { pickedId = l.id; drawManage(); } },
    },
      h("strong", {}, (l.kind === "survey" ? "[설문] " : "") + l.title),
      h("span", { class: "muted small" }, l.code + " · " + (l.slide_count ? slideTotal(l) + "쪽" : "슬라이드 없음") + " · " + new Date(l.created_at).toLocaleDateString("ko-KR")),
      l.id === lesson?.id ? h("span", { class: "tag ok" }, "지금 수업") : null,
      mine(l) ? null : h("span", { class: "tag info" }, canOpenLesson(l) ? "공유받음" : "다른 선생님"),
      l.observer_copy ? h("span", { class: "tag warn observer-copy" }, "관찰자 수정본") : null,
      // 첫 슬라이드(끌기를 방해하지 않게 그림 자체는 끌 수 없게)
      h("div", { class: "thumb-box" },
        l.slide_count && !isPptx(l)
          ? h("img", { class: "lesson-thumb", src: slideSrc(l, 1, true), alt: l.title + " 첫 슬라이드", loading: "lazy", draggable: "false" })
          : h("div", { class: "lesson-thumb empty" }, l.kind === "survey" ? "설문" : isPptx(l) ? "PowerPoint 자료" : "슬라이드 없음"),
        viewAll ? star(l) : null));

  const folderBox = (g) => {
    const items = inGroup(g.id);
    const list = h("div", { class: "lesson-list" }, items.length ? items.map((l) => card(l)) : h("p", { class: "muted small" }, "여기로 수업을 끌어 놓으세요."));
    sortCards(list, g.id);
    const f = folders.find((x) => x.id === g.id);
    return h("section", { class: "card stack folder", "data-gid": g.id === OTHERS ? null : g.id || "" },
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
  newName.addEventListener("keydown", (e) => { if (e.key === "Enter" && !imeBusy(e)) addFolder(); });

  const p = picked();
  const moveSel = p && mine(p) ? h("select", { "aria-label": "옮길 폴더", async onchange() { await moveLesson(p.id, moveSel.value || null, null); } },
    groups.map((g) => h("option", { value: g.id || "", selected: (folders.some((f) => f.id === p.folder_id) ? p.folder_id : null) === g.id }, g.name))) : null;
  // 맨 위 칸: 지금 고른 학생용 기본 수업(아래 카드와 같은 모양) + 저장/저장됨
  const pickNow = known(defaultPick), changed = pickNow !== known(defaultSaved);
  const defaultBox = viewAll ? h("section", { class: "card stack student-default" },
    h("div", { class: "row between wrap" },
      h("div", {}, h("h2", {}, "학생용 기본 수업"),
        h("p", { class: "muted small" }, "학생용 페이지를 주소(?c=) 없이 열면 이 수업 코드가 미리 들어갑니다. 아래 카드 첫 슬라이드의 ☆를 눌러 하나만 고를 수 있습니다.")),
      h("button", { class: "primary save-btn default-save", type: "button", disabled: !changed, onclick: devOnly(async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = "저장 중…";
        const r = await sb.rpc("set_default_lesson", { p_lesson: pickNow });
        if (r.error) { btn.disabled = false; btn.textContent = "저장"; return alert("저장하지 못했습니다: " + r.error.message); }
        defaultSaved = pickNow;
        drawManage();
      }) }, changed ? "저장" : "저장됨")),
    pickNow ? h("div", { class: "lesson-list" }, card(lessons.find((l) => l.id === pickNow)))
      : h("p", { class: "muted small default-empty" }, "고른 수업이 없습니다.")) : null;
  pane.replaceChildren(h("div", { class: "stack manage" },
    defaultBox,
    h("section", { class: "card stack" },
      h("div", { class: "row between wrap" },
        h("h2", {}, "전체 수업 " + lessons.length + "개"),
        h("div", { class: "row wrap" },
          h("div", { class: "folder-add" }, newName, h("button", { class: "ghost", type: "button", onclick: addFolder }, "+ 폴더 추가")),
          // 새 수업: 지금 수업을 비우고 「슬라이드 편집」의 만들기 칸으로 간다
          h("button", { class: "primary new-lesson", type: "button", async onclick() {
            newFrom = { id: lesson && lesson.id, tab, edit: editMode };   // 「취소」하면 이 수업·탭·모드로 돌아간다
            // 지금 모드에 「슬라이드 편집」이 없으면 편집 모드로 바꾼다(안 바꾸면 draw 가 전체 수업으로 되돌려 깜빡이기만 함)
            if (!tabShown("settings", editMode ? "edit" : "class")) { editMode = true; localStorage.setItem("cra-edit", "1"); }
            lesson = null; tab = "settings"; localStorage.setItem("cra-tab", tab);
            await loadLesson();
          } }, "+ 수업 추가"))),
      h("p", { class: "muted small" }, "수업 카드를 끌어 폴더에 넣거나 순서를 바꿀 수 있습니다. 다른 선생님 수업은 그 묶음 안에서 순서만 바꿀 수 있고, 내 화면에만 적용됩니다. 카드를 눌러 고른 뒤 「불러오기」(또는 두 번 누르기)를 하면 그 수업이 지금 수업이 됩니다. 화면은 그대로이고, 다른 탭에서 바로 그 수업을 씁니다."),
      error ? h("p", { class: "error" }, "폴더 기능을 쓰려면 Supabase에서 새 setup.sql을 실행해야 합니다.") : null,
      // 고른 수업 칸: 고르기 전에도 같은 자리·같은 단추를 꺼 둔 채로 보여 준다(고를 때 아래가 밀리지 않게)
      h("div", { class: "stack picked-bar" + (p ? "" : " none") },
        p ? h("strong", { class: "picked-name" }, "고른 수업: " + p.title + " (" + p.code + ")")
          : h("strong", { class: "picked-name muted" }, "고른 수업: 아직 고르지 않았습니다 · 아래 수업 카드를 눌러 고르세요"),
        h("div", { class: "row wrap" },
        p && p.id === lesson?.id
          ? h("button", { class: "primary", type: "button", disabled: true }, "불러오기 완료")
          : h("button", { class: "primary", type: "button", disabled: !p, onclick(e) { loadPicked(e.currentTarget); } }, "불러오기"),
        h("button", { class: "ghost", type: "button", disabled: !p, onclick() { exportSlidesPdf(p, msg); } }, "슬라이드 PDF 받기"),
        // 다른 반용으로 복제: 슬라이드·애니메이션·활동을 그대로 새 수업 코드의 수업으로(학생·응답은 비어 있음)
        h("button", { class: "ghost copy-lesson", type: "button", disabled: !p || !canOpenLesson(p), onclick(e) { duplicateLesson(p, e.currentTarget, msg); } }, "다른 반용으로 복제하기"),
        // 수업 삭제: 주인 또는 개발자만(공동 작업자는 못 지운다)
        h("button", { class: "ghost danger delete-lesson", type: "button", disabled: !p || !(mine(p) || viewAll), async onclick(ev) {
          if (!mine(p) && observer) return centerNote("개발자 고유의 권한입니다");
          const typed = prompt("「" + p.title + "」 수업을 지우면 활동, 학생, 응답, 슬라이드가 모두 지워집니다.\n지우려면 수업 코드 「" + p.code + "」를 입력하세요.");
          if ((typed || "").trim().toUpperCase() !== p.code) return;
          const btn = ev.currentTarget; btn.disabled = true;
          const { error } = await sb.from("lessons").delete().eq("id", p.id);
          if (error) { btn.disabled = false; return alert(error.message); }
          await removeSlideFiles(p).catch(() => {});   // 그림은 수업이 지워진 뒤에
          pickedId = null;
          await loadLessons(lesson && lesson.id !== p.id ? lesson.id : null);
          flash("「" + p.title + "」 수업을 지웠습니다.");
        } }, "수업 삭제"),
        h("div", { class: "folder-add" }, h("span", { class: "muted small" }, "폴더"),
          moveSel || h("select", { "aria-label": "옮길 폴더", disabled: true }, h("option", {}, p ? "다른 선생님 수업" : "—"))))),
      msg),
    groups.map(folderBox),
    others.length ? folderBox({ id: OTHERS, name: admin ? "다른 선생님 수업(개발자 권한 · 공유받은 것 포함)" : observer ? "다른 선생님 수업(불러오면 내 사본으로 열림)" : "공유받은 수업" }) : null));
}

// 다른 반용으로 복제: 새 수업 코드로 수업을 만들고 슬라이드 그림(애니메이션 단계·전환 효과 포함)을 새 수업 폴더로 복사, 활동(추가한 자료)을 옮겨 담는다.
// 학생·응답·공유 상태는 옮기지 않는다. 그림을 따로 두므로 두 수업의 슬라이드를 서로 상관없이 고칠 수 있다
let duplicating = false;
async function duplicateLesson(src, btn, msg) {
  if (duplicating) return;
  if (!confirm("「" + src.title + "」 수업을 다른 반용으로 복제할까요?\n슬라이드·애니메이션·추가한 자료가 그대로 복사되고, 새 수업 코드가 만들어집니다. 학생과 응답은 복사되지 않습니다.")) return;
  duplicating = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "복제하는 중…";
  let copy = null;
  try {
    const acts = await sb.from("activities").select("*").eq("lesson_id", src.id);
    if (acts.error) throw acts.error;
    const made = await sb.rpc("create_lesson", { p_title: (src.title + " (복사)").slice(0, 100), p_kind: src.kind });
    if (made.error) throw made.error;
    copy = made.data;
    if (src.slide_count) await copySlideFiles(src, copy, (i, n) => { btn.textContent = "슬라이드 복사 중 " + i + " / " + n; });
    if (acts.data.length) {
      const r = await sb.from("activities").insert(acts.data.map((a) => ({
        lesson_id: copy.id, kind: a.kind, title: a.title, page: a.page, show_answer: a.show_answer, named: a.named, questions: a.questions, sort: a.sort,
        page_to: a.page_to, html: a.html, sim_full: a.sim_full, sim_place: a.sim_place,
      })));
      if (r.error) throw r.error;
    }
    // 내 수업이면 같은 폴더에 넣는다
    if (src.owner === me.id && src.folder_id) await sb.from("lessons").update({ folder_id: src.folder_id }).eq("id", copy.id);
    pickedId = copy.id;
    await loadLessons(lesson ? lesson.id : copy.id);   // 지금 수업은 그대로(복제본은 「불러오기」로 연다)
    flash("「" + copy.title + "」(" + copy.code + ")로 복제했습니다.");
  } catch (e) {
    // 도중에 멈추면 반쯤 만든 복제본을 지운다
    if (copy) {
      await sb.from("lessons").delete().eq("id", copy.id);
      try {
        const store = await newSlideStore(), folder = slideFolder(copy);
        const names = await store.list(folder);
        if (names.length) await store.remove(names.map((n) => folder + n));
      } catch {}
    }
    btn.disabled = false;
    btn.textContent = label;
    msg.textContent = "복제하지 못했습니다: " + (e.message || e);
  } finally {
    duplicating = false;
  }
}

// 관찰자가 공동 작업자가 아닌 수업을 불러오면 원본 대신 내 사본을 연다. 사본은 한 사람당 OBSERVER_COPIES 개까지이고 넘치면 오래된 것부터 지운다.
const OBSERVER_COPIES = 3;
let copyingLesson = false;
async function openObserverCopy(src, btn, msg) {
  if (copyingLesson) return;
  const hasCopy = lessons.some((x) => x.owner === me.id && x.observer_copy && x.copied_from === src.id);
  if (!hasCopy && !confirm("공동 작업자가 아닌 수업을 관찰자 권한으로 불러오려면 사본을 만들어야 합니다.\n편집 내용은 원본을 덮어쓰지 않고 사본에 저장됩니다. 사본은 최대 " + OBSERVER_COPIES + "개까지 저장되며, 넘치면 먼저 만든 사본부터 삭제됩니다.\n사본을 만들까요?")) return;
  copyingLesson = true;
  const label = btn && btn.textContent;
  const status = (text) => { if (btn) btn.textContent = text; };
  if (btn) btn.disabled = true;
  status("사본 만드는 중…");
  try {
    const { data, error } = await sb.rpc("observer_copy_lesson", { p_lesson: src.id });
    if (error) throw error;
    const copy = data.lesson;
    // 사본에 그림을 못 옮겼으면(새로 만들었거나 지난번에 도중에 끊겼으면) 옮긴다. 실패하면 새 사본만 지워 다른 사본을 잃지 않게 한다
    if (src.slide_count && !copy.slide_count) {
      try { await copySlideFiles(src, copy, (i, n) => status("슬라이드 복사 중 " + i + " / " + n)); }
      catch (e) { if (!data.reused) await sb.from("lessons").delete().eq("id", copy.id); throw e; }
    }
    const { data: all, error: e2 } = await sb.from("lessons").select("*").eq("owner", me.id).eq("observer_copy", true).order("created_at");
    if (e2) throw e2;
    for (const old of all.filter((x) => x.id !== copy.id).slice(0, Math.max(all.length - OBSERVER_COPIES, 0))) {
      const r = await sb.from("lessons").delete().eq("id", old.id);
      if (r.error) throw r.error;
      await removeSlideFiles(old).catch(() => {});   // 그림은 수업이 지워진 뒤에
    }
    pickedId = copy.id;
    await loadLessons(copy.id);
    centerNote(data.reused ? "이미 만든 사본을 불러왔습니다." : "사본을 만들어 불러왔습니다.", null, true);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    if (msg) msg.textContent = "사본을 만들지 못했습니다: " + (e.message || e);
  } finally {
    copyingLesson = false;
  }
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
    const miss = [];   // 저장소에 그림이 없는 쪽(지우기·순서 저장이 중간에 멈춘 수업)은 빼고 만든다
    for (const [i, pg] of pages.entries()) {
      msg.textContent = "PDF 만드는 중 " + (i + 1) + " / " + pages.length;
      const r = await fetch(slideSrc(l, pg));
      const blob = r.ok ? await r.blob() : null;
      if (!blob || !/^image\//.test(blob.type)) { miss.push(slideNo(l, pg)); continue; }
      const bmp = await createImageBitmap(blob);
      const w = bmp.width, hh = bmp.height;
      const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
      const orient = w >= hh ? "landscape" : "portrait";
      if (!doc) doc = new JsPdf({ orientation: orient, unit: "px", format: [w, hh], hotfixes: ["px_scaling"] });
      else doc.addPage([w, hh], orient);
      doc.addImage(url, /png/i.test(blob.type) ? "PNG" : "JPEG", 0, 0, w, hh);
    }
    if (!doc) throw new Error("슬라이드 그림을 하나도 받지 못했습니다");
    doc.save((l.title || l.code).replace(/[\\/:*?"<>|]/g, "_") + "_슬라이드.pdf");
    msg.textContent = "PDF를 받았습니다 (" + (pages.length - miss.length) + "쪽)." + (miss.length ? " " + miss.join(", ") + "번 슬라이드는 그림이 저장소에 없어 뺐습니다. 슬라이드 편집의 「번호 다시 맞추기」로 번호를 바로잡거나 다시 올려 주세요." : "");
  } catch (e) {
    msg.textContent = "PDF를 만들지 못했습니다: " + (e.message || e);
  }
}
