// 교사 화면 · 「학생 관리」 탭: 명단·응답 표, 학생 화면 크게 보기(동의한 학생만, 시뮬레이션 WebRTC 영상),
// 실시간 화면 일괄 미리보기(동의 학생 작은 칸, 교사 전용 채널 :t).

// ---------- 학생 관리 ----------
function ensureTeacherScreenChannel() {
  const key = screenChannelName(lesson.code);
  if (screenChannel && screenChannelKey === key) return screenChannelReady;
  if (screenChannel) {
    for (const watch of [...screenWatchers.values()]) watch.close();
    sb.removeChannel(screenChannel);
    sb.removeChannel(screenDataCh);
  }
  screenChannelKey = key;
  // 수업 채널: 교사 → 학생 신호와 접속 상태. 학생이 보내는 것은 교사 전용 채널(:t)로만 온다.
  screenChannel = sb.channel(key, { config: { broadcast: { self: false } } });
  screenChannel.on("broadcast", { event: "signal" }, ({ payload }) => handleTeacherScreenSignal(payload));   // 새로고침 전 예전 학생 화면용
  screenChannel.on("presence", { event: "sync" }, updatePresence);
  screenDataCh = sb.channel(screenDataChannelName(lesson.code), { config: { broadcast: { self: false } } });
  screenDataCh.on("broadcast", { event: "signal" }, ({ payload }) => handleTeacherScreenSignal(payload));
  const join = (ch) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("화면 공유 연결을 준비하지 못했습니다. 새로고침해 주세요.")), 10000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error("화면 공유 채널에 연결하지 못했습니다.")); }
    });
  });
  screenChannelReady = Promise.all([join(screenChannel), join(screenDataCh)]).then(() => screenChannel);
  return screenChannelReady;
}

async function sendTeacherScreenSignal(payload) {
  if (screenChannel) await screenChannel.send({ type: "broadcast", event: "signal", payload });
}

async function handleTeacherScreenSignal(message) {
  if (!message || message.to !== "teacher") return;
  const watch = screenWatchers.get(message.from);
  if (!watch) {
    const t = grid && grid.tiles.get(message.from);
    if (t) gridSignal(t, message).catch(() => {});
    return;
  }
  try {
    if (message.type === "mirror") {
      await showMirror(watch, message);
    } else if (message.type === "sim") {
      await takeSimFrame(watch, message);
    } else if (message.type === "sim-rtc") {
      await simRtc(watch, message);
    } else if (message.type === "offer" && message.sdp) {
      await watch.pc.setRemoteDescription(message.sdp);
      for (const candidate of watch.queued) await watch.pc.addIceCandidate(candidate);
      watch.queued = [];
      await watch.pc.setLocalDescription(await watch.pc.createAnswer());
      await sendTeacherScreenSignal({ type: "answer", from: "teacher", to: message.from, sdp: watch.pc.localDescription });
      watch.status.textContent = "학생 화면에 연결했습니다.";
    } else if (message.type === "candidate" && message.candidate) {
      if (watch.pc.remoteDescription) await watch.pc.addIceCandidate(message.candidate);
      else watch.queued.push(message.candidate);
    } else if (message.type === "video-stopped") {
      watch.video.srcObject = null;
      watch.video.hidden = true;
    } else if (message.type === "stopped") {
      watch.status.textContent = "학생이 보여 주기를 멈췄거나 거절했습니다. 다시 요청하려면 창을 닫고 다시 여세요.";
      watch.video.srcObject = null;
      watch.video.hidden = true;
    }
  } catch (e) {
    watch.status.textContent = "화면 연결 오류: " + e.message;
  }
}

