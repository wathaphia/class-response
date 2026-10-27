// 학생 화면과 교사 화면이 함께 쓰는 것들

// http:// 로 열렸으면 https:// 로 다시 연다(내 PC에서 시험할 때는 그대로)
if (location.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) location.replace("https:" + location.href.slice(5));

// 주소 끝에 /rest/v1/ 같은 꼬리나 빈칸이 붙어 있어도 프로젝트 주소만 쓴다
const SB_URL = String(SUPABASE_URL).trim().replace(/\/(rest|auth|storage)\/v1.*$/, "").replace(/\/+$/, "");
const configured = (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SB_URL) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SB_URL))
  && !/여기에/.test(SUPABASE_KEY) && String(SUPABASE_KEY).trim() !== "";
const sb = configured ? supabase.createClient(SB_URL, String(SUPABASE_KEY).trim()) : null;

// 만든 사람 표시. 고쳐 쓰거나 나눌 때도 지우지 말아 주세요(LICENSE.md).
const CREDIT = { name: "이효송", year: 2026 };

const KIND_NAME = { slide: "슬라이드 질문", survey: "설문", quiz: "퀴즈", sim: "시뮬레이션" };
const TYPE_NAME = { choice: "하나 고르기", multi: "여러 개 고르기", short: "짧은 글", long: "긴 글" };

// 화면 요소 만들기. 학생이 쓴 글은 늘 글자(텍스트)로만 넣는다(innerHTML을 쓰지 않음).
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// 슬라이드 그림 주소. 보통은 "폴더/1.png". 폴더 칸에 {n}을 넣으면 그 자리에 쪽 번호가 들어간다
// (예: "slides/슬라이드{n}.PNG" → PowerPoint가 내보낸 이름을 그대로 쓸 때).
// 활동이 이 쪽에 보이는지. page부터 page_to까지(page_to가 없으면 page 한 쪽)
function onPage(a, n) {
  return a.page != null && a.page <= n && n <= Math.max(a.page_to ?? a.page, a.page);
}

// 애니메이션 단계 그림(class-publish.ps1 로 올림): slide_dir 끝의 anim=0213 은 슬라이드마다 클릭 수(36진수 한 글자)다.
// 슬라이드 하나가 (클릭 수 + 1)장의 그림이 되므로 lesson.page 는 그림 번호이고, 활동의 쪽 번호는 슬라이드 번호다.
function slideSteps(lesson) {
  const m = /[?&]anim=([0-9a-z]+)/.exec(lesson.slide_dir || "");
  return m ? [...m[1]].map((c) => parseInt(c, 36) + 1) : null;
}
// 그림 번호 → { slide: 슬라이드 번호, step: 그 슬라이드에서 몇 번째 단계, steps: 단계 수, total: 슬라이드 수 }
function slidePos(lesson, page) {
  const steps = slideSteps(lesson);
  if (!steps) return { slide: page, step: 1, steps: 1, total: lesson.slide_count };
  let first = 1;
  for (const [i, n] of steps.entries()) {
    if (page < first + n || i === steps.length - 1) return { slide: i + 1, step: Math.min(page - first + 1, n), steps: n, total: steps.length };
    first += n;
  }
}
const slideNo = (lesson, page) => slidePos(lesson, page).slide;
const slideTotal = (lesson) => slidePos(lesson, 1).total;
// 슬라이드 번호 → 그 슬라이드의 첫 그림 번호
function pageOfSlide(lesson, slide) {
  const steps = slideSteps(lesson);
  return steps ? steps.slice(0, slide - 1).reduce((a, b) => a + b, 1) : slide;
}
function slideLabel(lesson, page) {
  const p = slidePos(lesson, page);
  return p.slide + " / " + p.total + (p.steps > 1 ? " · 애니메이션 " + p.step + "/" + p.steps : "");
}
// 실시간 화면 신호에서 학생을 알아보는 이름(학생 id를 모를 때 씀)
const screenKey = (s) => "k:" + s.class_no + ":" + s.name;
const screenChannelName = (code) => (code ? "class-screen:" + String(code).trim().toUpperCase() : "");

