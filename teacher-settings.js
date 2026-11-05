// 교사 화면 · 「슬라이드 편집」 탭: 새 수업 만들기, 슬라이드 올리기(PPTX/PDF → 그림), 슬라이드 저장소(R2 / Supabase), CSV 내보내기.

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
          if (back.edit != null) { editMode = back.edit; localStorage.setItem("cra-edit", editMode ? "1" : "0"); }
          localStorage.setItem("cra-tab", tab);
          await loadLesson();
        } }, "취소") : null)),
    // 다른 반용 복제·수업 삭제는 「전체 수업」에서 수업을 골라 한다
    slides ? slides.mainCard : null),
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
  const canAppend = lesson.slide_count && !isPptx(lesson);
  const btnName = canAppend ? "맨 뒤에 이어 붙이기" : "올리기";
  // 「기존 슬라이드 대체하기」: 이어 붙일 수 있는 자료에서만 보인다(그 밖에는 「올리기」가 이미 바꾸기)
  const replaceBtn = canAppend ? h("button", { class: "ghost", type: "button", disabled: true }, "기존 슬라이드 대체하기") : null;
  const paintQueue = () => {
    list.replaceChildren(...queue.map((f, k) => h("li", {},
      h("span", { class: "grow" }, f.name),
      h("button", { class: "link danger", type: "button", "aria-label": f.name + " 빼기", onclick() { queue.splice(k, 1); paintQueue(); } }, "빼기"))));
    list.hidden = !queue.length;
    btn.disabled = !queue.length;
    btn.textContent = btnName + (queue.length ? " (" + queue.length + "개)" : "");
    if (replaceBtn) replaceBtn.disabled = !queue.length;
  };
  const add = (files) => {
    const ok = files.filter(isSlideFile).sort((a, b) => a.name.normalize("NFC").localeCompare(b.name.normalize("NFC"), "ko", { numeric: true }));
    const key = files.some((f) => /\.key$/i.test(f.name)) ? " Keynote 파일은 Keynote에서 「파일 → 내보내기 → PDF」(또는 PowerPoint)로 바꿔 올리세요." : "";
    status.textContent = ok.length < files.length ? "PPTX·PDF·PNG·JPG가 아닌 파일 " + (files.length - ok.length) + "개는 뺐습니다." + key : "";
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
  const upload = async (replace) => {
    if (!queue.length) { status.textContent = "PPTX, PDF 또는 그림 파일을 먼저 넣으세요."; return; }
    if (btn.disabled) return;
    const busy = (on) => { btn.disabled = on; if (replaceBtn) replaceBtn.disabled = on; };
    busy(true);
    bar.hidden = false;
    try {
      const n = await uploadSlides(queue.slice(), (done, total, what) => {
        bar.max = total;
        bar.value = done;
        status.textContent = what + " " + done + " / " + total;
      }, replace);
      if (n == null) { busy(false); bar.hidden = true; return; }   // 바꾸기 확인에서 취소
      flash("슬라이드 " + n + "장을 올렸습니다.");
      await loadLessons(lesson.id);
    } catch (e) {
      status.textContent = "올리지 못했습니다: " + (e.message || e);
      busy(false);
    }
  };
  btn.addEventListener("click", () => upload(false));
  if (replaceBtn) replaceBtn.addEventListener("click", () => upload(true));
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
      class: "thumb-hitbox", type: "button", "data-rapid": "1", "aria-label": i + "쪽 선택", "aria-pressed": selectedSlides.has(i),
      // 누르면 왼쪽 미리보기가 이 그림으로 바로 넘어가고, 「삭제할 슬라이드 선택하기」 중이면 고르기도 한다
      onclick() { pvJump(i); if (slidePicking) toggleSlideSelection(i, figure, checkbox, hitbox); },
      // 두 번 누르면 수업 진행으로 가서 이 슬라이드를 띄운다(고르는 중에는 하지 않는다)
      async ondblclick() { if (slidePicking) return; await setPage(i); goTab("run"); },
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
    const del = h("button", { class: "link danger", type: "button", "aria-label": i + "쪽 삭제", onclick() { cutSlides([i]); } }, "삭제");
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
    paintViewing();
  };
  slideEditStep = lesson.slide_count && !ppt ? (k) => pvShow(pvAt + k) : null;   // 좌우 화살표 키(아래 keydown)
  // 오른쪽 그림을 누르면 효과 없이 바로 그 그림으로
  const pvJump = (to) => {
    if (ppt || !lesson.slide_count) return;
    pvAt = to;
    swapSlide(pv, slideSrc(lesson, to), "none", 1);
    pvWhere.textContent = slideLabel(lesson, to);
    paintViewing();
  };
  // 미리보기에 띄운 그림의 칸 표시
  const paintViewing = () => [...thumbs.children].forEach((f) => f.classList.toggle("viewing", +f.dataset.i === pvAt));
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
  if (lesson.slide_count && !ppt) { swapSlide(pv, slideSrc(lesson, 1), "none", 1); pvWhere.textContent = slideLabel(lesson, 1); paintViewing(); }
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
    if (saveBtn.dataset.mode === "fix") { slideOrder = null; saveSlides(null, work, true); }
    else if (slideOrder) saveSlides(slideOrder.order, work);
  } });
  // 저장하지 않은 순서·지우기를 모두 버리고 저장된 상태로
  const undoBtn = h("button", { class: "ghost undo-order", type: "button", onclick() { slideOrder = null; drawSettings(); } }, "되돌리기");
  const paintSave = () => {
    const cut = slideOrder ? lesson.slide_count - slideOrder.order.length : 0;
    saveBtn.dataset.mode = "";
    saveBtn.disabled = !slideOrder;
    saveBtn.textContent = slideOrder ? "저장하기" + (cut ? " (" + cut + "장 지움)" : "") : "저장됨";
    undoBtn.hidden = !slideOrder;
  };
  // 지우기는 칸만 빼 두고(저장 전) 「저장하기」를 누를 때 순서와 함께 한 번에 저장한다
  const keepOrder = () => {
    const o = [...thumbs.children].map((f) => +f.dataset.i);
    slideOrder = o.length === lesson.slide_count && o.every((n, k) => n === k + 1) ? null : { id: lesson.id, dir: lesson.slide_dir, order: o };
    paintSave();
  };
  const cutSlides = (nums) => {
    for (const f of [...thumbs.children]) if (nums.includes(+f.dataset.i)) f.remove();
    [...thumbs.children].forEach((f) => f.classList.remove("selected"));
    thumbs.querySelectorAll(".thumb-check input").forEach((c) => { c.checked = false; });
    thumbs.querySelectorAll(".thumb-hitbox").forEach((x) => x.setAttribute("aria-pressed", "false"));
    selectedSlides.clear();
    slidePicking = false;
    paintPick();
    keepOrder();
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
      paintViewing();
      slideWork(work, "");
      paintSave();
    } };
  // 「삭제할 슬라이드 선택하기」를 누르면 고르기 상태: 단추가 「선택한 슬라이드 삭제 (n)」로 바뀌고 옆에 「취소」가 보인다.
  // 두 단추는 늘 자리를 차지하고(취소는 visibility 로 숨김) 너비가 고정이라 다른 단추가 밀리지 않는다
  const bulk = h("button", { class: "danger bulk-del", type: "button", onclick() {
    if (!slidePicking) { slidePicking = true; paintPick(); return; }
    if (selectedSlides.size) cutSlides([...selectedSlides]);
  } });
  const cancelPick = h("button", { class: "ghost cancel-pick", type: "button", onclick() {
    slidePicking = false;
    [...thumbs.children].forEach((f) => f.classList.remove("selected"));
    thumbs.querySelectorAll(".thumb-check input").forEach((c) => { c.checked = false; });
    thumbs.querySelectorAll(".thumb-hitbox").forEach((b) => b.setAttribute("aria-pressed", "false"));
    selectedSlides.clear();
    paintPick();
  } }, "취소");
  const paintPick = () => {
    thumbs.classList.toggle("picking", slidePicking);
    cancelPick.style.visibility = slidePicking ? "" : "hidden";
    paintBulk(bulk);
  };
  const allCard = lesson.slide_count && !ppt ? h("section", { class: "card stack all-slides" },
    h("div", { class: "row" },
      h("h2", { class: "grow" }, "전체 슬라이드 " + lesson.slide_count + "장"),
      h("span", { class: "muted small" }, "두 번 누르면 그 슬라이드로 수업 진행이 열립니다")),
    h("div", { class: "row slide-tools" },
      bulk, cancelPick,
      h("span", { class: "muted small grow" }, "끌어서 순서를 바꾸거나 지운 뒤 한 번에 저장하세요."),
      undoBtn, saveBtn),
    work.bar, work.status,
    thumbs) : null;
  paintPick();
  // 끌어서 슬라이드 순서 바꾸기(dragSort): 애니메이션 단계 그림은 한 슬라이드의 단계를 묶어서 함께 옮긴다.
  // 놓으면 칸을 새 순서로 늘어놓기만 하고, 「저장하기」를 누를 때 그림 순서 목록(ord)을 저장한다
  if (allCard) dragSort(thumbs, {
    items: () => [...thumbs.children],
    unit: anim ? (f) => slideNo(lesson, +f.dataset.i) : undefined,
    onDrop(order) {
      thumbs.append(...order);
      keepOrder();
    },
    scroller: () => thumbs,
  });
  // 상자 밖(이 칸의 나머지)에 떨어뜨린 파일은 받지 않는다(브라우저가 파일을 열지 않게)
  const mainCard = h("section", { class: "card stack",
    ondragover(ev) { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "none"; } },
    ondrop(ev) { ev.preventDefault(); } },
    h("h2", {}, "슬라이드 " + (lesson.slide_count ? slideTotal(lesson) + "장" + (anim ? " (애니메이션 단계 그림 " + lesson.slide_count + "장)" : "") : "없음")),
    h("p", { class: "muted small" }, "PowerPoint 파일(PPTX), PDF 파일, 그림 파일(PNG·JPG)을 올릴 수 있습니다. PPTX는 애니메이션을 살려 보여 주고, PDF는 쪽마다 그림으로 바뀝니다. PDF·그림은 여러 개를 함께 올릴 수 있고, 넣은 순서대로(한 번에 고른 파일끼리는 이름순) 슬라이드가 됩니다. 슬라이드가 이미 있으면 맨 뒤에 이어 붙고, 「기존 슬라이드 대체하기」를 누르면 지금 슬라이드를 모두 지우고 새 파일로 바꿉니다. 예전 형식(PPT)은 PowerPoint에서 PPTX로 다시 저장해 올리세요."),
    file, dropBox, list, h("div", { class: "row" }, btn, replaceBtn), bar, status,
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
  await cleanSlideFolder(old, store, folder, (n) => !/^\d+(s?\.jpg|\.pdf)$/.test(n));
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

