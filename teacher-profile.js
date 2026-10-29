// 교사 화면 · 「프로필」(오른쪽 위 단추): 왼쪽 1/3에 내 정보 · 로그아웃 · 비밀번호 재설정 · 공동 작업자(개발자는 선생님 관리),
// 오른쪽 2/3에 전체 수업(teacher-library.js 의 drawManage 가 .manage-pane 에 그린다).
// 받는 곳: Supabase my_profile() · add_collaborator() · remove_collaborator() · admin_set_teacher()(setup.sql).

let profile = null;   // my_profile() 결과 또는 { error }

async function drawProfile() {
  main.replaceChildren(h("div", { class: "profile-page" },
    h("aside", { class: "profile-side stack" }),
    h("div", { class: "manage-pane" })));
  paintProfile();
  drawManage();
  if (!profile || profile.error) {   // 한 번 받은 프로필은 다시 그릴 때 그대로 쓴다(바꾸는 단추를 누르면 새로 받음)
    await loadProfile();
    if (profile && profile.admin) drawManage();   // 개발자면 남의 수업 묶음 이름이 바뀐다
  }
}

async function loadProfile() {
  const { data, error } = await sb.rpc("my_profile");
  profile = error ? { error: /my_profile/.test(error.message) ? "Supabase SQL Editor에서 setup.sql을 한 번 더 실행하세요." : error.message } : data;
  paintProfile();
}

