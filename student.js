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

let code = "";          // 수업 코드
let token = null;       // 입장 열쇠(이 기기에 저장)
let state = null;       // 서버에서 받은 수업 상태
let stateV = null;      // 그 상태의 지문(서버가 같으면 다시 보내지 않음)
let liveOk = false;     // 수업 채널에 붙어 있는지
let viewing = 1;        // 학생이 보고 있는 쪽
let following = true;   // 교사가 띄운 쪽을 따라가는 중인지
let timer = null;
let shell = null;
const cards = new Map(); // 활동 id → 화면 카드
let screenChannel = null;
let screenChannelKey = "";
let screenPending = false;
let screenStudentId = null;
// 전체 화면 공유(PC): 동의한 학생이 「전체 화면 공유 시작」으로 화면 전체를 한 번 고르면 수업 내내 켜 두고,
// 교사가 볼 때만 영상(WebRTC)으로 보낸다. 다른 창·앱으로 옮겨도 그대로 보인다. 창·탭만 고르면 다시 고르게 한다.
// 휴대폰·태블릿 브라우저는 화면 공유가 없어 아래 수업 화면 복사로 대신한다.
let deskStream = null;
let deskPc = null;
let deskId = 0;                      // 지금 연결 번호(예전 연결의 답·후보는 버린다)
let deskLive = false;                // 교사에게 영상이 실제로 가는 중(그동안은 수업 화면 복사를 보내지 않는다)
let deskQueued = [];
let deskMsg = "";
// 휴대폰·태블릿은 화면 공유가 없다(아이패드는 Mac처럼 보이지만 터치가 된다)
const mobileDevice = () => !!navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
const canDesk = () => !!navigator.mediaDevices?.getDisplayMedia && !mobileDevice();
let deskGate = null;                 // 동의한 PC 학생이 전체 화면을 공유하기 전까지 수업 화면을 가리는 막
let shareAsked = false;              // 선생님이 「공유 요청」을 보냈고 학생이 아직 답하지 않음(동의 안 한 학생에게 묻는 창)
// 크게 보기: 높이 720·8 FPS·약 600 kbps. 일괄 미리보기(작은 칸 320×180): 높이 180·5 FPS·약 70 kbps(학생 30명 ≈ 시간당 1GB 미만)
const DESK = { full: { h: 720, fps: 8, br: 600000 }, lite: { h: 180, fps: 5, br: 70000 } };
// 실시간 수업 화면: 화면 공유가 없을 때 이 수업 화면(쪽, 쓰고 있는 답)을 복사해 보낸다. 모든 기기·브라우저에서 된다.
let mirrorOn = false;
let mirrorTimer = null;
let mirrorBeat = null;
let lastMirror = "";                 // 마지막으로 보낸 수업 화면(같으면 다시 보내지 않음)
const simStarted = new WeakMap();    // 촬영을 시작한 시뮬레이션 칸 → 그때의 srcdoc 길이
let simQ = 0.6, simW = 640;          // 시뮬레이션 그림 화질·최대 너비(메시지 크기에 따라 자동 조절)
// 일괄 미리보기(lite): 교사가 여러 학생을 작게 함께 볼 때. 시뮬레이션 영상 10 FPS·높이 240 이하, 그림은 초당 2장·가로 320.
// 화면 내용은 교사만 듣는 채널로 HTTP 전송한다. 교사 화면이 15초마다 「계속」을 보내지 않으면(창을 닫는 등) 45초 뒤 스스로 멈춘다.
let mirrorLite = false;
let liteKeep = 0;
let liteEvery = 500;                 // 일괄 미리보기 그림 간격(교사가 학생 수에 맞춰 정함)
let screenDataChannel = null;
// 일괄 미리보기(작은 칸 320×180): 중계 트래픽을 줄이려고 영상은 6 FPS·높이 180·약 70 kbps(학생 30명 ≈ 시간당 1GB 미만)
const LITE = { every: 500, maxW: 320, q: 0.4, rtc: { fps: 6, br: 70000, h: 180 } };

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
  const nameIn = h("input", { type: "text", autocomplete: "off", maxlength: 20, required: true });
  // 이 수업에 처음 들어올 때만: 수업 중 화면 보기 동의(둘 중 하나를 직접 고른다. 동의하지 않아도 수업에 참여할 수 있다)
  const consentYes = h("input", { type: "radio", name: "monitor-consent", value: "yes" });
  const consentNo = h("input", { type: "radio", name: "monitor-consent", value: "no" });
  const consentRow = h("fieldset", { class: "options consent", hidden: true },
    h("legend", {}, "수업 중 화면 보기"),
    h("p", { class: "muted small" }, "수업하는 동안 선생님이 이 기기 화면을 볼 수 있게 할까요? PC에서는 공유한 화면 전체(다른 창·앱 포함)가, 휴대폰·태블릿에서는 이 수업 화면만 보입니다. 선생님이 보고 있을 때는 화면에 표시되고, 나중에 언제든 바꿀 수 있습니다. 동의하지 않아도 수업에 참여할 수 있습니다."),
    h("label", { class: "option" }, consentYes, h("span", {}, "동의합니다")),
    h("label", { class: "option" }, consentNo, h("span", {}, "동의하지 않습니다")));
  let newAccount = false;
  const msg = h("p", { class: "msg" }, notice || "");
  const btn = h("button", { class: "primary big", type: "submit" }, "입장하기");

  // 코드나 이름을 바꾸면 동의 단계를 처음부터 다시
  [codeIn, nameIn].forEach((el) => el.addEventListener("input", () => {
    newAccount = false;
    consentRow.hidden = true;
  }));

  const form = h("form", {
    class: "card stack",
    async onsubmit(e) {
      e.preventDefault();
      if (newAccount && !consentYes.checked && !consentNo.checked) { msg.textContent = "「수업 중 화면 보기」에서 동의 여부를 골라 주세요."; return; }
      btn.disabled = true;
      msg.textContent = "확인 중…";
      const { data, error } = await sb.rpc("student_join", {
        p_code: codeIn.value, p_name: nameIn.value, p_consent: newAccount ? consentYes.checked : null,
      });
      btn.disabled = false;
      if (error) { msg.textContent = "연결하지 못했습니다. 인터넷을 확인하고 다시 시도하세요. (" + error.message + ")"; return; }
      const err = data.error;
      if (err === "no_lesson") msg.textContent = "수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.";
      else if (err === "bad_name") msg.textContent = "이름을 확인하세요(20자까지).";
      else if (err === "full") msg.textContent = "이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.";
      else if (err === "need_consent") {
        newAccount = true;
        consentRow.hidden = false;
        msg.textContent = "처음 들어왔네요. 아래에서 화면 보기 동의 여부를 고른 뒤 입장하세요.";
      } else if (data.token) {
        token = data.token;
        code = data.code;
        localStorage.setItem("cra-last-code", code);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(ME_KEY, whoName(data));
        following = true;
        poll();
      } else msg.textContent = "알 수 없는 오류입니다. 다시 시도하세요.";
    },
  },
    fromLink ? null : h("label", {}, "수업 코드", codeIn),
    h("label", {}, "이름", nameIn),
    consentRow,
    btn, msg);

  app.replaceChildren(h("main", { class: "narrow" },
    h("header", { class: "intro" },
      h("p", { class: "eyebrow" }, fromLink ? "수업 코드 " + code : "수업 응답"),
      h("h1", {}, "입장하기")),
    form));
  (fromLink ? nameIn : codeIn).focus();
}