// 학생이 보낸 화면을 그리기 전에 스크립트·외부 문서·이벤트 속성을 걷어 낸다.
// keepStyle: 시뮬레이션은 자기 스타일(style·link)이 있어야 모양이 맞으므로 남긴다.
function cleanDoc(html, keepStyle) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script, iframe, object, embed, base, meta, frame" + (keepStyle ? "" : ", link, style")).forEach((el) => el.remove());
  d.querySelectorAll("*").forEach((el) => [...el.attributes].forEach((a) => {
    const bad = /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value) || (/^\s*data:/i.test(a.value) && a.name !== "src");
    if (bad) el.removeAttribute(a.name);
  }));
  return d;
}
function cleanMirror(html, doc) {
  return [...cleanDoc(html, false).body.childNodes].map((n) => doc.importNode(n, true));
}

// 학생 시뮬레이션 장면: k번 시뮬레이션의 마지막 상태를 기억해 두고, 수업 화면이 다시 그려져 자리가 새로 생겨도 바로 다시 칠한다.
// 장면마다 문서를 새로 불러오지 않고 내용·그림만 바꿔 깜박임과 지연을 줄인다.
function simView(watch, k) {
  const doc = watch.frame.contentDocument;
  const hole = doc && doc.querySelector('.sim-mirror[data-k="' + k + '"]');
  if (!hole) return null;
  let v = hole.querySelector("iframe");
  if (!v) {
    v = doc.createElement("iframe");
    v.setAttribute("sandbox", "allow-same-origin");   // 스크립트는 막고 교사 화면이 내용만 넣는다
    v.setAttribute("srcdoc", '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    v.style.cssText = "border:0;display:block;background:#fff;transform-origin:0 0";
    hole.style.cssText = "overflow:hidden;border:1px solid #d0d7e2;border-radius:8px;background:#fff;min-height:60px";
    hole.append(v);
    v.addEventListener("load", () => { v.dataset.ready = "1"; paintSim(watch, k); }, { once: true });
  }
  return v;
}

function paintSim(watch, k) {
  const s = watch.sims.get(k);
  const v = s && simView(watch, k);
  if (!v || !v.dataset.ready || !v.contentDocument) return;
  const d = v.contentDocument;
  if (v.dataset.ver !== String(s.ver)) {
    const c = cleanDoc("<!doctype html><html><head>" + (s.head || "") + "</head><body>" + (s.body || "") + "</body></html>", true);
    d.head.innerHTML = c.head.innerHTML;
    d.body.innerHTML = c.body.innerHTML;
    d.body.setAttribute("style", s.bs || "");
    v.dataset.ver = String(s.ver);
  }
  for (const [i, url] of Object.entries(s.canvases)) {
    d.querySelectorAll('img[data-cra-canvas="' + i + '"]').forEach((img) => { if (img.getAttribute("src") !== url) img.setAttribute("src", url); });
  }
  const scale = Math.min(1, (v.parentNode.clientWidth || 400) / (s.w || 400));
  v.style.width = s.w + "px";
  v.style.height = s.h + "px";
  v.style.transform = "scale(" + scale + ")";
  v.parentNode.style.height = Math.round(s.h * scale) + "px";
  // 영상으로 받는 캔버스는 그림 자리를 영상으로 바꾼다(수업 화면이 다시 그려지면 다시 끼운다)
  if (s.stream && s.vidIdx != null) {
    const img = d.querySelector('img[data-cra-canvas="' + s.vidIdx + '"]');
    if (img) {
      const vid = d.createElement("video");
      vid.muted = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.className = img.className;
      vid.setAttribute("style", (img.getAttribute("style") || "") + ";object-fit:contain;background:#000");
      vid.srcObject = s.stream;
      img.replaceWith(vid);
      vid.play().catch(() => {});
    }
  }
  if (d.scrollingElement) { d.scrollingElement.scrollTop = s.sy || 0; d.scrollingElement.scrollLeft = s.sx || 0; }
}

// 시뮬레이션 영상(WebRTC): 학생 시뮬레이션의 가장 큰 캔버스를 15~30 FPS 영상으로 받는다.
// 연결되면 학생 쪽은 그 캔버스의 JPEG 전송을 멈추고, 연결되지 않으면(학교망이 막는 등) 그림 전송이 그대로 이어진다.
async function teacherIce() {
  const { data } = await sb.auth.getSession();
  return iceServers({ headers: data.session ? { Authorization: "Bearer " + data.session.access_token } : {} });
}
async function simRtc(watch, m) {
  const send = (rtc, extra) => sendTeacherScreenSignal({ type: "sim-rtc", from: "teacher", to: m.from, k: m.k, rtc, ...extra });
  if (m.rtc === "offer" && m.sdp) {
    watch.rtc.get(m.k)?.pc?.close();
    const r = { pc: null, queued: [] };
    watch.rtc.set(m.k, r);   // 접속 정보를 받는 동안 온 연결 후보도 모아 둔다
    const pc = new RTCPeerConnection({ iceServers: await teacherIce(), iceTransportPolicy: forceRelay() ? "relay" : "all" });
    r.pc = pc;
    pc.ontrack = (e) => {
      const s = watch.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
      s.stream = e.streams[0] || new MediaStream([e.track]);
      s.vidIdx = m.idx;
      watch.sims.set(m.k, s);
      (watch.paint || paintSim)(watch, m.k);
    };
    pc.onicecandidate = (e) => e.candidate && send("ice", { candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") send("ok");
      if (pc.connectionState === "failed") { send("fail"); watch.videoText = ""; }
    };
    await pc.setRemoteDescription(m.sdp);
    for (const c of r.queued) await pc.addIceCandidate(c).catch(() => {});
    r.queued = [];
    await pc.setLocalDescription(await pc.createAnswer());
    await send("answer", { sdp: pc.localDescription.toJSON() });
  } else if (m.rtc === "ice" && m.candidate) {
    const r = watch.rtc.get(m.k);
    if (!r) return;
    if (r.pc && r.pc.remoteDescription) await r.pc.addIceCandidate(m.candidate).catch(() => {});
    else r.queued.push(m.candidate);
  }
}

// 영상의 실제 FPS와 지연(왕복 시간의 절반 + 재생 대기 시간)을 1초마다 WebRTC 통계에서 읽는다
async function readRtcStats(watch) {
  for (const r of watch.rtc.values()) {
    if (!r.pc || r.pc.connectionState !== "connected") continue;
    let fps = 0, rtt = 0, jb = 0, relay = false;
    const stats = await r.pc.getStats();
    stats.forEach((x) => {
      if (x.type === "inbound-rtp" && x.kind === "video") {
        fps = x.framesPerSecond || 0;
        if (x.jitterBufferEmittedCount) jb = (x.jitterBufferDelay / x.jitterBufferEmittedCount) * 1000;
      }
      // 실제로 쓰는 연결 쌍의 양 끝 중 하나라도 중계 서버면 「중계」(후보 목록에 중계가 있다는 것만으로는 아님)
      if (x.type === "candidate-pair" && x.nominated && x.state === "succeeded") {
        rtt = (x.currentRoundTripTime || 0) * 1000;
        relay = [x.localCandidateId, x.remoteCandidateId].some((id) => stats.get(id)?.candidateType === "relay");
      }
    });
    watch.videoText = "영상 " + Math.round(fps) + " FPS · 지연 약 " + Math.round(rtt / 2 + jb) + " ms" + (relay ? " (중계)" : " (직접 연결)");
    watch.simInfo.textContent = watch.videoText;
    return;
  }
}

async function takeSimFrame(watch, m) {
  const s = watch.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
  if (typeof m.body === "string") { s.head = m.head; s.body = m.body; s.bs = m.bs; s.ver++; }
  Object.assign(s.canvases, m.canvases || {});
  Object.assign(s, { w: m.w, h: m.h, sx: m.sx, sy: m.sy });
  const now = Date.now();
  s.times = s.times.filter((t) => now - t < 2000).concat(now);
  watch.sims.set(m.k, s);
  await watch.ready;
  paintSim(watch, m.k);
  // 지연은 학생 기기 시계 기준이라 두 기기 시계가 어긋나면 조금 틀릴 수 있다
  const lag = m.t ? now - m.t : null;
  watch.simInfo.textContent = watch.videoText || ("시뮬레이션 " + (s.times.length / 2).toFixed(1) + " FPS"
    + (lag != null && lag >= 0 && lag < 60000 ? " · 지연 " + Math.round(lag) + " ms" : ""));
}

async function showMirror(watch, m) {
  await watch.ready;
  const doc = watch.frame.contentDocument;
  if (!doc || !doc.body) return;
  if (typeof m.html === "string" && m.html !== watch.html) {
    watch.html = m.html;
    doc.body.replaceChildren(...cleanMirror(m.html, doc));
    for (const k of watch.sims.keys()) paintSim(watch, k);   // 새로 생긴 자리에 시뮬레이션 다시 칠하기
  }
  const el = doc.scrollingElement;
  if (el && typeof m.scroll === "number") el.scrollTop = m.scroll * (el.scrollHeight - el.clientHeight);
  watch.frame.style.maxWidth = m.narrow ? "420px" : "";
  watch.status.replaceChildren(
    h("span", { class: "mirror-state" + (m.away ? " away" : "") }, m.away ? "다른 앱이나 탭으로 나가 있음" : "수업 화면을 보고 있음"),
    m.where ? " · " + m.where : "", " · " + new Date().toLocaleTimeString() + " 갱신 · ", watch.simInfo);
}

async function watchStudentScreen(s) {
  if (screenWatchers.size) return alert("실시간 화면은 한 번에 한 명씩 볼 수 있습니다. 먼저 열린 화면 창을 닫아 주세요.");
  const tile = grid && grid.tiles.get(s.id);
  if (tile) tileReset(tile, "크게 보는 중");   // 크게 보는 동안 학생은 원래 화질로 보내고, 닫으면 작은 화면으로 돌아온다
  try {
    await ensureTeacherScreenChannel();
    const video = h("video", { class: "screen-preview", autoplay: true, playsinline: true, muted: true, controls: true, hidden: true });
    const status = h("p", { class: "muted small" }, "학생 화면에 요청을 보냈습니다. 수업 중 보기에 동의한 학생은 바로 보이고, 아니면 학생이 허용할 때까지 기다립니다.");
    const simInfo = h("span", {});
    // 학생이 보낸 화면은 스크립트를 쓸 수 없는 iframe 안에만 그린다(allow-scripts 없음)
    const frame = h("iframe", { class: "mirror-frame", sandbox: "allow-same-origin", title: nameOf(s) + " 수업 화면",
      srcdoc: '<!doctype html><meta charset="utf-8"><base href="' + location.href.replace(/"/g, "") + '"><link rel="stylesheet" href="app.css">'
        + "<style>body{margin:0;padding:8px;background:#f6f7fb}body *{pointer-events:none}</style><body></body>" });
    const ready = new Promise((ok) => frame.addEventListener("load", ok, { once: true }));
    const pc = new RTCPeerConnection({ iceServers: await teacherIce(), iceTransportPolicy: forceRelay() ? "relay" : "all" });
    const close = openModal(nameOf(s) + " · 실시간 화면", h("div", { class: "stack" }, status, frame, video,
      h("p", { class: "muted small" }, "학생의 수업 화면(보고 있는 쪽, 쓰고 있는 답)은 바뀔 때마다, 시뮬레이션은 초당 최대 5장으로 갱신됩니다. 노트북·태블릿·휴대폰 모두 됩니다. PC에서 학생이 「PC 화면 전체 공유」까지 누르면 아래에 영상도 나옵니다.")), () => {
      const back = grid && grid.tiles.get(s.id);
      if (back) { tileReset(back, "작은 화면으로 돌아오는 중…"); askTile(back); }
      else sendTeacherScreenSignal({ type: "stop", from: "teacher", to: s.id, key: screenKey(s) });
      pc.close();
      clearInterval(watch.statsTimer);
      for (const r of watch.rtc.values()) r.pc?.close();
      screenWatchers.delete(s.id);
      screenWatchers.delete(screenKey(s));
    });
    const watch = { pc, video, status, frame, ready, html: "", sims: new Map(), simInfo, rtc: new Map(), videoText: "", queued: [], close };
    watch.statsTimer = setInterval(() => readRtcStats(watch).catch(() => {}), 1000);
    screenWatchers.set(s.id, watch);
    screenWatchers.set(screenKey(s), watch);   // 예전 setup.sql 이면 학생이 학번·이름으로 답한다
    pc.ontrack = (e) => { video.srcObject = e.streams[0]; video.hidden = false; };
    pc.onicecandidate = (e) => e.candidate && sendTeacherScreenSignal({ type: "candidate", from: "teacher", to: s.id, key: screenKey(s), candidate: e.candidate });
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState)) status.textContent = "연결이 끊겼습니다. 학생에게 다시 요청해 주세요.";
    };
    await sendTeacherScreenSignal({ type: "request", from: "teacher", to: s.id, key: screenKey(s) });
  } catch (e) {
    alert(e.message || e);
  }
}

