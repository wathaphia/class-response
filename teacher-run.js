// 교사 화면 · 「수업 진행」 탭: 슬라이드 넘기기·TV 화면, 제출 현황, 실시간 접속 표시(Presence).

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
      // 접속 QR은 머리말 수업 코드 옆, 전체 응답 CSV는 「학생 관리」에 있다. 「전체 화면」 오른쪽 끝은 슬라이드 오른쪽 끝에 맞춘다(pinRun이 줄 너비도 슬라이드에 맞춤)
      hasSlides ? h("nav", { class: "pager" }, prev, where, next, h("span", { class: "spacer" }), deckBtn,
        h("button", { class: "ghost", type: "button", onclick() { if (stage.requestFullscreen) stage.requestFullscreen(); } }, "전체 화면")) : null,
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
  const pager = left && left.querySelector(".pager");
  const fit = () => {
    if (!box.isConnected) return;
    if (!matchMedia("(min-width: 1100px)").matches) {
      box.classList.remove("pinned"); box.style.height = "";
      if (stage) stage.style.maxWidth = "";
      if (pager) pager.style.maxWidth = "";
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
      if (pager) pager.style.maxWidth = stage.style.maxWidth;
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
  const allOvers = L.slide_count > 0 && !isPptx(L) ? activities.filter(isOverSim) : [];
  const overs = stageSim ? [] : allOvers.filter((a) => simOnSlide(a, sn));
  syncSimLayer(run.simLayer, run.img);
  renderSimLayer(run.simLayer, overs, {
    all: allOvers, load: (a) => a.html, ver: (a) => (a.html || "").length + ":" + a.title, editable: true,
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