// 학번이 없는 학생(이름만으로 들어옴)은 이름만
function whoName(s) { return ((s.class_no || "") + " " + s.name).trim(); }

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
  clearTimeout(timer);
  timer = null;
}

async function poll() {
  clearTimeout(timer);
  const { data, error } = await sb.rpc("student_state", { p_token: token, p_code: code, p_have: shell ? stateV : null });
  if (!token) return;
  if (!error && data.error === "no_lesson") return showCodeOnly("수업 코드를 찾지 못했습니다. 선생님께 받은 코드를 확인하세요.");
  if (!error && data.error === "full") return showCodeOnly("이 수업은 인원이 가득 찼습니다. 선생님께 알려 주세요.");
  if (error) {
    if (shell) shell.conn.hidden = false;
    else showEntry("연결하지 못했습니다. 인터넷을 확인하고 다시 입장하세요.");
  } else if (data.error === "logged_out") {
    return logout("다시 입장해 주세요. 선생님이 비밀번호를 초기화했거나 학생 정보가 지워졌습니다.");
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

function ensureScreenChannel() {
  // 채널 이름은 수업 코드로 만든다(예전 setup.sql 은 수업 id·학생 id를 보내 주지 않음)
  if (!state) return;
  const key = screenChannelName(state.lesson.code || code);
  if (!key) return;
  if (screenChannel && screenChannelKey === key) return;
  closeDeskPc();
  if (screenChannel) sb.removeChannel(screenChannel);
  screenChannelKey = key;
  // 학생 id가 없으면 학번·이름으로 알아본다(교사 화면도 같은 이름을 함께 보냄)
  screenStudentId = state.me.id || screenKey(state.me);
  // presence: 교사 화면에 접속 상태(보고 있음/다른 앱·탭)만 알린다. 화면 내용은 보내지 않는다.
  screenChannel = sb.channel(key, { config: { broadcast: { self: false }, presence: { key: screenStudentId } } });
  screenChannel.on("broadcast", { event: "signal" }, ({ payload }) => handleScreenSignal(payload));
  screenChannel.on("broadcast", { event: "nudge" }, pollSoon);
  const ch = screenChannel;
  ch.subscribe((status, err) => {
    if (ch !== screenChannel) return;
    liveOk = status === "SUBSCRIBED";
    if (liveOk) return trackPresence(true);
    console.warn("수업 채널: " + status + (err ? " · " + (err.message || err) : ""));
    // 서버가 채널을 닫으면(CLOSED) 스스로 다시 붙지 않는다: 교사 신호·접속 표시가 멈추므로 새로 만든다.
    // (CHANNEL_ERROR·TIMED_OUT 은 supabase-js 가 알아서 다시 붙는다)
    if (status === "CLOSED") setTimeout(() => rejoinScreenChannel(ch), 2000);
  });
}
function rejoinScreenChannel(ch) {
  if (ch !== screenChannel || !state) return;
  sb.removeChannel(ch);
  screenChannel = null;
  screenChannelKey = "";
  ensureScreenChannel();
  if (mirrorOn) { lastMirror = ""; sendMirror(); offerDesk(); }   // 끊긴 동안 교사 답을 못 받았으니 영상도 다시 잇는다
}

// 수업 중 화면 보기 동의: 가입할 때 묻고 학생 계정에 저장한다(모든 수업·기기에 적용, 언제든 바꿀 수 있다).
// 아직 안 정한 기존 학생은 수업 화면에서 한 번 묻는다. 예전 setup.sql(동의 칸 없음)이면 이 기기에만 기억한다.
const monitorKey = () => "cra-monitor:" + String(state?.lesson.code || code || "").toUpperCase();
const monitorInAccount = () => !!(state?.me && "monitor" in state.me);
function monitorChoice() {
  if (monitorInAccount()) return state.me.monitor === true ? "yes" : state.me.monitor === false ? "no" : null;
  try { return localStorage.getItem(monitorKey()); } catch { return null; }
}
// 끄기: 무엇이 바뀌는지 한 번 더 보여 주고 고르게 한다(입장할 때 묻는 것과 같은 설명)
function askMonitorOff() {
  if (confirm("화면 보기 허용을 끌까요?\n끄면 선생님이 이 기기 화면을 볼 수 없고, 선생님 명단에 「철회함」으로 바로 표시됩니다.\n이 안내 칸의 「보기 허용 켜기」로 언제든 다시 켤 수 있습니다.")) setMonitorChoice("no");
}
// 켜기: PC면 곧바로 전체 화면 공유 창도 띄운다(브라우저는 누른 그 순간에만 띄워 준다)
function turnMonitorOn() {
  shareAsked = false;
  if (canDesk() && !deskStream) startDesk();
  setMonitorChoice("yes");
  if (screenPending) startMirror();
}
async function setMonitorChoice(v) {
  if (v === "no") { stopMirror(); stopDesk(); }
  if (monitorInAccount()) {
    state.me.monitor = v === "yes";
    renderScreenNotice();
    try { await sb.rpc("student_set_monitor", { p_token: token, p_consent: v === "yes" }); } catch {}
  } else {
    try { localStorage.setItem(monitorKey(), v); } catch {}
  }
  renderScreenNotice();
}

function renderScreenNotice() {
  if (!shell || !shell.screenNotice) return;
  const choice = monitorChoice();
  const deskBtn = canDesk() && !deskStream ? h("button", { class: "primary", type: "button", onclick: startDesk }, "전체 화면 공유 시작") : null;
  const deskAsk = deskMsg || (deskBtn ? " 「전체 화면 공유 시작」을 누르고 「전체 화면」을 골라 주세요." : "");
  let text, buttons;
  if (!choice) {
    text = "수업하는 동안 선생님이 이 기기 화면을 볼 수 있게 할까요? PC에서는 공유한 화면 전체(다른 창·앱 포함)가, 휴대폰·태블릿에서는 이 수업 화면만 보입니다. 한 번 정하면 모든 수업에 적용되고, 언제든 바꿀 수 있습니다.";
    buttons = [h("button", { class: "primary", type: "button", onclick() { setMonitorChoice("yes"); if (screenPending) startMirror(); } }, "동의"),
      h("button", { class: "ghost", type: "button", onclick() { setMonitorChoice("no"); } }, "동의 안 함")];
  } else if (choice === "yes") {
    text = deskStream ? (mirrorOn && mirrorLite ? "● 선생님이 지금 여러 학생의 화면을 작게 함께 보고 있습니다(전체 화면)."
        : mirrorOn ? "● 선생님이 지금 이 PC의 화면 전체를 보고 있습니다." : "전체 화면을 공유해 두었습니다. 선생님이 볼 때만 보냅니다(동의함).")
      : mirrorOn && mirrorLite ? "● 선생님이 지금 여러 학생의 수업 화면을 작게 함께 보고 있습니다." + deskAsk
      : mirrorOn ? "● 선생님이 지금 이 수업 화면을 보고 있습니다." + deskAsk
      : "선생님이 수업 중 이 화면을 볼 수 있습니다(동의함)." + deskAsk;
    buttons = [deskBtn, h("button", { class: "ghost", type: "button", onclick: askMonitorOff }, "보기 허용 끄기")];
  } else if (screenPending) {
    text = "선생님이 실시간 화면 보기를 요청했습니다. 허용하면 이 수업 화면이 보이고, PC에서 전체 화면 공유까지 켜면 화면 전체가 보입니다.";
    buttons = [h("button", { class: "primary", type: "button", onclick: startMirror }, "이번만 허용"),
      h("button", { class: "ghost", type: "button", onclick() { setMonitorChoice("yes"); startMirror(); } }, "수업 내내 허용"),
      h("button", { class: "ghost", type: "button", onclick() { stopMirror(); } }, "거절")];
  } else if (mirrorOn) {
    text = deskStream ? "● 이 PC의 화면 전체를 선생님께 보여 주는 중입니다." : "● 이 수업 화면을 선생님께 보여 주는 중입니다." + deskAsk;
    buttons = [deskBtn, h("button", { class: "ghost", type: "button", onclick() { stopMirror(); stopDesk(); } }, "그만 보여 주기")];
  } else {   // 보기 허용을 끈 학생: 안내 칸을 남겨 두어 언제든 다시 켤 수 있게
    text = "화면 보기 허용이 꺼져 있습니다. 선생님은 이 기기 화면을 볼 수 없습니다.";
    buttons = [h("button", { class: "primary", type: "button", onclick: turnMonitorOn }, "보기 허용 켜기")];
  }
  shell.screenNotice.hidden = !text;
  shell.screenNotice.classList.toggle("live", mirrorOn);
  shell.screenNotice.classList.toggle("ask", !!(mirrorOn && deskBtn));   // 선생님이 보는데 전체 화면 공유가 꺼져 있음
  shell.screenNotice.replaceChildren(...(text ? [h("span", {}, text), h("span", { class: "row" }, buttons)] : []));
  renderDeskGate(choice === "yes" && !!deskBtn, choice !== "yes" && shareAsked);
  trackPresence();
}

// 화면 보기에 동의한 PC 학생은 화면 전체를 공유해야 수업 화면이 열린다(창·탭만 고르면 열리지 않음).
// 공유 대신 동의를 철회할 수도 있지만, 그러면 선생님 명단에 바로 「철회함」으로 보인다.
// ask: 동의하지 않은 학생에게 선생님의 「공유 요청」을 보여 준다(거절하면 막이 닫히고 수업은 그대로 열린다)
function renderDeskGate(on, ask = false) {
  if (!on && !ask) {
    if (deskGate) deskGate.remove();
    deskGate = null;
    document.body.classList.remove("desk-locked");
    return;
  }
  if (!deskGate) {
    deskGate = h("div", { class: "desk-gate", role: "dialog", "aria-modal": "true", "aria-labelledby": "desk-gate-title" });
    document.body.append(deskGate);
  }
  document.body.classList.add("desk-locked");
  if (!on) return deskGate.replaceChildren(h("div", { class: "card stack" },
    h("h2", { id: "desk-gate-title" }, "선생님이 화면 공유를 요청했습니다"),
    h("p", {}, canDesk() ? "수업하는 동안 선생님이 이 PC 화면 전체(다른 창·앱 포함)를 볼 수 있게 화면 보기를 허용하고 전체 화면을 공유해 달라는 요청입니다."
      : "수업하는 동안 선생님이 이 기기의 수업 화면을 볼 수 있게 화면 보기를 허용해 달라는 요청입니다."),
    canDesk() ? h("p", { class: "small" }, "「허용하고 공유 시작」을 누른 뒤 뜨는 창에서 「전체 화면」을 고르고 「공유」를 누르세요.") : null,
    h("div", { class: "row wrap" },
      h("button", { class: "primary", type: "button", onclick: turnMonitorOn }, canDesk() ? "허용하고 공유 시작" : "허용"),
      h("button", { class: "ghost", type: "button", onclick() { shareAsked = false; renderScreenNotice(); } }, "이번에는 안 함"))));
  deskGate.replaceChildren(h("div", { class: "card stack" },
    h("h2", { id: "desk-gate-title" }, "화면 전체를 공유해야 수업이 열립니다"),
    h("p", {}, "수업 중 화면 보기에 동의했으므로, 이 PC에서는 화면 전체를 선생님과 공유해야 합니다. 열려 있는 다른 창·앱도 함께 보입니다."),
    h("ol", { class: "small" },
      h("li", {}, "아래 「전체 화면 공유 시작」을 누릅니다."),
      h("li", {}, "뜨는 창에서 「전체 화면」(또는 「화면 전체」) 탭을 고르고 화면을 누릅니다. 창이나 탭 하나만 고르면 열리지 않습니다."),
      h("li", {}, "「공유」를 누릅니다. 새로고침하면 다시 해야 합니다.")),
    deskMsg ? h("p", { class: "error" }, deskMsg.trim()) : null,
    h("div", { class: "row wrap" },
      h("button", { class: "primary", type: "button", onclick: startDesk }, "전체 화면 공유 시작"),
      h("button", { class: "ghost", type: "button", onclick() {
        if (confirm("화면 보기 동의를 철회할까요?\n선생님 명단에 「철회함」으로 바로 표시됩니다. 나중에 다시 동의할 수 있습니다.")) setMonitorChoice("no");
      } }, "화면 보기 동의 철회"))));
}

function startMirror(lite = false) {
  mirrorLite = lite;
  liteKeep = Date.now();
  screenPending = false;
  mirrorOn = true;
  lastMirror = "";
  clearInterval(mirrorBeat);
  mirrorBeat = setInterval(sendMirror, 4000);
  renderScreenNotice();
  sendMirror();
  offerDesk();
}

function stopMirror(send = true) {
  const was = mirrorOn || screenPending;
  mirrorOn = false;
  mirrorLite = false;
  screenPending = false;
  clearInterval(mirrorBeat);
  clearTimeout(mirrorTimer);
  mirrorBeat = mirrorTimer = null;
  closeDeskPc();
  // 멈춘 시뮬레이션은 다음에 보여 줄 때(일괄 미리보기 ↔ 크게 보기) 촬영기·영상을 다시 시작해야 한다
  stopSimAgents();
  if (send && was) sendScreenSignal({ type: "stopped", from: screenStudentId, to: "teacher" });
  renderScreenNotice();
}
function stopSimAgents() {
  simFrames().forEach((f) => { f.contentWindow?.postMessage({ craMirror: "stop" }, "*"); simStarted.delete(f); });
}

// ---- 전체 화면 공유 ----
// 브라우저가 학생에게 직접 고르게 한다(누를 때마다). 고른 뒤에는 브라우저가 「공유 중」 표시를 계속 띄우고, 학생이 끄면 선생님 화면에도 바로 나온다.
async function startDesk() {
  if (!canDesk()) return alert("이 기기에서는 전체 화면 공유를 쓸 수 없습니다. 수업 화면은 계속 선생님께 보입니다.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor", height: { max: 1080 }, frameRate: { ideal: 8, max: 10 } }, audio: false,
      monitorTypeSurfaces: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude", systemAudio: "exclude",
    });
  } catch (e) {
    if (e.name !== "NotAllowedError") alert("전체 화면 공유를 시작하지 못했습니다: " + e.message);
    return;
  }
  const track = stream.getVideoTracks()[0];
  const set = track ? track.getSettings() : {};
  // 창·탭만 고르면 그 밖의 활동이 보이지 않는다. 종류를 알려 주지 않는 브라우저는 영상 비율이 모니터와 같을 때만 받는다
  const whole = set.displaySurface ? set.displaySurface === "monitor"
    : !!(set.width && set.height) && Math.abs(set.width / set.height - screen.width / screen.height) < 0.02;
  if (!track || !whole) {
    stream.getTracks().forEach((t) => t.stop());
    deskMsg = " 창이나 탭이 아니라 「전체 화면」을 골라 주세요.";
    return renderScreenNotice();
  }
  stopDesk();
  deskMsg = "";
  track.contentHint = "detail";   // 글자가 또렷하게(움직임보다 선명함 우선)
  track.addEventListener("ended", () => { if (deskStream === stream) deskEnded(); });
  deskStream = stream;
  renderScreenNotice();
  if (mirrorOn) sendMirror();
  offerDesk();
}

