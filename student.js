// 학생 화면: 입장(수업 코드 + 이름) → 슬라이드를 따라가며 질문에 답한다.
// 서버에서 수업 상태를 받아 온다(교사가 넘긴 쪽, 제출 열림, 공개된 응답). 교사가 무엇을 바꾸면 수업 채널의 「nudge」 신호로
// 바로 받고, 신호를 못 받을 때를 위해 10초마다(채널이 끊기면 3초마다) 묻는다. 바뀐 것이 없으면 서버는 {same:true}만 보낸다.

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const POLL_MS = 3000;
const POLL_LIVE_MS = 10000;   // 수업 채널(nudge)이 이어져 있을 때
// 학생 계정은 웹앱 전체에 하나. 한 번 입장한 기기는 열쇠(token)를 기억해서, 새 수업 코드만 넣으면 바로 들어간다.
const TOKEN_KEY = "cra-token";
const ME_KEY = "cra-me";
const keep = loginStore("student");   // 열쇠·이름: 「자동 로그인」을 고른 기기만 다음에도 기억(common.js)

let code = "";          // 수업 코드
let token = null;       // 입장 열쇠(이 기기에 저장)
let state = null;       // 서버에서 받은 수업 상태
let stateV = null;      // 그 상태의 지문(서버가 같으면 다시 보내지 않음)
let liveOk = false;     // 수업 채널에 붙어 있는지
let viewing = 1;        // 학생이 보고 있는 쪽
let following = true;   // 교사가 띄운 쪽을 따라가는 중인지
let timer = null;
let pollSeq = 0;   // 늦게 온 예전 응답(다른 수업 코드·로그아웃 뒤)을 버리려고 부를 때마다 하나씩 올린다
// 사생활 보호 모드·저장 공간 꽉 참이면 localStorage 가 예외를 던진다: 저장 못 해도 수업은 계속
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let shell = null;
const cards = new Map(); // 활동 id → 화면 카드

if (!sb) notConfigured(app);
else start();

function start() {
  code = (params.get("c") || ls.get("cra-last-code") || "").trim();
  // 예전 판은 수업마다 열쇠를 따로 저장했다: 있으면 그대로 옮겨 쓴다
  token = keep.getItem(TOKEN_KEY) || (code ? keep.getItem("cra-token:" + code.toLowerCase()) : null);
  if (token) keep.setItem(TOKEN_KEY, token);
  if (token && code) poll();
  else if (token) showCodeOnly();
  else showEntry();
}

function enterLesson(newCode) {
  code = newCode.trim();
  ls.set("cra-last-code", code);
  state = null;
  following = true;
  poll();
}

// 이미 입장한 기기: 수업 코드만 넣으면 된다
function closeZoom() {
  document.querySelectorAll(".slide-zoom").forEach((x) => x.remove());
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function showCodeOnly(notice) {
  leaveScreenShare();
  stopPolling();
  closeZoom();
  shell = null;
  cards.clear();
  const me = keep.getItem(ME_KEY) || "";
  const codeIn = h("input", { type: "text", value: params.get("c") ? "" : code, autocomplete: "off", maxlength: 20, placeholder: "예: K7P2Q", autocapitalize: "characters", required: true });
  const msg = h("p", { class: "msg" }, notice || "");
  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" }, h("p", { class: "eyebrow" }, me ? me + " 학생" : "수업 응답"), h("h1", {}, "수업 코드 입력")),
    h("form", {
      class: "card stack",
      onsubmit(e) {
        e.preventDefault();
        if (!codeIn.value.trim()) return;
        history.replaceState(null, "", "?c=" + encodeURIComponent(codeIn.value.trim()));
        enterLesson(codeIn.value);
      },
    }, h("label", {}, "수업 코드", codeIn), h("button", { class: "primary big", type: "submit" }, "입장하기"), msg),
    h("p", { class: "center" }, h("button", { class: "link", type: "button", onclick() { logout(""); } }, me ? me + " 학생이 아니면: 다른 학생으로 들어가기" : "다른 학생으로 들어가기"))));
  codeIn.focus();
}

