// 교사 화면 · 「슬라이드 편집」 탭: 새 수업 만들기·복제·지우기, 슬라이드 올리기(PPTX/PDF → 그림), 슬라이드 저장소(R2 / Supabase), CSV 내보내기.

// ---------- 슬라이드 편집 ----------
let newFrom = null;   // 「+ 수업 추가」를 누르기 전의 수업·탭(만들기 취소용)
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
    newFrom = null;
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
        page_to: a.page_to, html: a.html, sim_full: a.sim_full, sim_place: a.sim_place,
      })));
      if (r.error) alert("활동을 복사하지 못했습니다: " + r.error.message);
    }
    await loadLessons(copy.id);
    flash("복제했습니다. 제목을 고쳐 주세요.");
  }

  async function remove(ev) {
    const typed = prompt("수업을 지우면 활동, 학생, 응답, 슬라이드가 모두 지워집니다.\n지우려면 수업 코드 「" + lesson.code + "」를 입력하세요.");
    if ((typed || "").trim().toUpperCase() !== lesson.code) return;
    const L = lesson, btn = ev && ev.currentTarget;
    if (btn) btn.disabled = true;
    const { error } = await sb.from("lessons").delete().eq("id", L.id);
    if (error) { if (btn) btn.disabled = false; return alert(error.message); }
    await removeSlideFiles(L).catch(() => {});   // 그림은 수업이 지워진 뒤에(실패해도 수업 삭제는 끝난 것)
    await loadLessons(null);
  }

  // 왼쪽: 설정·슬라이드 올리기·전환 효과 미리보기 / 오른쪽: 전체 슬라이드와 다중 선택 삭제(함께 보면서 고르게)
  const slides = lesson && lesson.kind !== "survey" ? slidesCard() : null;
  main.replaceChildren(h("div", { class: slides && slides.allCard ? "settings-grid" : "stack narrowish" }, h("div", { class: "stack" },
    slides ? slides.fxCard : null,   // 전환 효과 미리보기를 맨 위에(오른쪽 전체 슬라이드와 나란히)
    // 제목 고치기·학생 접속 주소는 위쪽 머리(제목 칸·「접속 QR」)에 있으므로 이 칸은 새로 만들 때만 보인다
    lesson ? null : h("form", { class: "card stack", onsubmit: submit },
      h("h2", {}, "새로 만들기"),
      kindPick,
      h("p", { class: "muted small" }, "수업 코드는 겹치지 않게 자동으로 만들어집니다."),
      h("label", {}, "제목", title),
      msg,
      h("div", { class: "row" },
        h("button", { class: "primary big", type: "submit" }, "수업 만들기"),
        // 만들기 취소: 「+ 수업 추가」 전의 수업(없으면 처음 수업)과 탭으로 돌아간다
        lessons.some(canOpenLesson) ? h("button", { class: "ghost big", type: "button", async onclick() {
          const back = newFrom || {};
          newFrom = null;
          lesson = lessons.find((l) => l.id === back.id) || lessons.find(canOpenLesson) || null;
          tab = back.tab && back.tab !== "settings" ? back.tab : "library";
          localStorage.setItem("cra-tab", tab);
          await loadLesson();
        } }, "취소") : null)),
    slides ? slides.mainCard : null,
    lesson ? h("section", { class: "card stack" },
      h("h2", {}, "수업 관리"),
      h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick: duplicate }, "다른 반용으로 복제"),
        h("button", { class: "ghost danger", type: "button", onclick: remove }, "수업 지우기"))) : null),
    slides && slides.allCard ? h("div", { class: "settings-slot" }, h("div", { class: "stack settings-right" }, slides.allCard)) : null));
  pinSettingsRight();
}

// 슬라이드 편집 오른쪽(전체 슬라이드·다중 선택 삭제)을 넓은 화면에서 화면에 고정한다(왼쪽을 스크롤해도 움직이지 않게).
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

// 올릴 수 있는 파일인지(PPT는 받아 두었다가 올릴 때 PPTX로 다시 저장하라고 알린다)
const isSlideFile = (f) => /\.(pptx?|pdf|png|jpe?g)$/i.test(f.name) || /^(application\/pdf|image\/(png|jpeg))$/.test(f.type);

