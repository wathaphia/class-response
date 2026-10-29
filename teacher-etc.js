// 교사 화면 · 「기타 관리」 탭: Supabase·Cloudflare·GitHub 무료 한도 대비 사용량 원 그래프·표, 동기화 규칙·비용.
// 받는 곳: Supabase resource_usage(), Worker /usage(class-toolscf-worker), GitHub API. 시각은 모두 한국 시간.

// ---------- 기타 관리 ----------
// 이 웹앱이 쓰는 바깥 서비스(Supabase · Cloudflare · GitHub)의 무료 한도에 견준 사용량을 원 띠 그래프와 표로 보여 준다.
// 받는 곳은 셋: Supabase 함수 resource_usage(DB 안 숫자), Worker /usage(Supabase 관리 API·Cloudflare 숫자), GitHub 공개 API.
// 탭을 열면 5분 넘게 지난 것만, 「동기화」를 누르면 모두 다시 받는다. 탭을 열어 두면 DB 안 숫자(접속 중 학생 등)만 30초마다 새로 받는다
// (창이 가려져 있으면 받지 않고, 다시 보일 때 받는다)
// (Worker는 KV 목록 읽기 하루 1,000번, GitHub는 이 PC에서 시간당 60번 한도라 저절로 다시 받지 않는다).
const GITHUB_REPO = "wathaphia/class-response";
const MB = 1024 * 1024, GB = 1024 * MB;
// 기타 관리의 시각·날짜·달은 모두 한국 시간(UTC+9). kstIso(t)는 그 시각의 한국 벽시계를 ISO 꼴로(끝의 Z는 무시)
const KST_MS = 9 * 3600000, TZ = "Asia/Seoul";
const kstIso = (t = Date.now()) => new Date(+t + KST_MS).toISOString();
const kstMonthStart = (t = Date.now(), add = 0) => { const d = new Date(+t + KST_MS); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) - KST_MS; };
const kstClock = (t, o = {}) => new Date(t).toLocaleTimeString("ko-KR", { timeZone: TZ, ...o });
// 동기화: 자동은 1시간마다(이 탭이 화면에 보일 때만), 「동기화」 버튼은 마지막 동기화 뒤 10분이 지나야 다시 누를 수 있다.
// 받은 값은 이 브라우저에 남겨 두어(cra-usage) 새로 고침해도 다시 받지 않는다.
const ETC_AUTO_MS = 60 * 60 * 1000;
const ETC_MANUAL_MS = 10 * 60 * 1000;
const ETC_CHECK_MS = 30000;
let usage = {};            // 받는 곳 이름 → { data, at, net } 또는 { error, at, net }. net = 이 동기화가 브라우저에서 보낸 요청 수·받은 양
try { usage = JSON.parse(localStorage.getItem("cra-usage")) || {}; } catch {}
let usageBusy = false;
let etcTimer = null;

async function usageDb(net) {
  net.requests++;
  const { data, error } = await sb.rpc("resource_usage");
  if (error) throw new Error(/resource_usage/.test(error.message) ? "Supabase SQL Editor에서 setup.sql을 한 번 더 실행하세요." : error.message);
  net.bytes += JSON.stringify(data).length;
  return data;
}
async function usageWorker(net) {
  const url = typeof TURN_URL === "string" ? TURN_URL.trim().replace(/\/$/, "") : "";
  if (!url) throw new Error("config.js에 TURN_URL이 없습니다.");
  const { data } = await sb.auth.getSession();
  net.requests++;
  const r = await fetch(url + "/usage", {
    method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + (data.session ? data.session.access_token : "") }, body: "{}",
  });
  if (!r.ok) throw new Error("Worker 응답 " + r.status);
  const text = await r.text();
  net.bytes += text.length;
  const d = JSON.parse(text);
  if (!d.turn) throw new Error("Worker를 새로 배포해야 합니다(PC에서 class-tools\\usage-setup.ps1 실행).");
  return d;
}
async function usageGithub(net) {
  const gh = async (path) => {
    net.requests++;
    const r = await fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub 응답 " + r.status + (r.status === 403 ? "(이 PC 시간당 60번 한도, 잠시 뒤 다시)" : ""));
    const text = await r.text();
    net.bytes += text.length;
    return JSON.parse(text);
  };
  const monthStart = kstIso().slice(0, 8) + "01T00:00:00%2B09:00";
  const [repo, rate, month, recent, alive] = await Promise.all([
    gh("/repos/" + GITHUB_REPO),
    gh("/rate_limit"),   // 이 요청은 한도에 세지 않는다
    gh("/repos/" + GITHUB_REPO + "/actions/runs?per_page=1&created=%3E%3D" + monthStart),
    gh("/repos/" + GITHUB_REPO + "/actions/runs?per_page=6"),
    gh("/repos/" + GITHUB_REPO + "/actions/workflows/keep-alive.yml/runs?per_page=1"),
  ]);
  // 브라우저에 남겨 둘 것만 추린다(실행 기록 하나가 수 KB라)
  const run = (r) => r && { name: r.name, created_at: r.created_at, conclusion: r.conclusion, status: r.status };
  return {
    repo: { size: repo.size, pushed_at: repo.pushed_at, default_branch: repo.default_branch, open_issues_count: repo.open_issues_count },
    rate: rate.resources.core, runsThisMonth: month.total_count, recent: recent.workflow_runs.map(run), alive: run(alive.workflow_runs[0]),
  };
}
const USAGE_SOURCES = { db: usageDb, worker: usageWorker, github: usageGithub };

const lastSync = () => Math.max(0, ...Object.values(usage).map((u) => u.at || 0));
// 하나라도 1시간이 지났으면 모두 다시 받는다: 기타 관리의 모든 숫자는 같은 동기화 시각(lastSync) 기준이다
const staleSources = () => Object.keys(USAGE_SOURCES).some((k) => !usage[k] || Date.now() - usage[k].at >= ETC_AUTO_MS) ? Object.keys(USAGE_SOURCES) : [];
const manualWait = () => Math.max(0, lastSync() + ETC_MANUAL_MS - Date.now());

async function syncUsage(names) {
  if (usageBusy || !names.length) return;
  usageBusy = true;
  if (tab === "etc") paintEtc();
  const at = Date.now();   // 이번 동기화의 기준 시각(모든 받는 곳에 같은 값)
  await Promise.all(names.map(async (k) => {
    const net = { requests: 0, bytes: 0 };
    try { usage[k] = { data: await USAGE_SOURCES[k](net), at, net }; }
    catch (e) { usage[k] = { error: e.message || String(e), at, net }; }
  }));
  usageBusy = false;
  try { localStorage.setItem("cra-usage", JSON.stringify(usage)); } catch {}
  if (tab === "etc") paintEtc();
}