// ---------- 입장 ----------
function showEntry(notice) {
  leaveScreenShare();
  stopPolling();
  closeZoom();
  shell = null;
  cards.clear();
  const fromLink = !!params.get("c");
  const codeIn = h("input", { type: "text", value: code, autocomplete: "off", maxlength: 20, placeholder: "예: K7P2Q", autocapitalize: "characters", required: true });
  const noIn = h("input", { type: "text", autocomplete: "off", maxlength: 20, required: true, inputmode: "numeric", placeholder: "예: 10203 또는 3" });
  const nameIn = h("input", { type: "text", autocomplete: "off", maxlength: 20, required: true });
  // 이 수업에 처음 들어올 때만: 수업 중 화면 보기 동의(둘 중 하나를 직접 고른다. 동의하지 않아도 수업에 참여할 수 있다)
  const consentYes = h("input", { type: "radio", name: "monitor-consent", value: "yes" });
  const consentNo = h("input", { type: "radio", name: "monitor-consent", value: "no" });
  const consentRow = h("fieldset", { class: "options consent", hidden: true },
    h("legend", {}, "수업 중 화면 보기"),
    h("p", { class: "muted small" }, "수업하는 동안 선생님이 이 기기 화면을 볼 수 있게 할까요? PC에서는 공유한 화면 전체(다른 창·앱 포함)가, 휴대폰·태블릿에서는 이 수업 화면만 보입니다. 선생님이 보고 있을 때는 화면에 표시되고, 나중에 언제든 바꿀 수 있습니다. 동의하지 않아도 수업에 참여할 수 있습니다."),
    h("label", { class: "option" }, consentYes, h("span", {}, "동의합니다")),
    h("label", { class: "option" }, consentNo, h("span", {}, "동의하지 않습니다")));
  const codeLabel = h("label", {}, "수업 코드", codeIn);
  let newAccount = false;
  const msg = h("p", { class: "msg" }, notice || "");
  const btn = h("button", { class: "primary big", type: "submit" }, "입장하기");
  const remember = rememberBox("student");

  // 코드·학번·이름을 바꾸면 동의 단계를 처음부터 다시
  [codeIn, noIn, nameIn].forEach((el) => el.addEventListener("input", () => {
    newAccount = false;
    consentRow.hidden = true;
  }));

  const form = h("form", {
    class: "card stack",
    async onsubmit(e) {
      e.preventDefault();
      if (newAccount && !consentYes.checked && !consentNo.checked) { msg.textContent = "「수업 중 화면 보기」에서 동의 여부를 골라 주세요."; return; }
      if (btn.disabled) return;
      btn.disabled = true;
      msg.textContent = "확인 중…";
      const { data, error } = await sb.rpc("student_join_no", {
        p_code: codeIn.value, p_class_no: noIn.value, p_name: nameIn.value, p_consent: newAccount ? consentYes.checked : null,
      });
      btn.disabled = false;
      if (error) { msg.textContent = "연결하지 못했습니다. 인터넷을 확인하고 다시 시도하세요. (" + error.message + ")"; return; }
      const err = data.error;
      if (err === "no_lesson") {
        msg.textContent = "수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.";
        if (!codeLabel.isConnected) { form.prepend(codeLabel); codeIn.focus(); }
      }
      else if (err === "bad_name") msg.textContent = "이름을 확인하세요(20자까지).";
      else if (err === "bad_no") msg.textContent = "학번(번호)을 확인하세요(20자까지).";
      else if (err === "full") msg.textContent = "이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.";
      else if (err === "need_consent") {
        newAccount = true;
        consentRow.hidden = false;
        msg.textContent = "처음 들어왔네요. 아래에서 화면 보기 동의 여부를 고른 뒤 입장하세요.";
      } else if (data.token) {
        token = data.token;
        code = data.code;
        ls.set("cra-last-code", code);
        setRememberLogin("student", remember.querySelector("input").checked);
        keep.setItem(TOKEN_KEY, token);
        keep.setItem(ME_KEY, whoName(data));
        following = true;
        poll();
      } else msg.textContent = "알 수 없는 오류입니다. 다시 시도하세요.";
    },
  },
    fromLink ? null : codeLabel,
    h("label", {}, "학번(번호)", noIn),
    h("label", {}, "이름", nameIn),
    consentRow,
    btn, remember, msg);

  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" },
      h("p", { class: "eyebrow" }, fromLink ? "수업 코드 " + code : "수업 응답"),
      h("h1", {}, "입장하기")),
    form));
  (fromLink ? noIn : codeIn).focus();
}