// 슬라이드 올리기: PPTX 한 개는 그대로, PDF·그림은 쪽마다 JPG로 바꿔 Storage에 올린다.
// 파일은 아래 상자에 끌어다 놓거나 골라서 대기열에 쌓고, 쌓인 순서대로 슬라이드가 된다(한 번에 고른 여러 개는 이름순).
function slidesCard() {
  const file = h("input", { type: "file", hidden: true, accept: ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg", multiple: true,
    onchange() { add([...file.files]); file.value = ""; } });
  const bar = h("progress", { max: 1, value: 0, hidden: true });
  const status = h("p", { class: "msg" });
  const queue = [];   // 올릴 파일들(올릴 순서)
  const list = h("ol", { class: "upload-list" });
  const btn = h("button", { class: "primary", type: "button", disabled: true });
  const btnName = lesson.slide_count && !isPptx(lesson) ? "맨 뒤에 이어 붙이기" : "올리기";
  const paintQueue = () => {
    list.replaceChildren(...queue.map((f, k) => h("li", {},
      h("span", { class: "grow" }, f.name),
      h("button", { class: "link danger", type: "button", "aria-label": f.name + " 빼기", onclick() { queue.splice(k, 1); paintQueue(); } }, "빼기"))));
    list.hidden = !queue.length;
    btn.disabled = !queue.length;
    btn.textContent = btnName + (queue.length ? " (" + queue.length + "개)" : "");
  };
  const add = (files) => {
    const ok = files.filter(isSlideFile).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    status.textContent = ok.length < files.length ? "PPTX·PDF·PNG·JPG가 아닌 파일 " + (files.length - ok.length) + "개는 뺐습니다." : "";
    queue.push(...ok);
    paintQueue();
  };
  paintQueue();
  const pick = () => file.click();
  const hasFiles = (ev) => [...ev.dataTransfer.types].includes("Files");
  const dropBox = h("div", { class: "drop-box", role: "button", tabindex: 0, onclick: pick,
    onkeydown(ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } },
    ondragover(ev) { if (!hasFiles(ev)) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = "copy"; dropBox.classList.add("over"); },
    ondragleave(ev) { if (!dropBox.contains(ev.relatedTarget)) dropBox.classList.remove("over"); },
    ondrop(ev) { ev.preventDefault(); ev.stopPropagation(); dropBox.classList.remove("over"); add([...ev.dataTransfer.files]); } },
    h("strong", {}, "파일을 이 상자에 끌어다 놓으세요"),
    h("span", { class: "muted small" }, "또는 눌러서 고르기 · 여러 개를 한 번에 넣을 수 있고, 넣은 순서대로 슬라이드가 됩니다"));
  const upload = async () => {
    if (!queue.length) { status.textContent = "PPTX, PDF 또는 그림 파일을 먼저 넣으세요."; return; }
    if (btn.disabled) return;
    btn.disabled = true;
    bar.hidden = false;
    try {
      const n = await uploadSlides(queue.slice(), (done, total, what) => {
        bar.max = total;
        bar.value = done;
        status.textContent = what + " " + done + " / " + total;
      });
      if (n == null) { btn.disabled = false; bar.hidden = true; return; }   // 바꾸기 확인에서 취소
      flash("슬라이드 " + n + "장을 올렸습니다.");
      await loadLessons(lesson.id);
    } catch (e) {
      status.textContent = "올리지 못했습니다: " + (e.message || e);
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", upload);
  const thumbs = h("div", { class: "thumbs" });
  // 작은 그림은 오른쪽 스크롤 상자에서 보일 즈음 받는다. 브라우저의 loading="lazy" 는 고정된 칸 안 스크롤 상자에서
  // 그림을 받지 않고 비워 두는 경우가 있어 직접 지켜본다
  const seen = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    seen.unobserve(e.target);
    e.target.src = e.target.dataset.src;
  }), { root: thumbs, rootMargin: "300px 0px" });
  const fitHits = new Map();
  const hitWatch = new ResizeObserver((es) => es.forEach((e) => fitHits.get(e.target)?.()));
  const figs = [], renumber = new Map();
  for (let n = 1; n <= lesson.slide_count; n++) {
    let i = n;   // 순서를 저장하면 다시 그리지 않고 renumber 로 이 번호만 바꾼다
    const preview = h("div", { class: "thumb-preview" });
    const image = h("img", { class: "thumb-photo", "data-src": slideSrc(lesson, i, true), alt: i + "쪽" });
    // 작은 그림을 못 받으면 큰 그림으로, 그것도 안 되면 캐시를 피해 한 번 더
    let retry;
    const setRetry = () => { const big = slideSrc(lesson, i); retry = [big, big + (big.includes("?") ? "&" : "?") + "r=" + Date.now()]; };
    setRetry();
    image.addEventListener("error", () => { const next = retry.shift(); if (next) image.src = next; });
    seen.observe(image);
    const hitbox = h("button", {
      class: "thumb-hitbox", type: "button", "aria-label": i + "쪽 선택", "aria-pressed": selectedSlides.has(i),
      onclick() { toggleSlideSelection(i, figure, checkbox, hitbox); },
    });
    // 선택 칸은 그림 크기에 맞춘다(그림이 아직 없으면 미리보기 칸 전체)
    fitHits.set(image, () => {
      const on = image.offsetWidth > 0;
      hitbox.style.left = (on ? image.offsetLeft : 0) + "px";
      hitbox.style.top = (on ? image.offsetTop : 0) + "px";
      hitbox.style.width = on ? image.offsetWidth + "px" : "100%";
      hitbox.style.height = on ? image.offsetHeight + "px" : "100%";
    });
    hitWatch.observe(image);
    preview.append(image, hitbox);
    const checkbox = h("input", {
      type: "checkbox", checked: selectedSlides.has(i), "aria-label": i + "쪽 선택",
      onchange() { setSlideSelection(i, checkbox.checked, figure, checkbox, hitbox); },
    });
    const name = h("span", {}, slideSteps(lesson) ? thumbLabel(i) : i + "쪽");
    const del = h("button", { class: "link danger", type: "button", "aria-label": i + "쪽 삭제", onclick() { deleteSlide([i], work); } }, "삭제");
    const figure = h("figure", { class: "thumb" + (selectedSlides.has(i) ? " selected" : ""), "data-i": i },
      preview,
      h("label", { class: "thumb-check" }, checkbox, "선택"),
      h("figcaption", {}, name, del));
    figs.push(figure);
    // 받아 둔 그림은 그대로 두고(이미 맞는 그림) 아직 안 받은 그림만 새 주소로 받게 한다
    renumber.set(figure, (k) => {
      setSlideSelection(i, false, figure, checkbox, hitbox);
      i = k;
      figure.dataset.i = k;
      image.alt = k + "쪽";
      if (!image.getAttribute("src")) image.dataset.src = slideSrc(lesson, k, true);
      setRetry();
      hitbox.setAttribute("aria-label", k + "쪽 선택");
      checkbox.setAttribute("aria-label", k + "쪽 선택");
      del.setAttribute("aria-label", k + "쪽 삭제");
      del.disabled = false;
      name.textContent = slideSteps(lesson) ? thumbLabel(k) : k + "쪽";
    });
  }
  // 저장하지 않은 순서가 있으면(다른 탭에 다녀온 경우 등) 그 순서로 늘어놓는다
  if (slideOrder && (slideOrder.id !== lesson.id || slideOrder.dir !== lesson.slide_dir)) slideOrder = null;
  thumbs.append(...(slideOrder ? slideOrder.order : figs.map((_, k) => k + 1)).map((n) => figs[n - 1]));
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
        // 그림은 그대로이니 다시 그리지 않고(오른쪽 슬라이드 그림을 다시 받지 않게) 이 수업의 값만 바꾼다
        lesson.slide_dir = withFx(lesson.slide_dir, fxPick.value);
        const same = lessons.find((l) => l.id === lesson.id);
        if (same && same !== lesson) same.slide_dir = lesson.slide_dir;
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
  // 오른쪽 위 단추: 끌어서 바꾼 순서가 있으면 「저장하기」, 없으면 「저장됨」. 저장·삭제가 중간에 멈추면 「번호 다시 맞추기」
  const saveBtn = h("button", { class: "primary save-order", type: "button", onclick() {
    if (saveBtn.dataset.mode === "fix") { slideOrder = null; deleteSlide(null, work); }
    else if (slideOrder) reorderSlides(slideOrder.order, work);
  } });
  const paintSave = () => {
    saveBtn.dataset.mode = "";
    saveBtn.disabled = !slideOrder;
    saveBtn.textContent = slideOrder ? "저장하기" : "저장됨";
  };
  paintSave();
  // 저장·삭제 진행은 이 칸(오른쪽)의 막대와 글로 보여 준다
  const work = { bar: h("progress", { max: 1, value: 0, hidden: true }), status: h("p", { class: "msg" }),
    broke() { saveBtn.dataset.mode = "fix"; saveBtn.disabled = false; saveBtn.textContent = "번호 다시 맞추기"; },
    // 순서를 저장한 뒤: 화면을 다시 그리지 않고(그림을 다시 받아 깜빡이지 않게) 칸 번호·미리보기 번호만 고친다
    saved(order) {
      [...thumbs.children].forEach((f, k) => renumber.get(f)?.(k + 1));
      pvAt = order.indexOf(pvAt) + 1 || 1;
      pvWhere.textContent = slideLabel(lesson, pvAt);
      slideWork(work, "");
      paintSave();
    } };
  const allCard = lesson.slide_count && !ppt ? h("section", { class: "card stack all-slides" },
    h("h2", {}, "전체 슬라이드 " + lesson.slide_count + "장"),
    h("div", { class: "row slide-tools" },
      h("button", { class: "danger", type: "button", disabled: !selectedSlides.size, onclick() { deleteSlide([...selectedSlides].sort((a, b) => a - b), work); } }, "선택한 슬라이드 삭제 (" + selectedSlides.size + ")"),
      h("span", { class: "muted small grow" }, "끌어서 순서를 바꾼 뒤 저장하세요."),
      saveBtn),
    work.bar, work.status,
    thumbs) : null;
  // 끌어서 슬라이드 순서 바꾸기(dragSort): 애니메이션 단계 그림은 한 슬라이드의 단계를 묶어서 함께 옮긴다.
  // 놓으면 칸을 새 순서로 늘어놓기만 하고, 「저장하기」를 누를 때 저장소의 그림 이름을 바꾼다
  if (allCard) dragSort(thumbs, {
    items: () => [...thumbs.children],
    unit: anim ? (f) => slideNo(lesson, +f.dataset.i) : undefined,
    onDrop(order) {
      thumbs.append(...order);
      const o = order.map((f) => +f.dataset.i);
      slideOrder = o.every((n, k) => n === k + 1) ? null : { id: lesson.id, dir: lesson.slide_dir, order: o };
      paintSave();
    },
    scroller: () => thumbs,
  });
  // 상자 밖(이 칸의 나머지)에 떨어뜨린 파일은 받지 않는다(브라우저가 파일을 열지 않게)
  const mainCard = h("section", { class: "card stack",
    ondragover(ev) { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "none"; } },
    ondrop(ev) { ev.preventDefault(); } },
    h("h2", {}, "슬라이드 " + (lesson.slide_count ? slideTotal(lesson) + "장" + (anim ? " (애니메이션 단계 그림 " + lesson.slide_count + "장)" : "") : "없음")),
    h("p", { class: "muted small" }, "PowerPoint 파일(PPTX), PDF 파일, 그림 파일(PNG·JPG)을 올릴 수 있습니다. PPTX는 애니메이션을 살려 보여 주고, PDF는 쪽마다 그림으로 바뀝니다. PDF·그림은 여러 개를 함께 올릴 수 있고, 넣은 순서대로(한 번에 고른 파일끼리는 이름순) 슬라이드가 됩니다. 슬라이드가 이미 있으면 맨 뒤에 이어 붙습니다. 예전 형식(PPT)은 PowerPoint에서 PPTX로 다시 저장해 올리세요."),
    file, dropBox, list, h("div", { class: "row" }, btn), bar, status,
    anim ? h("p", { class: "muted small" }, "애니메이션 단계 그림 자료입니다(교사 PC의 올리기 도구로 올림). 수업 진행에서 「애니메이션」 버튼으로 클릭 단계를 넘깁니다. 아래 미리보기에서 단계 그림을 골라 지울 수 있고, 한 슬라이드의 단계를 모두 지우면 그 슬라이드가 빠집니다.") : null,
    ppt ? h("p", { class: "muted small" }, "지금은 PPTX 자료입니다. 쪽 미리보기와 쪽 삭제는 PDF·그림으로 올린 자료에서만 쓸 수 있습니다. PPTX 자료는 이어 붙일 수 없어서, 파일을 올리면 지금 자료가 새 파일로 바뀝니다.") : null);
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