function drawEtc() {
  paintEtc();
  etcCheck();
}
// 30초마다 시계만 본다(네트워크는 쓰지 않음): 1시간 지난 것이 있으면 자동 동기화, 아니면 버튼의 남은 시간만 고친다
function etcCheck() {
  clearTimeout(etcTimer);
  if (tab !== "etc") return;
  if (!document.hidden && staleSources().length) syncUsage(staleSources());
  else if (!usageBusy && main) { const b = main.querySelector(".sync-btn"); if (b) b.replaceWith(syncButton()); }
  etcTimer = setTimeout(etcCheck, ETC_CHECK_MS);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && tab === "etc") etcCheck(); });

function syncButton() {
  const wait = manualWait();
  const syncIcon = h("span", { class: "sync-icon" + (usageBusy ? " spin" : ""), "aria-hidden": "true" });
  syncIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>';
  return h("button", {
    class: "primary sync-btn", type: "button", disabled: usageBusy || wait > 0,
    title: wait > 0 ? "동기화는 10분에 한 번만 할 수 있습니다(무료 한도를 아끼려고)" : "지금 모든 사용량을 다시 받습니다",
    onclick() { if (manualWait() <= 0) syncUsage(Object.keys(USAGE_SOURCES)); },
  }, syncIcon, usageBusy ? "동기화 중…" : wait > 0 ? Math.ceil(wait / 60000) + "분 뒤 다시 동기화" : "동기화");
}

function usageAmount(n, fmt) {
  if (fmt === "days") return n + "일";
  if (fmt !== "bytes") return Number(n).toLocaleString();
  if (n < 1024) return Math.round(n) + "B";
  if (n < MB) return (n / 1024).toFixed(0) + "KB";
  if (n < GB) return (n / MB).toFixed(1) + "MB";
  return (n / GB).toFixed(2) + "GB";
}
const shortTime = (t) => new Date(t).toLocaleString("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 초기화(쿨타임) 창: 이 한도가 언제부터 쌓여 언제 다시 0이 되는지. 누적·실시간 값과 동기화 비용 추정은 창이 없다.
function usageWindow(it, at) {
  if (it.win) return it.win;
  if (it.period === "이번 달") return { from: kstMonthStart(at - 1), to: kstMonthStart(at - 1, 1) };
  if (it.period === "오전 9시부터") { const from = Math.floor(at / 86400000) * 86400000; return { from, to: from + 86400000 }; }   // 한국 오전 9시 = UTC 0시
  return null;
}
// 지금 속도를 초기화 때까지 이어 간다고 보고 예상치를 낸다. 시작 직후의 튀는 값을 줄이려고 경과 시간은 최소 1시간(창의 1/24)으로 센다.
// risk: 초기화 때 한도의 몇 배를 쓸지(창이 없으면 지금 비율). 0.8 이상이면 「소진 주의」로 표시하고 맨 위에 모은다.
const USAGE_RISK = 0.8;
function usageStat(it) {
  const known = !it.missing && it.used != null && it.limit > 0;
  const s = { known, p: known ? it.used / it.limit : 0 };
  if (!known) return s;
  const at = it.asOf || lastSync() || Date.now();
  const w = usageWindow(it, at);
  if (w) {
    const span = w.to - w.from, el = Math.min(span, Math.max(at - w.from, Math.min(3600000, span / 24)));
    s.win = w; s.at = at;
    s.rate = it.used / el;                                             // 1ms당
    s.proj = it.used + s.rate * Math.max(0, w.to - at);
    s.avg = it.limit * Math.min(1, Math.max(0, (at - w.from) / span));  // 고르게 쓸 때 지금까지의 몫
    s.over = it.used > 0 && it.used > s.avg;
    s.runOut = s.proj > it.limit && s.rate > 0 ? at + Math.max(0, it.limit - it.used) / s.rate : null;
    s.risk = s.proj / it.limit;
  } else s.risk = s.p;
  s.level = s.p >= 0.85 ? "bad" : s.p >= 0.6 ? "warn" : (w ? s.proj <= it.limit * 0.1 : s.p <= 0.1) ? "great" : "ok";
  s.risky = !it.noRisk && s.risk >= USAGE_RISK;
  return s;
}

// 날짜별 기록: 날마다의 값을 주는 곳이 없는 항목은 이 브라우저가 동기화할 때마다 그날 마지막 값을 남겨 둔다(cra-usage-hist, 40일).
// 날짜는 그 항목의 하루가 바뀌는 때를 따른다(Cloudflare 하루 한도는 UTC 날짜 = 한국 오전 9시).
let usageHist = {};
try { usageHist = JSON.parse(localStorage.getItem("cra-usage-hist")) || {}; } catch {}
const histDay = (it, t) => it.period === "오전 9시부터" ? new Date(t).toISOString().slice(0, 10) : kstIso(t).slice(0, 10);
function histNote(it) {
  const st = usageStat(it);
  if (!st.known || it.days || !it.id || it.noRisk) return;
  const t = it.asOf || lastSync();
  if (!t) return;
  const rec = usageHist[it.id] || (usageHist[it.id] = {});
  rec[histDay(it, t)] = it.used;
  for (const k of Object.keys(rec).sort().slice(0, -40)) delete rec[k];
}
const histSave = () => { try { localStorage.setItem("cra-usage-hist", JSON.stringify(usageHist)); } catch {} };

// 원 띠 그래프 하나: 회색 띠 위에 쓴 만큼 색 띠(아주 여유(초기화까지 10% 미만 예상) 파랑 · 여유 초록 · 60% 넘으면 주황 · 85% 넘으면 빨강). 색과 함께 글자로도 상태를 적는다.
// 누르면 그 항목이 골라지고(usageSel) 그 묶음 아래에 자세한 정보(usageDetail)가 열린다. where = 어느 묶음에 열지("top" = 맨 위 소진 주의).
const USAGE_LEVEL = { great: "아주 여유", ok: "여유", warn: "주의", bad: "위험" };
const USAGE_MARK = { great: "◆ ", ok: "● ", warn: "▲ ", bad: "■ " };
let usageSel = null;   // { id, where }
// 초기화 단위 묶음: 하루 이하 → 한 달 → 누적 → 실시간 순서로 놓고, 묶음마다 기간 꼬리표 색을 달리한다(app.css .tag.period-*)
const PERIOD_ORDER = ["day", "month", "acc", "live"];
const periodGroup = (p) => p === "이번 달" || p === "한 달" ? "month" : p === "누적" ? "acc" : p === "실시간" ? "live" : "day";
function usageRing(it, where = "sec") {
  const st = usageStat(it), known = st.known, p = st.p, level = st.level;
  const sel = !!(usageSel && usageSel.id === it.id && usageSel.where === where);
  const pick = () => { usageSel = sel ? null : { id: it.id, where }; paintEtc(); };
  const c = 2 * Math.PI * 40;
  const pct = !known ? "—" : p > 0 && p < 0.01 ? "<1%" : Math.round(p * 100) + "%";
  const ring = h("span", { class: "ring", "aria-hidden": "true" });
  ring.innerHTML = '<svg viewBox="0 0 100 100"><circle class="ring-track" cx="50" cy="50" r="40"/>'
    + (known && p > 0 ? '<circle class="ring-bar ' + level + '" cx="50" cy="50" r="40" transform="rotate(-90 50 50)" stroke-dasharray="' + Math.max(Math.min(p, 1) * c, 0.5).toFixed(2) + " " + c.toFixed(2) + '"/>' : "")
    + '<text x="50" y="50">' + pct + "</text></svg>";
  const amount = known ? usageAmount(it.used, it.fmt) + " / " + usageAmount(it.limit, it.fmt) : it.missing || "알 수 없음";
  const left = known ? "남음 " + usageAmount(Math.max(it.limit - it.used, 0), it.fmt) : "";
  return h("figure", {
    class: "usage-item" + (known ? "" : " unknown") + (st.risky ? " risky" : "") + (sel ? " selected" : ""),
    role: "button", tabindex: "0", "aria-pressed": sel ? "true" : "false",
    title: it.label + " · " + it.period + "\n" + amount + (left ? " · " + left : "") + (it.hint ? "\n" + it.hint : "") + "\n누르면 자세히 봅니다",
    onclick: pick, onkeydown(e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } },
  },
    st.risky ? h("span", { class: "risk-mark", title: "초기화 전에 다 쓸 수 있음" }, "⚠ 소진 주의") : null,
    ring,
    h("figcaption", {},
      where === "top" && it.sec ? h("span", { class: "muted small" }, it.sec) : null,
      h("strong", {}, it.label),
      h("span", { class: "small" }, amount),
      left ? h("span", { class: "muted small" }, left) : null,
      st.win ? h("span", { class: "muted small" }, "평균 몫 " + usageAmount(Math.round(st.avg), it.fmt)) : null,
      h("span", { class: "usage-tags" },
        h("span", { class: "tag period-" + periodGroup(it.period) }, it.period),
        known ? h("span", { class: "tag " + level }, USAGE_MARK[level] + USAGE_LEVEL[level]) : null,
        st.over ? h("span", { class: "tag warn", title: "초기화까지 고르게 쓸 때의 지금 몫보다 많이 씀" }, "▲ 평균 초과") : null),
      it.hint ? h("span", { class: "muted small" }, it.hint) : null));
}
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), hh = Math.floor(m % 1440 / 60);
  return d ? d + "일 " + hh + "시간" : hh ? hh + "시간 " + m % 60 + "분" : m % 60 + "분"; };
