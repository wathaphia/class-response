// 학생 화면: 입장(학번 + 이름 + 비밀번호) → 슬라이드를 따라가며 질문에 답한다.
// 3초마다 서버에서 수업 상태를 받아 온다(교사가 넘긴 쪽, 제출 열림, 공개된 응답).

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const POLL_MS = 3000;
// 학생 계정은 웹앱 전체에 하나. 한 번 입장한 기기는 열쇠(token)를 기억해서, 새 수업 코드만 넣으면 바로 들어간다.
const TOKEN_KEY = "cra-token";
const ME_KEY = "cra-me";

let code = "";          // 수업 코드
let token = null;       // 입장 열쇠(이 기기에 저장)
let state = null;       // 서버에서 받은 수업 상태
let viewing = 1;        // 학생이 보고 있는 쪽
let following = true;   // 교사가 띄운 쪽을 따라가는 중인지
let timer = null;
let shell = null;
const cards = new Map(); // 활동 id → 화면 카드
let screenChannel = null;
let screenChannelKey = "";
let screenPc = null;
let screenPending = false;
let screenStudentId = null;
let screenQueuedCandidates = [];
// 실시간 수업 화면: 학생이 허용하면 이 수업 화면(쪽, 쓰고 있는 답)만 교사에게 보낸다. 모든 기기·브라우저에서 된다.
let mirrorOn = false;
let mirrorTimer = null;
let mirrorBeat = null;
let lastMirror = "";                 // 마지막으로 보낸 수업 화면(같으면 다시 보내지 않음)
const simStarted = new WeakMap();    // 촬영을 시작한 시뮬레이션 칸 → 그때의 srcdoc 길이
let simQ = 0.6, simW = 640;          // 시뮬레이션 그림 화질·최대 너비(메시지 크기에 따라 자동 조절)

if (!sb) notConfigured(app);
else start();

function start() {
  code = (params.get("c") || localStorage.getItem("cra-last-code") || "").trim();
  // 예전 판은 수업마다 열쇠를 따로 저장했다: 있으면 그대로 옮겨 쓴다
  token = localStorage.getItem(TOKEN_KEY) || (code ? localStorage.getItem("cra-token:" + code.toLowerCase()) : null);
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (token && code) poll();
  else if (token) showCodeOnly();
  else showEntry();
}

function enterLesson(newCode) {
  code = newCode.trim();
  localStorage.setItem("cra-last-code", code);
  state = null;
  following = true;
  poll();
}