// 학생이 브라우저의 「공유 중지」를 눌렀다: 선생님께 알리고 수업 화면 복사로 돌아간다
function deskEnded() {
  stopDesk();
  if (mirrorOn) sendScreenSignal({ type: "desk-off", from: screenStudentId, to: "teacher" }).catch(() => {});
  if (mirrorOn) sendMirror();
}

function stopDesk() {
  closeDeskPc();
  if (deskStream) deskStream.getTracks().forEach((t) => t.stop());
  deskStream = null;
  renderScreenNotice();
}

function closeDeskPc() {
  deskId++;
  if (deskPc) deskPc.close();
  deskPc = null;
  deskQueued = [];
  if (deskLive) lastMirror = "";   // 영상이 끊기면 수업 화면 복사를 다시 처음부터
  deskLive = false;
}

// 교사가 볼 때마다(크게 보기 ↔ 일괄 미리보기) 새 연결로 보낸다. 화질은 그때 방식에 맞춘다.
async function offerDesk() {
  closeDeskPc();
  if (!deskStream || !mirrorOn || !state || typeof RTCPeerConnection !== "function") return;
  const id = deskId;
  const ice = await iceServers({ body: { token, code: state.lesson.code || code } });
  if (id !== deskId || !deskStream) return;
  const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: relayFirst(ice) ? "relay" : "all" });
  deskPc = pc;
  const track = deskStream.getVideoTracks()[0];
  const o = mirrorLite ? DESK.lite : DESK.full;
  pc.addTransceiver(track, { direction: "sendonly", streams: [deskStream],
    sendEncodings: [{ maxBitrate: o.br, maxFramerate: o.fps, scaleResolutionDownBy: Math.max(1, (track.getSettings().height || o.h) / o.h) }] });
  pc.onicecandidate = (e) => e.candidate && id === deskId && sendScreenSignal({ type: "candidate", from: screenStudentId, to: "teacher", pid: id, candidate: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    if (id !== deskId) return;
    const live = pc.connectionState === "connected";
    if (live === deskLive) return;
    if (live) stopSimAgents();   // 시뮬레이션도 화면 영상에 함께 보인다
    else lastMirror = "";
    deskLive = live;
    sendMirror();
  };
  await pc.setLocalDescription(await pc.createOffer());
  if (id === deskId) await sendScreenSignal({ type: "offer", from: screenStudentId, to: "teacher", pid: id, lite: mirrorLite, sdp: pc.localDescription.toJSON() });
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
const simHidden = (f) => !!f.closest(".sim-over.off");
// 다른 쪽이라 숨겨 둔 얹기 시뮬레이션은 장면을 보내지 않는다(그 쪽으로 넘기면 다음 전송 때 다시 시작)
function stopHiddenSimAgents() {
  for (const f of simFrames()) if (simHidden(f) && simStarted.has(f)) { f.contentWindow?.postMessage({ craMirror: "stop" }, "*"); simStarted.delete(f); }
}
function startSimAgents() {
  for (const f of simFrames()) {
    if (simHidden(f) || simStarted.get(f) === f.srcdoc.length) continue;
    simStarted.set(f, f.srcdoc.length);
    const start = () => {
      f.contentWindow?.postMessage(mirrorLite ? { craMirror: "start", every: liteEvery, maxW: LITE.maxW, q: LITE.q, lite: true }
        : { craMirror: "start", every: 200, maxW: simW, q: simQ }, "*");
      // 캔버스가 있으면 영상(WebRTC)으로도 보낸다. 중계 서버 접속 정보는 학생 토큰으로 받는다.
      iceServers({ body: { token, code: state.lesson.code || code } })
        .then((ice) => f.contentWindow?.postMessage({ craRtc: "start", ice, relay: relayFirst(ice), opt: mirrorLite ? LITE.rtc : null }, "*"));
    };
    if (!f.__craLoad) { f.__craLoad = true; f.addEventListener("load", () => { if (mirrorOn && !simHidden(f) && simStarted.has(f)) start(); }); }
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
  ack.q = mirrorLite ? Math.min(simQ, LITE.q) : simQ;
  ack.maxW = mirrorLite ? Math.min(simW, LITE.maxW) : simW;
  if (size > 230000) return e.source.postMessage({ ...ack, resend: 1 }, "*");   // 너무 크면 버리고 줄인 크기로 다시
  const { craSim, ...frame } = m;
  try { await sendScreenData({ type: "sim", from: screenStudentId, to: "teacher", k, ...frame }); } catch {}
  e.source.postMessage(ack, "*");
});
["input", "change", "click", "scroll"].forEach((t) => document.addEventListener(t, queueMirror, { capture: true, passive: true }));
document.addEventListener("visibilitychange", () => { trackPresence(); if (mirrorOn) sendMirror(); });
// desk: on(전체 화면 공유 중) · off(PC인데 공유 안 함) · none(휴대폰·태블릿) · no(화면 보기 동의 안 함). multi: 모니터가 여러 대
// 보내기에 실패하면(track 은 실패해도 "timed out"·"error" 를 돌려줄 뿐 던지지 않음) 기억을 지우고 3초 뒤 다시 보낸다
let lastPresence = "";
let presenceRetry = null;
function trackPresence(force) {
  if (!screenChannel || screenChannel.state !== "joined") return;
  const p = { away: document.hidden, desk: monitorChoice() !== "yes" ? "no" : !canDesk() ? "none" : deskStream ? "on" : "off", multi: !!screen.isExtended };
  const k = JSON.stringify(p);
  if (k === lastPresence && !force) return;
  lastPresence = k;
  clearTimeout(presenceRetry);
  const failed = () => {
    if (lastPresence !== k) return;   // 그사이 새 상태를 보냈다
    lastPresence = "";
    presenceRetry = setTimeout(() => trackPresence(), 3000);
  };
  screenChannel.track(p).then((r) => { if (r !== "ok") failed(); }, failed);
}
// 「ok」를 받고도 서버에 예전 상태가 남는 때가 있다(교사 명단에 「공유 안 함」이 남음).
// 15초마다 서버가 가진 내 상태(presenceState)를 보고 다르면 다시 보낸다.
setInterval(() => {
  if (!lastPresence || !screenChannel || screenChannel.state !== "joined") return;
  const metas = screenChannel.presenceState()[screenStudentId] || [];
  if (!metas.some((m) => JSON.stringify({ away: m.away, desk: m.desk, multi: m.multi }) === lastPresence)) trackPresence(true);
}, 15000);

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
  clone.querySelectorAll(".screen-share-note, .slide-under").forEach((el) => el.remove());
  clone.querySelectorAll(".slide").forEach((el) => el.classList.remove("fx-step", "fx-fade", "fx-zoom", "fx-push-next", "fx-push-prev"));   // 갱신마다 전환 효과가 다시 돌지 않게
  // 시뮬레이션 자리는 번호만 남긴다. 교사 화면이 그 자리에 시뮬레이션 장면을 그린다.
  const all = simFrames();
  const inMain = [...main.querySelectorAll("iframe")];
  clone.querySelectorAll("iframe").forEach((el, i) => {
    const k = all.indexOf(inMain[i]);
    el.replaceWith(k >= 0 ? h("div", { class: "sim-mirror", "data-k": k }) : h("p", { class: "card muted" }, "[화면]"));
  });
  clone.querySelectorAll(".sim-over.off").forEach((el) => el.remove());   // 다른 쪽이라 숨겨 둔 것
  // 수업 화면 밖에 띄운 시뮬레이션(떠 있는 창·화면 가득)은 맨 위에 붙인다
  all.forEach((f, k) => {
    if (!main.contains(f)) clone.prepend(h("section", { class: "card" }, h("p", { class: "muted small" }, "학생이 띄운 시뮬레이션"), h("div", { class: "sim-mirror", "data-k": k })));
  });
  return clone.outerHTML;
}