// 큰 그림(n.jpg)은 교사 화면(TV·프로젝터)과 학생의 「크게 보기」에만 쓴다: 1920px·품질 0.82(2026-11-05, 1280px·0.72는 큰 화면에서 흐렸다)
const SLIDE_WIDTH = 1920;
const SLIDE_QUALITY = 0.82;

// 학생 기기·썸네일용 작은 그림(n s.jpg): 휴대폰·태블릿 화면에는 1024px·0.72면 충분하다(학생 수만큼 내려가므로 작게)
const SMALL_WIDTH = 1024;
const SMALL_QUALITY = 0.72;

function canvasToJpeg(canvas, quality) {
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("그림으로 바꾸지 못했습니다"))), "image/jpeg", quality));
}
// 한 쪽 → { big: 1920px, small: 1024px } JPG
async function slidePair(canvas) {
  const scale = Math.min(1, SMALL_WIDTH / canvas.width);
  const c = h("canvas", { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) });
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const pair = { big: await canvasToJpeg(canvas, SLIDE_QUALITY), small: await canvasToJpeg(c, SMALL_QUALITY) };
  canvas.width = canvas.height = c.width = c.height = 0;
  return pair;
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
  out.pdfs = [];   // { file, first: 첫 쪽이 out 의 몇 번째인지(0부터), n: 쪽 수 }
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
        page.cleanup();
        out.push(await slidePair(canvas));
      }
      // 원본 PDF도 함께 올려 「슬라이드 PDF 받기」가 그 쪽을 화질 그대로 쓰게 한다(저장소 한도 50MB를 넘으면 그림만)
      if (f.size <= 50 * 1024 * 1024) out.pdfs.push({ file: f, first: out.length - pdf.numPages, n: pdf.numPages });
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
    bmp.close?.();
    out.push(await slidePair(canvas));
  }
  return out;
}