// 이미 입장한 기기: 수업 코드만 넣으면 된다
function showCodeOnly(notice) {
  leaveScreenShare();
  stopPolling();
  shell = null;
  cards.clear();
  const me = localStorage.getItem(ME_KEY) || "";
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
  shell = null;
  cards.clear();
  const fromLink = !!params.get("c");
  const codeIn = h("input", { type: "text", value: code, autocomplete: "off", maxlength: 20, placeholder: "예: K7P2Q", autocapitalize: "characters", required: true });
  const noIn = h("input", { type: "text", autocomplete: "off", maxlength: 20, inputmode: "numeric", placeholder: "예: 20243030", required: true });
  const nameIn = h("input", { type: "text", autocomplete: "off", maxlength: 20, required: true });
  const pinIn = h("input", { type: "password", inputmode: "numeric", maxlength: 4, autocomplete: "off", required: true });
  const pin2In = h("input", { type: "password", inputmode: "numeric", maxlength: 4, autocomplete: "off" });
  const pin2Row = h("label", { hidden: true }, "비밀번호 한 번 더", pin2In);
  const msg = h("p", { class: "msg" }, notice || "");
  const btn = h("button", { class: "primary big", type: "submit" }, "입장하기");
  let confirming = false;

  // 이름이나 번호를 바꾸면 확인 단계를 처음부터 다시
  [codeIn, noIn, nameIn].forEach((el) => el.addEventListener("input", () => {
    confirming = false;
    pin2Row.hidden = true;
  }));

  const form = h("form", {
    class: "card stack",
    async onsubmit(e) {
      e.preventDefault();
      const pin = pinIn.value.trim();
      if (!/^\d{4}$/.test(pin)) { msg.textContent = "비밀번호는 숫자 4자리로 입력하세요."; return; }
      if (confirming && pin2In.value.trim() !== pin) { msg.textContent = "두 비밀번호가 다릅니다. 다시 입력하세요."; return; }
      btn.disabled = true;
      msg.textContent = "확인 중…";
      const { data, error } = await sb.rpc("student_enter", {
        p_code: codeIn.value, p_class_no: noIn.value, p_name: nameIn.value, p_pin: pin, p_confirm: confirming,
      });
      btn.disabled = false;
      if (error) { msg.textContent = "연결하지 못했습니다. 인터넷을 확인하고 다시 시도하세요. (" + error.message + ")"; return; }
      const err = data.error;
      if (err === "no_lesson") msg.textContent = "수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.";
      else if (err === "bad_name") msg.textContent = "학번과 이름을 확인하세요(각각 20자까지).";
      else if (err === "bad_pin") msg.textContent = "비밀번호는 숫자 4자리로 입력하세요.";
      else if (err === "full") msg.textContent = "이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.";
      else if (err === "need_confirm") {
        confirming = true;
        pin2Row.hidden = false;
        pin2In.value = "";
        pin2In.focus();
        msg.textContent = data.reset
          ? "선생님이 비밀번호를 초기화했습니다. 새 비밀번호를 한 번 더 입력하고 입장하세요."
          : "처음 들어왔네요. 지금 입력한 번호가 내 비밀번호가 됩니다. 한 번 더 입력하고 입장하세요.";
      } else if (err === "wrong_pin") msg.textContent = "비밀번호가 틀렸습니다. " + data.left + "번 더 틀리면 10분 동안 잠깁니다.";
      else if (err === "locked") msg.textContent = "비밀번호를 여러 번 틀려 잠겼습니다. " + data.minutes + "분 뒤에 다시 하거나 선생님께 초기화를 부탁하세요.";
      else if (data.token) {
        token = data.token;
        code = data.code;
        localStorage.setItem("cra-last-code", code);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(ME_KEY, data.class_no + " " + data.name);
        following = true;
        poll();
      } else msg.textContent = "알 수 없는 오류입니다. 다시 시도하세요.";
    },
  },
    fromLink ? null : h("label", {}, "수업 코드", codeIn),
    h("label", {}, "학번", noIn),
    h("label", {}, "이름", nameIn),
    h("label", {}, "비밀번호 (숫자 4자리)", pinIn),
    pin2Row,
    h("div", { class: "tip" },
      h("strong", {}, "처음 들어오나요?"),
      h("p", {}, "처음 입력한 번호가 내 비밀번호가 됩니다. 다른 수업에서도 같은 학번·이름·비밀번호를 씁니다. 휴대폰 비밀번호나 생일은 쓰지 마세요.")),
    btn, msg);

  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" },
      h("p", { class: "eyebrow" }, fromLink ? "수업 코드 " + code : "수업 응답"),
      h("h1", {}, "입장하기")),
    form,
    h("p", { class: "muted small center" }, "비밀번호를 잊었다면 선생님께 말하세요. 초기화해도 쓴 답은 지워지지 않습니다.")));
  (fromLink ? noIn : codeIn).focus();
}

function logout(notice) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ME_KEY);
  if (code) localStorage.removeItem("cra-token:" + code.toLowerCase());
  token = null;
  state = null;
  showEntry(notice);
}

function leaveScreenShare() {
  stopMirror();
  if (screenPc) stopScreenShare();
  if (screenChannel) sb.removeChannel(screenChannel);
  screenChannel = null;
  screenChannelKey = "";
  screenPending = false;
}

// ---------- 서버에서 상태 받기 ----------
function stopPolling() {
  clearTimeout(timer);
  timer = null;
}