async function uploadPptx(file, progress, L = lesson) {
  if (file.size > 50 * 1024 * 1024) throw new Error("PPTX 파일은 50MB 이하로 올려 주세요.");
  const Zip = await loadZipJs();
  const zip = await Zip.loadAsync(file);
  const pages = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  if (!pages || pages > 300) throw new Error("PPTX에서 슬라이드를 읽지 못했거나 300장을 넘습니다.");
  const folder = slideFolder(L);
  const old = { home: slideHome(L), shared: sharedSlides(L) };
  const store = await newSlideStore();
  progress(0, 1, "PPTX 올리는 중");
  await store.put(folder + "deck.pptx", file, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const { error: updateError } = await sb.from("lessons").update({ slide_dir: "pptx:" + store.base + folder + "deck.pptx?v=" + Date.now(), slide_count: pages, page: 1 }).eq("id", L.id);
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

// 파일들을 받은 순서대로 쪽별 JPG 묶음({ big, small })으로 바꾼다(PDF는 쪽마다, 그림은 한 장씩). 모두 합쳐 200쪽까지
const SLIDE_MAX = 200;
async function toSlideImages(files, progress) {
  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const use = files.filter((f) => isPdf(f) || /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
  if (!use.length) throw new Error("PPTX, PDF 또는 PNG·JPG 파일을 고르세요.");
  const lib = use.some(isPdf) ? await loadPdfJs() : null;
  // 먼저 PDF 쪽 수를 세어 전체 쪽 수를 알린다
  const docs = await Promise.all(use.map(async (f) => (isPdf(f) ? lib.getDocument({ data: await f.arrayBuffer() }).promise : null)));
  const total = docs.reduce((s, d) => s + (d ? d.numPages : 1), 0);
  if (total > SLIDE_MAX) throw new Error("모두 " + total + "쪽으로 " + SLIDE_MAX + "쪽이 넘습니다.");
  const what = (k) => (use.length > 1 ? "파일 " + (k + 1) + "/" + use.length + " · " : "") + "그림으로 바꾸는 중";
  const out = [];
  for (const [k, f] of use.entries()) {
    const pdf = docs[k];
    if (pdf) {
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(out.length, total, what(k));
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: SLIDE_WIDTH / page.getViewport({ scale: 1 }).width });
        const canvas = h("canvas", { width: Math.round(vp.width), height: Math.round(vp.height) });
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out.push(await slidePair(canvas));
      }
      continue;
    }
    progress(out.length, total, what(k));
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
let slideOrder = null;   // 끌어서 바꾸고 아직 저장하지 않은 순서 { id, dir, order: 새 순서의 예전 그림 번호들 }
addEventListener("beforeunload", (ev) => { if (slideOrder) ev.preventDefault(); });

// 오른쪽 「전체 슬라이드」 칸의 진행 막대와 안내 글(total 이 없으면 막대를 숨긴다)
function slideWork(ui, text, done, total) {
  ui.status.textContent = text;
  ui.bar.hidden = total == null;
  if (total != null) { ui.bar.max = Math.max(total, 1); ui.bar.value = done; }
}

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

async function deleteSlide(target, ui) {
  if (slideBusy) return;
  if (target != null && slideOrder) return alert("끌어서 바꾼 순서를 먼저 「저장하기」로 저장해 주세요.");
  const targets = target == null ? [] : [...new Set(Array.isArray(target) ? target : [target])].sort((a, b) => a - b);
  const home = slideHome(lesson);
  if (!home || isPptx(lesson)) return alert("이 수업의 슬라이드 위치를 알 수 없습니다. 슬라이드를 다시 올려 주세요.");
  const folder = home.folder;
  const base = lesson.slide_dir.split("?")[0];
  if (folder !== slideFolder(lesson) || sharedSlides(lesson)) {
    return alert("이 슬라이드는 복제한 다른 수업과 함께 쓰고 있어서 한 쪽만 지울 수 없습니다.\n복제해 온 수업이면 이 수업에서 슬라이드를 이어 붙일 때 이 수업만의 슬라이드로 복사됩니다.");
  }
  if (targets.length) {
    if (!confirm(targets.length + "장의 슬라이드를 지울까요? 남은 슬라이드와 질문 쪽 번호를 맞춥니다.")) return;
  }
  slideBusy = true;
  document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = true; });
  const st = home.store;
  try {
    slideWork(ui, "슬라이드 목록을 확인하는 중…", 0, 1);
    const names = await st.list(folder);
    let nums = names.map((n) => /^(\d+)\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]).sort((x, y) => x - y);
    // 작은 그림(3s.jpg)도 큰 그림과 함께 지우고 옮긴다
    const smalls = new Set(names.map((n) => /^(\d+)s\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]));
    // 순서 저장이 중간에 멈춰 남은 임시 그림(m3.jpg)은 번호 다시 맞추기에서 맨 뒤 번호로 되살린다
    const temps = targets.length ? [] : names.map((n) => /^m(\d+)\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]);
    if (targets.length) {
      const missing = targets.filter((n) => !nums.includes(n));
      if (missing.length) throw new Error(missing.join(", ") + "쪽 그림이 이미 없습니다. 「번호 다시 맞추기」를 눌러 주세요.");
      slideWork(ui, targets.length + "장의 슬라이드를 지우는 중…", 0, 1);
      await st.remove(targets.flatMap((n) => [folder + n + ".jpg", ...(smalls.has(n) ? [folder + n + "s.jpg"] : [])]));
      for (const n of targets) smalls.delete(n);
      nums = nums.filter((x) => !targets.includes(x));
    }
    const small = /[?&]sm=1/.test(lesson.slide_dir) && nums.every((n) => smalls.has(n)) && temps.every((t) => names.includes("m" + t + "s.jpg"));
    // 남은 그림을 1, 2, 3 … 으로 당긴다(작은 번호부터 옮기므로 옮길 자리는 늘 비어 있다)
    const pulls = [...nums.map((num, i) => [String(num), i + 1, smalls.has(num)]).filter(([num, to]) => +num !== to),
      ...temps.map((t, i) => ["m" + t, nums.length + i + 1, names.includes("m" + t + "s.jpg")])];
    for (const [i, [from, to, sm]] of pulls.entries()) {
      slideWork(ui, "슬라이드 번호를 맞추는 중 " + (i + 1) + " / " + pulls.length, i, pulls.length);
      await Promise.all([st.move(folder + from + ".jpg", folder + to + ".jpg"), sm && st.move(folder + from + "s.jpg", folder + to + "s.jpg")]);
    }
    const left = nums.length + temps.length;
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
        anim = keep.filter(Boolean).map((k) => Math.min(k - 1, 35).toString(36)).join("") + "0".repeat(temps.length);
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
    slideWork(ui, "멈췄습니다: " + (e.message || e) + " · 「번호 다시 맞추기」를 누르면 남은 그림으로 번호를 다시 맞춥니다.");
    ui.broke();
    alert(ui.status.textContent);
  }
}