// 학번이 없는 학생(이름만으로 들어옴)은 이름만
function whoName(s) { return ((s.class_no || "") + " " + s.name).trim(); }

// fade: 알림을 화면 가운데 띄웠다가 서서히 사라진 뒤 입장 화면으로(자동 로그인한 학생 정보가 지워졌을 때)
function logout(notice, fade) {
  stopPolling();
  keep.removeItem(TOKEN_KEY);
  keep.removeItem(ME_KEY);
  if (code) keep.removeItem("cra-token:" + code.toLowerCase());
  token = null;
  state = null;
  if (!fade) return showEntry(notice);
  leaveScreenShare();
  app.replaceChildren();
  centerNote(notice, () => showEntry());
}

function leaveScreenShare() {
  stopMirror();
  stopDesk();
  if (screenChannel) sb.removeChannel(screenChannel);
  screenChannel = null;
  liveOk = false;
  screenChannelKey = "";
  screenPending = false;
  shareAsked = false;
  renderDeskGate(false);   // 위에서 화면 안내를 다시 그려도 입장 화면에는 막이 남지 않게 맨 끝에
}

// ---------- 서버에서 상태 받기 ----------
function stopPolling() {
  pollSeq++;
  clearTimeout(timer);
  timer = null;
}

async function poll() {
  clearTimeout(timer);
  const seq = ++pollSeq, c = code, t = token;
  const { data, error } = await sb.rpc("student_state", { p_token: t, p_code: c, p_have: shell ? stateV : null });
  if (!token || seq !== pollSeq || code !== c || token !== t) return;   // 그사이 다시 불렀거나 코드·학생이 바뀌었다
  if (!error && data.error === "no_lesson") return showCodeOnly("수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.");
  if (!error && data.error === "full") return showCodeOnly("이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.");
  if (error) {
    if (shell) shell.conn.hidden = false;
    else return showCodeOnly("연결하지 못했습니다. 인터넷을 확인하고 다시 입장하세요.");
  } else if (data.error === "logged_out") {
    return logout("다시 입장해 주세요. 선생님이 비밀번호를 초기화했거나 학생 정보가 지워졌습니다.", true);
  } else if (data.same) {
    if (shell) shell.conn.hidden = true;
  } else {
    stateV = data.v || null;
    apply(data);
  }
  timer = setTimeout(poll, (liveOk ? POLL_LIVE_MS : POLL_MS) * (document.hidden ? 4 : 1));
}
// 교사가 바꿨다는 신호: 모든 학생이 한꺼번에 묻지 않게 조금씩 흩어서 받는다
function pollSoon() {
  if (!token || !shell) return;
  clearTimeout(timer);
  timer = setTimeout(poll, Math.random() * 600);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && token && shell) poll(); });

function apply(data) {
  const before = state;
  state = data;
  ensureScreenChannel();
  if (!shell) buildShell();
  shell.conn.hidden = true;
  const teacherPage = clampPage(data.lesson.page);
  if (!before || following) viewing = teacherPage;
  if (viewing > teacherPage) viewing = teacherPage;   // 교사가 앞쪽으로 되돌아간 경우
  following = viewing === teacherPage;
  render(!before || before.lesson.page !== data.lesson.page);
  queueMirror();
}

addEventListener("resize", () => { if (shell && shell.simLayer) syncSimLayer(shell.simLayer, shell.img); });

function clampPage(n) {
  const max = Math.max(state.lesson.slide_count, 1);
  return Math.min(Math.max(n || 1, 1), max);
}