async function poll() {
  clearTimeout(timer);
  const { data, error } = await sb.rpc("student_state", { p_token: token, p_code: code });
  if (!token) return;
  if (!error && data.error === "no_lesson") return showCodeOnly("수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.");
  if (!error && data.error === "full") return showCodeOnly("이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.");
  if (error) {
    if (shell) shell.conn.hidden = false;
    else showEntry("연결하지 못했습니다. 인터넷을 확인하고 다시 입장하세요.");
  } else if (data.error === "logged_out") {
    return logout("다시 입장해 주세요. 선생님이 비밀번호를 초기화했거나 학생 정보가 지워졌습니다.");
  } else {
    apply(data);
  }
  timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
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

function clampPage(n) {
  const max = Math.max(state.lesson.slide_count, 1);
  return Math.min(Math.max(n || 1, 1), max);
}

// ---------- 화면 ----------
function buildShell() {
  const img = h("img", { class: "slide", alt: "", title: "누르면 크게 보기", onclick: zoom });
  const prev = h("button", { class: "ghost", type: "button", onclick() { go(viewing - 1); } }, "◀ 이전");
  const next = h("button", { class: "ghost", type: "button", onclick() { go(viewing + 1); } }, "다음 ▶");
  const where = h("span", { class: "where" });
  const back = h("button", { class: "primary", type: "button", onclick() { go(state.lesson.page); } }, "선생님과 같은 쪽으로");
  const closed = h("p", { class: "banner" }, "지금은 제출이 닫혀 있습니다. 쓴 내용은 이 기기에 남아 있으니, 선생님이 열면 저장하세요.");
  const conn = h("p", { class: "banner bad", hidden: true }, "연결이 끊겼습니다. 다시 연결하는 중…");
  const title = h("strong", {});
  const who = h("span", {});
  const screenNotice = h("section", { class: "screen-share-note", hidden: true });
  const simStage = h("div", { class: "sim-stage", hidden: true });
  const slideBox = h("div", { class: "slide-box" }, img, simStage,
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
  shell = { img, simStage, prev, next, where, back, closed, conn, title, who, screenNotice, slideBox, list, anytimeHead, empty, stageSim: null, stageKey: "", pptKey: "" };
  renderScreenNotice();
}

function ensureScreenChannel() {
  // 채널 이름은 수업 코드로 만든다(예전 setup.sql 은 수업 id·학생 id를 보내 주지 않음)
  if (!state) return;
  const key = screenChannelName(state.lesson.code || code);
  if (!key) return;
  if (screenChannel && screenChannelKey === key) return;
  if (screenPc) stopScreenShare();
  if (screenChannel) sb.removeChannel(screenChannel);
  screenChannelKey = key;
  // 학생 id가 없으면 학번·이름으로 알아본다(교사 화면도 같은 이름을 함께 보냄)
  screenStudentId = state.me.id || screenKey(state.me);
  // presence: 교사 화면에 접속 상태(보고 있음/다른 앱·탭)만 알린다. 화면 내용은 보내지 않는다.
  screenChannel = sb.channel(key, { config: { broadcast: { self: false }, presence: { key: screenStudentId } } });
  screenChannel.on("broadcast", { event: "signal" }, ({ payload }) => handleScreenSignal(payload));
  screenChannel.subscribe((status) => { if (status === "SUBSCRIBED") trackPresence(); });
}

// 수업 중 화면 보기 동의: 수업에 처음 들어올 때 한 번 묻고 이 기기에 기억한다("yes"/"no"). 언제든 끌 수 있다.
const monitorKey = () => "cra-monitor:" + String(state?.lesson.code || code || "").toUpperCase();
function monitorChoice() { try { return localStorage.getItem(monitorKey()); } catch { return null; } }
function setMonitorChoice(v) {
  try { localStorage.setItem(monitorKey(), v); } catch {}
  if (v === "no") { stopMirror(); if (screenPc) stopScreenShare(); }
  renderScreenNotice();
}

function renderScreenNotice() {
  if (!shell || !shell.screenNotice) return;
  const choice = monitorChoice();
  const canScreen = !!navigator.mediaDevices?.getDisplayMedia && !screenPc;
  let text, buttons;
  if (!choice) {
    text = "이 수업에서는 수업하는 동안 선생님이 이 수업 화면(보고 있는 쪽, 쓰고 있는 답, 시뮬레이션)을 볼 수 있습니다. 다른 앱이나 탭은 보이지 않습니다. 동의할까요?";
    buttons = [h("button", { class: "primary", type: "button", onclick() { setMonitorChoice("yes"); if (screenPending) startMirror(); } }, "동의"),
      h("button", { class: "ghost", type: "button", onclick() { setMonitorChoice("no"); } }, "동의 안 함")];
  } else if (choice === "yes") {
    text = screenPc ? "PC 화면을 선생님께 공유 중입니다. 언제든 끌 수 있습니다."
      : mirrorOn ? "● 선생님이 지금 이 수업 화면을 보고 있습니다." : "선생님이 수업 중 이 화면을 볼 수 있습니다(동의함).";
    buttons = [mirrorOn && canScreen ? h("button", { class: "ghost", type: "button", onclick: startScreenShare }, "PC 화면 전체 공유") : null,
      h("button", { class: "ghost", type: "button", onclick() { setMonitorChoice("no"); } }, "보기 허용 끄기")];
  } else if (screenPending) {
    text = "선생님이 실시간 화면 보기를 요청했습니다. 허용하면 이 수업 화면만 보입니다.";
    buttons = [h("button", { class: "primary", type: "button", onclick: startMirror }, "이번만 허용"),
      h("button", { class: "ghost", type: "button", onclick() { setMonitorChoice("yes"); startMirror(); } }, "수업 내내 허용"),
      h("button", { class: "ghost", type: "button", onclick() { stopMirror(); } }, "거절")];
  } else if (mirrorOn || screenPc) {
    text = "● 이 수업 화면을 선생님께 보여 주는 중입니다.";
    buttons = [h("button", { class: "ghost", type: "button", onclick() { stopMirror(); if (screenPc) stopScreenShare(); } }, "그만 보여 주기")];
  }
  shell.screenNotice.hidden = !text;
  shell.screenNotice.classList.toggle("live", !!(mirrorOn || screenPc));
  shell.screenNotice.replaceChildren(...(text ? [h("span", {}, text), h("span", { class: "row" }, buttons)] : []));
}

function startMirror() {
  screenPending = false;
  mirrorOn = true;
  lastMirror = "";
  clearInterval(mirrorBeat);
  mirrorBeat = setInterval(sendMirror, 4000);
  renderScreenNotice();
  sendMirror();
}

function stopMirror(send = true) {
  const was = mirrorOn || screenPending;
  mirrorOn = false;
  screenPending = false;
  clearInterval(mirrorBeat);
  clearTimeout(mirrorTimer);
  mirrorBeat = mirrorTimer = null;
  simFrames().forEach((f) => f.contentWindow?.postMessage({ craMirror: "stop" }, "*"));
  if (send && was) sendScreenSignal({ type: "stopped", from: screenStudentId, to: "teacher" });
  renderScreenNotice();
}

// 바꾼 직후 0.25초 안에 보내고, 그 사이 변화는 한 번으로 모은다
function queueMirror() {
  if (!mirrorOn || mirrorTimer) return;
  mirrorTimer = setTimeout(() => { mirrorTimer = null; sendMirror(); }, 250);
}

// ---- 시뮬레이션 화면 전달 ----
// 시뮬레이션 안의 촬영기(SIM_AGENT)가 보낸 장면을 교사에게 넘기고, 다 보낸 뒤에야 다음 장면을 달라고 답한다.
// 메시지가 크면 해상도·화질을 낮추고, 작으면 조금씩 되돌린다.
function simFrames() { return [...document.querySelectorAll("iframe.sim-frame")]; }
function startSimAgents() {
  for (const f of simFrames()) {
    if (simStarted.get(f) === f.srcdoc.length) continue;
    simStarted.set(f, f.srcdoc.length);
    const start = () => {
      f.contentWindow?.postMessage({ craMirror: "start", every: 200, maxW: simW, q: simQ }, "*");
      f.contentWindow?.postMessage({ craRtc: "start" }, "*");   // 캔버스가 있으면 영상(WebRTC)으로도 보낸다
    };
    f.addEventListener("load", () => { if (mirrorOn) start(); });
    start();
  }
}
window.addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || !(m.craSim || m.craRtc)) return;
  const k = simFrames().findIndex((f) => f.contentWindow === e.source);
  if (k < 0) return;
  if (m.craRtc) {   // 시뮬레이션 영상 연결 신호는 그대로 교사에게 넘긴다
    if (mirrorOn) sendScreenSignal({ type: "sim-rtc", from: screenStudentId, to: "teacher", k, rtc: m.craRtc, sdp: m.sdp, candidate: m.candidate, idx: m.idx });
    return;
  }
  if (!mirrorOn) return e.source.postMessage({ craMirror: "stop" }, "*");
  const size = JSON.stringify(m).length;
  const ack = { craAck: 1 };
  if (size > 150000) { simQ = Math.max(0.3, simQ - 0.1); simW = Math.max(320, Math.round(simW * 0.8)); }
  else if (size < 50000 && simQ < 0.6) { simQ = Math.min(0.6, simQ + 0.05); simW = Math.min(640, simW + 40); }
  ack.q = simQ; ack.maxW = simW;
  if (size > 230000) return e.source.postMessage({ ...ack, resend: 1 }, "*");   // 너무 크면 버리고 줄인 크기로 다시
  const { craSim, ...frame } = m;
  try { await sendScreenSignal({ type: "sim", from: screenStudentId, to: "teacher", k, ...frame }); } catch {}
  e.source.postMessage(ack, "*");
});
["input", "change", "click", "scroll"].forEach((t) => document.addEventListener(t, queueMirror, { capture: true, passive: true }));
document.addEventListener("visibilitychange", () => { trackPresence(); if (mirrorOn) sendMirror(); });
function trackPresence() {
  if (screenChannel && screenChannel.state === "joined") screenChannel.track({ away: document.hidden }).catch(() => {});
}