// 슬라이드 순서 바꾸기: order 는 새 순서의 예전 그림 번호들. 질문의 쪽 번호·지금 쪽·애니메이션 단계 수(anim)도 새 순서에 맞춘다.
// 그림 이름(1.jpg …)이 곧 순서라서(학생 화면이 쪽 번호로 바로 그림 주소를 만든다) 이름을 바꿔 저장한다.
// 새 순서를 고리(cycle: 3→1, 1→2, 2→3 처럼 서로 자리를 물려받는 묶음)로 나누면 고리마다 임시 이름(m번호) 하나만 거쳐
// 고리 길이 + 1 번 옮기면 된다(옮길 그림마다 두 번 옮기던 것의 약 절반). 고리끼리는 겹치지 않으니 함께 옮긴다.
async function reorderSlides(order, ui) {
  if (slideBusy || order.every((n, k) => n === k + 1)) return;
  const home = slideHome(lesson);
  if (!home || isPptx(lesson) || home.folder !== slideFolder(lesson) || sharedSlides(lesson)) {
    alert("이 슬라이드는 복제한 다른 수업과 함께 쓰고 있어서 순서를 바꿀 수 없습니다.\n복제해 온 수업이면 이 수업에서 슬라이드를 이어 붙일 때 이 수업만의 슬라이드로 복사됩니다.");
    slideOrder = null;
    return drawSettings();
  }
  slideBusy = true;
  document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = true; });
  const { store: st, folder } = home;
  try {
    slideWork(ui, "슬라이드 목록을 확인하는 중…", 0, 1);
    const names = new Set(await st.list(folder));
    // 그림 n(예전 번호)의 큰·작은 그림을 이름 from → to 로 함께 옮긴다
    const mv = (n, from, to) => Promise.all([n + ".jpg", ...(names.has(n + "s.jpg") ? [n + "s.jpg"] : [])]
      .map((f) => st.move(folder + f.replace(/^\d+/, from), folder + f.replace(/^\d+/, to))));
    // 고리: 자리 c[0] 은 c[1] 이, c[1] 은 c[2] 가 … 물려받고 마지막 자리는 임시로 옮겨 둔 c[0] 이 받는다
    const done = new Set(), cycles = [];
    order.forEach((old, k) => {
      if (old === k + 1 || done.has(k + 1)) return;
      const c = [];
      for (let at = k + 1; !done.has(at); at = order[at - 1]) { done.add(at); c.push(at); }
      cycles.push(c);
    });
    const total = cycles.reduce((s, c) => s + c.length + 1, 0);
    let moved = 0;
    const step = async (n, from, to) => { await mv(n, from, to); moved++; slideWork(ui, "슬라이드 순서를 저장하는 중 " + moved + " / " + total, moved, total); };
    const runCycle = async (c) => {
      await step(c[0], c[0], "m" + c[0]);
      for (let j = 0; j + 1 < c.length; j++) await step(c[j + 1], c[j + 1], c[j]);
      await step(c[0], "m" + c[0], c[c.length - 1]);
    };
    const waiting = cycles.slice();
    await Promise.all(Array.from({ length: Math.min(4, waiting.length) }, async () => { while (waiting.length) await runCycle(waiting.shift()); }));
    // 슬라이드 번호(애니메이션 수업은 단계를 묶은 번호)로 바꿔 질문 쪽 번호를 옮긴다
    const steps = slideSteps(lesson);
    const slides = [...new Set(order.map((n) => slideNo(lesson, n)))];
    const newSlide = (s) => (s == null ? s : slides.indexOf(s) + 1);
    for (const a of activities) {
      if (a.page == null) continue;
      const page = newSlide(a.page);
      let to = a.page_to > a.page ? newSlide(a.page_to) : a.page_to ?? null;
      if (to != null && to <= page) to = null;
      if (page === a.page && to === (a.page_to ?? null)) continue;
      const change = { page };
      if ("page_to" in a) change.page_to = to;
      const u = await sb.from("activities").update(change).eq("id", a.id);
      if (u.error) throw u.error;
      Object.assign(a, change);
    }
    activities = sortActivities(activities);
    const anim = steps ? slides.map((s) => Math.min(steps[s - 1] - 1, 35).toString(36)).join("") : "";
    const small = /[?&]sm=1/.test(lesson.slide_dir);
    const dir = withFx(lesson.slide_dir.split("?")[0] + "?v=" + Date.now() + (small ? "&sm=1" : "") + (anim ? "&anim=" + anim : ""), slideFx(lesson));
    const change = { slide_dir: dir, page: order.indexOf(lesson.page) + 1 || 1 };
    const u = await sb.from("lessons").update(change).eq("id", lesson.id);
    if (u.error) throw u.error;
    // 수업 전체를 다시 불러오면 화면이 통째로 깜빡이므로 이 수업의 값만 바꾸고 칸 번호를 고친다
    Object.assign(lesson, change);
    const same = lessons.find((l) => l.id === lesson.id);
    if (same && same !== lesson) Object.assign(same, change);
    slideOrder = null;
    slideBusy = false;
    ui.saved(order);
    selectedSlides.clear();
    flash("슬라이드 순서를 저장했습니다.");
  } catch (e) {
    slideBusy = false;
    document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = false; });
    slideWork(ui, "멈췄습니다: " + (e.message || e) + " · 「번호 다시 맞추기」를 누르면 남은 그림으로 번호를 다시 맞춥니다.");
    ui.broke();
    alert(ui.status.textContent);
  }
}