// 고른 항목의 자세한 정보: 쓴 양·남은 양·초기화 시각·평균 몫·쓰는 속도·초기화 때 예상·다 쓰는 예상 시각 + 날짜별 사용량
function usageDetail(it) {
  const st = usageStat(it), f = (n) => usageAmount(n, it.fmt), pc = (x) => Math.round(x * 100) + "%";
  const rows = [];
  if (!st.known) rows.push(["상태", it.missing || "알 수 없음"]);
  else {
    rows.push(["쓴 양", f(it.used) + " / " + f(it.limit) + " (" + pc(st.p) + ")"], ["남은 양", f(Math.max(it.limit - it.used, 0))]);
    if (st.win) {
      const perDay = st.win.to - st.win.from > 86400000;
      rows.push(
        ["초기화", shortTime(st.win.to) + " · " + dur(st.win.to - st.at) + " 남음"],
        ["평균 몫(지금까지)", f(Math.round(st.avg)) + " · " + (st.over ? "▲ " + pc(it.used / Math.max(st.avg, 1) - 1) + " 넘게 씀" : "그 안에서 쓰는 중")],
        ["남은 기간 하루 몫", perDay ? f(Math.round(Math.max(it.limit - it.used, 0) / Math.max((st.win.to - st.at) / 86400000, 1 / 24))) + "까지 쓰면 한도 안" : "—"],
        ["쓰는 속도", f(Math.round(st.rate * (perDay ? 86400000 : 3600000))) + (perDay ? " / 하루" : " / 시간")],
        ["초기화 때 예상", f(Math.round(st.proj)) + " (" + pc(st.risk) + ") · " + (st.proj <= it.limit ? f(Math.round(it.limit - st.proj)) + " 남음" : "한도 넘음")]);
      if (st.runOut) rows.push(["다 쓰는 예상 시각", st.runOut <= st.at ? "이미 다 씀" : shortTime(st.runOut) + " (초기화 " + dur(st.win.to - st.runOut) + " 전)"]);
    } else rows.push(["초기화", it.period === "누적" ? "없음(쌓이는 양)" : it.period === "실시간" ? "없음(지금 값)" : "추정치(" + it.period + ")"]);
    rows.push(["상태", USAGE_LEVEL[st.level] + (st.risky ? " · ⚠ 소진 주의" : "")]);
  }
  let days = null;
  if (it.days) days = egressDayChart("날마다 " + it.label, it.days.m, it.days.field, it.days.at);
  else if (!it.noRisk) {
    const rec = usageHist[it.id] || {}, keys = Object.keys(rec).sort();
    const diff = it.period === "이번 달" || it.period === "누적";
    const list = keys.map((k, i) => {
      const prev = i ? rec[keys[i - 1]] : null, sameMonth = i && keys[i - 1].slice(0, 7) === k.slice(0, 7);
      const d = !diff ? rec[k] : prev == null || (it.period === "이번 달" && !sameMonth) ? null : rec[k] - prev;
      return [k.slice(5).replace("-", "/"), f(rec[k]), d == null ? "—" : (d < 0 ? "−" + f(-d) : f(d))];
    }).reverse().slice(0, 14);
    days = list.length ? usageTable(["날짜", diff ? "그날 마지막 값" : "그날 쓴 양", diff ? "그날 늘어난 양" : "—"].slice(0, diff ? 3 : 2), list.map((r) => diff ? r : r.slice(0, 2)))
      : h("p", { class: "muted small" }, "아직 날짜별 기록이 없습니다.");
  }
  // 왼쪽에 글(사실·설명), 오른쪽 빈 곳에 날짜별 그래프·표를 알맞게 줄여 둔다(좁은 화면은 아래로)
  return h("div", { class: "usage-detail" + (days ? " has-side" : "") },
    h("div", { class: "usage-detail-text" },
      h("div", { class: "row between" }, h("h4", {}, it.label + " · " + it.period),
        h("button", { type: "button", class: "ghost small", onclick() { usageSel = null; paintEtc(); } }, "닫기")),
      h("dl", { class: "usage-facts" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      it.hint ? h("p", { class: "muted small" }, it.hint) : null,
      it.days && egressHasDay9(it.days.m) ? h("p", { class: "muted small" }, "「" + DAY9 + "」이 붙은 날은 그날 오전 9시부터 다음 날 오전 9시까지를 묶은 값입니다.") : null,
      !it.days && !it.noRisk ? h("p", { class: "muted small" }, "날짜별 값은 이 서비스가 따로 주지 않아, 이 브라우저가 동기화할 때 남긴 그날 마지막 값입니다(최근 14일).") : null),
    days ? h("div", { class: "usage-detail-side" }, days) : null);
}
// 묶음 하나의 원 그래프들 + 고른 것의 자세한 정보. 소진 주의 항목은 맨 위 요약(usageRisky)에도 모은다.
let usageRisky = [];
function usageRings(sec, items, opt = {}) {
  items = items.map((it) => ({ ...it, id: sec + ":" + it.label, sec, noRisk: opt.noRisk || it.noRisk }))
    .sort((a, b) => PERIOD_ORDER.indexOf(periodGroup(a.period)) - PERIOD_ORDER.indexOf(periodGroup(b.period)));
  for (const it of items) { histNote(it); const st = usageStat(it); if (st.risky) usageRisky.push({ it, risk: st.risk }); }
  const pick = usageSel && usageSel.where === "sec" && items.find((it) => it.id === usageSel.id);
  return [h("div", { class: "usage-grid" }, items.map((it) => usageRing(it))), pick ? usageDetail(pick) : null];
}
const usageTable = (head, rows) => h("div", { class: "table-wrap usage-table" },
  h("table", {}, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((x) => h("td", {}, x)))))));