// 지금 수업 화면을 복사한다(쓰고 있는 답을 속성으로 옮겨 적어 그대로 보이게)
function mirrorSnapshot() {
  const main = app.querySelector("main.lesson");
  if (!main) return "";
  const clone = main.cloneNode(true);
  const from = main.querySelectorAll("input, textarea, select");
  const to = clone.querySelectorAll("input, textarea, select");
  from.forEach((el, i) => {
    const c = to[i];
    if (el.type === "checkbox" || el.type === "radio") c.toggleAttribute("checked", el.checked);
    else if (el.tagName === "TEXTAREA") c.textContent = el.value;
    else if (el.tagName === "SELECT") [...c.options].forEach((o, j) => o.toggleAttribute("selected", j === el.selectedIndex));
    else if (el.type !== "password") c.setAttribute("value", el.value);
  });
  clone.querySelectorAll(".screen-share-note").forEach((el) => el.remove());
  clone.querySelectorAll(".slide").forEach((el) => el.classList.remove("fx-step", "fx-fade", "fx-zoom", "fx-push-next", "fx-push-prev"));   // 갱신마다 전환 효과가 다시 돌지 않게
  // 시뮬레이션 자리는 번호만 남긴다. 교사 화면이 그 자리에 시뮬레이션 장면을 그린다.
  const all = simFrames();
  const inMain = [...main.querySelectorAll("iframe")];
  clone.querySelectorAll("iframe").forEach((el, i) => {
    const k = all.indexOf(inMain[i]);
    el.replaceWith(k >= 0 ? h("div", { class: "sim-mirror", "data-k": k }) : h("p", { class: "card muted" }, "[화면]"));
  });
  // 수업 화면 밖에 띄운 시뮬레이션(떠 있는 창·화면 가득)은 맨 위에 붙인다
  all.forEach((f, k) => {
    if (!main.contains(f)) clone.prepend(h("section", { class: "card" }, h("p", { class: "muted small" }, "학생이 띄운 시뮬레이션"), h("div", { class: "sim-mirror", "data-k": k })));
  });
  return clone.outerHTML;
}