// 이 수업의 그림 폴더: 이미 이 수업 폴더(누가 올렸든 「교사id/이 수업id/」)가 있으면 그곳, 없으면 내 폴더.
// 주인·공동작업자·개발자 모두 같은 폴더를 고친다(저장소는 그 수업에 손댈 수 있는 사람에게 쓰기를 허락한다).
function slideFolder(l) {
  const home = slideHome(l);
  return home && home.folder.endsWith("/" + l.id + "/") ? home.folder : me.id + "/" + l.id + "/";
}
// 올린 원본 PDF를 그림 파일 번호에 맞춰 k.pdf 로 올리고, 주소의 pdf 목록에 넣을 항목을 돌려준다(start: 첫 그림의 파일 번호 - 1)
async function putSourcePdfs(store, folder, images, start, progress) {
  const out = [];
  for (const p of images.pdfs || []) {
    progress(images.length, images.length, "원본 PDF 올리는 중");
    try {
      await store.put(folder + (start + p.first + 1) + ".pdf", p.file, "application/pdf");
      out.push({ k: start + p.first + 1, n: p.n });
    } catch (e) {
      console.warn("원본 PDF 올리기 실패(그림으로만 받음)", e);
    }
  }
  return out;
}

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
let slideEditStep = null;   // 슬라이드 편집 미리보기를 k칸 넘기기(slidesCard 가 정한다)
// 슬라이드 편집 탭에서 좌우 화살표(PageUp/Down)로 위 미리보기를 넘긴다(입력 칸에 있을 땐 그대로)
document.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  if (tab !== "settings" || !slideEditStep || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
  const k = slideKey(e);
  if (k) { e.preventDefault(); slideEditStep(k); }
});
let slidePicking = false;   // 「삭제할 슬라이드 선택하기」를 눌러 지울 슬라이드를 고르는 중
let slideOrder = null;   // 끌어서 바꾸거나 지우고 아직 저장하지 않은 순서 { id, dir, order: 새 순서의 예전 그림 번호들(지운 그림은 빠짐) }
// 끌어 바꾼 순서를 저장하지 않았거나, 지우기·순서 저장 중(중간에 끊기면 그림 번호에 빈 곳이 생긴다)이면 떠나기 전에 묻는다
addEventListener("beforeunload", (ev) => { if (slideOrder || slideBusy) ev.preventDefault(); });

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
  paintBulk();
}

