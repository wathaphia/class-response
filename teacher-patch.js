// 교사 화면 · 「패치 노트」 탭(개발자만, 「기타 관리」 옆): 맨 위 시기별 타임라인(PATCH_ERAS) + 아래 하위 탭. 기록은 patch-notes.js.
// 하위 탭: 「날짜별 요약」(하루 한 상자, PATCH_DAYS 요약만 보이고 「자세히 보기」로 그날 목록) + 성격별(PATCH_KINDS, 오래된 것부터 시간 순서).
// 타임라인은 가로로 늘어놓고, 한 줄에 다 못 들어가면 뱀처럼 아래 줄로 꺾어 이어 그린다(가로 스크롤 없음). 폭이 바뀌면 다시 나눈다.
// 시기를 누르면 「날짜별 요약」으로 돌아가 그 시기에 든 날 상자와 줄에 불을 켜고(.lit) 그리로 스크롤한다. 같은 시기를 다시 누르면 끈다.

const PATCH_TL_MIN = 190;   // 타임라인 한 칸의 가장 작은 폭(px)

const patchDayText = (d) => { const [y, m, dd] = d.split("-"); return y + "년 " + +m + "월 " + +dd + "일"; };
const patchShort = (d) => { const [, m, dd] = d.split("-"); return +m + "/" + +dd; };

let patchView = "days";        // "days" 또는 PATCH_KINDS 의 키
let patchLit = null;           // 불 켠 시기 { from, to }
const patchOpen = new Set();   // 「자세히 보기」로 펼친 날