// 화면이 그대로면 무거운 화면 내용은 빼고 상태만 보낸다(4초마다 살아 있음 알림)
function sendMirror() {
  if (!mirrorOn || !state) return;
  startSimAgents();
  const max = document.documentElement.scrollHeight - innerHeight;
  const html = mirrorSnapshot();
  const msg = {
    type: "mirror", from: screenStudentId, to: "teacher",
    where: state.lesson.slide_count ? slideLabel(state.lesson, viewing) : "", away: document.hidden,
    scroll: max > 0 ? scrollY / max : 0, narrow: innerWidth < 700, t: Date.now(),
  };
  if (html !== lastMirror) { msg.html = html; lastMirror = html; }
  sendScreenSignal(msg);
}

async function sendScreenSignal(payload) {
  if (!screenChannel) return;
  await screenChannel.send({ type: "broadcast", event: "signal", payload });
}

async function handleScreenSignal(message) {
  if (!message || (message.to !== screenStudentId && message.key !== screenKey(state.me))) return;
  if (message.type === "request") {
    if (mirrorOn) { lastMirror = ""; simFrames().forEach((f) => simStarted.delete(f)); return sendMirror(); }   // 새로 연 교사 창에 전부 다시
    if (monitorChoice() === "yes") return startMirror();   // 수업 중 보기에 동의한 학생은 묻지 않고 바로
    screenPending = true;
    renderScreenNotice();
    return;
  }
  if (message.type === "stop") {
    stopMirror(false);
    if (screenPc) stopScreenShare(false);
    return;
  }
  if (message.type === "sim-rtc") {   // 교사가 보낸 영상 연결 신호를 해당 시뮬레이션으로
    if (mirrorOn) simFrames()[message.k]?.contentWindow?.postMessage({ craRtc: message.rtc, sdp: message.sdp, candidate: message.candidate }, "*");
    return;
  }
  if (!screenPending && !screenPc) return;
  if (message.type === "answer" && screenPc && message.sdp) {
    await screenPc.setRemoteDescription(message.sdp);
    for (const c of screenQueuedCandidates) await screenPc.addIceCandidate(c);
    screenQueuedCandidates = [];
  } else if (message.type === "candidate" && screenPc && message.candidate) {
    if (screenPc.remoteDescription) await screenPc.addIceCandidate(message.candidate);
    else screenQueuedCandidates.push(message.candidate);
  } else if (message.type === "stop") {
    stopScreenShare(false);
  }
}