// ---------- 실시간 화면 일괄 미리보기 ----------
// 학생 관리 표의 「일괄 미리보기」 열에 화면 보기에 동의한 학생들의 수업 화면을 작게(320×180, 240p 미만) 띄운다.
// 학생은 가벼운 방식으로 보낸다: 시뮬레이션 캔버스는 WebRTC 영상 6 FPS·높이 180 이하(약 70 kbps, 중계 서버 우선),
// 영상이 막히면 그림 초당 2장(가로 320). 수업 화면(쪽·답)은 바뀔 때만. 화면 내용은 교사만 듣는 채널(:t)로 받는다.
let grid = null;   // { code, ready, keep, tiles: Map(학생 id → 칸) }

function startGrid() {
  grid = { code: lesson.code, tiles: new Map(), ready: false };
  const g = grid;
  // 학생 화면이 「아직 보고 있음」을 알 수 있게 15초마다 한 번(모두에게 한 메시지)
  g.keep = setInterval(() => {
    const ids = [...g.tiles.values()].filter((t) => t.asked).flatMap((t) => [t.s.id, screenKey(t.s)]);
    if (ids.length) sendTeacherScreenSignal({ type: "grid-keep", from: "teacher", to: "grid", ids }).catch(() => {});
  }, 15000);
  ensureTeacherScreenChannel().then(() => {
    if (grid !== g) return;
    g.ready = true;
    drawStudents();
  }).catch((e) => { if (grid === g) { stopGrid(); drawStudents(); alert(e.message || e); } });
}

