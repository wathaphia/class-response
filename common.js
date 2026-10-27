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
    img.classList.remove("fx-step", "fx-fade", "fx-zoom", "fx-push-next", "fx-push-prev");
    img.src = src;
    const cls = dir === 0 ? "fx-step" : fx === "none" ? "" : fx === "push" ? (dir > 0 ? "fx-push-next" : "fx-push-prev") : "fx-" + fx;
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