async function startScreenShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return alert("이 기기에서는 PC 화면 공유를 쓸 수 없습니다. 수업 화면은 계속 선생님께 보입니다.");
  }
  try {
    // 화면 선택과 브라우저 권한은 학생이 직접 승인해야 한다.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 6, max: 8 } }, audio: false });
    screenPending = false;
    screenPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    screenQueuedCandidates = [];
    stream.getTracks().forEach((track) => {
      if (track.kind === "video") track.applyConstraints({ width: { max: 640 }, height: { max: 360 }, frameRate: { max: 8 } }).catch(() => {});
      screenPc.addTrack(track, stream);
      track.addEventListener("ended", () => stopScreenShare());
    });
    for (const sender of screenPc.getSenders()) {
      const params = sender.getParameters();
      params.encodings = params.encodings || [{}];
      params.encodings[0].maxBitrate = 250000;
      params.encodings[0].maxFramerate = 8;
      await sender.setParameters(params).catch(() => {});
    }
    screenPc.onicecandidate = (e) => e.candidate && sendScreenSignal({ type: "candidate", from: screenStudentId, to: "teacher", candidate: e.candidate });
    const offer = await screenPc.createOffer();
    await screenPc.setLocalDescription(offer);
    await sendScreenSignal({ type: "offer", from: screenStudentId, to: "teacher", sdp: screenPc.localDescription });
    renderScreenNotice();
  } catch (e) {
    screenPending = false;
    renderScreenNotice();
    if (e.name !== "NotAllowedError") alert("화면 공유를 시작하지 못했습니다: " + e.message);
  }
}

function stopScreenShare(send = true) {
  if (send && screenPc) sendScreenSignal({ type: "video-stopped", from: screenStudentId, to: "teacher" });
  if (screenPc) {
    screenPc.getSenders().forEach((s) => s.track && s.track.stop());
    screenPc.close();
  }
  screenPc = null;
  screenPending = false;
  screenQueuedCandidates = [];
  renderScreenNotice();
}