const usageBlock = (title, ...kids) => h("div", { class: "usage-block" }, h("h4", {}, title), ...kids);

// 이번 달 전송량을 지금까지의 시간당 평균으로 월말까지 늘려 본다(6시간 넘게 모였을 때만)
function egressProjection(m) {
  if (!m || !m.hours || m.hours < 6 || !m.until) return null;
  const until = Date.parse(m.until);
  const left = Math.max(0, (kstMonthStart(until - 1, 1) - until) / 3600000);
  return { bytes: m.bytes + m.bytes / m.hours * left, cached: m.cached + m.cached / m.hours * left };
}
// 날짜 묶음의 하루가 언제 바뀌는지: Worker가 한국 시간으로 나누기 전(kstSince 전)에 모인 날은 UTC 날짜 = 한국 오전 9시~다음 날 오전 9시
const DAY9 = "오전 9시~다음 날 오전 9시";
function egressDayNote(m, k) {
  const since = m && m.kstSince ? kstIso(Date.parse(m.kstSince)).slice(0, 10) : null;
  return !since || k < since ? " (" + DAY9 + ")" : k === since ? " (일부 " + DAY9 + ")" : "";
}
const egressHasDay9 = (m) => !!(m && m.days && Object.keys(m.days).some((k) => egressDayNote(m, k)));