const dateText = (t) => (t ? new Date(t).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function paintProfile() {
  const side = main && main.querySelector(".profile-side");
  if (tab !== "profile" || !side) return;
  const p = profile && !profile.error ? profile : null;
  const msg = h("p", { class: "msg" });
  const email = (p && p.email) || me.email || "";
  const info = (label, value) => h("div", { class: "profile-row" }, h("dt", {}, label), h("dd", {}, value));
  const idBox = p ? h("span", { class: "teacher-id" }, h("strong", {}, p.code),
    h("button", { class: "link", type: "button", onclick(e) { navigator.clipboard.writeText(p.code).then(() => { e.target.textContent = "복사했습니다"; }); } }, "복사")) : "—";
  side.replaceChildren(
    h("section", { class: "card stack profile-card" },
      h("div", { class: "profile-head" },
        h("span", { class: "avatar big", "aria-hidden": "true" }, (email[0] || "?").toUpperCase()),
        h("div", {}, h("strong", { class: "profile-email" }, email),
          h("div", {}, p && p.admin ? h("span", { class: "tag warn" }, "개발자 · 모든 선생님 관리") : h("span", { class: "tag info" }, "선생님")))),
      profile && profile.error ? h("p", { class: "error small" }, "프로필을 불러오지 못했습니다: " + profile.error) : null,
      h("dl", { class: "profile-info" },
        info("교사 ID", idBox),
        info("이메일", email),
        info("계정 만든 날", dateText(me.created_at)),
        info("마지막 로그인", dateText(me.last_sign_in_at)),
        info("내 수업", p ? p.own + "개" : "—"),
        info("공유받은 수업", p ? p.shared + "개" : "—")),
      h("p", { class: "muted small" }, "공동 작업자는 「선생님 추가」로 넣은 선생님이나 「학생 관리」에서 승격된 학생 중에서 고릅니다."),
      h("div", { class: "row wrap" },
        h("button", { class: "ghost", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃"),
        h("button", {
          class: "ghost", type: "button",
          async onclick(e) {
            if (!confirm(email + " 로 비밀번호 재설정 메일을 보낼까요?")) return;
            e.currentTarget.disabled = true;
            msg.textContent = "재설정 메일을 보내는 중…";
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL(location.pathname, location.origin).href });
            msg.textContent = error ? "보내지 못했습니다: " + error.message : "메일함에서 비밀번호 재설정 링크를 확인해 주세요.";
          },
        }, "비밀번호 재설정")),
      msg),
    tabsCard(),
    p ? collaboratorCard(p) : null,
    p && p.admin ? teachersCard(p) : null);
}

// 탭 꾸미기: 「탭 꾸미기」를 누르면 펼쳐진다. 줄을 끌어 순서를 바꾸고(dragSort) 칸에 새 이름을 적는다(비우면 원래 이름).
// 이 브라우저에만 남는다(tabCustom, cra-tabs). 평소 탭 줄·설정 메뉴·편집 모드가 모두 이 순서를 따른다.
let tabsOpen = false;
function tabsCard() {
  const apply = (c) => { saveTabCustom(c); draw(); };
  const head = h("div", { class: "row between" }, h("h3", {}, "탭 꾸미기"),
    h("button", { class: "ghost", type: "button", "aria-expanded": tabsOpen ? "true" : "false", onclick() { tabsOpen = !tabsOpen; paintProfile(); } }, tabsOpen ? "닫기" : "탭 꾸미기"));
  if (!tabsOpen) return h("section", { class: "card stack" }, head, h("p", { class: "muted small" }, "탭의 순서와 이름을 내 마음대로 바꿉니다."));
  const list = h("ol", { class: "tab-edit-list" }, tabSort(TAB_DEFAULTS.map(([k]) => k)).map(([k, name]) => {
    const def = TAB_DEFAULTS.find(([x]) => x === k)[1];
    const input = h("input", { type: "text", maxlength: 12, value: name, placeholder: def, "aria-label": def + " 탭 이름",
      onkeydown(e) { if (e.key === "Enter") input.blur(); },
      onchange() {
        const v = input.value.trim(), names = { ...(tabCustom.names || {}) };
        if (!v || v === def) delete names[k]; else names[k] = v;
        apply({ ...tabCustom, names });
      } });
    return h("li", { class: "tab-edit-row", "data-k": k }, h("span", { class: "tab-grip", "aria-hidden": "true" }, "⠿"), tabIcon(k), input);
  }));
  dragSort(list, {
    items: () => [...list.children],
    onDrop(order) { apply({ ...tabCustom, order: order.map((x) => x.dataset.k) }); },
  });
  return h("section", { class: "card stack" }, head,
    h("p", { class: "muted small" }, "줄을 끌어 순서를 바꾸고, 칸에 새 이름을 적은 뒤 Enter. 이름을 비우면 원래 이름으로 돌아갑니다. 이 브라우저에만 남습니다."),
    list,
    h("div", { class: "row" }, h("button", { class: "ghost", type: "button", onclick() { if (confirm("탭 순서와 이름을 처음대로 되돌릴까요?")) apply({}); } }, "처음대로")));
}

// 공동 작업자 이름: 승격된 학생이면 학번·이름, 아니면 이메일(교사 ID)
function whoText(c, p) {
  const s = (p.promoted || []).find((x) => x.email === c.email);
  return s ? s.class_no + " " + s.name + " (" + c.email + ")" : c.email + " (" + c.code + ")";
}

// 공동 작업자: 내가 나눈 수업(개발자는 모든 수업)과 나에게 나눈 수업
function collaboratorCard(p) {
  const byLesson = new Map();
  for (const c of p.collaborators || []) {
    if (!byLesson.has(c.lesson_id)) byLesson.set(c.lesson_id, { title: c.title, code: c.lesson_code, list: [] });
    byLesson.get(c.lesson_id).list.push(c);
  }
  const remove = async (lessonId, who, text) => {
    if (!confirm(text)) return;
    const { error } = await sb.rpc("remove_collaborator", { p_lesson: lessonId, p_email: who });
    if (error) return alert(error.message);
    await loadLessons(lesson && lesson.id);
    await loadProfile();
  };
  return h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("h3", {}, "공동 작업자"),
      h("button", { class: "primary", type: "button", onclick: addCollaborator }, "+ 공동 작업자 추가하기")),
    byLesson.size ? h("ul", { class: "collab-list" }, [...byLesson].map(([id, g]) => h("li", {},
      h("strong", {}, g.title), h("span", { class: "muted small" }, " · " + g.code),
      h("div", { class: "row wrap" }, g.list.map((c) => h("span", { class: "chip collab" }, whoText(c, p),
        h("button", { class: "link danger", type: "button", title: "공동 작업자에서 빼기", "aria-label": c.email + " 빼기",
          onclick() { remove(id, c.email, "「" + g.title + "」에서 " + c.email + " 선생님을 뺄까요?"); } }, "×")))))))
      : h("p", { class: "muted small" }, "아직 함께 쓰는 선생님이 없습니다."),
    (p.shared_with_me || []).length ? h("div", { class: "stack" }, h("h4", {}, "나에게 공유된 수업"),
      h("ul", { class: "collab-list" }, p.shared_with_me.map((s) => h("li", { class: "row between" },
        h("span", {}, h("strong", {}, s.title), h("span", { class: "muted small" }, " · " + (s.owner || "주인 모름"))),
        h("button", { class: "link danger", type: "button", onclick() { remove(s.lesson_id, p.email, "「" + s.title + "」 공동 작업에서 빠질까요?"); } }, "빠지기"))))) : null);
}