// 화면이 그대로면 무거운 화면 내용은 빼고 상태만 보낸다(4초마다 살아 있음 알림).
// 전체 화면 영상이 가는 동안에는 수업 화면 복사·시뮬레이션 그림을 보내지 않는다(영상에 모두 보임).
// desk: on(영상 전송 중) · ready(공유했고 연결 중) · off(PC인데 전체 화면 공유 안 함) · none(이 기기는 화면 공유 없음)
function sendMirror() {
  if (!mirrorOn || !state) return;
  if (mirrorLite && Date.now() - liteKeep > 45000) return stopMirror(false);   // 교사가 일괄 미리보기를 닫았다
  if (!deskLive) startSimAgents();
  const max = document.documentElement.scrollHeight - innerHeight;
  const msg = {
    type: "mirror", from: screenStudentId, to: "teacher",
    where: state.lesson.slide_count ? slideLabel(state.lesson, viewing) : "", away: document.hidden,
    scroll: max > 0 ? scrollY / max : 0, narrow: innerWidth < 700, t: Date.now(),
    desk: deskLive ? "on" : deskStream ? "ready" : canDesk() ? "off" : "none",
  };
  if (!deskLive) {
    const html = mirrorSnapshot();
    if (html !== lastMirror) { msg.html = html; lastMirror = html; }
  }
  sendScreenData(msg).catch(() => {});
}