// 날마다 전송량 막대 그래프. 축척을 고정한다: 세로 0~500MB, 가로 그달 1일~말일(날마다·달마다 같은 눈으로 견줄 수 있게).
// 점선은 「하루 몫」(5GB ÷ 그달 날 수). 500MB를 넘는 날은 막대를 위에서 자르고 값을 적는다.
const EGRESS_DAY_MAX = 500 * MB;
function egressDayChart(title, m, field, at = lastSync() || Date.now()) {
  const ref = new Date(+(m && m.until ? Date.parse(m.until) - 1 : at) + KST_MS);
  const y = ref.getUTCFullYear(), mo = ref.getUTCMonth();
  const n = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const key = (d) => y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const today = kstIso(at).slice(0, 10);
  const budget = 5 * GB / n;
  const W = 640, H = 210, L = 52, R = 10, T = 16, B = 26, pw = W - L - R, ph = H - T - B, base = T + ph;
  const yOf = (v) => T + ph * (1 - Math.min(v, EGRESS_DAY_MAX) / EGRESS_DAY_MAX);
  const slot = pw / n, bw = Math.max(3, Math.min(14, slot * 0.62));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = "";
  for (let v = 0; v <= EGRESS_DAY_MAX; v += 100 * MB) {
    svg += '<line class="eg-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yOf(v) + '" y2="' + yOf(v) + '"/>'
      + '<text class="eg-tick" x="' + (L - 6) + '" y="' + yOf(v) + '">' + (v ? v / MB + "MB" : "0") + "</text>";
  }
  let total = 0;
  for (let d = 1; d <= n; d++) {
    const k = key(d), v = m && m.days && m.days[k] ? m.days[k][field] || 0 : null;
    const x = L + (d - 1) * slot + (slot - bw) / 2;
    let bar = "";
    if (v > 0) {
      total += v;
      const top = yOf(v), r = Math.min(4, bw / 2, base - top);
      bar = '<path class="eg-bar" d="M' + x + "," + base + "V" + (top + r) + "Q" + x + "," + top + " " + (x + r) + "," + top
        + "H" + (x + bw - r) + "Q" + (x + bw) + "," + top + " " + (x + bw) + "," + (top + r) + "V" + base + 'Z"/>';
      if (v > EGRESS_DAY_MAX) bar += '<text class="eg-over" x="' + (x + bw / 2) + '" y="' + (T - 4) + '">' + esc(usageAmount(v, "bytes")) + "</text>";
    }
    if (k === today) {
      bar = bar.replace('class="eg-bar"', 'class="eg-bar today"');
      if (v <= EGRESS_DAY_MAX) bar += '<text class="eg-today" x="' + (x + bw / 2) + '" y="' + (yOf(v || 0) - 5) + '">오늘 ' + esc(usageAmount(v || 0, "bytes")) + "</text>";
    }
    const tip = (mo + 1) + "/" + d + (v == null ? "" : egressDayNote(m, k)) + " · " + (v == null ? (k > today ? "아직 안 옴" : "집계 없음") : usageAmount(v, "bytes"))
      + (k === today ? " (" + kstClock(at, { hour: "2-digit", minute: "2-digit" }) + " 동기화까지)" : "");
    // 막대보다 넓은 칸 전체가 마우스 대상(얇은 막대도 가리키기 쉽게)
    svg += '<g class="eg-day"><title>' + esc(tip) + "</title>"
      + '<rect class="eg-hit" x="' + (L + (d - 1) * slot) + '" y="' + T + '" width="' + slot + '" height="' + ph + '"/>' + bar + "</g>";
    if (d === 1 || d % 5 === 0 || k === today)
      svg += '<text class="eg-day-label' + (k === today ? " now" : "") + '" x="' + (L + (d - 0.5) * slot) + '" y="' + (H - 8) + '">' + d + "</text>";
  }
  const by = yOf(budget);
  svg += '<line class="eg-budget" x1="' + L + '" x2="' + (W - R) + '" y1="' + by + '" y2="' + by + '"/>'
    + '<text class="eg-budget-label" x="' + (L + 4) + '" y="' + (by - 4) + '">하루 몫 ' + esc(usageAmount(budget, "bytes")) + "</text>"
    + '<line class="eg-axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '"/>';
  const box = h("div", { class: "eg-chart", role: "img", "aria-label": title + " " + (mo + 1) + "월 날마다 막대 그래프, 이번 달 합계 " + usageAmount(total, "bytes") });
  box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' + svg + "</svg>";
  return h("figure", { class: "eg-figure" },
    h("figcaption", {}, h("strong", {}, title), h("span", { class: "muted small" }, " " + (mo + 1) + "월 합계 " + usageAmount(total, "bytes") + " / 5GB")),
    h("div", { class: "eg-scroll" }, box));
}
// 이번 달 집계(매시 5분까지) + 그 뒤 동기화 시각까지(Worker egressTail)
function egressWithTail(m, tail) {
  if (!m || !tail || !tail.until || (m.until && Date.parse(tail.until) <= Date.parse(m.until))) return m;
  const days = { ...m.days };
  for (const [k, v] of Object.entries(tail.days || {})) {
    const was = days[k] || { bytes: 0, cached: 0 };
    days[k] = { bytes: was.bytes + v.bytes, cached: was.cached + v.cached };
  }
  return { ...m, days, bytes: m.bytes + tail.bytes, cached: m.cached + tail.cached, until: tail.until,
    hours: m.hours + Math.max(0, (Date.parse(tail.until) - Date.parse(tail.from || m.until)) / 3600000) };
}
// Supabase: DB 안 숫자(db) + Worker가 관리 API로 모은 전송량·요청 수·서비스 상태(worker.supabase)
function supabaseView() {
  const d = usage.db && usage.db.data, w = usage.worker && usage.worker.data, s = w && w.supabase;
  if (!d) return usage.db && usage.db.error ? h("p", { class: "banner bad" }, "불러오지 못했습니다: " + usage.db.error) : h("p", { class: "muted small" }, "불러오는 중…");
  const noApi = !w ? "Worker 응답 없음" : !s ? "관리 토큰 필요" : null;
  const at = lastSync();
  const m = s && egressWithTail(s.egressMonth, s.egressTail);
  const since = m && Date.parse(m.from) > kstMonthStart(at) + 3600000 ? shortTime(m.from) + "부터 집계" : null;
  const ep = egressProjection(m);
  // 무료 프로젝트는 7일 동안 요청이 없으면 잠든다: 최근 7일 요청 기록 중 마지막으로 요청이 있었던 날로 센다
  const lastDay = s && s.apiCounts && [...s.apiCounts].reverse().find((x) => x.total_rest_requests + x.total_auth_requests + x.total_storage_requests + x.total_realtime_requests > 0);
  const idle = lastDay ? Math.max(0, Math.floor((at - Date.parse(lastDay.timestamp + "Z")) / 86400000)) : null;
  const items = [
    { label: "데이터베이스", used: d.db_bytes, limit: 500 * MB, fmt: "bytes", period: "누적" },
    { label: "파일 저장소", used: d.storage_bytes, limit: GB, fmt: "bytes", period: "누적", hint: d.storage_files + "개 파일 · 새 슬라이드는 Cloudflare R2에 저장(여기 남은 것은 예전 사본·PPTX)" },
    { label: "전송량", used: m ? m.bytes : null, limit: 5 * GB, fmt: "bytes", period: "이번 달", asOf: m && Date.parse(m.until), days: m && { m, field: "bytes", at }, missing: noApi || (m ? null : "첫 집계 기다리는 중(매시 5분)"),
      hint: (ep ? "월말 예상 " + usageAmount(ep.bytes, "bytes") + " · " : "") + (since || "CDN 캐시를 거치지 않은 응답") },
    { label: "캐시 전송량", used: m ? m.cached : null, limit: 5 * GB, fmt: "bytes", period: "이번 달", asOf: m && Date.parse(m.until), days: m && { m, field: "cached", at }, missing: noApi || (m ? null : "첫 집계 기다리는 중(매시 5분)"),
      hint: (ep ? "월말 예상 " + usageAmount(ep.cached, "bytes") + " · " : "") + (since ? since + " · " : "") + "CDN 캐시에서 나간 슬라이드 그림 등" },
    { label: "접속 중 학생", used: d.online, limit: 200, period: "실시간", hint: "실시간 동시 연결 한도 200" },
    { label: "DB 연결", used: d.db_conn, limit: d.db_conn_max, period: "실시간" },
    { label: "로그인 사용자(MAU)", used: d.mau, limit: 50000, period: "이번 달", hint: "교사 계정 기준(학생은 세지 않음)" },
    { label: "일시정지까지", used: idle, limit: 7, fmt: "days", period: "실시간", missing: noApi, hint: "요청 없이 7일이 지나면 프로젝트가 잠듦(keep-alive가 매일 깨움)" },
  ];
  const stale = s && (!s.egressLast || at - Date.parse(s.egressLast) > 3 * 3600000);
  return [
    usageRings("Supabase", items),
    s && stale ? h("p", { class: "banner bad egress-stale" }, "전송량 매시 집계가 " + (s.egressLast ? shortTime(s.egressLast) + " 뒤로 멈춰 있습니다" : "아직 한 번도 되지 않았습니다")
      + ". 무료 요금제 로그는 하루만 남으므로 그보다 오래 멈추면 그동안의 전송량은 이번 달 합계에서 빠집니다.") : null,
    noApi === "관리 토큰 필요" ? h("p", { class: "muted small" }, "전송량은 Worker에 Supabase 관리 토큰이 들어가야 보입니다(PC에서 class-tools\\usage-setup.ps1 실행).") : null,
  ];
}