// ---------- 화면 ----------
function buildShell() {
  const img = h("img", { class: "slide", alt: "", title: "누르면 크게 보기", onclick: zoom });
  const prev = h("button", { class: "ghost", type: "button", "data-rapid": "", onclick() { go(viewing - 1); } }, "◀ 이전");
  const next = h("button", { class: "ghost", type: "button", "data-rapid": "", onclick() { go(viewing + 1); } }, "다음 ▶");
  const where = h("span", { class: "where" });
  const back = h("button", { class: "primary", type: "button", onclick() { go(state.lesson.page); } }, "선생님과 같은 쪽으로");
  const closed = h("p", { class: "banner" }, "지금은 제출이 닫혀 있습니다. 쓴 내용은 이 기기에 남아 있으니, 선생님이 열면 저장하세요.");
  const conn = h("p", { class: "banner bad", hidden: true }, "연결이 끊겼습니다. 다시 연결하는 중…");
  const title = h("strong", {});
  const who = h("span", {});
  const screenNotice = h("section", { class: "screen-share-note", hidden: true });
  const simStage = h("div", { class: "sim-stage", hidden: true });
  const simLayer = h("div", { class: "sim-layer" });   // 선생님이 슬라이드 위에 얹은 시뮬레이션
  const slideWrap = h("div", { class: "slide-wrap" }, img, simLayer);
  img.addEventListener("load", () => syncSimLayer(simLayer, img));
  new ResizeObserver(() => syncSimLayer(simLayer, img)).observe(img);   // 알림 띠가 생기고 사라져 슬라이드 크기가 바뀔 때도 얹은 시뮬레이션을 맞춘다
  const slideBox = h("div", { class: "slide-box" }, slideWrap, simStage,
    h("nav", { class: "pager" }, prev, where, next, back, h("span", { class: "spacer" }),
      h("button", { class: "ghost", type: "button", onclick: zoom }, "크게 보기")),
    h("p", { class: "muted small" }, "다음 쪽은 선생님이 넘기면 자동으로 열립니다."));
  const list = h("div", { class: "stack" });
  app.replaceChildren(
    h("header", { class: "top" }, h("div", { class: "top-title" }, title, who),
      h("div", { class: "row" },
        h("button", { class: "link", type: "button", onclick() { history.replaceState(null, "", location.pathname); showCodeOnly(); } }, "다른 수업"),
        h("button", { class: "link", type: "button", onclick() { logout("나갔습니다. 다시 들어오려면 입장하세요."); } }, "나가기"))),
    h("main", { class: "lesson" }, conn, closed, screenNotice, slideBox, list));
  const anytimeHead = h("h2", { class: "section-head" }, "언제든 할 수 있는 활동");
  const empty = h("p", { class: "muted center" });
  shell = { img, simStage, simLayer, prev, next, where, back, closed, conn, title, who, screenNotice, slideBox, list, anytimeHead, empty, stageSim: null, stageKey: "", pptKey: "" };
  renderScreenNotice();
}

// 슬라이드를 화면 가득 띄운다. 누르거나 Esc로 닫는다. 선생님이 쪽을 넘기면 띄운 그림도 바뀐다.
function zoom() {
  if (isPptx(state.lesson)) return openPptxFull(state.lesson, viewing);
  if (shell.stageSim) {
    const a = shell.stageSim;
    return loadSim(a).then((html) => openSimFull(a.title, withSimAgent(html)), (e) => alert("시뮬레이션을 불러오지 못했습니다. " + (e.message || "")));
  }
  if (shell.zoom) return;
  const big = h("img", { src: slideSrc(state.lesson, viewing), alt: shell.img.alt });   // 크게 볼 때만 큰 그림(1280px)을 받는다
  const box = h("div", { class: "slide-zoom", onclick: close }, big, h("p", {}, "눌러서 닫기 · 휴대폰은 가로로 돌리면 더 크게 보입니다"));
  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    box.remove();
    document.removeEventListener("keydown", esc);
    document.removeEventListener("fullscreenchange", left);
    if (shell) shell.zoom = null;
  }
  const esc = (e) => { if (e.key === "Escape") close(); };
  const left = () => { if (!document.fullscreenElement) close(); };
  document.addEventListener("keydown", esc);
  document.body.append(box);
  shell.zoom = big;
  if (box.requestFullscreen) box.requestFullscreen().then(() => document.addEventListener("fullscreenchange", left)).catch(() => {});
}

