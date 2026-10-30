// 교사 화면 · 「패치 노트」 탭(개발자만, 「기타 관리」 옆): 맨 위 시기별 타임라인(PATCH_ERAS) + 날짜별 상자(PATCH_NOTES). 기록은 patch-notes.js.
// 타임라인은 가로로 늘어놓고, 한 줄에 다 못 들어가면 뱀처럼 아래 줄로 꺾어 이어 그린다(가로 스크롤 없음). 폭이 바뀌면 다시 나눈다.

const PATCH_TL_MIN = 190;   // 타임라인 한 칸의 가장 작은 폭(px)

const patchDayText = (d) => { const [y, m, dd] = d.split("-"); return y + "년 " + +m + "월 " + +dd + "일"; };
const patchShort = (d) => { const [, m, dd] = d.split("-"); return +m + "/" + +dd; };

function drawPatch() {
  const dayOf = new Map(PATCH_NOTES.map(([no, day]) => [no, day]));
  const days = [];
  for (const [no, day, text] of PATCH_NOTES) {
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push([no, text]);
  }
  const eras = PATCH_ERAS.map(([from, to, title, text]) => {
    const a = dayOf.get(from), b = dayOf.get(to) || days[0].day;
    return { from, to, title, text, a, b, when: !a || a === b ? patchShort(b) : patchShort(a) + "–" + patchShort(b) };
  });
  main.replaceChildren(h("div", { class: "stack patch-page" },
    h("div", {},
      h("h2", {}, "패치 노트"),
      h("p", { class: "muted small" }, "지금까지 " + PATCH_NOTES.length + "번 고침 · 날짜는 합친 날(한국 시간) · 타임라인의 시기를 누르면 그 날짜로")),
    h("section", { class: "card stack" }, h("h3", {}, "시기별 주요 패치"), patchTimeline(eras)),
    h("div", { class: "patch-days" }, days.map((g) => h("section", { class: "card patch-day", id: "patch-" + g.day },
      h("div", { class: "patch-day-head" }, h("h3", {}, patchDayText(g.day)), h("span", { class: "muted small" }, g.items.length + "건 · #" + g.items[g.items.length - 1][0] + "–" + g.items[0][0])),
      h("ul", {}, g.items.map(([no, text]) => h("li", {}, h("span", { class: "patch-no" }, "#" + no), " " + text))))))));
}

// 칸 수는 폭에 맞춰 정하고, 홀수 번째 줄은 오른쪽→왼쪽으로 놓아 줄 끝의 꺾인 선이 다음 줄 첫 칸에 바로 닿게 한다
function patchTimeline(eras) {
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
      row.map((e) => h("button", { class: "tl-item" + (e === eras[eras.length - 1] ? " now" : ""), type: "button", style: "flex-basis:" + 100 / n + "%",
        title: e.text, onclick() { const el = document.getElementById("patch-" + e.b); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } },
        h("span", { class: "tl-dot", "aria-hidden": "true" }),
        h("span", { class: "tl-when" }, e.when + " · #" + e.from + "–" + e.to),
        h("strong", {}, e.title),
        h("span", { class: "tl-text" }, e.text))))));
  };
  new ResizeObserver(lay).observe(box);
  return box;
}