// 슬라이드를 화면 가득 띄운다. 누르거나 Esc로 닫는다. 선생님이 쪽을 넘기면 띄운 그림도 바뀐다.
function zoom() {
  if (isPptx(state.lesson)) return openPptxFull(state.lesson, viewing);
  if (shell.stageSim) {
    const a = shell.stageSim;
    return loadSim(a).then((html) => openSimFull(a.title, withSimAgent(html)));
  }
  if (shell.zoom) return;
  const big = h("img", { src: shell.img.src, alt: shell.img.alt });
  const box = h("div", { class: "slide-zoom", onclick: close }, big, h("p", {}, "눌러서 닫기 · 휴대폰은 가로로 돌리면 더 크게 보입니다"));
  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    box.remove();
    document.removeEventListener("keydown", esc);
    document.removeEventListener("fullscreenchange", left);
    shell.zoom = null;
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
  shell.who.textContent = state.me.class_no + " " + state.me.name;
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
      src = slideSrc(L, viewing);
      const last = shell.lastPage || viewing;
      swapSlide(shell.img, src, slideFx(L), slideNo(L, last) === slideNo(L, viewing) ? (last === viewing ? 1 : 0) : Math.sign(viewing - last));
      shell.lastPage = viewing;
    }
    if (shell.zoom && shell.zoom.getAttribute("src") !== src) shell.zoom.src = src;
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
  let here = hasSlides ? acts.filter((a) => onPage(a, slideNo(L, viewing))) : acts;
  const anytime = hasSlides ? acts.filter((a) => a.page == null) : [];
  // 「슬라이드 자리에 띄우기」 시뮬레이션은 슬라이드 그림 대신 위쪽에 크게 보인다
  const stageSim = hasSlides ? here.find((a) => a.kind === "sim" && a.sim_full) : null;
  showStageSim(stageSim);
  if (stageSim) here = here.filter((a) => a !== stageSim);
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

async function loadSim(a) {
  const hit = simCache.get(a.id);
  if (hit && hit.ver === a.html_ver) return hit.html;
  const { data, error } = await sb.rpc("student_sim", { p_token: token, p_activity: a.id });
  if (error) throw error;
  const html = typeof data === "string" ? data : "";
  simCache.set(a.id, { ver: a.html_ver, html });
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
      h("p", { class: "muted small" }, "직접 조작해 보세요. 화면이 작으면 「화면 가득 보기」를 누르세요."),
      h("div", { class: "row wrap" },
        h("button", { class: "primary", type: "button", onclick() { loadSim(a).then((html) => showFloatingSim(a.title, withSimAgent(html), a.id + ":" + a.html_ver)); } }, "화면에 띄우기"),
        h("button", { class: "ghost", type: "button", onclick() { loadSim(a).then((html) => openSimFull(a.title, withSimAgent(html))); } }, "화면 가득 보기")),
      f);
    loadSim(a).then((html) => { if (c.key === key) f.srcdoc = withSimAgent(html); })
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
        h("p", { class: "muted small" }, "선생님이 공개했습니다 · " + (a.named ? "이름과 함께" : "이름 없이") + " · " + a.others.length + "명"),
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
  try { draft = JSON.parse(localStorage.getItem(draftKey(a)) || "null"); } catch (e) { draft = null; }
  if (draft && a.saved_at && draft.at < Date.parse(a.saved_at)) draft = null;
  const values = Object.assign({}, a.mine || {}, draft ? draft.values : {});
  const err = h("p", { class: "error" });
  const status = h("p", { class: "status" });
  const btn = h("button", { class: "primary big", type: "button" });
  let sending = false;

  const saveDraft = () => {
    localStorage.setItem(draftKey(a), JSON.stringify({ at: Date.now(), values }));
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
      localStorage.removeItem(draftKey(a));
      c.formSig = null;   // 저장한 내용으로 다시 그린다
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
    btn.disabled = sending || !open || (a.mine && !d);
    btn.textContent = sending ? "저장 중…" : a.kind === "quiz" ? "제출하기" : !a.mine ? "저장하기" : d ? "고친 내용 저장" : "저장됨";
    status.textContent = !open ? "지금은 저장할 수 없습니다." : a.mine && !d ? "✓ 저장 완료 (" + fmtTime(a.saved_at) + ")" : a.mine ? "저장하지 않은 수정 내용이 있습니다." : "";
    status.className = a.mine && !d && open ? "status ok" : "status";
  };

  c.form.replaceChildren(...[
    h("div", { class: "card-head" }, h("h2", {}, a.title), h("span", { class: "badge" }, KIND_NAME[a.kind])),
    activityDescription(a) ? linkedDescription(activityDescription(a)) : null,
    quizDone && a.total ? h("p", { class: "score" }, "점수 " + a.score + " / " + a.total) : null,
    rows, err, btn, status].flat().filter(Boolean));
}