async function uploadSlides(files, progress) {
  const L = lesson;   // 올리는 동안 다른 수업을 골라도 처음 수업에 저장
  if (files.some((f) => /\.ppt$/i.test(f.name))) throw new Error("예전 PowerPoint 형식(PPT)은 올릴 수 없습니다. PowerPoint에서 파일 → 다른 이름으로 저장 → PPTX로 저장해 올리세요.");
  const pptx = files.filter((f) => /\.pptx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  if (pptx.length) {
    if (pptx.length !== 1 || files.length !== 1) throw new Error("PPTX는 한 번에 하나만 올릴 수 있습니다.");
    if (L.slide_count && !confirm("PPTX 파일은 이어 붙일 수 없어서 지금 슬라이드를 이 파일로 바꿉니다. 계속할까요?")) return null;
    return uploadPptx(pptx[0], progress, L);
  }
  // 그림 슬라이드가 이미 있으면 맨 뒤에 이어 붙인다. PPTX 자료(또는 위치를 모르는 자료)만 새 파일로 바꾼다
  const home = slideHome(L);
  const append = L.slide_count && !isPptx(L) && home;
  if (L.slide_count && !append && !confirm("지금 자료에는 이어 붙일 수 없어서 슬라이드를 새 파일로 바꿉니다. 계속할까요?")) return null;
  const images = await toSlideImages(files, progress);
  if (append) return appendSlides(L, home, images, progress);
  const folder = slideFolder(L);
  const old = { home: slideHome(L), shared: sharedSlides(L) };
  const store = await newSlideStore();
  for (const [i, pair] of images.entries()) {
    progress(i, images.length, "올리는 중");
    await store.put(folder + (i + 1) + ".jpg", pair.big, "image/jpeg");
    await store.put(folder + (i + 1) + "s.jpg", pair.small, "image/jpeg");
  }
  progress(images.length, images.length, "올리는 중");
  const dir = withFx(store.base + folder + "{n}.jpg?v=" + Date.now() + "&sm=1", slideFx(L));
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: images.length, page: 1 }).eq("id", L.id);
  if (error) throw error;
  // 전보다 쪽 수가 줄었으면 남은 그림과 예전 원본 PPTX를 지운다
  await cleanSlideFolder(old, store, folder, (n) => { const m = /^(\d+)s?\.jpg$/.exec(n); return !!m && +m[1] <= images.length; });
  return images.length;
}