// 교사에게 보내는 것(화면 내용·영상 연결 신호)은 모두 교사만 듣는 채널로 HTTP로 보낸다.
// 수업 채널로 보내면 같은 수업의 다른 학생 기기도 전부 받아서 버리게 된다.
async function sendScreenData(payload) {
  const key = screenDataChannelName(state.lesson.code || code);
  if (!screenDataChannel || screenDataChannel.key !== key) {
    if (screenDataChannel) sb.removeChannel(screenDataChannel.ch);
    screenDataChannel = { key, ch: sb.channel(key) };   // 구독하지 않는다(다른 학생 화면을 받지 않음)
  }
  await screenDataChannel.ch.httpSend("signal", payload);
}

async function sendScreenSignal(payload) {
  if (!state) return;
  await sendScreenData(payload);
}

async function handleScreenSignal(message) {
  if (message && message.type === "grid-keep") {   // 일괄 미리보기가 아직 열려 있음
    if (mirrorLite && (message.ids || []).includes(screenStudentId)) liteKeep = Date.now();
    return;
  }
  if (message && message.type === "ask-share" && message.to === "all") {   // 선생님이 모든 학생에게 보기 허용·전체 화면 공유를 권함
    if (monitorChoice() !== "yes") shareAsked = true;
    renderScreenNotice();   // 동의했지만 공유하지 않은 PC 학생에게는 원래 막이 보인다
    return;
  }
  if (!message || (message.to !== screenStudentId && message.key !== screenKey(state.me))) return;
  if (message.type === "request") {
    const lite = !!message.lite;
    if (lite) liteEvery = Math.min(5000, Math.max(LITE.every, Number(message.every) || LITE.every));
    if (mirrorOn) {   // 새로 연 교사 창에 전부 다시(크게 보기 ↔ 일괄 미리보기면 방식도 바꾼다)
      mirrorLite = lite;
      liteKeep = Date.now();
      closeDeskPc();   // 영상은 새 방식으로 다시 잇는다. 그동안 볼 수 있게 수업 화면 복사를 먼저 보낸다
      lastMirror = "";
      simFrames().forEach((f) => simStarted.delete(f));
      renderScreenNotice();
      sendMirror();
      return offerDesk();
    }
    if (monitorChoice() === "yes") return startMirror(lite);   // 수업 중 보기에 동의한 학생은 묻지 않고 바로
    if (lite) return;   // 일괄 미리보기는 동의한 학생만. 동의하지 않은 학생에게는 묻지 않는다
    screenPending = true;
    renderScreenNotice();
    return;
  }
  if (message.type === "stop") {
    stopMirror(false);
    return;
  }
  if (message.type === "sim-rtc") {   // 교사가 보낸 영상 연결 신호를 해당 시뮬레이션으로
    if (mirrorOn) simFrames()[message.k]?.contentWindow?.postMessage({ craRtc: message.rtc, sdp: message.sdp, candidate: message.candidate }, "*");
    return;
  }
  // 전체 화면 영상 연결 신호(예전 연결 번호는 버린다)
  if (!deskPc || message.pid !== deskId) return;
  if (message.type === "answer" && message.sdp) {
    await deskPc.setRemoteDescription(message.sdp);
    for (const c of deskQueued) await deskPc.addIceCandidate(c).catch(() => {});
    deskQueued = [];
  } else if (message.type === "candidate" && message.candidate) {
    if (deskPc.remoteDescription) await deskPc.addIceCandidate(message.candidate).catch(() => {});
    else deskQueued.push(message.candidate);
  }
}