// 슬라이드 전환 효과: slide_dir 끝의 fx=… (없으면 페이드)
const SLIDE_FX = { fade: "페이드", push: "밀어내기", zoom: "확대", none: "없음" };
function slideFx(lesson) {
  const m = /[?&]fx=(\w+)/.exec(lesson.slide_dir || "");
  return m && SLIDE_FX[m[1]] ? m[1] : "fade";
}
function withFx(dir, fx) {
  const base = dir.replace(/([?&])fx=\w+&?/, "$1").replace(/[?&]$/, "");
  return fx === "fade" || !base ? base : base + (base.includes("?") ? "&" : "?") + "fx=" + fx;
}
// 슬라이드 그림을 바꾸며 전환 효과를 준다. dir: 1 앞으로, -1 뒤로, 0 같은 슬라이드 안의 애니메이션 단계
// 새 그림을 먼저 받아 둔 뒤 바꿔서, 효과 도중에 예전 그림이 비치지 않게 한다.
function swapSlide(img, src, fx, dir) {
  if (img.dataset.want === src || (!img.dataset.want && img.getAttribute("src") === src)) return;
  img.dataset.want = src;
  const show = () => {
    if (img.dataset.want !== src) return;
    const prev = img.getAttribute("src");
    const cls = dir === 0 ? "fx-step" : fx === "none" ? "" : fx === "push" ? (dir > 0 ? "fx-push-next" : "fx-push-prev") : "fx-" + fx;
    // 이전 장면을 바로 아래에 남겨 두고 새 장면이 그 위로 들어오게 한다(효과 도중 흰 바탕이 비쳐 깜빡이지 않게)
    if (prev && cls && img.parentNode && img.offsetWidth) {
      const box = img.parentNode;
      if (getComputedStyle(box).position === "static") box.style.position = "relative";
      box.querySelectorAll(":scope > .slide-under").forEach((u) => u.remove());
      const under = h("img", { class: "slide slide-under", src: prev, alt: "", "aria-hidden": "true" });
      under.style.cssText = "left:" + img.offsetLeft + "px;top:" + img.offsetTop + "px;width:" + img.offsetWidth + "px;height:" + img.offsetHeight + "px";
      box.insertBefore(under, img);
      const drop = () => under.remove();
      img.addEventListener("animationend", drop, { once: true });
      setTimeout(drop, 1000);
    }
    img.classList.remove("fx-step", "fx-fade", "fx-zoom", "fx-push-next", "fx-push-prev");
    img.src = src;
    if (cls) { void img.offsetWidth; img.classList.add(cls); }
  };
  if (!img.getAttribute("src")) return show();
  const pre = new Image();
  pre.src = src;
  (pre.decode ? pre.decode() : Promise.resolve()).catch(() => {}).then(show);
}

// 단계 그림과 함께 올린 원본 PPTX(같은 폴더의 deck.pptx) 주소
function deckUrl(lesson) {
  return /[?&]deck=1/.test(lesson.slide_dir || "") ? lesson.slide_dir.split("?")[0].replace(/\{n\}\.jpg$/, "deck.pptx") : null;
}

// WebRTC 연결 주소 후보. 학교망처럼 직접 연결이 막힌 곳을 위해 config.js 의 TURN_URL(Cloudflare Worker)에서
// 중계 서버(TURN) 접속 정보를 받는다(로그인한 교사나 수업에 들어온 학생만 받을 수 있음). 없거나 실패하면 무료 STUN만 쓴다.
const STUN_ONLY = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
let iceCache = null;
async function iceServers(auth) {
  const url = typeof TURN_URL === "string" ? TURN_URL.trim() : "";
  if (!url) return STUN_ONLY;
  if (iceCache && iceCache.until > Date.now()) return iceCache.list;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(auth.headers || {}) }, body: JSON.stringify(auth.body || {}) });
    if (!r.ok) throw new Error("turn " + r.status);
    const d = await r.json();
    const list = d.iceServers ? [].concat(d.iceServers) : STUN_ONLY;
    iceCache = { list, until: Date.now() + 50 * 60 * 1000 };   // 접속 정보는 1시간짜리라 50분 동안 다시 쓴다
    return list;
  } catch {
    return STUN_ONLY;
  }
}