// 여러 장 삭제 단추: 평소엔 「삭제할 슬라이드 선택하기」, 고르는 중엔 「선택한 슬라이드 삭제 (n)」(고른 것이 없으면 꺼짐)
function paintBulk(bulk = document.querySelector(".slide-tools .bulk-del")) {
  if (!bulk) return;
  bulk.disabled = slidePicking && !selectedSlides.size;
  bulk.classList.toggle("on", slidePicking);
  bulk.textContent = slidePicking ? "선택한 슬라이드 삭제 (" + selectedSlides.size + ")" : "삭제할 슬라이드 선택하기";
}

function toggleSlideSelection(page, figure, checkbox, hitbox) {
  setSlideSelection(page, !selectedSlides.has(page), figure, checkbox, hitbox);
}

const SHARED_NOTE = "이 수업에서 복제한 다른 수업이 같은 슬라이드 그림을 함께 쓰고 있어서 지금은 고칠 수 없습니다.\n복제한 수업 쪽에서 슬라이드를 한 번 편집(삭제·순서 바꾸기·이어 붙이기)하면 그 수업만의 슬라이드로 복사되고, 그다음부터 이 수업에서도 고칠 수 있습니다.";

// 그림이 다른 수업의 폴더에 있으면(예전에 「다른 반용으로 복제」해 그림을 함께 쓰는 수업) 고치기 전에 이 수업 폴더로 복사하고 주소(slide_dir)를 바꾼다.
// 원래 수업의 그림을 건드리면 안 되기 때문이다. 주인·공동작업자는 같은 수업 폴더를 그대로 고치므로 복사하지 않는다.
async function ownSlideHome(L, home, ui) {
  const folder = slideFolder(L);
  if (home.folder === folder) return home;
  const query = L.slide_dir.split("?")[1] || "";
  const small = /(^|&)sm=1(&|$)/.test(query);
  const names = fileNums(L).flatMap((n) => (small ? [n + ".jpg", n + "s.jpg"] : [n + ".jpg"])).concat(slidePdfs(L).map((p) => p.k + ".pdf"));
  const st = await newSlideStore();
  let done = 0, next = 0;
  const copy = async () => {
    while (next < names.length) {
      const name = names[next++];
      const r = await fetch(home.store.base + home.folder + name + (query ? "?" + query : ""));
      if (!r.ok) throw new Error(name + " 응답 " + r.status);
      await st.put(folder + name, await r.blob(), /\.pdf$/.test(name) ? "application/pdf" : "image/jpeg");
      slideWork(ui, "이 수업만의 슬라이드로 복사하는 중 " + ++done + " / " + names.length, done, names.length);
    }
  };
  slideWork(ui, "이 수업만의 슬라이드로 복사하는 중…", 0, names.length);
  await Promise.all(Array.from({ length: 4 }, copy));
  const dir = st.base + folder + "{n}.jpg" + (query ? "?" + query : "");
  const { error } = await sb.from("lessons").update({ slide_dir: dir }).eq("id", L.id);
  if (error) throw error;
  L.slide_dir = dir;
  return { store: st, folder };
}