function go(n) {
  viewing = clampPage(Math.min(n, state.lesson.page));
  following = viewing === clampPage(state.lesson.page);
  render(true);
  scrollTo(0, 0);
}

function render(pageChanged) {
  const L = state.lesson;
  const hasSlides = L.slide_count > 0;
  shell.title.textContent = L.title;
  shell.who.textContent = whoName(state.me);
  shell.closed.hidden = L.open;
  shell.slideBox.hidden = !hasSlides;
  if (hasSlides) {
    let src = "";
    if (isPptx(L)) {
      const key = L.slide_dir + ":" + viewing;
      shell.img.hidden = true;
      if (shell.pptKey !== key) {
        shell.slideBox.querySelector(".pptx-frame")?.remove();
        shell.slideBox.insertBefore(pptxFrame(L, viewing), shell.simStage);
        shell.pptKey = key;
      }
    } else {
      shell.slideBox.querySelector(".pptx-frame")?.remove();
      shell.pptKey = "";
      shell.img.hidden = false;
      src = slideSrc(L, viewing, true);
      const last = shell.lastPage || viewing;
      swapSlide(shell.img, src, slideFx(L), slideNo(L, last) === slideNo(L, viewing) ? (last === viewing ? 1 : 0) : Math.sign(viewing - last));
      shell.lastPage = viewing;
    }
    const big = src && slideSrc(L, viewing);
    if (shell.zoom && big && shell.zoom.getAttribute("src") !== big) shell.zoom.src = big;
    shell.img.alt = "슬라이드 " + viewing;
    shell.where.textContent = slideLabel(L, viewing);
    shell.prev.disabled = viewing <= 1;
    shell.next.disabled = viewing >= clampPage(L.page);
    shell.back.hidden = following;
  }

  // 슬라이드가 없는 수업은 활동을 모두 보여 준다
  const acts = state.activities;
  // 큰 화면에서는 슬라이드와 질문을 나란히(split), 슬라이드가 없으면 가운데 한 줄(single)
  shell.slideBox.parentNode.className = "lesson " + (hasSlides ? "split" : "single");
  let here = hasSlides ? acts.filter((a) => simOnSlide(a, slideNo(L, viewing))) : acts;
  const anytime = hasSlides ? acts.filter((a) => a.page == null && !allPagesSim(a)) : [];
  // 「슬라이드 자리에 띄우기」 시뮬레이션은 슬라이드 그림 대신 위쪽에 크게 보인다
  const stageSim = hasSlides ? here.find((a) => a.kind === "sim" && a.sim_full && a.page != null) || here.find((a) => a.kind === "sim" && a.sim_full) || null : null;
  showStageSim(stageSim);
  if (stageSim) here = here.filter((a) => a !== stageSim);
  // 슬라이드 위에 얹는 시뮬레이션: 선생님이 정한 자리에 테두리 없이 놓는다(카드로는 보이지 않음)
  // 다른 쪽에 얹은 것도 미리 불러 숨겨 두어, 그 쪽으로 넘기면 바로 보인다
  const allOvers = hasSlides && !isPptx(L) ? acts.filter(isOverSim) : [];
  const overs = stageSim ? [] : here.filter(isOverSim);
  here = here.filter((a) => !isOverSim(a));
  shell.simLayer.hidden = !allOvers.length;
  syncSimLayer(shell.simLayer, shell.img);
  renderSimLayer(shell.simLayer, overs, { all: allOvers, load: (a) => loadSim(a).then(withSimAgent), ver: (a) => a.html_ver, editable: false, img: shell.img });
  stopHiddenSimAgents();
  const els = here.map(cardFor);
  if (anytime.length) els.push(shell.anytimeHead, anytime.map(cardFor));
  if (!here.length && !anytime.length) {
    shell.empty.textContent = hasSlides ? "이 쪽에는 질문이 없습니다." : "아직 활동이 없습니다.";
    els.push(shell.empty);
  }
  // 같은 카드들이면 그대로 둔다(다시 끼우면 쓰고 있던 칸의 커서가 빠진다)
  if (pageChanged || shell.list.childElementCount !== els.flat().length || els.flat().some((el, i) => shell.list.children[i] !== el)) {
    shell.list.replaceChildren(...els.flat());
  }
}