// 시뮬레이션 화면 촬영기: 학생 화면의 시뮬레이션 안에 넣는다. 부모(학생 화면)가 start 를 보내면
// 바뀐 화면 구조(head·body)와 캔버스 그림(JPEG)만 보내고, 부모가 다 보냈다고 답(ack)해야 다음 장면을 찍는다.
// 밀린 장면이 쌓이지 않아 지연이 늘지 않는다(최신 장면만 보냄).
const SIM_AGENT = `<script>(function(){if(window.__craAgent)return;window.__craAgent=1;
var on=false,busy=false,last={},lastKey="",maxW=640,q=0.6,timer=0,pc=null,vidIdx=-1,vidOk=false;
function bigCanvas(){var cs=document.querySelectorAll("canvas"),b=-1,a=0;for(var i=0;i<cs.length;i++){var r=cs[i].getBoundingClientRect(),s=r.width*r.height;if(s>a){a=s;b=i;}}return b;}
function rtcStop(){vidOk=false;if(pc){try{pc.close();}catch(e){}pc=null;}}
function rtcStart(ice){rtcStop();vidIdx=bigCanvas();var c=document.querySelectorAll("canvas")[vidIdx];if(!c||!c.captureStream||!window.RTCPeerConnection)return;
try{var st=c.captureStream(30);pc=new RTCPeerConnection({iceServers:ice&&ice.length?ice:[{urls:"stun:stun.cloudflare.com:3478"},{urls:"stun:stun.l.google.com:19302"}]});
st.getTracks().forEach(function(t){pc.addTrack(t,st);});
pc.onicecandidate=function(e){if(e.candidate)parent.postMessage({craRtc:"ice",candidate:e.candidate.toJSON()},"*");};
pc.createOffer().then(function(o){return pc.setLocalDescription(o);}).then(function(){
pc.getSenders().forEach(function(s){var p=s.getParameters();if(!p.encodings||!p.encodings.length)p.encodings=[{}];p.encodings[0].maxBitrate=1000000;p.encodings[0].maxFramerate=30;s.setParameters(p).catch(function(){});});
parent.postMessage({craRtc:"offer",sdp:pc.localDescription.toJSON(),idx:vidIdx},"*");}).catch(function(){});}catch(e){rtcStop();}}
function snap(){var d=document,canv=d.querySelectorAll("canvas"),data={},root=d.documentElement.cloneNode(true),cc=root.querySelectorAll("canvas");
for(var i=0;i<canv.length;i++){var c=canv[i],url="";
if(!(vidOk&&i===vidIdx))try{var s=Math.min(1,maxW/(c.width||1)),t=d.createElement("canvas");t.width=Math.max(1,Math.round(c.width*s));t.height=Math.max(1,Math.round(c.height*s));var x=t.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,t.width,t.height);x.drawImage(c,0,0,t.width,t.height);url=t.toDataURL("image/jpeg",q);}catch(e){}
if(url&&url!==last[i]){data[i]=url;last[i]=url;}
var r=c.getBoundingClientRect(),img=d.createElement("img");img.setAttribute("data-cra-canvas",String(i));img.className=c.className;
img.setAttribute("style",(c.getAttribute("style")||"")+";width:"+r.width+"px;height:"+r.height+"px;");cc[i].parentNode.replaceChild(img,cc[i]);}
var fi=d.querySelectorAll("input,textarea,select"),ti=root.querySelectorAll("input,textarea,select");
for(var j=0;j<fi.length&&j<ti.length;j++){var a=fi[j],b=ti[j];
if(a.type==="checkbox"||a.type==="radio"){if(a.checked)b.setAttribute("checked","");else b.removeAttribute("checked");}
else if(a.tagName==="TEXTAREA")b.textContent=a.value;
else if(a.tagName==="SELECT"){for(var k=0;k<b.options.length;k++){if(k===a.selectedIndex)b.options[k].setAttribute("selected","");else b.options[k].removeAttribute("selected");}}
else if(a.type!=="password")b.setAttribute("value",a.value);}
var sc=root.querySelectorAll("script");for(var m=0;m<sc.length;m++)sc[m].parentNode.removeChild(sc[m]);
var head=root.querySelector("head"),body=root.querySelector("body"),hh=head?head.innerHTML:"",bh=body?body.innerHTML:"",bs=body?(body.getAttribute("style")||""):"";
var msg={craSim:1,canvases:data,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,t:Date.now()},key=hh+"|#|"+bh+"|#|"+bs;
if(key!==lastKey){msg.head=hh;msg.body=bh;msg.bs=bs;lastKey=key;}return msg;}
function tick(){if(!on||busy)return;busy=true;var m;try{m=snap();}catch(e){busy=false;return;}parent.postMessage(m,"*");}
addEventListener("message",function(e){var m=e.data||{};if(e.source!==parent)return;
if(m.craMirror==="start"){on=true;busy=false;last={};lastKey="";if(m.maxW)maxW=m.maxW;if(m.q)q=m.q;clearInterval(timer);timer=setInterval(tick,m.every||200);tick();}
else if(m.craMirror==="stop"){on=false;clearInterval(timer);rtcStop();}
else if(m.craRtc==="start"){rtcStart(m.ice);}
else if(m.craRtc==="answer"&&pc){pc.setRemoteDescription(m.sdp).catch(function(){});}
else if(m.craRtc==="ice"&&pc&&m.candidate){pc.addIceCandidate(m.candidate).catch(function(){});}
else if(m.craRtc==="ok"){vidOk=true;}
else if(m.craRtc==="fail"){vidOk=false;last={};}
else if(m.craAck){busy=false;if(m.maxW)maxW=m.maxW;if(m.q)q=m.q;if(m.resend){last={};lastKey="";}}});})();<\/script>`;
function withSimAgent(html) {
  if (!html || html.includes("__craAgent")) return html;
  const doctype = /^\s*<!doctype[^>]*>/i;
  return doctype.test(html) ? html.replace(doctype, (m) => m + SIM_AGENT) : SIM_AGENT + html;
}