function cloudflareView() {
  const u = usage.worker;
  if (!u) return h("p", { class: "muted small" }, "불러오는 중…");
  if (u.error) return h("p", { class: "banner bad" }, "불러오지 못했습니다: " + u.error);
  const d = u.data, a = d.analytics, r2 = d.r2;
  const missing = a ? null : "분석 토큰 필요";
  const daily = "Cloudflare 하루 한도는 한국 시간 오전 9시에 초기화", day9 = "오전 9시부터";
  const items = [
    { label: "중계(TURN) 접속 발급", used: d.turn.issued, limit: d.turn.limit, period: "이번 달", hint: "오늘 " + (d.turn.today || 0) + "장 · 다 쓰면 직접 연결(STUN)만 씀" },
    { label: "중계(TURN) 전송량", used: a && a.turnBytesMonth, limit: 1000 * GB, fmt: "bytes", period: "이번 달", missing },
    { label: "Worker 요청", used: a && a.workerRequestsToday, limit: 100000, period: day9, hint: daily + " · 슬라이드 그림 1장도 1번", missing },
    { label: "R2 슬라이드 저장", used: r2 && r2.bytes, limit: 10 * GB, fmt: "bytes", period: "누적", missing: r2 ? null : d.r2Error ? "못 받음" : "Worker 새로 배포 필요",
      hint: r2 && r2.objects.toLocaleString() + "개 파일" + (r2.from === "list" ? "(버킷 목록으로 셈)" : "") },
    { label: "R2 올리기·목록(Class A)", used: a && a.r2ClassAMonth, limit: 1000000, period: "이번 달", missing: a && a.r2ClassAMonth == null ? "Worker 새로 배포 필요" : missing, hint: "슬라이드 올리기 · 파일 목록" },
    { label: "R2 읽기(Class B)", used: a && a.r2ClassBMonth, limit: 10000000, period: "이번 달", missing: a && a.r2ClassBMonth == null ? "Worker 새로 배포 필요" : missing, hint: "학생 기기가 슬라이드 그림을 받은 횟수 · 내보내는 전송량은 무료" },
    { label: "KV 읽기", used: a && a.kvReadsToday, limit: 100000, period: day9, hint: daily, missing },
    { label: "KV 쓰기", used: a && a.kvWritesToday, limit: 1000, period: day9, hint: daily + " · 중계 접속 1장마다 2번", missing },
    { label: "KV 삭제", used: a && a.kvDeletesToday, limit: 1000, period: day9, missing: a && a.kvDeletesToday == null ? "Worker 새로 배포 필요" : missing, hint: daily },
    { label: "KV 목록", used: a && a.kvListsToday, limit: 1000, period: day9, missing: a && a.kvListsToday == null ? "Worker 새로 배포 필요" : missing, hint: daily + " · 기타 관리 동기화 1번마다 1번" },
    { label: "KV 저장", used: a && a.kvBytes, limit: GB, fmt: "bytes", period: "누적", missing: a && a.kvBytes == null ? (a.kvListsToday == null ? "Worker 새로 배포 필요" : "아직 집계 없음") : missing,
      hint: a && a.kvKeys != null ? a.kvKeys.toLocaleString() + "개 키 · 하루 한 번 집계(한국 오전 9시에 날짜 바뀜)" : "하루 한 번 집계(한국 오전 9시에 날짜 바뀜)" },
  ];
  const hist = (d.turn.history || []).slice().reverse();
  return [
    usageRings("Cloudflare", items),
    hist.length ? h("div", { class: "usage-blocks" }, usageBlock("달마다 중계 접속 발급",
      usageTable(["달", "발급", "한도 대비"], hist.map((x) => [x.month, x.issued.toLocaleString() + "장", Math.round(x.issued / d.turn.limit * 100) + "%"])))) : null,
    a ? null : h("p", { class: "muted small" }, "중계 전송량·Worker 요청·R2 요청·KV 사용량은 Cloudflare 읽기 전용 분석 토큰이 있어야 보입니다(PC에서 class-tools\\usage-setup.ps1 실행)."
      + (d.analyticsError && d.analyticsError !== "no token" ? " (" + d.analyticsError + ")" : "")),
  ];
}