// ---------- 시뮬레이션 ----------
const simCache = new Map();   // 활동 id → { ver, html }

// 시뮬레이션 HTML은 이 기기에도 저장해 두어, 새로고침하거나 다음 시간에 다시 들어와도 바뀌지 않았으면 다시 받지 않는다
async function loadSim(a) {
  let hit = simCache.get(a.id);
  if (!hit) try { hit = JSON.parse(ls.get("cra-sim:" + a.id)); } catch {}
  if (hit && hit.ver === a.html_ver) { simCache.set(a.id, hit); return hit.html; }
  const { data, error } = await sb.rpc("student_sim", { p_token: token, p_activity: a.id });
  if (error) throw error;
  const html = typeof data === "string" ? data : "";
  hit = { ver: a.html_ver, html };
  simCache.set(a.id, hit);
  if (html.length < 500000) try { ls.set("cra-sim:" + a.id, JSON.stringify(hit)); } catch {}
  return html;
}

function showStageSim(a) {
  shell.stageSim = a || null;
  shell.img.hidden = !!a;
  const pptFrame = shell.slideBox.querySelector(".pptx-frame");
  if (pptFrame) pptFrame.hidden = !!a;
  shell.simStage.hidden = !a;
  const key = a ? a.id + ":" + a.html_ver : "";
  if (key === shell.stageKey) return;
  shell.stageKey = key;
  shell.simStage.replaceChildren();
  if (!a) return;
  const f = simFrame(null, a.title);
  shell.simStage.append(f);
  loadSim(a).then((html) => { if (shell.stageKey === key) f.srcdoc = withSimAgent(html); })
    .catch(() => shell.simStage.replaceChildren(h("p", { class: "error" }, "시뮬레이션을 불러오지 못했습니다. 새로고침해 보세요.")));
}

// 슬라이드 아래에 붙는 시뮬레이션 카드
function simCard(a) {
  let c = cards.get(a.id);
  if (!c) {
    c = { el: h("section", { class: "card activity" }), key: "" };
    cards.set(a.id, c);
  }
  const key = a.title + ":" + a.html_ver;
  if (c.key !== key) {
    c.key = key;
    const f = simFrame(null, a.title);
    c.el.replaceChildren(
      h("div", { class: "card-head" }, h("h2", {}, a.title), h("span", { class: "badge" }, "시뮬레이션")),
      h("div", { class: "row" }, simPlayButton(f)),
      h("p", { class: "muted small" }, "▶ 재생을 눌러 시작하고, 직접 조작해 보세요. 화면이 작으면 「화면 가득 보기」를 누르세요."),
      h("div", { class: "row wrap" },
        h("button", { class: "primary", type: "button", onclick() { loadSim(a).then((html) => showFloatingSim(a.title, withSimAgent(html), a.id + ":" + a.html_ver)); } }, "화면에 띄우기"),
        h("button", { class: "ghost", type: "button", onclick() { loadSim(a).then((html) => openSimFull(a.title, withSimAgent(html))); } }, "화면 가득 보기")),
      simScaled(f));
    loadSim(a).then((html) => { if (c.key === key) f.srcdoc = withSimPause(withSimAgent(html)); })
      .catch(() => f.replaceWith(h("p", { class: "error" }, "시뮬레이션을 불러오지 못했습니다. 새로고침해 보세요.")));
  }
  return c.el;
}

// ---------- 활동 카드 ----------
function draftKey(a) { return "cra-draft:" + token + ":" + a.id; }