// 이 수업 그림들의 저장소 파일 번호(n번째 그림 = 배열의 n-1번째). ord 가 없으면 1, 2, 3 …
const fileNums = (L) => slideFiles(L) || Array.from({ length: L.slide_count }, (_, i) => i + 1);
// 그림 주소의 물음표 뒤: v(바꾸면 브라우저가 그림을 새로 받음)·sm(작은 그림 있음)·anim(단계 수)·ord(파일 순서)·pdf(원본 PDF)·fx(전환 효과)
function slideDirOf(L, base, { v, small, anim, files, pdfs }) {
  const ord = files ? ordText(files) : "";
  const pdf = pdfs ? pdfText(pdfs) : "";
  return withFx(base + "?v=" + v + (small ? "&sm=1" : "") + (anim ? "&anim=" + anim : "") + (ord ? "&ord=" + ord : "") + (pdf ? "&pdf=" + pdf : ""), slideFx(L));
}
// list 에서 x(예전 번호)의 새 자리. 빠졌으면 그 뒤에 남은 것, 없으면 그 앞에 남은 것의 자리
function nearestKept(list, x, max) {
  for (let t = x; t <= max; t++) { const i = list.indexOf(t); if (i >= 0) return i + 1; }
  for (let t = x - 1; t >= 1; t--) { const i = list.indexOf(t); if (i >= 0) return i + 1; }
  return 1;
}