// 이어 붙이기: 새 그림을 지금 마지막 번호 다음부터 올린다(지금 쪽·질문 쪽 번호는 그대로).
// 복제해 온 그림(다른 수업 폴더)이면 지금 그림을 먼저 이 수업 폴더로 복사해 원래 수업은 건드리지 않는다.
async function appendSlides(L, home, images, progress) {
  const folder = slideFolder(L);
  const query = L.slide_dir.split("?")[1] || "";
  const small = /(^|&)sm=1(&|$)/.test(query);
  let st = home.store;
  if (home.folder !== folder) {
    st = await newSlideStore();
    const names = Array.from({ length: L.slide_count }, (_, i) => i + 1).flatMap((n) => (small ? [n + ".jpg", n + "s.jpg"] : [n + ".jpg"]));
    for (const [i, name] of names.entries()) {
      progress(i, names.length, "지금 슬라이드 복사하는 중");
      const r = await fetch(home.store.base + home.folder + name + (query ? "?" + query : ""));
      if (!r.ok) throw new Error(name + " 응답 " + r.status);
      await st.put(folder + name, await r.blob(), "image/jpeg");
    }
  }
  const start = L.slide_count;
  for (const [i, pair] of images.entries()) {
    progress(i, images.length, "올리는 중");
    await st.put(folder + (start + i + 1) + ".jpg", pair.big, "image/jpeg");
    await st.put(folder + (start + i + 1) + "s.jpg", pair.small, "image/jpeg");
  }
  progress(images.length, images.length, "올리는 중");
  // 단계 그림 수업이면 새 그림은 단계가 하나뿐인 슬라이드("0")로 덧붙인다
  const steps = slideSteps(L);
  const anim = steps ? steps.map((n) => Math.min(n - 1, 35).toString(36)).join("") + "0".repeat(images.length) : "";
  const dir = withFx(st.base + folder + "{n}.jpg?v=" + Date.now() + (small ? "&sm=1" : "") + (anim ? "&anim=" + anim : ""), slideFx(L));
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: start + images.length }).eq("id", L.id);
  if (error) throw error;
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