// 시뮬레이션(html) 칸. sandbox 로 격리해서 이 웹앱의 로그인 정보나 저장소에 손대지 못하게 한다.
function simFrame(html, title) {
  const f = h("iframe", { class: "sim-frame", title: title || "시뮬레이션", loading: "lazy" });
  f.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads");
  if (html != null) f.srcdoc = html;
  return f;
}

// 수업 화면 위에 떠 있는 시뮬레이션 창. iframe을 재사용해 조작 상태를 보존한다.
let floatingSim = null;
function showFloatingSim(title, html, key) {
  if (floatingSim && floatingSim.dataset.key === key) return floatingSim;
  closeFloatingSim();
  const frame = simFrame(html, title);
  const head = h("div", { class: "sim-float-head" },
    h("strong", {}, title || "시뮬레이션"),
    h("div", { class: "row" },
      h("button", { class: "ghost", type: "button", "aria-label": "시뮬레이션 크게 보기", onclick() { openSimFull(title, frame.srcdoc); } }, "크게"),
      h("button", { class: "ghost", type: "button", "aria-label": "시뮬레이션 닫기", onclick: closeFloatingSim }, "닫기")));
  const box = h("section", { class: "sim-float", "aria-label": "실시간 시뮬레이션" }, head, frame);
  box.dataset.key = key;
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = box.getBoundingClientRect();
    drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    box.style.left = Math.max(0, Math.min(innerWidth - box.offsetWidth, e.clientX - drag.x)) + "px";
    box.style.top = Math.max(0, Math.min(innerHeight - 80, e.clientY - drag.y)) + "px";
    box.style.right = "auto";
    box.style.bottom = "auto";
  });
  head.addEventListener("pointerup", () => { drag = null; });
  document.body.append(box);
  floatingSim = box;
  return box;
}

function closeFloatingSim() {
  if (floatingSim) floatingSim.remove();
  floatingSim = null;
}