// 동기화 비용: 이 탭이 사용량을 받느라 무료 한도를 얼마나 쓰는지. 마지막 동기화에서 잰 값 × 하루 자동 동기화 횟수(이 탭을 하루 종일 켜 둔 최악의 경우).
// Worker 매시 집계(cron)는 탭과 상관없이 하루 24번 돈다. 아직 Worker가 재지 않았으면 코드대로 센 값(CRON_COST)을 쓴다.
const AUTO_PER_DAY = 86400000 / ETC_AUTO_MS;
const CRON_COST = { kvRead: 2, kvList: 0, kvWrite: 2, r2ClassA: 0, sbRest: 0, sbApi: 1, cfApi: 0 };
function syncCostView() {
  const net = (k) => usage[k] && usage[k].net;
  const db = net("db"), wk = net("worker"), gh = net("github");
  if (!db && !wk && !gh) return h("p", { class: "muted small" }, usageBusy ? "불러오는 중…" : "아직 동기화한 적이 없습니다.");
  const w = usage.worker && usage.worker.data;
  const c = w && w.cost;
  const m = w && w.supabase && w.supabase.egressMonth;
  const cron = (m && m.cron) || CRON_COST;
  const noCost = c ? null : "Worker 새로 배포 필요";
  const day = (perSync, perCron = 0) => AUTO_PER_DAY * perSync + 24 * perCron;
  const ghCounted = gh ? Math.max(0, gh.requests - 1) : 0;   // rate_limit 요청은 한도에 세지 않는다
  const dbBytes = db ? db.bytes : 0;
  const items = [
    { label: "Worker 요청", used: day(wk ? 1 : 0, 1), limit: 100000, period: "하루", hint: "동기화 " + AUTO_PER_DAY + "번 + 매시 집계 24번" },
    { label: "KV 읽기", used: c && day(c.kvRead, cron.kvRead), limit: 100000, period: "하루", missing: noCost },
    { label: "KV 목록", used: c && day(c.kvList, cron.kvList), limit: 1000, period: "하루", missing: noCost },
    { label: "KV 쓰기", used: c && day(c.kvWrite, cron.kvWrite), limit: 1000, period: "하루", missing: noCost, hint: "거의 다 매시 집계가 씀" },
    { label: "R2 목록(Class A)", used: c && day(c.r2ClassA) * 30, limit: 1000000, period: "한 달", missing: noCost },
    { label: "Supabase 전송량", used: day(dbBytes) * 30, limit: 5 * GB, fmt: "bytes", period: "한 달", hint: "DB 함수 응답 " + usageAmount(dbBytes, "bytes") + " × " + AUTO_PER_DAY * 30 + "번(압축 전)" },
    { label: "GitHub API", used: ghCounted, limit: 60, period: "1시간", hint: "자동은 1시간에 1번 · 버튼을 10분마다 눌러도 최대 " + ghCounted * 6 + "건" },
  ];
  return [
    h("p", { class: "small" }, "자동 동기화는 1시간마다(이 탭이 열려 있고 화면에 보일 때만), 「동기화」 버튼은 마지막 동기화 뒤 10분이 지나야 다시 됩니다. "
      + "계산은 각 서비스 서버가 하고(Supabase DB 함수 · Supabase 로그 · Cloudflare 분석) 이 브라우저는 받은 숫자로 그림만 그립니다. 학생 기기는 쓰지 않습니다."),
    usageRings("동기화 비용", items, { noRisk: true }),
    h("p", { class: "muted small" }, "원 그래프는 이 탭을 하루 종일 켜 둔 최악의 경우(자동 동기화 하루 " + AUTO_PER_DAY + "번 + 매시 집계 24번)가 무료 한도에서 차지하는 몫입니다."),
  ];
}

function githubView() {
  const u = usage.github;
  if (!u) return h("p", { class: "muted small" }, "불러오는 중…");
  if (u.error) return h("p", { class: "banner bad" }, "불러오지 못했습니다: " + u.error);
  const { repo, rate, runsThisMonth, recent, alive } = u.data;
  // 공개 저장소에 60일 동안 아무 변화가 없으면 GitHub가 예약 실행(keep-alive)을 멈춘다 → Supabase가 7일 뒤 잠든다
  const idleDays = Math.floor((u.at - Date.parse(repo.pushed_at)) / 86400000);
  const RESULT = { success: "성공", failure: "실패", cancelled: "취소", skipped: "건너뜀" };
  const items = [
    { label: "저장소(사이트) 크기", used: repo.size * 1024, limit: GB, fmt: "bytes", period: "누적", hint: "GitHub Pages 사이트 한도 1GB" },
    { label: "keep-alive 멈춤까지", used: idleDays, limit: 60, fmt: "days", period: "실시간", hint: "마지막 변경 " + shortTime(repo.pushed_at) + " · 60일 지나면 멈춤" },
    { label: "GitHub API(이 PC)", used: rate.used, limit: rate.limit, period: "1시간", win: { from: rate.reset * 1000 - 3600000, to: rate.reset * 1000 }, hint: kstClock(rate.reset * 1000) + "에 초기화" },
  ];
  return [
    usageRings("GitHub", items),
    h("div", { class: "usage-blocks" }, usageBlock("최근 자동 실행(Actions)",
      usageTable(["작업", "시각", "결과"], recent.map((r) => [r.name, shortTime(r.created_at), RESULT[r.conclusion] || r.conclusion || (r.status === "in_progress" ? "실행 중" : r.status)])))),
    h("p", { class: "small" }, "이번 달 Actions 실행 " + runsThisMonth + "회(공개 저장소라 무료) · "
      + (alive ? "keep-alive 마지막 실행 " + shortTime(alive.created_at) + " " + (RESULT[alive.conclusion] || alive.conclusion || alive.status) : "keep-alive 실행 기록 없음")
      + " · 기본 가지 " + repo.default_branch + " · 열린 PR·이슈 " + repo.open_issues_count + "개"),
    h("p", { class: "muted small" }, "GitHub Pages 전송량(월 100GB 권장)은 GitHub가 어떤 API로도 내주지 않습니다."),
  ];
}

function paintEtc() {
  if (tab !== "etc" || !main) return;
  const last = lastSync();
  const section = (name, what, body) => h("section", { class: "card stack usage-card" },
    h("div", {}, h("h3", {}, name), h("span", { class: "muted small" }, what)), body);
  usageRisky = [];
  const secs = [
    section("Supabase", "데이터베이스 · 파일 · 전송량 · 로그인", supabaseView()),
    section("Cloudflare", "중계 서버(TURN) · Worker · R2 슬라이드 저장소 · KV", cloudflareView()),
    section("GitHub", "사이트 · 자동 실행", githubView()),
    section("동기화 비용", "이 탭이 사용량을 받느라 쓰는 무료 한도", syncCostView())];
  histSave();
  // 맨 위 요약: 초기화 전에 다 쓸 수 있는 자원(소진 주의)을 위험한 순서로 복제해 모아 본다
  const risky = usageRisky.sort((a, b) => b.risk - a.risk).map((x) => x.it);
  const topPick = usageSel && usageSel.where === "top" && risky.find((it) => it.id === usageSel.id);
  const summary = risky.length ? h("section", { class: "card stack risk-card" },
    h("div", {}, h("h3", {}, "⚠ 소진 주의 " + risky.length + "개"),
      h("span", { class: "muted small" }, "지금 속도라면 초기화 전에 한도의 " + Math.round(USAGE_RISK * 100) + "% 넘게 쓸 것으로 보이는 자원(누적·실시간은 지금 비율) · 아래 묶음의 같은 원을 모아 둔 것")),
    h("div", { class: "usage-grid" }, risky.map((it) => usageRing(it, "top"))), topPick ? usageDetail(topPick) : null)
    : lastSync() ? h("p", { class: "risk-none small" }, "◆ 지금 속도로는 초기화 전에 다 쓸 것으로 보이는 자원이 없습니다.") : null;
  // 자세히 보는 중에 원·자세히 칸·단추 밖의 빈 곳을 누르면 고른 것을 푼다
  main.replaceChildren(h("div", { class: "stack", onclick(e) {
    if (usageSel && !e.target.closest(".usage-item, .usage-detail, button, a, input, select, textarea")) { usageSel = null; paintEtc(); }
  } },
    h("div", { class: "row between" },
      h("div", {},
        h("h2", {}, "기타 관리"),
        h("p", { class: "muted small" }, "이 웹앱이 쓰는 바깥 서비스의 무료 한도 대비 사용량 · 파랑 아주 여유(지금 속도면 초기화까지 10% 미만 사용 예상), 초록 여유, 주황 주의(60% 이상), 빨강 위험(85% 이상) · 원을 누르면 자세히")),
      h("div", { class: "row" },
        last ? h("span", { class: "muted small" }, "모든 숫자는 마지막 동기화 " + kstClock(last) + " 기준 · 다음 자동 " + kstClock(last + ETC_AUTO_MS, { hour: "2-digit", minute: "2-digit" }) + " (한국 시간)") : null,
        syncButton())),
    summary, ...secs));
}