// 공동 작업자 추가: 다른 선생님(「선생님 추가」로 넣은 선생님 · 승격된 학생) 한 명 + 나눌 수업 고르기(내 수업만, 개발자는 모든 수업)
function addCollaborator() {
  const mine = lessons.filter((l) => l.owner === me.id || (profile && profile.admin));
  const people = (profile && profile.colleagues) || [];
  const picks = people.map((p) => h("input", { type: "radio", name: "collab-who", value: p.code }));
  const msg = h("p", { class: "msg" });
  const boxes = mine.map((l) => h("input", { type: "checkbox", value: l.id, checked: !!lesson && l.id === lesson.id }));
  const close = openModal("공동 작업자 추가하기", h("form", {
    class: "stack collab-form",
    async onsubmit(e) {
      e.preventDefault();
      const who = picks.find((r) => r.checked);
      const picked = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!who) { msg.textContent = "함께 쓸 선생님을 골라 주세요."; return; }
      if (!picked.length) { msg.textContent = "함께 쓸 수업을 하나 이상 골라 주세요."; return; }
      msg.textContent = "추가하는 중…";
      const { data, error } = await sb.rpc("add_collaborator", { p_code: who.value, p_lessons: picked });
      const why = { no_teacher: "그 ID의 선생님이 없습니다.", self: "내 ID는 넣을 수 없습니다.", not_owner: "내 수업만 나눌 수 있습니다." };
      if (error || data.error) { msg.textContent = error ? error.message : why[data.error] || data.error; return; }
      close();
      flash(data.email + " 선생님과 수업 " + data.added + "개를 함께 씁니다.");
      await loadProfile();
    },
  },
    h("fieldset", { class: "stack collab-people" }, h("legend", {}, "함께 쓸 선생님"),
      people.length ? people.map((p, i) => h("label", { class: "check" }, picks[i], " " + (p.name ? p.class_no + " " + p.name : p.email),
        h("span", { class: "muted small" }, (p.name ? " · " + p.email : "") + " · ID " + p.code + (p.account ? "" : " · 아직 계정 만들기 전"))))
        : h("p", { class: "muted small" }, "고를 수 있는 선생님이 없습니다. 「선생님 추가」로 선생님을 넣거나 「학생 관리」에서 학생을 승격해 주세요.")),
    h("fieldset", { class: "stack collab-lessons" }, h("legend", {}, "함께 쓸 수업"),
      mine.length ? mine.map((l, i) => h("label", { class: "check" }, boxes[i], " " + l.title + " (" + l.code + ")"))
        : h("p", { class: "muted small" }, "내가 만든 수업이 없습니다.")),
    h("p", { class: "muted small" }, "공동 작업자는 고른 수업을 보고 고치고 진행할 수 있습니다. 수업을 지우거나 다른 선생님에게 다시 나누지는 못합니다."),
    h("button", { class: "primary", type: "submit", disabled: !people.length }, "추가"), msg));
}

// 개발자 전용: 모든 선생님 목록 · 선생님 추가/빼기. 개발자는 모든 수업을 보고 고치며 공동 작업자도 바꿀 수 있다
function teachersCard(p) {
  const email = h("input", { type: "email", placeholder: "새 선생님 이메일", "aria-label": "새 선생님 이메일" });
  const set = async (who, on) => {
    if (!on && !confirm(who + " 선생님을 교사 목록에서 뺄까요? 그 선생님의 수업은 지워지지 않고 개발자가 계속 볼 수 있습니다.")) return;
    const { data, error } = await sb.rpc("admin_set_teacher", { p_email: who, p_on: on });
    const why = { bad_email: "이메일 모양이 아닙니다.", self: "내 계정은 뺄 수 없습니다." };
    if (error || data.error) return alert(error ? error.message : why[data.error] || data.error);
    if (on) flash(who + " 선생님을 추가했습니다(ID " + data.code + ").");
    await loadProfile();
  };
  return h("section", { class: "card stack" },
    h("h3", {}, "선생님 관리(개발자)"),
    h("div", { class: "table-wrap" }, h("table", { class: "teachers-table" },
      h("thead", {}, h("tr", {}, ["ID", "이메일", "수업", "마지막 로그인", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, (p.teachers || []).map((t) => h("tr", {},
        h("td", {}, t.code), h("td", {}, t.email, t.admin ? h("span", { class: "tag warn" }, "개발자") : null),
        h("td", {}, t.lessons + "개"), h("td", {}, t.last_sign_in ? dateText(t.last_sign_in) : "로그인 안 함"),
        h("td", {}, t.admin ? null : h("button", { class: "link danger", type: "button", onclick() { set(t.email, false); } }, "빼기"))))))),
    h("div", { class: "row" }, email, h("button", { class: "ghost", type: "button", onclick() { if (email.value.trim()) set(email.value.trim(), true); } }, "선생님 추가")),
    h("p", { class: "muted small" }, "추가한 선생님은 Supabase 대시보드 → Authentication → Users 에서 같은 이메일로 계정을 만들어야 로그인할 수 있습니다. 개발자는 모든 선생님의 수업을 「전체 수업」에서 보고 불러올 수 있습니다."));
}