function cardFor(a) {
  if (a.kind === "sim") return simCard(a);
  let c = cards.get(a.id);
  if (!c) {
    c = { el: h("section", { class: "card activity" }), form: h("div", { class: "stack" }), others: h("div", {}) };
    c.el.append(c.form, c.others);
    cards.set(a.id, c);
  }
  c.a = a;
  const formSig = JSON.stringify([a.title, a.kind, a.questions, a.saved_at, a.score]);
  if (formSig !== c.formSig) {
    c.formSig = formSig;
    buildForm(c);
  }
  c.refresh();
  const othersSig = JSON.stringify(a.shared ? [a.others, a.questions] : null);
  if (othersSig !== c.othersSig) {
    c.othersSig = othersSig;
    c.others.replaceChildren(...(a.shared ? [
      h("div", { class: "others" },
        h("h3", {}, "친구들의 응답"),
        h("p", { class: "muted small" }, "선생님이 공개했습니다 · " + nameModeText(a) + " · " + (a.others_n ?? a.others.length) + "명"),
        summaryView(a.questions, a.others)),
    ] : []));
  }
  return c.el;
}

function buildForm(c) {
  const a = c.a;
  if (isInfoActivity(a)) {
    c.refresh = () => {};
    c.form.replaceChildren(
      h("div", { class: "card-head" }, h("h2", {}, a.title), h("span", { class: "badge" }, "설명 카드")),
      linkedDescription(a.questions[0].text));
    return;
  }
  const quizDone = a.kind === "quiz" && !!a.mine;
  // 고치는 중인 내용(이 기기에 저장). 서버에 더 나중에 저장된 것이 있으면 그것을 쓴다.
  let draft = null;
  try { draft = JSON.parse(ls.get(draftKey(a)) || "null"); } catch (e) { draft = null; }
  if (draft && a.saved_at && draft.at < Date.parse(a.saved_at)) draft = null;
  const values = Object.assign({}, a.mine || {}, draft ? draft.values : {});
  const err = h("p", { class: "error" });
  const status = h("p", { class: "status" });
  const btn = h("button", { class: "primary big", type: "button" });
  // 저장한 뒤에는 답을 잠그고 「저장됨」으로 보여 준다. 「수정하기」를 누르면 다시 고칠 수 있고, 「취소」는 저장한 답으로 되돌린다.
  let unlocked = false;
  const editBtn = h("button", { class: "ghost big", type: "button", hidden: true, onclick() {
    if (unlocked) {   // 취소: 고치던 내용을 버리고 저장한 답으로
      ls.del(draftKey(a));
      c.formSig = null;
      cardFor(a);
      return;
    }
    unlocked = true;
    c.refresh();
    c.form.querySelector(".question input:not([type=radio]):not([type=checkbox]), .question textarea, .question input")?.focus();
  } }, "수정하기");
  let sending = false;

  const saveDraft = () => {
    ls.set(draftKey(a), JSON.stringify({ at: Date.now(), values }));
    err.textContent = "";
    c.refresh();
  };
  const dirty = () => a.questions.some((q) => JSON.stringify(values[q.id] ?? "") !== JSON.stringify((a.mine || {})[q.id] ?? ""));

  const rows = a.questions.map((q, i) => {
    const label = (i + 1) + ". " + q.text;
    let control;
    if (q.type === "choice" || q.type === "multi") {
      const picked = () => [].concat(values[q.id] ?? []);
      control = h("fieldset", { class: "options" }, h("legend", {}, label), q.options.map((o) => {
        const right = quizDone && q.answer != null && [].concat(q.answer).includes(o);
        return h("label", { class: "option" + (right ? " right" : "") },
          h("input", {
            type: q.type === "choice" ? "radio" : "checkbox", name: a.id + "-" + q.id, checked: picked().includes(o), disabled: quizDone,
            onchange(e) {
              if (q.type === "choice") values[q.id] = o;
              else values[q.id] = q.options.filter((x) => (x === o ? e.target.checked : picked().includes(x)));
              saveDraft();
            },
          }),
          h("span", {}, o), right ? h("strong", { class: "right-mark" }, "정답") : null);
      }));
    } else {
      const input = q.type === "short"
        ? h("input", { type: "text", maxlength: 200, value: values[q.id] || "", disabled: quizDone })
        : h("textarea", { rows: 4, maxlength: 2000, disabled: quizDone }, values[q.id] || "");
      input.addEventListener("input", () => { values[q.id] = input.value; saveDraft(); });
      control = h("label", {}, label, input);
    }
    const result = quizDone && q.answer != null
      ? h("p", { class: JSON.stringify(values[q.id]) === JSON.stringify(q.answer) ? "ok small" : "error small" },
        JSON.stringify(values[q.id]) === JSON.stringify(q.answer) ? "맞았습니다." : "정답: " + answerText(q.answer))
      : null;
    const explain = quizDone && q.explain ? h("p", { class: "tip small" }, "해설: " + q.explain) : null;
    return h("div", { class: "question" }, control, result, explain);
  });

  async function save() {
    const missing = a.questions.findIndex((q) => isEmptyAnswer(values[q.id]));
    if (missing >= 0) { err.textContent = (missing + 1) + "번 질문에 답해 주세요."; return; }
    if (a.kind === "quiz" && !confirm("퀴즈는 한 번만 제출할 수 있습니다. 제출할까요?")) return;
    const answers = {};
    a.questions.forEach((q) => { answers[q.id] = typeof values[q.id] === "string" ? values[q.id].trim() : values[q.id]; });
    sending = true;
    c.refresh();
    const { data, error } = await sb.rpc("student_save", { p_token: token, p_activity: a.id, p_answers: answers });
    sending = false;
    if (error) err.textContent = "저장하지 못했습니다. 다시 시도하세요. (" + error.message + ")";
    else if (data.error === "closed") err.textContent = "지금은 제출이 닫혀 있습니다. 선생님이 열면 다시 저장하세요.";
    else if (data.error === "already") err.textContent = "이미 제출한 퀴즈입니다.";
    else if (data.error === "logged_out") return logout("다시 입장해 주세요.");
    else if (data.error) err.textContent = "저장하지 못했습니다. (" + data.error + ")";
    else {
      ls.del(draftKey(a));
      c.formSig = null;   // 저장한 내용으로 다시 그린다
      // 공개 응답이면 친구들 화면도 새로 받게 알린다(내용 없이 신호만)
      if (a.shared && liveOk) screenChannel.send({ type: "broadcast", event: "nudge", payload: {} }).catch(() => {});
      return poll();
    }
    c.refresh();
  }
  btn.addEventListener("click", save);

  c.refresh = () => {
    const open = state.lesson.open;
    const d = dirty();
    if (quizDone) {
      btn.hidden = true;
      status.textContent = "제출했습니다 (" + fmtTime(a.saved_at) + ")";
      status.className = "status ok";
      return;
    }
    const locked = !!a.mine && !d && !unlocked && !sending;
    c.form.querySelectorAll(".question input, .question textarea").forEach((el) => { el.disabled = locked; });
    editBtn.hidden = !a.mine || !open || (!unlocked && d) || sending;
    editBtn.textContent = unlocked ? "취소" : "수정하기";
    btn.disabled = sending || !open || (a.mine && !d);
    btn.textContent = sending ? "저장 중…" : a.kind === "quiz" ? "제출하기" : !a.mine ? "저장하기" : d ? "고친 내용 저장" : unlocked ? "고친 뒤 저장" : "저장됨";
    status.textContent = !open ? "지금은 저장할 수 없습니다." : a.mine && !d ? "✓ 저장 완료 (" + fmtTime(a.saved_at) + ")" : a.mine ? "저장하지 않은 수정 내용이 있습니다." : "";
    status.className = a.mine && !d && open ? "status ok" : "status";
  };

  c.form.replaceChildren(...[
    h("div", { class: "card-head" }, h("h2", {}, a.title), h("span", { class: "badge" }, KIND_NAME[a.kind])),
    activityDescription(a) ? linkedDescription(activityDescription(a)) : null,
    quizDone && a.total ? h("p", { class: "score" }, "점수 " + a.score + " / " + a.total) : null,
    rows, err, h("div", { class: "row" }, btn, editBtn), status].flat().filter(Boolean));
}
