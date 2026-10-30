// 「버그 제보」 탭(teacher.js 의 draw 가 drawBugs 를 부른다).

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