// 슬라이드 순서·지우기 저장(「저장하기」 한 번): pages 는 새 순서의 예전 그림 번호들(지운 그림은 빠짐).
// 그림 파일은 옮기지 않고 주소의 ord(그림 번호 → 파일 번호)만 고친 뒤 지운 그림 파일만 지운다. 이름이 그대로라 받아 둔 그림도 그대로 쓴다.
// 질문의 쪽 번호·지금 쪽·애니메이션 단계 수(anim)도 새 순서에 맞춘다. ord 가 주소 길이 한도(500자)를 넘으면 예전처럼 파일 이름을 1, 2, 3 … 으로 바꾼다.
// fix: 「번호 다시 맞추기」(저장이 중간에 멈춘 뒤 저장소에 남은 파일로 목록을 다시 만든다)
async function saveSlides(pages, ui, fix = false) {
  if (slideBusy) return;
  const home = slideHome(lesson);
  if (!home || isPptx(lesson) || (home.folder === slideFolder(lesson) && sharedSlides(lesson))) {
    alert(home && !isPptx(lesson) ? SHARED_NOTE : "이 수업의 슬라이드 위치를 알 수 없어서 고칠 수 없습니다.");
    slideOrder = null;
    return drawSettings();
  }
  const cut = fix ? 0 : lesson.slide_count - pages.length;
  if (cut && !confirm(cut + "장의 슬라이드를 지웁니다. 지운 슬라이드는 되돌릴 수 없습니다. 저장할까요?")) return;
  slideBusy = true;
  document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = true; });
  try {
    const { store: st, folder } = await ownSlideHome(lesson, home, ui);
    slideWork(ui, "슬라이드 목록을 확인하는 중…", 0, 1);
    const names = new Set(await st.list(folder));
    const files = fileNums(lesson);
    const count = files.length;
    const small = /[?&]sm=1/.test(lesson.slide_dir);
    const both = (f) => [folder + f + ".jpg", ...(names.has(f + "s.jpg") ? [folder + f + "s.jpg"] : [])];
    if (fix) {
      // 파일이 남은 그림만 지금 순서대로 두고, 목록에 없는 번호 파일(이어 붙이다 멈춘 것)과
      // 예전 방식 순서 저장이 남긴 임시 그림(m3.jpg)은 새 번호를 주어 맨 뒤에 붙인다
      pages = files.map((f, i) => (names.has(f + ".jpg") ? i + 1 : 0)).filter(Boolean);
      const nums = [...names].map((n) => /^(\d+)\.jpg$/.exec(n)).filter(Boolean).map((m) => +m[1]);
      const extra = nums.filter((n) => !files.includes(n)).sort((a, b) => a - b);
      let free = Math.max(0, ...nums, ...files, ...slidePdfs(lesson).map((p) => p.k + p.n - 1));
      const temps = [...names].map((n) => /^m(\d+)\.jpg$/.exec(n)).filter(Boolean).map((m) => m[1]);
      for (const t of temps) {
        const to = ++free;
        await Promise.all([st.move(folder + "m" + t + ".jpg", folder + to + ".jpg"), names.has("m" + t + "s.jpg") && st.move(folder + "m" + t + "s.jpg", folder + to + "s.jpg")]);
        if (names.has("m" + t + "s.jpg")) names.add(to + "s.jpg");
        extra.push(to);
      }
      for (const f of extra) { files.push(f); pages.push(files.length); }
    }
    // 슬라이드 번호(애니메이션 수업은 단계를 묶은 번호). 맨 뒤에 되살린 그림은 단계가 하나뿐인 슬라이드로 센다
    const steps = slideSteps(lesson);
    const oldTotal = slideTotal(lesson);
    const slideOf = (p) => (p <= count ? slideNo(lesson, p) : oldTotal + p - count);
    const slides = [...new Set(pages.map(slideOf))];
    const anim = steps ? slides.map((s) => Math.min(pages.filter((p) => slideOf(p) === s).length - 1, 35).toString(36)).join("") : "";
    const newSlide = (s) => (s == null ? s : nearestKept(slides, s, oldTotal));
    const keep = pages.map((p) => files[p - 1]);
    const gone = files.filter((f, i) => !pages.includes(i + 1) && names.has(f + ".jpg"));
    const base = lesson.slide_dir.split("?")[0];
    // 그림 이름을 그대로 두므로 v 도 그대로(학생·교사 화면이 받아 둔 그림을 다시 받지 않게)
    const v = (/[?&]v=(\d+)/.exec(lesson.slide_dir) || [])[1] || Date.now();
    // 원본 PDF: 남은 그림이 하나도 없는 PDF는 목록에서 빼고 파일도 지운다
    const pdfs = slidePdfs(lesson);
    const livePdfs = pdfs.filter(({ k, n }) => keep.some((f) => f >= k && f < k + n));
    let gonePdfs = pdfs.filter((p) => !livePdfs.includes(p));
    let dir = keep.length ? slideDirOf(lesson, base, { v, small: small && keep.every((f) => names.has(f + "s.jpg")), anim, files: keep, pdfs: livePdfs }) : "";
    let moved = 0, total = 0;
    if (dir.length > 500) {
      // 순서 목록이 너무 길면: 지울 그림을 먼저 지우고, 옮길 그림을 모두 임시 이름(m번호)으로 옮긴 뒤 1, 2, 3 … 으로 옮긴다
      if (gone.length) await st.remove(gone.flatMap(both));
      const moves = keep.map((f, i) => [f, i + 1]).filter(([f, to]) => f !== to);
      total = moves.length * 2;
      const run = async (list, from, to) => {
        const waiting = list.slice();
        await Promise.all(Array.from({ length: Math.min(4, waiting.length) }, async () => {
          while (waiting.length) {
            const [f, i] = waiting.shift();
            await Promise.all([st.move(folder + from(f, i) + ".jpg", folder + to(f, i) + ".jpg"), names.has(f + "s.jpg") && st.move(folder + from(f, i) + "s.jpg", folder + to(f, i) + "s.jpg")]);
            slideWork(ui, "슬라이드 순서를 저장하는 중 " + ++moved + " / " + total, moved, total);
          }
        }));
      };
      await run(moves, (f) => f, (f) => "m" + f);
      await run(moves, (f) => "m" + f, (f, i) => i);
      // 파일 번호가 바뀌어 원본 PDF와 짝이 맞지 않으므로 원본 PDF는 버린다(그 쪽들은 그림으로 받는다)
      dir = slideDirOf(lesson, base, { v: Date.now(), small: small && keep.every((f) => names.has(f + "s.jpg")), anim });
      gonePdfs = pdfs;
    }
    for (const a of activities) {
      if (a.page == null) continue;
      const page = Math.min(newSlide(a.page), Math.max(slides.length, 1));
      let to = a.page_to > a.page ? Math.min(newSlide(a.page_to), Math.max(slides.length, 1)) : a.page_to ?? null;
      if (to != null && to <= page) to = null;
      if (page === a.page && to === (a.page_to ?? null)) continue;
      const change = { page };
      if ("page_to" in a) change.page_to = to;
      const u = await sb.from("activities").update(change).eq("id", a.id);
      if (u.error) throw u.error;
      Object.assign(a, change);
    }
    activities = sortActivities(activities);
    // 「자료 추가」에 열어 둔 편집기의 표시 위치도 같이 옮긴다(저장됨 상태는 그대로)
    if (editing && editing.page != null && editing.page !== "") {
      const change = { page: newSlide(editing.page) };
      if (editing.page_to > editing.page) { const to = newSlide(editing.page_to); change.page_to = to > change.page ? to : null; }
      Object.assign(editing, change);
      rebase(editing, (base) => Object.assign(base, change));
    }
    const change = { slide_dir: dir, slide_count: keep.length, page: Math.min(nearestKept(pages, lesson.page, count), Math.max(keep.length, 1)) };
    const u = await sb.from("lessons").update(change).eq("id", lesson.id);
    if (u.error) throw u.error;
    // 지운 그림 파일은 주소를 바꾼 뒤에 지운다(지우다 멈추면 남은 파일은 「번호 다시 맞추기」가 맨 뒤에 되살린다)
    if (gone.length && !total) {
      slideWork(ui, gone.length + "장의 그림 파일을 지우는 중…", 0, 1);
      await st.remove(gone.flatMap(both));
    }
    if (gonePdfs.length) await st.remove(gonePdfs.map((p) => folder + p.k + ".pdf")).catch((e) => console.warn("원본 PDF 정리 실패", e));
    // 수업 전체를 다시 불러오면 화면이 통째로 깜빡이므로, 순서만 바꿨으면 이 수업의 값만 바꾸고 칸 번호를 고친다
    Object.assign(lesson, change);
    const same = lessons.find((l) => l.id === lesson.id);
    if (same && same !== lesson) Object.assign(same, change);
    slideOrder = null;
    slideBusy = false;
    selectedSlides.clear();
    slidePicking = false;
    flash(fix ? "슬라이드 번호를 맞췄습니다 (" + keep.length + "장)." : cut ? cut + "장을 지우고 슬라이드를 저장했습니다." : "슬라이드 순서를 저장했습니다.");
    if (fix || cut) await loadLessons(lesson.id);
    else {
      document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = false; });
      ui.saved(pages);
    }
  } catch (e) {
    slideBusy = false;
    document.querySelectorAll(".thumb button, .slide-tools button").forEach((b) => { b.disabled = false; });
    slideWork(ui, "멈췄습니다: " + (e.message || e) + " · 「번호 다시 맞추기」를 누르면 남은 그림으로 번호를 다시 맞춥니다.");
    ui.broke();
    alert(ui.status.textContent);
  }
}