// ---------- 버그 제보 ----------
// 편집 모드의 「버그 제보」 탭. 선생님 누구나 쓰고 모두 읽는다. 고치기·지우기는 쓴 사람과 개발자(profile.admin)만, 한 사람당 5개까지
// (Supabase bug_reports 표 · 보안 규칙과 5개 제한은 setup.sql 의 bug_reports_guard). 제보마다 오른쪽 위 「복사」로 글을 클립보드에.
const BUG_MAX = 5;
let bugs = null;       // 목록(새것부터) 또는 { error }
let bugEdit = null;    // 고치는 중인 제보 id
async function drawBugs() {
  paintBugs();
  const [{ data, error }] = await Promise.all([
    sb.from("bug_reports").select("*").order("created_at", { ascending: false }),
    profile && !profile.error ? null : loadProfile()]);
  bugs = error ? { error: /bug_reports/.test(error.message) ? "Supabase에 bug_reports 표가 없습니다(setup.sql 적용 필요)." : error.message } : data;
  paintBugs();
}
function paintBugs() {
  if (tab !== "bugs" || !main) return;
  const list = Array.isArray(bugs) ? bugs : [];
  const admin = !!(profile && profile.admin);
  const mine = list.filter((b) => b.author === me.id).length;
  const msg = h("p", { class: "msg" });
  const text = h("textarea", { class: "bug-text", rows: 4, maxlength: 4000, placeholder: "무엇을 하다가, 어떤 일이 생겼고, 원래는 어떻게 되어야 하는지 적어 주세요.", disabled: mine >= BUG_MAX });
  const send = h("button", { class: "primary", type: "button", disabled: mine >= BUG_MAX, async onclick() {
    const body = text.value.trim();
    if (!body) { msg.textContent = "내용을 적어 주세요."; return; }
    send.disabled = true;
    msg.textContent = "올리는 중…";
    const { error } = await sb.from("bug_reports").insert({ body });
    if (error) { send.disabled = false; msg.textContent = "올리지 못했습니다: " + error.message; return; }
    drawBugs();
  } }, "제보하기");
  const card = (b) => {
    const can = b.author === me.id || admin, editing = can && bugEdit === b.id;
    const copy = h("button", { class: "ghost bug-copy", type: "button", title: "제보 글을 클립보드에 복사", onclick() {
      navigator.clipboard.writeText(b.body).then(() => { copy.textContent = "복사했습니다"; setTimeout(() => { copy.textContent = "복사"; }, 1500); }, () => alert("복사하지 못했습니다."));
    } }, "복사");
    const edited = Date.parse(b.updated_at) - Date.parse(b.created_at) > 2000;
    const head = h("div", { class: "bug-head" },
      h("span", { class: "muted small" }, (b.author === me.id ? "나 · " : "") + b.author_email + " · " + dateText(b.created_at) + (edited ? " · 고침 " + dateText(b.updated_at) : "")),
      copy);
    if (editing) {
      const box = h("textarea", { class: "bug-text", rows: 5, maxlength: 4000, value: b.body });
      const m = h("p", { class: "msg" });
      return h("article", { class: "card stack bug-card" }, head, box, h("div", { class: "row" },
        h("button", { class: "primary", type: "button", async onclick(e) {
          const body = box.value.trim();
          if (!body) { m.textContent = "내용을 적어 주세요."; return; }
          e.currentTarget.disabled = true;
          const { error } = await sb.from("bug_reports").update({ body }).eq("id", b.id);
          if (error) { e.currentTarget.disabled = false; m.textContent = "저장하지 못했습니다: " + error.message; return; }
          bugEdit = null; drawBugs();
        } }, "저장"),
        h("button", { class: "ghost", type: "button", onclick() { bugEdit = null; paintBugs(); } }, "취소")), m);
    }
    return h("article", { class: "card stack bug-card" }, head, h("p", { class: "bug-body" }, b.body),
      can ? h("div", { class: "row" },
        h("button", { class: "ghost", type: "button", onclick() { bugEdit = b.id; paintBugs(); } }, "고치기"),
        h("button", { class: "ghost danger", type: "button", async onclick() {
          if (!confirm("이 제보를 지울까요?")) return;
          const { error } = await sb.from("bug_reports").delete().eq("id", b.id);
          if (error) return alert("지우지 못했습니다: " + error.message);
          drawBugs();
        } }, "지우기"),
        b.author !== me.id ? h("span", { class: "tag warn" }, "개발자 권한") : null) : null);
  };
  main.replaceChildren(h("div", { class: "stack bugs-page" },
    h("div", {}, h("h2", {}, "버그 제보"),
      h("p", { class: "muted small" }, "선생님 누구나 쓰고 모두 볼 수 있습니다. 고치기·지우기는 쓴 사람과 개발자만 할 수 있고, 한 사람당 " + BUG_MAX + "개까지 쓸 수 있습니다.")),
    h("section", { class: "card stack" },
      h("div", { class: "row between" }, h("h3", {}, "새 제보"), h("span", { class: "tag " + (mine >= BUG_MAX ? "bad" : "info") }, "내 제보 " + mine + " / " + BUG_MAX)),
      text, h("div", { class: "row" }, send, mine >= BUG_MAX ? h("span", { class: "muted small" }, "5개를 다 썼습니다. 예전 제보를 고치거나 지우면 새로 쓸 수 있습니다.") : null), msg),
    bugs && bugs.error ? h("p", { class: "banner bad" }, "불러오지 못했습니다: " + bugs.error)
      : !bugs ? h("p", { class: "muted small" }, "불러오는 중…")
      : list.length ? list.map(card) : h("p", { class: "muted small" }, "아직 제보가 없습니다.")));
}