// 슬라이드를 화면 가득 띄운다. 누르거나 Esc로 닫는다. 선생님이 쪽을 넘기면 띄운 그림도 바뀐다.
function zoom() {
  if (isPptx(state.lesson)) return openPptxFull(state.lesson, viewing);
  if (shell.stageSim) {
    const a = shell.stageSim;
    return loadSim(a).then((html) => openSimFull(a.title, withSimAgent(html)));
  }
  if (shell.zoom) return;
  const big = h("img", { src: slideSrc(state.lesson, viewing), alt: shell.img.alt });   // 크게 볼 때만 큰 그림(1280px)을 받는다
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
  if (!hit) try { hit = JSON.parse(localStorage.getItem("cra-sim:" + a.id)); } catch {}
  if (hit && hit.ver === a.html_ver) { simCache.set(a.id, hit); return hit.html; }
  const { data, error } = await sb.rpc("student_sim", { p_token: token, p_activity: a.id });
  if (error) throw error;
  const html = typeof data === "string" ? data : "";
  hit = { ver: a.html_ver, html };
  simCache.set(a.id, hit);
  if (html.length < 500000) try { localStorage.setItem("cra-sim:" + a.id, JSON.stringify(hit)); } catch {}
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
  try { draft = JSON.parse(localStorage.getItem(draftKey(a)) || "null"); } catch (e) { draft = null; }
  if (draft && a.saved_at && draft.at < Date.parse(a.saved_at)) draft = null;
  const values = Object.assign({}, a.mine || {}, draft ? draft.values : {});
  const err = h("p", { class: "error" });
  const status = h("p", { class: "status" });
  const btn = h("button", { class: "primary big", type: "button" });
  // 저장한 뒤에는 답을 잠그고 「저장됨」으로 보여 준다. 「수정하기」를 누르면 다시 고칠 수 있고, 「취소」는 저장한 답으로 되돌린다.
  let unlocked = false;
  const editBtn = h("button", { class: "ghost big", type: "button", hidden: true, onclick() {
    if (unlocked) {   // 취소: 고치던 내용을 버리고 저장한 답으로
      localStorage.removeItem(draftKey(a));
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