// 시뮬레이션을 화면 가득 띄운다. 닫기 버튼이나 Esc로 닫는다.
function openSimFull(title, html) {
  const close = () => { box.remove(); document.removeEventListener("keydown", esc); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const box = h("div", { class: "sim-full" },
    h("div", { class: "sim-full-head" }, h("strong", {}, title || "시뮬레이션"), h("button", { class: "ghost", type: "button", onclick: close }, "닫기")),
    simFrame(html, title));
  document.addEventListener("keydown", esc);
  document.body.append(box);
  if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
}

function slideSrc(lesson, n) {
  const dir = lesson.slide_dir.trim();
  return encodeURI(dir.includes("{n}") ? dir.split("{n}").join(n) : dir.replace(/\/+$/, "") + "/" + n + ".png");
}

function isPptx(lesson) { return (lesson.slide_dir || "").startsWith("pptx:"); }
function pptxUrl(lesson, page) {
  const src = lesson.slide_dir.slice(5).split("?")[0];
  return "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(src) + "&wdSlideIndex=" + page;
}
function pptxFrame(lesson, page) {
  return h("iframe", { class: "pptx-frame", title: "PowerPoint 슬라이드 " + page, src: pptxUrl(lesson, page), allowfullscreen: true, loading: "lazy" });
}
function openPptxFull(lesson, page) {
  const close = () => { box.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const box = h("div", { class: "sim-full" },
    h("div", { class: "sim-full-head" }, h("strong", {}, "PowerPoint · " + page + " / " + lesson.slide_count), h("button", { class: "ghost", type: "button", onclick: close }, "닫기")),
    pptxFrame(lesson, page));
  document.addEventListener("keydown", esc);
  document.body.append(box);
}

function fmtTime(t) {
  if (!t) return "—";
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return (today ? "" : (d.getMonth() + 1) + "/" + d.getDate() + " ") +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// 응답 하나를 글로: 여러 개 고르기는 쉼표로 잇는다
function answerText(v) {
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

function isEmptyAnswer(v) {
  return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
}

// 설명문은 텍스트로 표시하고, 웹 주소만 안전한 링크로 바꾼다.
function linkedDescription(value) {
  const box = h("p", { class: "question-description" });
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  const source = String(value || "");
  let from = 0;
  for (const match of source.matchAll(urlPattern)) {
    const raw = match[0];
    const urlText = raw.replace(/[.,!?;:)\]]+$/, "");
    box.append(document.createTextNode(source.slice(from, match.index)));
    try {
      const url = new URL(urlText);
      if (url.protocol === "http:" || url.protocol === "https:") {
        box.append(h("a", { href: url.href, target: "_blank", rel: "noopener noreferrer" }, urlText));
      } else box.append(document.createTextNode(urlText));
    } catch (_) { box.append(document.createTextNode(urlText)); }
    from = match.index + urlText.length;
  }
  box.append(document.createTextNode(source.slice(from)));
  return box;
}

function activityDescription(activity) {
  const questions = activity.questions || [];
  return questions.find((q) => q.intro)?.intro ||
    [...new Set(questions.map((q) => q.description).filter(Boolean))].join("\n\n");
}

function isInfoActivity(activity) {
  return activity.kind === "survey" && activity.questions?.length === 1 && activity.questions[0].type === "info";
}

function activityName(activity) {
  return isInfoActivity(activity) ? "설명 카드" : KIND_NAME[activity.kind];
}

// 응답 모아 보기: 고르는 질문은 막대, 글은 목록. docs = [{ name, answers }]
function summaryView(questions, docs, opts) {
  opts = opts || {};
  return questions.map((q, i) => {
    const answered = docs.filter((d) => !isEmptyAnswer(d.answers[q.id]));
    const head = h("p", { class: "sum-q" }, (i + 1) + ". " + q.text);
    if (q.type === "choice" || q.type === "multi") {
      return h("div", { class: "sum-block" }, head, q.options.map((o) => {
        const n = answered.filter((d) => [].concat(d.answers[q.id]).includes(o)).length;
        const pct = answered.length ? Math.round((n / answered.length) * 100) : 0;
        const right = q.answer != null && [].concat(q.answer).includes(o);
        return h("div", { class: "bar-row" },
          h("span", { class: "bar-label" }, o, right ? h("strong", { class: "right-mark" }, " ✓정답") : null),
          h("span", { class: "bar-track" }, h("span", { class: "bar", style: "width:" + pct + "%" })),
          h("span", { class: "bar-value" }, n + "명"));
      }));
    }
    return h("div", { class: "sum-block" }, head,
      answered.length ? answered.map((d) => h("p", { class: "note" }, d.name ? h("strong", {}, d.name + " · ") : null, answerText(d.answers[q.id])))
        : h("p", { class: "muted small" }, opts.empty || "아직 응답이 없습니다."));
  });
}

function openModal(title, body, onClose) {
  const close = () => { box.remove(); if (onClose) onClose(); };
  const box = h("div", { class: "overlay", onclick(e) { if (e.target === box) close(); } },
    h("div", { class: "modal" },
      h("div", { class: "modal-head" }, h("h2", {}, title), h("button", { class: "ghost", type: "button", onclick: close }, "닫기")),
      h("div", { class: "modal-body" }, body)));
  document.body.append(box);
  return close;
}

function notConfigured(app) {
  app.replaceChildren(h("main", { class: "narrow" }, h("section", { class: "card" },
    h("h1", {}, "아직 연결되지 않았습니다"),
    h("p", {}, "config.js 파일에 Supabase 주소(SUPABASE_URL)와 publishable 키(SUPABASE_KEY)를 넣어 주세요. 방법은 README.md에 있습니다."),
    h("p", { class: "muted small" }, "지금 읽은 주소: " + SUPABASE_URL),
    h("p", { class: "muted small" }, "주소는 https://(영문 소문자·숫자).supabase.co 모양이어야 합니다. 고친 뒤 GitHub에 다시 올렸다면 1~2분 뒤 Ctrl+F5로 새로고침하세요."))));
}

// 모든 화면 맨 아래에 만든 사람과 이용 조건을 보인다
document.addEventListener("DOMContentLoaded", () => {
  document.body.append(h("footer", { class: "credit" },
    "수업 응답 웹앱 · 만든 사람 ", h("strong", {}, CREDIT.name), " · © " + CREDIT.year + " · ",
    h("a", { href: "https://creativecommons.org/licenses/by-nc/4.0/deed.ko", target: "_blank", rel: "noopener noreferrer" }, "CC BY-NC 4.0"),
    " · 출처를 밝히면 수업에 자유롭게 쓰고 고칠 수 있습니다(판매 금지)"));
});