// replace: 「기존 슬라이드 대체하기」(이어 붙이지 않고 지금 슬라이드를 모두 지운 뒤 새 파일로)
async function uploadSlides(files, progress, replace = false) {
  const L = lesson;   // 올리는 동안 다른 수업을 골라도 처음 수업에 저장
  if (files.some((f) => /\.ppt$/i.test(f.name))) throw new Error("예전 PowerPoint 형식(PPT)은 올릴 수 없습니다. PowerPoint에서 파일 → 다른 이름으로 저장 → PPTX로 저장해 올리세요.");
  const pptx = files.filter((f) => /\.pptx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  if (pptx.length) {
    if (pptx.length !== 1 || files.length !== 1) throw new Error("PPTX는 한 번에 하나만 올릴 수 있습니다.");
    if (replace) { if (!confirm(replaceNote(L))) return null; }
    else if (L.slide_count && !confirm("PPTX 파일은 이어 붙일 수 없어서 지금 슬라이드를 이 파일로 바꿉니다. 계속할까요?")) return null;
    return uploadPptx(pptx[0], progress, L);
  }
  // 그림 슬라이드가 이미 있으면 맨 뒤에 이어 붙인다. PPTX 자료(또는 위치를 모르는 자료)만 새 파일로 바꾼다
  const home = slideHome(L);
  const append = !replace && L.slide_count && !isPptx(L) && home;
  if (replace && L.slide_count && !confirm(replaceNote(L))) return null;
  if (!replace && L.slide_count && !append && !confirm("지금 자료에는 이어 붙일 수 없어서 슬라이드를 새 파일로 바꿉니다. 계속할까요?")) return null;
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
  const pdfs = await putSourcePdfs(store, folder, images, 0, progress);
  progress(images.length, images.length, "올리는 중");
  const dir = slideDirOf(L, store.base + folder + "{n}.jpg", { v: Date.now(), small: true, pdfs });
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: images.length, page: 1 }).eq("id", L.id);
  if (error) throw error;
  // 전보다 쪽 수가 줄었으면 남은 그림과 예전 원본 PPTX·PDF를 지운다
  const keepPdf = new Set(pdfs.map((p) => p.k + ".pdf"));
  await cleanSlideFolder(old, store, folder, (n) => { const m = /^(\d+)s?\.jpg$/.exec(n); return keepPdf.has(n) || (!!m && +m[1] <= images.length); });
  return images.length;
}