// 관찰자 사본: 원본 그림을 사본 전용 폴더로 복사한다(원본이 바뀌거나 지워져도 사본은 그대로). 우리 저장소 밖의 주소면 주소만 쓴다.
async function copySlideFiles(src, copy, progress) {
  const home = slideHome(src);
  let dir = src.slide_dir;
  if (home) {
    const store = await newSlideStore();
    const folder = slideFolder(copy);
    const tail = /(?:\{n\}\.jpg|deck\.pptx)(\?.*)?$/.exec(dir);
    const query = tail[1] || "";
    const names = isPptx(src) ? ["deck.pptx"] : Array.from({ length: src.slide_count }, (_, i) => i + 1).flatMap((n) => /[?&]sm=1/.test(dir) ? [n + ".jpg", n + "s.jpg"] : [n + ".jpg"]);
    let done = 0, next = 0;
    const worker = async () => {
      while (next < names.length) {
        const name = names[next++];
        const r = await fetch(home.store.base + home.folder + name + query);
        if (!r.ok) throw new Error(name + " 응답 " + r.status);
        const blob = await r.blob();
        await store.put(folder + name, blob, blob.type || "image/jpeg");
        progress(++done, names.length);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    dir = (isPptx(src) ? "pptx:" : "") + store.base + folder + tail[0];
  }
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: src.slide_count }).eq("id", copy.id);
  if (error) throw error;
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