function drawPatch() {
  const dayOf = new Map(PATCH_NOTES.map(([no, day]) => [no, day]));
  const days = [];
  for (const [no, day, text, kind] of PATCH_NOTES) {
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push({ no, text, kind: (kind || "").split(" ").filter(Boolean) });
  }
  const eras = PATCH_ERAS.map(([from, to, title, text]) => {
    const a = dayOf.get(from), b = dayOf.get(to) || days[0].day;
    return { from, to, title, text, a, b, when: !a || a === b ? patchShort(b) : patchShort(a) + "–" + patchShort(b) };
  });
  const body = h("div", { class: "stack patch-body" });
  const tabs = h("div", { class: "patch-tabs", role: "tablist" });
  const timeline = patchTimeline(eras, (e) => {
    patchLit = patchLit && patchLit.from === e.from ? null : { from: e.from, to: e.to };
    patchView = "days";
    paint();
    const first = patchLit && body.querySelector(".patch-day.lit");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const paint = () => {
    tabs.replaceChildren(...[["days", "날짜별 요약", days.length + "일"], ...Object.entries(PATCH_KINDS).map(([k, name]) =>
      [k, name, PATCH_NOTES.filter((n) => (n[3] || "").split(" ").includes(k)).length + "건"])].map(([k, name, count]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(patchView === k), class: patchView === k ? "on" : "",
        onclick() { patchView = k; paint(); } }, name, h("span", { class: "patch-count" }, count))));
    for (const b of timeline.querySelectorAll(".tl-item")) b.classList.toggle("lit", !!patchLit && +b.dataset.from === patchLit.from);
    body.replaceChildren(...(patchView === "days" ? patchDays(days) : patchKind(patchView, days)));
  };
  paint();
  main.replaceChildren(h("div", { class: "stack patch-page" },
    h("div", {},
      h("h2", {}, "패치 노트"),
      h("p", { class: "muted small" }, "지금까지 " + PATCH_NOTES.length + "번 고침 · 날짜는 합친 날(한국 시간) · 타임라인의 시기를 누르면 그 시기의 날에 불이 켜짐")),
    h("section", { class: "card stack" }, h("h3", {}, "시기별 주요 패치"), timeline),
    tabs, body));
}

const patchInLit = (no) => !!patchLit && no >= patchLit.from && no <= patchLit.to;

// 하루 한 상자: 요약 한두 줄 + 「자세히 보기」(펼치면 그날 PR 목록, 새것이 위)
function patchDays(days) {
  return days.map((g) => {
    const open = patchOpen.has(g.day), lit = g.items.some((it) => patchInLit(it.no));
    const list = h("ul", { hidden: !open }, g.items.map((it) => h("li", { class: patchInLit(it.no) ? "lit" : "" },
      h("span", { class: "patch-no" }, "#" + it.no), " " + it.text, patchKindTags(it.kind))));
    const more = h("button", { type: "button", class: "ghost small patch-more", "aria-expanded": String(open),
      onclick() {
        const on = list.hidden;
        list.hidden = !on;
        if (on) patchOpen.add(g.day); else patchOpen.delete(g.day);
        more.textContent = on ? "접기" : "자세히 보기";
        more.setAttribute("aria-expanded", String(on));
      } }, open ? "접기" : "자세히 보기");
    return h("section", { class: "card patch-day" + (lit ? " lit" : ""), id: "patch-" + g.day },
      h("div", { class: "patch-day-head" }, h("h3", {}, patchDayText(g.day)),
        h("span", { class: "muted small" }, g.items.length + "건 · #" + g.items[g.items.length - 1].no + "–" + g.items[0].no)),
      h("p", { class: "patch-sum" }, PATCH_DAYS[g.day] || g.items.slice(0, 3).map((it) => it.text.split(" · ")[0]).join(" · ")),
      h("div", { class: "row" }, more),
      list);
  });
}

// 성격별 하위 탭: 그 성격의 PR만 오래된 것부터 시간 순서로, 날짜가 바뀌는 곳에 날짜 머리
function patchKind(kind, days) {
  const rows = [];
  for (const g of [...days].reverse()) {
    const items = g.items.filter((it) => it.kind.includes(kind)).reverse();
    if (!items.length) continue;
    rows.push(h("li", { class: "patch-kind-day" }, patchDayText(g.day)));
    for (const it of items) rows.push(h("li", {}, h("span", { class: "patch-no" }, "#" + it.no), " " + it.text));
  }
  return [h("section", { class: "card patch-day patch-kind" },
    h("div", { class: "patch-day-head" }, h("h3", {}, PATCH_KINDS[kind]), h("span", { class: "muted small" }, "오래된 것부터 시간 순서")),
    rows.length ? h("ul", {}, rows) : h("p", { class: "muted small" }, "아직 없습니다."))];
}

const patchKindTags = (kinds) => kinds.length ? h("span", { class: "patch-kinds" }, kinds.map((k) => h("span", { class: "tag patch-kind-" + k }, PATCH_KINDS[k] || k))) : null;

// 칸 수는 폭에 맞춰 정하고, 홀수 번째 줄은 오른쪽→왼쪽으로 놓아 줄 끝의 꺾인 선이 다음 줄 첫 칸에 바로 닿게 한다
function patchTimeline(eras, onPick) {
  const box = h("div", { class: "patch-timeline" });
  let cols = 0;
  const lay = () => {
    const w = box.clientWidth;
    if (!w) return;
    const n = Math.max(1, Math.min(eras.length, Math.floor(w / PATCH_TL_MIN)));
    if (n === cols) return;
    cols = n;
    const rows = [];
    for (let i = 0; i < eras.length; i += n) rows.push(eras.slice(i, i + n));
    box.replaceChildren(...rows.map((row, r) => h("div", { class: "tl-row" + (r % 2 ? " rev" : "") + (r < rows.length - 1 ? " turn" : "") },
      row.map((e) => h("button", { class: "tl-item" + (e === eras[eras.length - 1] ? " now" : "") + (patchLit && patchLit.from === e.from ? " lit" : ""),
        type: "button", style: "flex-basis:" + 100 / n + "%", "data-from": e.from, title: e.text, onclick() { onPick(e); } },
        h("span", { class: "tl-dot", "aria-hidden": "true" }),
        h("span", { class: "tl-when" }, e.when + " · #" + e.from + "–" + e.to),
        h("strong", {}, e.title),
        h("span", { class: "tl-text" }, e.text))))));
  };
  new ResizeObserver(lay).observe(box);
  return box;
}