function stopGrid() {
  if (!grid) return;
  const g = grid;
  grid = null;
  clearInterval(g.keep);
  for (const t of g.tiles.values()) {
    tileReset(t);
    if (t.asked && !screenWatchers.has(t.s.id)) sendTeacherScreenSignal({ type: "stop", from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
  }
}

function dropTile(t) {
  tileReset(t);
  grid.tiles.delete(t.s.id);
  if (t.asked && !screenWatchers.has(t.s.id)) sendTeacherScreenSignal({ type: "stop", from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
}

// 영상 연결을 닫고 받은 화면을 비운다(크게 보기로 넘길 때, 끌 때)
function tileReset(t, text) {
  for (const r of t.rtc.values()) r.pc?.close();
  t.rtc.clear();
  t.sims.clear();
  t.seen = 0;
  if (text) t.cap.textContent = text;
}

function askTile(t) {
  t.asked = Date.now();
  // 영상이 막혀 그림으로 보낼 때 전체가 초당 약 7장을 넘지 않게(무료 Supabase 초당 메시지 한도) 학생이 많을수록 천천히
  const every = Math.min(5000, Math.max(500, grid.tiles.size * 150));
  sendTeacherScreenSignal({ type: "request", lite: true, every, from: "teacher", to: t.s.id, key: screenKey(t.s) }).catch(() => {});
}

function gridTile(s) {
  let t = grid.tiles.get(s.id);
  if (t) { t.s = s; return t; }
  const frame = h("iframe", { class: "tile-frame", sandbox: "allow-same-origin", tabindex: "-1", "aria-hidden": "true",
    srcdoc: '<!doctype html><meta charset="utf-8"><base href="' + location.href.replace(/"/g, "") + '"><link rel="stylesheet" href="app.css">'
      + "<style>html{overflow:hidden}body{margin:0;padding:8px;background:#f6f7fb}body.narrow{max-width:420px;margin:0 auto}"
      + ".sim-mirror img,.sim-mirror video{display:block;width:100%;max-height:540px;object-fit:contain;background:#000;border-radius:8px}"
      + ".sim-mirror p{padding:1.5rem;text-align:center;color:#5b6475;background:#fff;border:1px dashed #c9d1de;border-radius:8px}"
      + "body *{pointer-events:none}</style><body></body>" });
  const cap = h("span", { class: "tile-cap" }, "연결 중…");
  t = { s, frame, cap, html: "", drawn: null, scroll: 0, narrow: false, sims: new Map(), rtc: new Map(), seen: 0, asked: 0, videoText: "", simInfo: h("span") };
  t.paint = () => paintTile(t);
  frame.addEventListener("load", () => { t.loaded = true; t.drawn = null; paintTile(t); });
  t.el = h("div", { class: "live-tile" },
    h("div", { class: "tile-view" }, frame,
      h("button", { class: "tile-hit", type: "button", title: nameOf(s) + " 화면 크게 보기", "aria-label": nameOf(s) + " 화면 크게 보기", onclick() { watchStudentScreen(t.s); } },
        h("span", {}, "⤢ 크게 보기"))),
    cap);
  grid.tiles.set(s.id, t);
  return t;
}

async function gridSignal(t, m) {
  t.seen = Date.now();
  t.el.classList.remove("stale");
  if (m.type === "mirror") {
    if (typeof m.html === "string") t.html = m.html;
    t.scroll = typeof m.scroll === "number" ? m.scroll : 0;
    t.narrow = !!m.narrow;
    t.cap.replaceChildren(h("span", { class: "mirror-state" + (m.away ? " away" : "") }, m.away ? "다른 앱·탭" : "수업 화면"),
      m.where ? " · " + m.where : "", " · " + new Date().toLocaleTimeString());
    paintTile(t);
  } else if (m.type === "sim") {
    const sm = t.sims.get(m.k) || { canvases: {}, ver: 0, times: [] };
    Object.assign(sm.canvases, m.canvases || {});
    t.sims.set(m.k, sm);
    paintTile(t);
  } else if (m.type === "sim-rtc") {
    await simRtc(t, m);
  } else if (m.type === "stopped") {
    tileReset(t, "학생이 보여 주기를 멈췄습니다");
    t.html = "";
    paintTile(t);
  }
}

// 받은 수업 화면을 작은 칸에 그린다: 1000px 너비로 그려 320px로 줄인다. 시뮬레이션 자리에는 영상(없으면 가장 큰 캔버스 그림).
function paintTile(t) {
  const doc = t.loaded && t.frame.contentDocument;
  if (!doc || !doc.body) return;
  if (t.drawn !== t.html) {
    doc.body.replaceChildren(...(t.html ? cleanMirror(t.html, doc) : []));
    t.drawn = t.html;
  }
  doc.body.classList.toggle("narrow", t.narrow);
  doc.querySelectorAll(".sim-mirror[data-k]").forEach((hole) => {
    const sm = t.sims.get(Number(hole.dataset.k));
    if (sm && sm.stream) {
      let v = hole.querySelector("video");
      if (!v) { v = doc.createElement("video"); v.muted = true; v.autoplay = true; v.playsInline = true; hole.replaceChildren(v); }
      if (v.srcObject !== sm.stream) v.srcObject = sm.stream;
      if (v.paused) v.play().catch(() => {});
      return;
    }
    const urls = sm ? Object.values(sm.canvases).filter(Boolean) : [];
    const url = urls.sort((a, b) => b.length - a.length)[0];
    if (url) {
      let img = hole.querySelector("img");
      if (!img) { img = doc.createElement("img"); hole.replaceChildren(img); }
      if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    } else if (!hole.querySelector("p")) {
      hole.replaceChildren(Object.assign(doc.createElement("p"), { textContent: "시뮬레이션" }));
    }
  });
  const el = doc.scrollingElement;
  if (el) el.scrollTop = t.scroll * (el.scrollHeight - el.clientHeight);
}

// 미리보기 칸: 동의한 학생마다 하나. 접속 중인데 8초 넘게 소식이 없으면 다시 요청한다.
function gridCell(s, now) {
  if (s.monitor !== true) {
    const t = grid.tiles.get(s.id);
    if (t) dropTile(t);
    return h("span", { class: "muted small" }, "동의하지 않아 볼 수 없음");
  }
  const t = gridTile(s);
  if (grid.ready && !screenWatchers.has(s.id) && presenceOf(s) !== "off" && now - t.seen > 8000 && now - t.asked > 8000) askTile(t);
  if (presenceOf(s) === "off" && !t.seen) t.cap.textContent = "접속 안 함";
  if (t.seen && now - t.seen > 12000) { t.el.classList.add("stale"); t.cap.textContent = "응답 없음 · 다시 요청 중"; }
  return t.el;
}

function drawStudents() {
  const now = Date.now();
  const rows = students.map((s) => {
    const mine = responses.filter((r) => r.student_id === s.id);
    const last = mine.reduce((t, r) => (r.updated_at > t ? r.updated_at : t), "");
    const locked = s.locked_until && Date.parse(s.locked_until) > now;
    const status = locked ? h("span", { class: "tag warn" }, "잠김 · " + Math.ceil((Date.parse(s.locked_until) - now) / 60000) + "분 남음")
      : !s.pin_set ? h("span", { class: "tag info" }, "초기화됨 · 새 비밀번호 기다리는 중")
      : h("span", { class: "tag ok" }, "정상");
    return h("tr", { class: locked ? "locked" : "" },
      h("td", {}, presenceDot(s), " ", s.class_no), h("td", {}, s.name),
      h("td", {}, mine.length + " / " + activities.filter((a) => a.kind !== "sim").length), h("td", {}, fmtTime(last)), h("td", {}, status),
      h("td", {}, s.monitor === true ? h("span", { class: "tag ok" }, "동의")
        : s.monitor === false ? h("span", { class: "tag" }, "동의 안 함")
        : h("span", { class: "tag info" }, "아직 안 정함")),
      h("td", { class: "grid-cell", "data-sid": s.id }),
      h("td", { class: "actions" },
        h("button", { class: "ghost", type: "button", onclick() { watchStudentScreen(s); } }, "실시간 화면 보기"),
        h("button", {
          class: locked ? "primary" : "ghost", type: "button", disabled: !s.pin_set && !locked,
          async onclick() {
            if (!confirm(nameOf(s) + " 학생의 비밀번호를 초기화할까요?\n모든 수업에 함께 적용됩니다. 쓴 답은 그대로 남고, 다음에 들어올 때 새 비밀번호를 정합니다.")) return;
            const { error } = await sb.from("students").update({ pin_hash: null, token: null, fails: 0, locked_until: null }).eq("id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
            flash("초기화했습니다.");
          },
        }, "비밀번호 초기화"),
        h("button", {
          class: "link danger", type: "button",
          async onclick() {
            if (!confirm(nameOf(s) + " 학생을 이 수업에서 뺄까요? 이 수업에서 쓴 응답이 지워집니다.\n(다른 수업의 응답과 학생 계정은 남습니다. 학생이 다시 들어오면 다시 참여합니다.)")) return;
            const ids = activities.map((a) => a.id);
            if (ids.length) {
              const r = await sb.from("responses").delete().eq("student_id", s.id).in("activity_id", ids);
              if (r.error) return alert(r.error.message);
            }
            const { error } = await sb.from("lesson_students").delete().eq("lesson_id", lesson.id).eq("student_id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
          },
        }, "이 수업에서 빼기"),
        h("button", {
          class: "link danger", type: "button",
          async onclick() {
            if (!confirm(nameOf(s) + " 학생 계정을 완전히 지울까요?\n모든 수업에서 빠지고, 모든 수업의 응답이 지워집니다. 장난으로 만든 이름을 지울 때 쓰세요.")) return;
            const { error } = await sb.from("students").delete().eq("id", s.id);
            if (error) return alert(error.message);
            await loadResponses();
            drawStudents();
          },
        }, "계정 삭제")));
  });
  if (grid) for (const t of [...grid.tiles.values()]) if (!students.some((s) => s.id === t.s.id)) dropTile(t);
  const ids = students.map((s) => s.id).join();
  const cells = new Map(grid ? students.map((s) => [s.id, gridCell(s, now)]) : []);
  // 미리보기 중이고 학생 목록이 그대로면 미리보기 칸은 그대로 두고 나머지 칸만 바꾼다(iframe을 옮기면 다시 불러온다)
  const old = grid && main.querySelector(".students-table");
  if (old && old.dataset.ids === ids && old.dataset.grid === "1") {
    const oldRows = [...old.tBodies[0].rows];
    rows.forEach((row, i) => {
      const was = oldRows[i];
      was.className = row.className;
      [...row.cells].forEach((td, j) => {
        if (!td.classList.contains("grid-cell")) was.cells[j].replaceWith(td);
        else if (was.cells[j].firstChild !== cells.get(td.dataset.sid)) was.cells[j].replaceChildren(cells.get(td.dataset.sid));
      });
    });
    main.querySelector(".students-count").textContent = "학생 " + students.length + "명";
    return;
  }
  for (const td of rows.flatMap((row) => [...row.cells])) if (td.dataset.sid && cells.has(td.dataset.sid)) td.append(cells.get(td.dataset.sid));
  const gridHead = h("th", { class: "grid-head" }, h("button", {
    class: grid ? "grid-toggle on" : "grid-toggle", type: "button", "aria-pressed": grid ? "true" : "false",
    title: "화면 보기에 동의한 학생들의 수업 화면을 작게(240p 미만) 한꺼번에 봅니다",
    onclick() { if (grid) stopGrid(); else startGrid(); drawStudents(); },
  }, grid ? "■ 일괄 미리보기 끄기" : "▦ 실시간 화면 일괄 미리보기"));
  main.replaceChildren(h("section", { class: "card stack" },
    h("div", { class: "row between wrap" },
      h("div", { class: "row" }, h("h2", { class: "students-count" }, "학생 " + students.length + "명"),
        h("button", { class: "ghost", type: "button", onclick() { downloadCSV(activities, lesson.code + "_전체응답"); } }, "전체 응답 CSV")),
      h("p", { class: "muted small" }, "학생 계정은 웹앱 전체에 하나라서, 어느 수업에서든 같은 학번·이름·비밀번호를 씁니다. 실시간 화면은 학생이 가입할 때(또는 수업 화면에서) 「화면 보기」에 동의해야 바로 보이며, 이 수업 화면(보고 있는 쪽, 쓰고 있는 답, 시뮬레이션)만 보입니다. 학생은 언제든 동의를 바꿀 수 있습니다. 크게 보기는 한 번에 한 명, 「일괄 미리보기」는 동의한 학생 모두를 작게(240p 미만, 시뮬레이션 영상 10 FPS) 함께 봅니다. 칸을 누르면 크게 봅니다."),
      h("p", { class: "muted small" }, h("span", { class: "presence on" }), " 수업 화면을 보고 있음 · ", h("span", { class: "presence away" }), " 다른 앱·탭에 있음 · ", h("span", { class: "presence off" }), " 접속 안 함 (바로 바뀝니다)")),
    students.length ? h("div", { class: "table-wrap" }, h("table", { class: "students-table", "data-ids": ids, "data-grid": grid ? "1" : "" },
      h("thead", {}, h("tr", {}, ["학번", "이름", "저장한 활동", "마지막 저장", "상태", "화면 보기"].map((t) => h("th", {}, t)), gridHead, h("th", {}))),
      h("tbody", {}, rows))) : h("p", { class: "muted" }, "아직 입장한 학생이 없습니다.")));
}
