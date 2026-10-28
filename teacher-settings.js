// 교사 화면 · 「슬라이드 편집」 탭: 새 수업 만들기·복제·지우기, 슬라이드 올리기(PPTX/PDF → 그림), 슬라이드 저장소(R2 / Supabase), CSV 내보내기.

// ---------- 슬라이드 편집 ----------
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
    // 제목 고치기·학생 접속 주소는 위쪽 머리(제목 칸·「접속 QR」)에 있으므로 이 칸은 새로 만들 때만 보인다
    lesson ? null : h("form", { class: "card stack", onsubmit: submit },
      h("h2", {}, "새로 만들기"),
      kindPick,
      h("p", { class: "muted small" }, "수업 코드는 겹치지 않게 자동으로 만들어집니다."),
      h("label", {}, "제목", title),
      msg,
      h("button", { class: "primary big", type: "submit" }, "수업 만들기")),
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