const replaceNote = (L) => "지금 슬라이드 " + slideTotal(L) + "장을 모두 지우고 새로 올린 슬라이드로 바꿉니다. 지운 슬라이드는 되돌릴 수 없습니다. 계속할까요?";

// 이어 붙이기: 새 그림을 지금 마지막 번호 다음부터 올린다(지금 쪽·질문 쪽 번호는 그대로).
// 복제해 온 그림(다른 수업 폴더)이면 지금 그림을 먼저 이 수업 폴더로 복사해 원래 수업은 건드리지 않는다.
async function appendSlides(L, home, images, progress) {
  const folder = slideFolder(L);
  const query = L.slide_dir.split("?")[1] || "";
  const small = /(^|&)sm=1(&|$)/.test(query);
  let st = home.store;
  if (home.folder !== folder) {
    st = await newSlideStore();
    const names = fileNums(L).flatMap((n) => (small ? [n + ".jpg", n + "s.jpg"] : [n + ".jpg"])).concat(slidePdfs(L).map((p) => p.k + ".pdf"));
    for (const [i, name] of names.entries()) {
      progress(i, names.length, "지금 슬라이드 복사하는 중");
      const r = await fetch(home.store.base + home.folder + name + (query ? "?" + query : ""));
      if (!r.ok) throw new Error(name + " 응답 " + r.status);
      await st.put(folder + name, await r.blob(), /\.pdf$/.test(name) ? "application/pdf" : "image/jpeg");
    }
  }
  // 새 그림은 지금 가장 큰 파일 번호 다음부터(순서를 바꾼 수업은 파일 번호가 쪽 번호와 다르다).
  // 원본 PDF가 맡은 번호(그 쪽 그림을 지웠어도)는 건너뛴다: 새 그림이 그 PDF의 쪽으로 잘못 짝지어지지 않게
  const files = fileNums(L), start = Math.max(0, ...files, ...slidePdfs(L).map((p) => p.k + p.n - 1));
  for (const [i, pair] of images.entries()) {
    progress(i, images.length, "올리는 중");
    await st.put(folder + (start + i + 1) + ".jpg", pair.big, "image/jpeg");
    await st.put(folder + (start + i + 1) + "s.jpg", pair.small, "image/jpeg");
    files.push(start + i + 1);
  }
  progress(images.length, images.length, "올리는 중");
  // 단계 그림 수업이면 새 그림은 단계가 하나뿐인 슬라이드("0")로 덧붙인다
  const steps = slideSteps(L);
  const anim = steps ? steps.map((n) => Math.min(n - 1, 35).toString(36)).join("") + "0".repeat(images.length) : "";
  const pdfs = slidePdfs(L).concat(await putSourcePdfs(st, folder, images, start, progress));
  const dir = slideDirOf(L, st.base + folder + "{n}.jpg", { v: Date.now(), small, anim, files, pdfs });
  const { error } = await sb.from("lessons").update({ slide_dir: dir, slide_count: files.length }).eq("id", L.id);
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
    const names = isPptx(src) ? ["deck.pptx"] : fileNums(src).flatMap((n) => /[?&]sm=1/.test(dir) ? [n + ".jpg", n + "s.jpg"] : [n + ".jpg"]).concat(slidePdfs(src).map((p) => p.k + ".pdf"));
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
