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
      // 접속 QR은 「접속 QR」 탭, 전체 응답 CSV는 「학생 관리」에 있다. 「전체 화면」 오른쪽 끝은 슬라이드 오른쪽 끝에 맞춘다(pinRun이 줄 너비도 슬라이드에 맞춤)
      hasSlides ? h("nav", { class: "pager" }, prev, where, next, h("span", { class: "spacer" }), deckBtn,
        h("button", { class: "ghost", type: "button", onclick() { if (stage.requestFullscreen) stage.requestFullscreen(); } }, "전체 화면")) : null,
      classBar()),
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
  const bar = left && left.querySelector(".class-bar");
  const fit = () => {
    if (!box.isConnected) return;
    if (!matchMedia("(min-width: 1100px)").matches) {
      box.classList.remove("pinned"); box.style.height = "";
      if (stage) stage.style.maxWidth = "";
      if (pager) pager.style.maxWidth = "";
      if (bar) bar.style.maxWidth = "";
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
      if (bar) bar.style.maxWidth = stage.style.maxWidth;
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
  paintStage(run, true);
  if (L.slide_count > 0) {
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
  drawRoster(shown.filter((a) => a.kind !== "sim"));
  run.panel.replaceChildren(...(shown.length ? shown.map(runBlock)
    : [h("p", { class: "card muted" }, sn + "쪽에는 활동이 없습니다. 「자료 추가」에서 추가하세요.")]));
  paintPresent();
}

// 무대(s: img·stage·simStage·simLayer)에 지금 쪽의 슬라이드·PPTX·시뮬레이션을 그린다. 「수업 진행」과 수업용 화면이 함께 쓴다
function paintStage(s, editable) {
  const L = lesson;
  if (L.slide_count > 0) {
    if (isPptx(L)) {
      const key = L.slide_dir + ":" + L.page;
      s.img.hidden = true;
      if (s.pptKey !== key) {
        s.stage.querySelector(".pptx-frame")?.remove();
        s.stage.insertBefore(pptxFrame(L, L.page), s.simStage);
        s.pptKey = key;
      }
    } else {
      s.stage.querySelector(".pptx-frame")?.remove();
      s.pptKey = "";
      s.img.hidden = false;
      const last = s.lastPage || L.page;
      swapSlide(s.img, slideSrc(L, L.page), slideFx(L), slideNo(L, last) === slideNo(L, L.page) ? (last === L.page ? 1 : 0) : Math.sign(L.page - last));
      s.lastPage = L.page;
      s.img.alt = "슬라이드 " + L.page;
    }
  }
  const sn = slideNo(L, L.page);
  // 「슬라이드 자리에 띄우기」 시뮬레이션: 교사 화면에서도 슬라이드 대신 띄운다(다시 그릴 때마다 새로 띄우지 않게 key로 확인)
  const stageSim = L.slide_count > 0 ? activities.find((a) => a.kind === "sim" && a.sim_full && onPage(a, sn)) || activities.find((a) => a.sim_full && allPagesSim(a)) || null : null;
  const simKey = stageSim ? stageSim.id + ":" + (stageSim.html || "").length + ":" + stageSim.title : "";
  if (!isPptx(L)) s.img.hidden = !!stageSim;
  const pptFrame = s.stage.querySelector(".pptx-frame");
  if (pptFrame) pptFrame.hidden = !!stageSim;
  s.simStage.hidden = !stageSim;
  if (simKey !== s.simKey) {
    s.simKey = simKey;
    // 교사 화면 것에는 촬영기를 넣어 둔다(수업용 화면이 그대로 비춘다, presentMirrorSync)
    s.simStage.replaceChildren(...(stageSim ? [simFrame(editable ? withSimAgent(stageSim.html) : stageSim.html, stageSim.title)] : []));
  }
  // 슬라이드 위에 얹는 시뮬레이션: 위쪽 막대를 끌어 옮기면 바로 저장되고 학생 화면에도 그 자리에 보인다
  const allOvers = L.slide_count > 0 && !isPptx(L) ? activities.filter(isOverSim) : [];
  const overs = stageSim ? [] : allOvers.filter((a) => simOnSlide(a, sn));
  syncSimLayer(s.simLayer, s.img);
  renderSimLayer(s.simLayer, overs, {
    all: allOvers, load: (a) => (editable ? withSimAgent(a.html) : a.html), ver: (a) => (a.html || "").length + ":" + a.title, editable, img: s.img,
    onMove: editable ? (a, p) => setActivity(a, { sim_place: p }) : null,
  });
}

// ---------- 수업용 화면(TV·빔 프로젝터에 띄우는 창) ----------
// 따로 연 창에 지금 슬라이드(애니메이션 단계·시뮬레이션 포함)만 검은 바탕에 가득 그리고, 어느 탭에 있든 0.3초마다 따라간다.
// 창 이름(cra-present)이 같아 늘 한 개만 생기고(교사 화면을 새로 고쳐도 같은 창을 다시 쓴다), 맨 위 가림막이 마우스를 모두 막는다.
// 시뮬레이션은 교사 화면에서 조작한 모습을 그대로 비춘다(presentMirrorSync). 교사 화면에 같은 시뮬레이션이 안 보일 때만 이 창이 직접 돌린다.
let present = null;
function openPresent() {
  if (present && !present.w.closed) { present.w.focus(); return; }
  const w = open("", "cra-present", "popup=yes,width=1280,height=720");
  if (!w) { alert("창을 열지 못했습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요."); return; }
  try { w.clearInterval(w.craTick); } catch (e) { /* 처음 여는 창 */ }
  const d = w.document;
  // 모양은 교사 창이 이미 읽은 규칙(app.css)을 그대로 옮겨 적는다(빈 창에서는 link로 불러오지 않아서)
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch (e) { return ""; } }).join("\n");
  d.open(); d.write("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>수업용 화면</title></head><body></body></html>"); d.close();
  const style = d.createElement("style");
  style.textContent = css;
  d.head.append(style);
  const img = h("img", { class: "slide", alt: "" });
  const simStage = h("div", { class: "sim-stage", hidden: true });
  const simLayer = h("div", { class: "sim-layer" });
  const stage = h("div", { class: "stage" }, img, simStage, simLayer);
  const note = h("p", { class: "present-note", hidden: true });
  d.body.className = "present-body";
  d.body.append(stage, note, h("div", { class: "present-shield", "aria-hidden": "true" }));
  d.addEventListener("contextmenu", (e) => e.preventDefault());
  // 창을 눌러 초점이 넘어가도 키보드 ← → 로는 교사 화면처럼 넘길 수 있다
  d.addEventListener("keydown", (e) => {
    if (!lesson) return;
    if (e.key === "ArrowRight") setPage(lesson.page + 1);
    if (e.key === "ArrowLeft") setPage(lesson.page - 1);
  });
  present = { w, img, stage, simStage, simLayer, note, simKey: "", pptKey: "" };
  // 비추개가 보내는 영상 연결 답을 교사 쪽 시뮬레이션에 넘긴다(같은 창을 다시 쓰면 바꿔 끼운다)
  w.onmessage = presentViewMessage;
  w.onpagehide = () => presentMirrorStop();
  img.addEventListener("load", paintPresent);
  w.craTick = w.setInterval(paintPresent, 300);   // 이 창의 타이머라서 교사 창이 가려져도 느려지지 않는다
  paintPresent();
  w.focus();
}
function paintPresent() {
  const p = present;
  if (!p || p.w.closed) return presentMirrorStop();
  const has = !!lesson && lesson.slide_count > 0;
  p.stage.hidden = !has;
  p.note.hidden = has;
  if (!has) { p.note.textContent = lesson ? "슬라이드가 없는 수업입니다." : "수업을 고르면 슬라이드가 나옵니다."; return; }
  paintStage(p, false);
  // 얹기 시뮬레이션 크기: 교사 창의 ResizeObserver는 다른 창의 칸을 보지 못하므로 여기서 맞춘다
  p.simLayer.querySelectorAll(":scope > .sim-over").forEach((b) => b.style.setProperty("--s", b.clientWidth / SIM_VIEW.w));
  presentMirrorSync(p);
}

// 수업용 화면의 시뮬레이션 비추기: 교사 화면의 시뮬레이션(촬영기 SIM_AGENT)이 바뀐 화면 구조와 캔버스를 보내면
// 수업용 화면의 같은 자리에 겹친 비추개(PRESENT_VIEW)에 넘긴다. 가장 큰 캔버스는 WebRTC 영상으로(같은 PC 안이라 중계 없이) 받는다.
// 첫 장면이 오면 수업용 화면이 직접 돌리던 것은 숨겨 멈추고, 교사 화면에서 그 시뮬레이션이 사라지면 다시 직접 돌린다.
const PRESENT_VIEW = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>(function(){
var w=0,h=0,cv={},vid=null,el=null,idx=-1,pc=null,P=parent;
function fit(){if(w&&h)document.documentElement.style.zoom=Math.min(innerWidth/w,innerHeight/h);}
function putVid(){if(!vid)return;var img=document.querySelector('img[data-cra-canvas="'+idx+'"]');if(!img)return;
if(!el){el=document.createElement("video");el.muted=true;el.autoplay=true;el.playsInline=true;el.srcObject=vid;}
el.className=img.className;el.setAttribute("style",(img.getAttribute("style")||"")+";object-fit:contain");img.replaceWith(el);el.play().catch(function(){});}
addEventListener("resize",fit);
addEventListener("message",function(e){var m=e.data||{};
if(m.craSim){if(m.head!=null){document.head.innerHTML=m.head;document.body.innerHTML=m.body;document.body.setAttribute("style",m.bs||"");putVid();}
for(var i in m.canvases)cv[i]=m.canvases[i];
for(var k in cv){var ims=document.querySelectorAll('img[data-cra-canvas="'+k+'"]');for(var j=0;j<ims.length;j++)if(ims[j].getAttribute("src")!==cv[k])ims[j].setAttribute("src",cv[k]);}
if(m.w&&m.h){w=m.w;h=m.h;fit();}
var se=document.scrollingElement;if(se){se.scrollTop=m.sy||0;se.scrollLeft=m.sx||0;}}
else if(m.craRtc==="offer"){if(pc)pc.close();vid=null;el=null;idx=m.idx;pc=new RTCPeerConnection();var me=pc;
pc.onicecandidate=function(ev){if(ev.candidate)P.postMessage({craView:"ice",candidate:ev.candidate.toJSON()},"*");};
pc.ontrack=function(ev){if(pc!==me)return;vid=ev.streams[0]||new MediaStream([ev.track]);putVid();P.postMessage({craView:"ok"},"*");};
pc.setRemoteDescription(m.sdp).then(function(){return me.createAnswer();}).then(function(a){return me.setLocalDescription(a);})
.then(function(){P.postMessage({craView:"answer",sdp:me.localDescription.toJSON()},"*");}).catch(function(){});}
else if(m.craRtc==="ice"&&pc&&m.candidate){pc.addIceCandidate(m.candidate).catch(function(){});}});})();<\/script></body></html>`;
const presentMirrors = new Map();   // 교사 쪽 시뮬레이션 iframe → { live: 수업용 화면이 직접 돌리는 iframe, view: 비추개, shown }
function presentPairs(p) {
  const pairs = new Map();
  if (!run) return pairs;
  const vis = (f) => f && f.isConnected && f.offsetWidth > 0;   // 교사 화면에서 다른 탭을 보는 중이면 0
  const tf = run.simStage.querySelector("iframe.sim-frame"), pf = p.simStage.querySelector("iframe.sim-frame:not(.sim-mirror)");
  if (vis(tf) && pf && !p.simStage.hidden && run.simKey === p.simKey) pairs.set(tf, pf);
  p.simLayer.querySelectorAll(":scope > .sim-over:not(.off)").forEach((box) => {
    const tb = run.simLayer.querySelector(':scope > .sim-over[data-sim="' + box.dataset.sim + '"]');
    const tf = tb && tb.querySelector("iframe.sim-frame"), pf = box.querySelector("iframe.sim-frame:not(.sim-mirror)");
    if (vis(tf) && pf && tb.dataset.ver === box.dataset.ver && !tb.classList.contains("off")) pairs.set(tf, pf);
  });
  return pairs;
}
function presentMirrorDrop(tf) {
  const x = presentMirrors.get(tf);
  if (!x) return;
  presentMirrors.delete(tf);
  tf.contentWindow?.postMessage({ craMirror: "stop" }, "*");
  x.view.remove();
  if (x.live.isConnected) {
    x.live.style.visibility = "";
    const box = x.live.closest(".sim-over");
    if (box) simOverPause(box); else x.live.contentWindow?.postMessage({ craPause: false }, "*");
  }
}
function presentMirrorStop() {
  for (const tf of [...presentMirrors.keys()]) presentMirrorDrop(tf);
}
function presentMirrorSync(p) {
  const pairs = presentPairs(p);
  for (const [tf, x] of presentMirrors) if (pairs.get(tf) !== x.live || !x.view.isConnected) presentMirrorDrop(tf);
  for (const [tf, live] of pairs) {
    const x = presentMirrors.get(tf);
    if (x) {
      // 수업용 화면 쪽 것은 계속 숨겨 멈춰 둔다(보이고 숨길 때 renderSimLayer가 다시 돌릴 수 있어서)
      if (x.shown) live.contentWindow?.postMessage({ craPause: true }, "*");
      continue;
    }
    const view = simFrame(PRESENT_VIEW, live.title);
    view.loading = "eager";
    view.classList.add("sim-mirror");
    view.style.visibility = "hidden";   // 첫 장면이 올 때까지는 직접 돌리는 것을 보인다
    live.after(view);
    presentMirrors.set(tf, { live, view, shown: false });
    view.addEventListener("load", () => {
      if (presentMirrors.get(tf)?.view !== view) return;
      tf.contentWindow?.postMessage({ craMirror: "start", every: 100, maxW: 1280, q: 0.8 }, "*");
      tf.contentWindow?.postMessage({ craRtc: "start", ice: [], relay: false }, "*");
    }, { once: true });
    tf.addEventListener("load", () => presentMirrorDrop(tf), { once: true });   // 교사 쪽을 새로 불러오면 처음부터 다시
  }
}
addEventListener("message", (e) => {
  const m = e.data || {};
  if (!m.craSim && !m.craRtc) return;
  for (const [tf, x] of presentMirrors) {
    if (tf.contentWindow !== e.source) continue;
    if (!present || present.w.closed) return presentMirrorStop();
    if (m.craSim) {
      if (m.w) x.view.contentWindow?.postMessage(m, "*");   // 크기 0(숨은 칸)인 장면은 버린다
      if (m.head != null && m.w && !x.shown) {
        x.shown = true;
        x.view.style.visibility = "";
        x.live.style.visibility = "hidden";
        x.live.contentWindow?.postMessage({ craPause: true }, "*");
      }
      tf.contentWindow?.postMessage({ craAck: 1 }, "*");
    } else x.view.contentWindow?.postMessage({ craRtc: m.craRtc, sdp: m.sdp, candidate: m.candidate, idx: m.idx }, "*");
    return;
  }
});
function presentViewMessage(e) {
  const m = e.data || {};
  if (!m.craView) return;
  for (const [tf, x] of presentMirrors) if (x.view.contentWindow === e.source) tf.contentWindow?.postMessage({ craRtc: m.craView, sdp: m.sdp, candidate: m.candidate }, "*");
}

addEventListener("resize", () => { if (run && run.simLayer) syncSimLayer(run.simLayer, run.img); });

// ---------- 수업 시작하기(중계 접속 발급) ----------
// 학생 화면 보기(크게 보기·일괄 미리보기)는 「수업 시작하기」를 누른 뒤 50분 동안만 된다. 누를 때 중계 서버(TURN) 접속 정보를
// 수업 시간만큼 한 장 받아 두고, 50분이 지나거나 「수업 끝내기」를 누르면 화면 보기를 닫고 접속 정보를 버린다(월 발급 한도를 아끼려고).
// 남은 시간이 30분 밑으로 내려가면 「시간 연장하기」로 50분을 더하고, 그때 끝나는 시각까지 쓸 접속 정보를 한 장 새로 받는다.
// 이 브라우저에 수업마다 남겨 두어(cra-class) 새로 고침해도 이어진다.
const CLASS_MS = 50 * 60 * 1000;
const EXTEND_MS = 50 * 60 * 1000;
const EXTEND_BELOW_MS = 30 * 60 * 1000;   // 남은 시간이 이보다 적어야 연장할 수 있다
let classTimer = null;
let classTick = null;
function classUntil() {
  try {
    const v = JSON.parse(localStorage.getItem("cra-class"));
    return v && lesson && v.lesson === lesson.id && v.until > Date.now() ? v.until : 0;
  } catch { return 0; }
}
const classOn = () => classUntil() > 0;
async function startClass() {
  try { localStorage.setItem("cra-class", JSON.stringify({ lesson: lesson.id, until: Date.now() + CLASS_MS })); } catch {}
  forgetIce();
  armClass();
  paintClass();
  const ice = await teacherIce();
  flash(hasTurn(ice) ? "수업을 시작했습니다. 50분 동안 학생 화면을 볼 수 있습니다." : "수업을 시작했습니다(중계 서버 없이 직접 연결만 씁니다).");
}
const canExtend = () => classOn() && classUntil() - Date.now() < EXTEND_BELOW_MS;
async function extendClass() {
  if (!canExtend()) return;
  const until = classUntil() + EXTEND_MS;
  try { localStorage.setItem("cra-class", JSON.stringify({ lesson: lesson.id, until })); } catch {}
  forgetIce();   // 새 끝나는 시각까지 쓸 접속 정보를 한 장 받는다(지금 보고 있는 화면은 그대로 이어짐)
  armClass();
  paintClass();
  await teacherIce();
  flash("수업 시간을 50분 늘렸습니다.");
}
function endClass(auto) {
  try { localStorage.removeItem("cra-class"); } catch {}
  forgetIce();
  armClass();
  if (grid) stopGrid();
  for (const w of new Set(screenWatchers.values())) w.close();
  paintClass();
  if (tab === "students") drawStudents();
  if (auto) flash("수업 시간이 끝나 학생 화면 보기를 닫았습니다.");
}
function forgetIce() {
  iceCache = null;
  try { sessionStorage.removeItem("cra-ice"); } catch {}
}
// 끝나는 시각에 저절로 끝내고, 남은 시간 글자는 20초마다 고친다
function armClass() {
  clearTimeout(classTimer);
  clearInterval(classTick);
  const until = classUntil();
  if (!until) return;
  classTimer = setTimeout(() => endClass(true), until - Date.now());
  classTick = setInterval(paintClass, 20000);
}
function classLeft() {
  const m = Math.max(0, Math.ceil((classUntil() - Date.now()) / 60000));
  return "수업 중 · " + m + "분 남음";
}
function classBar() {
  classBarEl = h("div", { class: "class-bar row" });
  paintClass(true);
  return classBarEl;
}
let classBarEl = null;
function paintClass(fresh) {
  if (!classBarEl || (!fresh && !classBarEl.isConnected)) return;
  const on = classOn();
  classBarEl.classList.toggle("on", on);
  const ext = canExtend();
  classBarEl.replaceChildren(on
    ? h("span", { class: "row class-now" }, h("span", { class: "class-left" }, h("span", { class: "presence on" }), " " + classLeft()),
      h("button", { class: "ghost class-extend", type: "button", disabled: !ext, onclick: extendClass,
        title: ext ? "수업 시간을 50분 늘립니다" : "남은 시간이 30분 밑으로 내려가면 늘릴 수 있습니다" }, "시간 연장하기(+50분)"))
    : h("span", { class: "muted small" }, "학생 화면 보기(크게 보기·일괄 미리보기)는 수업을 시작해야 쓸 수 있습니다."),
  on ? h("button", { class: "ghost", type: "button", onclick() { if (confirm("수업을 끝낼까요? 학생 화면 보기가 닫힙니다.")) endClass(false); } }, "수업 끝내기")
    : h("button", { class: "primary class-start", type: "button", onclick: startClass }, "수업 시작하기"));
}

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
  // 같은 학생이 여러 기기·탭으로 들어와 있으면 하나라도 전체 화면을 공유하지 않으면 「공유 안 함」
  const rank = { off: 4, no: 3, none: 2, on: 1 };
  for (const [k, metas] of Object.entries(screenChannel ? screenChannel.presenceState() : {})) {
    presence[k] = { away: metas.every((m) => m.away), multi: metas.some((m) => m.multi),
      desk: metas.map((m) => m.desk).filter(Boolean).sort((a, b) => (rank[b] || 0) - (rank[a] || 0))[0] || "" };
  }
  document.querySelectorAll(".presence[data-sid]").forEach((el) => {
    const s = students.find((x) => x.id === el.dataset.sid);
    if (s) setDot(el, presenceOf(s));
  });
  document.querySelectorAll(".desk-tag[data-sid]").forEach((el) => {
    const s = students.find((x) => x.id === el.dataset.sid);
    if (s) el.replaceWith(deskTag(s));
  });
  if (tab === "run" && run) refreshRun();
}

// 전체 화면 공유 상태(학생 화면이 Presence로 알림): on · off(PC인데 공유 안 함) · none(휴대폰·태블릿) · no(동의 안 함·철회) · ""(모름·접속 안 함)
function deskOf(s) {
  if (presenceOf(s) === "off") return { desk: "" };
  return presence[s.id] || presence[screenKey(s)] || { desk: "" };
}
const DESK_TAG = { on: ["ok", "화면 공유 중", "PC 화면 전체를 공유하고 있어 다른 창·앱도 보입니다"],
  off: ["bad", "공유 안 함", "PC인데 전체 화면을 공유하지 않아 수업 화면이 가려져 있습니다(학생이 공유해야 열림)"],
  none: ["info", "휴대폰·태블릿", "화면 공유가 없는 기기라 이 수업 화면만 보입니다(다른 앱은 보이지 않음)"],
  no: ["warn", "동의 안 함", "화면 보기에 동의하지 않았거나 철회해 화면을 볼 수 없습니다"] };
function deskTag(s) {
  const d = deskOf(s), t = DESK_TAG[d.desk];
  const el = h("span", { class: "desk-tag", "data-sid": s.id });
  if (t) el.append(h("span", { class: "tag " + t[0], title: t[2] }, t[1]));
  if (d.multi && d.desk === "on") el.append(" ", h("span", { class: "tag warn", title: "모니터가 여러 대입니다. 공유한 화면 하나만 보입니다" }, "모니터 2대+"));
  return el;
}

// 접속한 학생: 초록 = 수업 화면을 보고 있음, 주황 = 다른 앱·탭, ✓ = 이 쪽 활동에 답함
function rosterChips(shown, big) {
  const ids = new Set(shown.map((a) => a.id));
  return h("div", { class: "roster" + (big ? " big" : "") }, students.map((s) => {
    const st = presenceOf(s);
    const done = shown.length && responses.some((r) => r.student_id === s.id && ids.has(r.activity_id));
    const d = DESK_TAG[deskOf(s).desk];
    return h("span", { class: "chip" + (st === "on" ? " on" : st === "away" ? " away" : "") + (deskOf(s).desk === "off" ? " nodesk" : "") + (done ? " done" : ""),
      title: PRESENCE_TEXT[st] + (d ? " · " + d[1] : "") }, nameOf(s));
  }));
}

function drawRoster(shown) {
  const online = students.filter((s) => presenceOf(s) !== "off").length;
  run.roster.replaceChildren(
    h("div", { class: "row between" },
      h("h2", {}, "접속 중 " + online + "명", h("span", { class: "muted small" }, " · 입장 " + students.length + "명")),
      h("button", { class: "ghost", type: "button", onclick() { openModal("입장한 학생", rosterChips(shown, true)); } }, "크게 보기")),
    students.length ? rosterChips(shown) : h("p", { class: "muted small" }, "아직 입장한 학생이 없습니다."),
    students.length ? h("p", { class: "muted small" }, "초록: 수업 화면을 보고 있음 · 주황: 다른 앱·탭 · 빨간 테두리: PC인데 전체 화면 공유 안 함 · ✓: " + (lesson.slide_count ? "이 쪽" : "") + " 활동에 답함") : h("span", {}));
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

// 「접속 QR」 탭: 학생 접속 QR·수업 코드·주소를 화면에 크게(교실 TV에 띄우기 좋게)
function drawJoin() {
  const url = joinUrl(lesson);
  const qr = h("div", { class: "qr" });
  main.replaceChildren(h("section", { class: "card join join-page" }, qr,
    h("div", { class: "stack" },
      h("h2", {}, "학생 접속"),
      h("p", { class: "join-code" }, "수업 코드 ", h("strong", {}, lesson.code)),
      h("p", { class: "join-url" }, url),
      h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick(e) { navigator.clipboard.writeText(url).then(() => { e.target.textContent = "복사했습니다"; }); } }, "주소 복사"),
        h("a", { class: "ghost btn-link", href: url, target: "_blank", rel: "noopener" }, "학생 화면 열기")))));
  if (window.QRCode) new QRCode(qr, { text: url, width: 480, height: 480 });
  else qr.textContent = "QR을 만들지 못했습니다(인터넷 연결 확인).";
}
