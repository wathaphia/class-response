// 교사 화면 · 「설정」(오른쪽 위 단추)을 누르면 나오는 아래 줄 탭:
//   「프로필」 내 정보 · 로그아웃 · 비밀번호 재설정 · 회원탈퇴 · 탭 꾸미기(teacher.js startTabEdit) · 나에게 공유된 수업
//   「전체 수업」 teacher-library.js 의 drawManage 가 .manage-pane 에 그린다(drawLibrary)
//   「전체 선생님 및 학생」(개발자만) 선생님 관리 · 공동 작업자 · 승격된 학생 · 모든 학생(drawPeople)
// 받는 곳: Supabase my_profile() · add_collaborator()(개발자만) · remove_collaborator() · admin_set_teacher() · withdraw_account()(setup.sql).

let resetQuotaText;   // 「오늘 3번 중 n번 사용」: 화면을 다시 그려도 깜빡이지 않게 처음 한 번만 읽는다
let profile = null;   // my_profile() 결과 또는 { error }
let withdrawOpen = false;   // 프로필의 「회원탈퇴」를 눌러 확인 칸을 열었음

function drawProfile() {
  main.replaceChildren(h("div", { class: "profile-page" }, h("div", { class: "profile-side stack" })));
  paintProfile();
}

function drawLibrary() {
  main.replaceChildren(h("div", { class: "manage-pane library-page" }));
  drawManage();
}

async function loadProfile() {
  const { data, error } = await sb.rpc("my_profile");
  profile = error ? { error: /my_profile/.test(error.message) ? "Supabase SQL Editor에서 setup.sql을 한 번 더 실행하세요." : error.message } : data;
  paintProfile();
  paintPeople();
}

const dateText = (t) => (t ? new Date(t).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function paintProfile() {
  const side = main && main.querySelector(".profile-side");
  if (tab !== "profile" || !side) return;
  const p = profile && !profile.error ? profile : null;
  const email = (p && p.email) || me.email || "";
  const info = (label, value) => h("div", { class: "profile-row" }, h("dt", {}, label), h("dd", {}, value));
  const idBox = p ? h("span", { class: "teacher-id" }, h("strong", {}, p.code),
    h("button", { class: "link", type: "button", onclick(e) { navigator.clipboard.writeText(p.code).then(() => { e.target.textContent = "복사했습니다"; }, () => prompt("복사해 쓰세요.", p.code)); } }, "복사")) : "—";
  // 재설정 메일의 링크로 들어옴(로그인된 채) 또는 프로필의 「비밀번호 재설정」: 여기서 새 비밀번호를 정한다. 프로필에서 열면 현재 비밀번호도 확인한다
  const pw0 = passwordChange && !passwordRecovery ? h("input", { type: "password", autocomplete: "current-password", required: true }) : null;
  const pw1 = h("input", { type: "password", autocomplete: "new-password", minlength: 6, required: true });
  const pw2 = h("input", { type: "password", autocomplete: "new-password", minlength: 6, required: true });
  const pwMsg = h("p", { class: "msg" });
  const recovery = passwordRecovery || passwordChange ? h("form", {
    class: "card stack recovery-card",
    async onsubmit(e) {
      e.preventDefault();
      if (pw1.value.length < 6) { pwMsg.textContent = "6자 이상으로 정해 주세요."; return pw1.focus(); }
      if (pw1.value !== pw2.value) { pwMsg.textContent = "두 비밀번호가 다릅니다."; return pw2.focus(); }
      pwMsg.textContent = "바꾸는 중…";
      if (pw0) {
        const why = await checkPassword(me.email, pw0.value);
        if (why) { pwMsg.textContent = why; return pw0.focus(); }
      }
      const { error } = await sb.auth.updateUser({ password: pw1.value });
      if (error) { pwMsg.textContent = "바꾸지 못했습니다: " + error.message; return; }
      passwordRecovery = passwordChange = false;
      centerNote("새 비밀번호로 바꿨습니다");
      paintProfile();
    },
  }, h("h3", {}, "새 비밀번호 설정"),
    pw0 ? h("label", {}, "현재 비밀번호", pw0) : null, h("label", {}, "새 비밀번호 (6자 이상)", pw1), h("label", {}, "한 번 더", pw2),
    h("div", { class: "row" },
      h("button", { class: "primary", type: "submit" }, "비밀번호 바꾸기"),
      h("button", { class: "ghost", type: "button", onclick() { passwordRecovery = passwordChange = false; paintProfile(); } }, "취소")), pwMsg) : "";
  if (recovery) requestAnimationFrame(() => { recovery.scrollIntoView({ block: "center" }); (pw0 || pw1).focus(); });
  // 오늘 재설정 메일을 몇 번 썼는지(하루 3번)
  const resetUsed = h("span", { class: "muted small" }, resetQuotaText || "");
  if (resetQuotaText === undefined) {
    resetQuotaText = "";
    sb.rpc("my_reset_quota").then(({ data }) => {
      if (!data) return;
      resetQuotaText = "오늘 3번 중 " + data.used + "번 사용";
      resetUsed.textContent = resetQuotaText;
    });
  }
  side.replaceChildren(
    h("section", { class: "card stack profile-card" },
      h("div", { class: "profile-head" },
        h("span", { class: "avatar big", "aria-hidden": "true" }, (email[0] || "?").toUpperCase()),
        h("div", {}, h("strong", { class: "profile-email" }, email),
          h("div", {}, p && p.admin ? h("span", { class: "tag warn" }, "개발자 · 모든 선생님 관리") : p && p.observer ? h("span", { class: "tag warn" }, "관찰자 · 개발자 탭 보기") : h("span", { class: "tag info" }, "선생님")))),
      profile && profile.error ? h("p", { class: "error small" }, "프로필을 불러오지 못했습니다: " + profile.error) : null,
      h("dl", { class: "profile-info" },
        info("교사 ID", idBox),
        info("이메일", email),
        info("계정 만든 날", dateText(me.created_at)),
        info("마지막 로그인", dateText(me.last_sign_in_at)),
        info("내 수업", p ? p.own + "개" : "—"),
        info("공유받은 수업", p ? p.shared + "개" : "—")),
      h("div", { class: "row wrap" },
        h("button", { class: "ghost", type: "button", async onclick() { await sb.auth.signOut(); location.reload(); } }, "로그아웃"),
        h("button", {
          class: "ghost", type: "button",
          onclick() { passwordChange = true; paintProfile(); },
        }, "비밀번호 재설정"), resetUsed,
        p && !p.admin ? h("button", { class: "ghost danger", type: "button", onclick() { withdrawOpen = true; paintProfile(); } }, "회원탈퇴") : null)),
    recovery,
    withdrawOpen ? withdrawCard() : "",
    h("section", { class: "card stack" },
      h("div", { class: "row between" }, h("h3", {}, "탭 꾸미기"),
        h("button", { class: "primary tabs-edit-btn", type: "button", onclick: startTabEdit }, "탭 꾸미기")),
      h("p", { class: "muted small" }, "탭 이름을 눌러 바로 고치고, 탭을 끌어 두 줄 사이에서 자리를 옮기며, 위 줄 탭마다 수업 모드·편집 모드 중 어디에 보일지 고릅니다. 내 계정에 저장되어 다른 기기에서도 같습니다.")),
    p && (p.shared_with_me || []).length ? sharedCard(p) : "");   // replaceChildren 은 null 을 「null」 글자로 넣는다
}

// 회원탈퇴: 현재 비밀번호를 확인하고 계정과 계정 고유 정보를 지운다. 수업은 개발자 소유로 남는다
function withdrawCard() {
  const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
  const msg = h("p", { class: "msg" });
  const card = h("form", {
    class: "card stack withdraw-card",
    async onsubmit(e) {
      e.preventDefault();
      msg.textContent = "확인하는 중…";
      const why = await checkPassword(me.email, pw.value);
      if (why) { msg.textContent = why; return pw.focus(); }
      msg.textContent = "지우는 중…";
      const { data, error } = await sb.rpc("withdraw_account");
      if (error || data.error) { msg.textContent = "탈퇴하지 못했습니다: " + (error ? error.message : data.error); return; }
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      alert("회원탈퇴가 끝났습니다.");
      location.reload();
    },
  }, h("h3", {}, "회원탈퇴"),
    h("p", { class: "error" }, "계정과 폴더·보낸 버그 신고가 지워지고 되돌릴 수 없습니다. 내 수업(슬라이드·학생 응답 포함)은 개발자 소유로 남습니다."),
    h("label", {}, "현재 비밀번호", pw),
    h("div", { class: "row" },
      h("button", { class: "ghost danger", type: "submit" }, "회원탈퇴"),
      h("button", { class: "ghost", type: "button", onclick() { withdrawOpen = false; paintProfile(); } }, "취소")), msg);
  requestAnimationFrame(() => { card.scrollIntoView({ block: "center" }); pw.focus(); });
  return card;
}

// 나에게 공유된 수업(공동 작업자는 개발자가 넣는다). 직접 빠질 수는 있다
function sharedCard(p) {
  return h("section", { class: "card stack" }, h("h3", {}, "나에게 공유된 수업"),
    h("ul", { class: "collab-list" }, p.shared_with_me.map((s) => h("li", { class: "row between" },
      h("span", {}, h("strong", {}, s.title), h("span", { class: "muted small" }, " · " + (s.owner || "주인 모름"))),
      h("button", { class: "link danger", type: "button", onclick() { removeCollaborator(s.lesson_id, p.email, "「" + s.title + "」 공동 작업에서 빠질까요?"); } }, "빠지기")))));
}

async function removeCollaborator(lessonId, who, text) {
  if (!confirm(text)) return;
  const { error } = await sb.rpc("remove_collaborator", { p_lesson: lessonId, p_email: who });
  if (error) return alert(error.message);
  await loadLessons(lesson && lesson.id);
  await loadProfile();
}

// ---------- 전체 선생님 및 학생(개발자만) ----------
let allStudents = null;   // 모든 학생(처음 열 때 한 번 받는다)
let studentsBusy = false;  // 「새로 읽기」 중이면 화살표가 돈다
function drawPeople() {
  main.replaceChildren(h("div", { class: "people-page stack" }));
  paintPeople();
  if (!allStudents) loadAllStudents();
}

async function loadAllStudents(manual) {
  studentsBusy = true;
  paintStudents();
  const started = Date.now();
  const { data, error } = await sb.from("students").select("id, class_no, name, created_at, monitor_consent, lesson_students(lesson_id, last_seen)").order("created_at", { ascending: false }).limit(2000);
  await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - started))));   // 너무 빨리 끝나도 한 바퀴는 보이게
  allStudents = error ? { error: error.message } : data;
  studentsBusy = false;
  paintStudents();
  if (manual && !error) flash("모든 학생 " + data.length + "명을 새로 읽었습니다.");
}

// 모든 학생 표만 다시 그린다(위쪽 입력 칸에 쓰던 글자를 지우지 않게)
function paintStudents() {
  const old = main && main.querySelector(".people-page .all-students-card");
  if (tab === "people" && old) old.replaceWith(studentsCard());
}

function paintPeople() {
  const page = main && main.querySelector(".people-page");
  if (tab !== "people" || !page) return;
  const p = profile && !profile.error ? profile : null;
  if (!p || !seesAdminTabs()) return page.replaceChildren(h("p", { class: "muted" }, "불러오는 중…"));
  page.replaceChildren(teachersCard(p), collaboratorCard(p), promotedCard(), studentsCard());
}

// ---------- 표에서 여러 줄 고르기(전체 선생님 및 학생) ----------
// 표마다 고른 줄의 id 모음. 다시 그려도 남고, 없어진 줄은 그릴 때 뺀다
const peoplePick = { students: new Set(), teachers: new Set(), promoted: new Set() };
function pickPrune(set, ids) { for (const id of [...set]) if (!ids.includes(id)) set.delete(id); }
function pickCell(set, id, label, repaint) {
  return h("td", { class: "pick" }, h("input", { type: "checkbox", checked: set.has(id), "aria-label": label + " 고르기",
    onchange(e) { if (e.target.checked) set.add(id); else set.delete(id); repaint(); } }));
}
function pickHead(set, ids, repaint) {
  const all = ids.length > 0 && ids.every((id) => set.has(id));
  const box = h("input", { type: "checkbox", checked: all, disabled: !ids.length, "aria-label": "전체 선택",
    onchange(e) { ids.forEach((id) => (e.target.checked ? set.add(id) : set.delete(id))); repaint(); } });
  box.indeterminate = !all && ids.some((id) => set.has(id));
  return h("th", { class: "pick" }, box);
}
// 표 위 막대: [전체 선택] n명 고름 · 고른 사람에게 할 일 단추들(고른 사람이 없으면 못 누른다)
function bulkBar(set, ids, repaint, ...actions) {
  const all = ids.length > 0 && ids.every((id) => set.has(id));
  return h("div", { class: "row wrap bulk-bar" + (set.size ? " on" : "") },
    h("button", { class: "ghost small", type: "button", disabled: !ids.length,
      onclick() { ids.forEach((id) => (all ? set.delete(id) : set.add(id))); repaint(); } }, all ? "선택 해제" : "전체 선택"),
    h("span", { class: "muted small" }, set.size ? set.size + "명 고름" : "고른 사람 없음"),
    actions.map((a) => { if (!set.size) a.disabled = true; return a; }));
}

// 여러 학생 승격: 학생마다 로그인 이메일을 받는다
function promoteMany(list) {
  if (list.length === 1) return promoteStudent(list[0]);
  const emails = list.map((s) => h("input", { type: "email", placeholder: "로그인 이메일 (비워도 됨)","aria-label": nameOf(s) + " 로그인 이메일" }));
  const msg = h("p", { class: "msg" });
  const close = openModal(list.length + "명을 선생님으로 승격", h("form", {
    class: "stack promote-form",
    async onsubmit(e) {
      e.preventDefault();
      const why = { bad_email: "이메일 모양이 아닙니다", no_student: "학생 계정이 없습니다", already: "이미 선생님입니다", email_taken: "그 이메일은 다른 선생님이 씁니다" };
      const fails = [];
      let ok = 0;
      for (const [i, s] of list.entries()) {
        msg.textContent = "승격하는 중… (" + (i + 1) + "/" + list.length + ")";
        const { data, error } = await sb.rpc("promote_student", { p_student: s.id, p_email: emails[i].value.trim() });
        if (error || data.error) fails.push(nameOf(s) + ": " + (error ? error.message : why[data.error] || data.error));
        else { ok++; peoplePick.students.delete(s.id); }
      }
      if (fails.length) msg.textContent = ok + "명 승격, " + fails.length + "명 못 함 — " + fails.join(" · ");
      else { close(); flash(ok + "명을 선생님으로 승격했습니다."); }
      await loadProfile();
      if (!fails.length) draw();
    },
  },
    list.map((s, i) => h("label", {}, nameOf(s), emails[i])),
    h("p", { class: "muted small" }, "이메일을 적으면 학생은 그 이메일로 「가입하기」를 하면 됩니다. 비워 두면 학생이 「가입하기」에서 학번·이름과 쓸 이메일을 적어 가입 요청을 보내고, 「전체 선생님 및 학생」에서 승인합니다."),
    h("button", { class: "primary", type: "submit" }, list.length + "명 승격"), msg));
  emails[0].focus();
}

async function deleteStudents(list) {
  const names = list.slice(0, 10).map(nameOf).join(", ") + (list.length > 10 ? " 외 " + (list.length - 10) + "명" : "");
  if (!confirm(list.length + "명의 학생 계정을 완전히 지울까요?\n" + names + "\n모든 수업에서 빠지고, 모든 수업의 응답이 지워집니다.")) return;
  const ids = list.map((s) => s.id);
  const { error } = await sb.from("students").delete().in("id", ids);
  if (error) return alert(error.message);
  allStudents = allStudents.filter((x) => !ids.includes(x.id));
  ids.forEach((id) => peoplePick.students.delete(id));
  flash(list.length + "명의 학생 계정을 지웠습니다.");
  paintStudents();
}

function studentsCard() {
  const list = Array.isArray(allStudents) ? allStudents : [];
  const title = (id) => { const l = lessons.find((x) => x.id === id); return l ? l.title : "?"; };
  const seen = (s) => (s.lesson_students || []).reduce((t, m) => (m.last_seen > t ? m.last_seen : t), "");
  const set = peoplePick.students, ids = list.map((s) => s.id);
  if (Array.isArray(allStudents)) pickPrune(set, ids);
  const chosen = list.filter((s) => set.has(s.id));
  const canPromote = chosen.filter((s) => !promotedOf(s));
  const reloadIcon = h("span", { class: "sync-icon" + (studentsBusy ? " spin" : ""), "aria-hidden": "true" });
  reloadIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>';
  return h("section", { class: "card stack all-students-card" },
    h("div", { class: "row between wrap" }, h("h3", {}, "모든 학생 " + list.length + "명"),
      h("button", { class: "ghost reload-btn", type: "button", disabled: studentsBusy, onclick() { loadAllStudents(true); } }, reloadIcon, studentsBusy ? "읽는 중…" : "새로 읽기")),
    allStudents && allStudents.error ? h("p", { class: "error small" }, allStudents.error) : null,
    !Array.isArray(allStudents) ? (allStudents ? null : h("p", { class: "muted small" }, "불러오는 중…")) : [bulkBar(set, ids, paintStudents,
      h("button", { class: "ghost small", type: "button", disabled: !canPromote.length, onclick: devOnly(() => promoteMany(canPromote)) }, "승격" + (canPromote.length ? " (" + canPromote.length + ")" : "")),
      h("button", { class: "ghost small danger", type: "button", onclick: devOnly(() => deleteStudents(chosen)) }, "계정 삭제" + (chosen.length ? " (" + chosen.length + ")" : ""))),
    h("div", { class: "table-wrap" }, h("table", { class: "all-students-table" },
      h("thead", {}, h("tr", {}, pickHead(set, ids, paintStudents), ["이름", "학번(번호)", "들어온 수업", "마지막 접속", "만든 날", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.map((s) => h("tr", { class: set.has(s.id) ? "picked-row" : null },
        pickCell(set, s.id, nameOf(s), paintStudents),
        h("td", {}, s.name, promotedOf(s) ? h("span", { class: "tag ok" }, "선생님") : null), h("td", {}, s.class_no || "—"),
        h("td", {}, (s.lesson_students || []).map((m) => title(m.lesson_id)).join(", ") || "—"),
        h("td", {}, seen(s) ? dateText(seen(s)) : "—"), h("td", {}, dateText(s.created_at)),
        h("td", { class: "actions" },
          promotedOf(s) ? null : h("button", { class: "link small", type: "button", onclick: devOnly(() => promoteStudent(s)) }, "승격"),
          h("button", {
            class: "link danger", type: "button",
            onclick: devOnly(async () => {
              if (!confirm(nameOf(s) + " 학생 계정을 완전히 지울까요?\n모든 수업에서 빠지고, 모든 수업의 응답이 지워집니다.")) return;
              const { error } = await sb.from("students").delete().eq("id", s.id);
              if (error) return alert(error.message);
              allStudents = allStudents.filter((x) => x.id !== s.id);
              paintStudents();
            }),
          }, "계정 삭제")))))))]);
}

// 공동 작업자 이름: 승격된 학생이면 학번·이름, 아니면 이메일(교사 ID)
function whoText(c, p) {
  const s = (p.promoted || []).find((x) => x.email === c.email);
  return s ? nameOf(s) + " (" + c.email + ")" : c.email + " (" + c.code + ")";
}

// 공동 작업자(개발자만 붙이고 뗀다): 수업마다 함께 쓰는 선생님
function collaboratorCard(p) {
  const byLesson = new Map();
  for (const c of p.collaborators || []) {
    if (!byLesson.has(c.lesson_id)) byLesson.set(c.lesson_id, { title: c.title, code: c.lesson_code, list: [] });
    byLesson.get(c.lesson_id).list.push(c);
  }
  return h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("h3", {}, "공동 작업자"),
      h("button", { class: "primary", type: "button", onclick: devOnly(addCollaborator) }, "+ 공동 작업자 추가하기")),
    h("p", { class: "muted small" }, "선생님들은 공동 작업자를 직접 넣지 못합니다. 개발자는 모든 수업에 함께하며, 여기서 수업에 다른 선생님을 넣습니다."),
    byLesson.size ? h("ul", { class: "collab-list" }, [...byLesson].map(([id, g]) => h("li", {},
      h("strong", {}, g.title), h("span", { class: "muted small" }, " · " + g.code),
      h("div", { class: "row wrap" }, g.list.map((c) => h("span", { class: "chip collab" }, whoText(c, p),
        h("button", { class: "link danger", type: "button", title: "공동 작업자에서 빼기", "aria-label": c.email + " 빼기",
          onclick: devOnly(() => removeCollaborator(id, c.email, "「" + g.title + "」에서 " + c.email + " 선생님을 뺄까요?")) }, "×")))))))
      : h("p", { class: "muted small" }, "아직 함께 쓰는 선생님이 없습니다."));
}

// 공동 작업자 추가: 다른 선생님(「선생님 추가」로 넣은 선생님 · 승격된 학생) 한 명 + 나눌 수업 고르기(모든 수업)
function addCollaborator() {
  const all = lessons;
  const people = (profile && profile.colleagues) || [];
  const picks = people.map((p) => h("input", { type: "radio", name: "collab-who", value: p.code }));
  const msg = h("p", { class: "msg" });
  const boxes = all.map((l) => h("input", { type: "checkbox", value: l.id, checked: !!lesson && l.id === lesson.id }));
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
      const why = { no_teacher: "그 ID의 선생님이 없습니다.", self: "내 ID는 넣을 수 없습니다." };
      if (error || data.error) { msg.textContent = error ? error.message : why[data.error] || data.error; return; }
      close();
      flash(data.email + " 선생님과 수업 " + data.added + "개를 함께 씁니다.");
      await loadProfile();
    },
  },
    h("fieldset", { class: "stack collab-people" }, h("legend", {}, "함께 쓸 선생님"),
      people.length ? people.map((p, i) => h("label", { class: "check" }, picks[i], " " + (p.name ? nameOf(p) : p.email),
        h("span", { class: "muted small" }, (p.name ? " · " + p.email : "") + " · ID " + p.code + (p.account ? "" : " · 아직 가입 전"))))
        : h("p", { class: "muted small" }, "고를 수 있는 선생님이 없습니다. 선생님 관리 표의 「추가」로 선생님을 넣거나 학생을 승격해 주세요.")),
    h("fieldset", { class: "stack collab-lessons" }, h("legend", {}, "함께 쓸 수업"),
      all.length ? all.map((l, i) => h("label", { class: "check collab-lesson" }, boxes[i],
        l.slide_count && !isPptx(l) ? h("img", { class: "lesson-thumb mini", src: slideSrc(l, 1, true), alt: "", loading: "lazy" })
          : h("span", { class: "lesson-thumb mini empty", "aria-hidden": "true" }),
        " " + l.title + " (" + l.code + ")"))
        : h("p", { class: "muted small" }, "수업이 없습니다.")),
    h("p", { class: "muted small" }, "공동 작업자는 고른 수업을 보고 고치고 진행할 수 있습니다. 수업을 지우거나 다른 선생님에게 다시 나누지는 못합니다."),
    h("button", { class: "primary", type: "submit", disabled: !people.length }, "추가"), msg));
}

// 현재 비밀번호 확인: 지금 로그인을 건드리지 않게 저장 안 하는 임시 연결로 로그인해 본다. 틀리면 알릴 문구를 돌려준다
async function checkPassword(email, password) {
  const check = supabase.createClient(SB_URL, String(SUPABASE_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "cra-pw-check" } });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return error.code === "invalid_credentials" ? "현재 비밀번호가 다릅니다." : "확인하지 못했습니다: " + error.message;
  await check.auth.signOut({ scope: "local" });
  return "";
}

// 개발자 전용: 모든 선생님 목록 · 선생님 추가/빼기. 개발자는 모든 수업을 보고 고치며 공동 작업자도 바꿀 수 있다
function teachersCard(p) {
  const set = async (who, on) => {
    if (!on && !confirm(who + " 선생님을 뺄까요? 회원탈퇴와 같아서 그 계정과 폴더·버그 신고가 지워지고 되돌릴 수 없습니다. 수업(슬라이드·학생 응답 포함)은 개발자 소유로 남습니다.")) return false;
    const { data, error } = await sb.rpc("admin_set_teacher", { p_email: who, p_on: on });
    const why = { bad_email: "이메일 형식이 올바르지 않습니다", self: "내 계정은 뺄 수 없습니다" };
    if (error || data.error) { centerNote((on ? "추가하지 못했습니다: " : "빼지 못했습니다: ") + (error ? error.message : why[data.error] || data.error)); return false; }
    centerNote(on ? who + " 선생님을 추가했습니다 (ID " + data.code + ")" : who + " 선생님을 뺐습니다");
    await loadProfile();
    return true;
  };
  // 표 맨 아래 줄: 「추가」 → 이메일 칸에 입력란이 열리고 단추가 「이메일로 추가」로 바뀐다.
  // 「취소」·Esc·줄 밖 빈 곳을 누르면 입력란을 닫고 처음 모습(「추가」만)으로 돌아간다.
  const newEmail = h("input", { type: "email", class: "add-email", placeholder: "새 선생님 이메일", "aria-label": "새 선생님 이메일", hidden: true,
    onkeydown(e) {
      if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
      if (e.key === "Escape") closeAdd();
    } });
  const cancelBtn = h("button", { class: "link", type: "button", hidden: true, onclick() { closeAdd(); } }, "취소");
  const outside = (e) => { if (!addRow.isConnected) return document.removeEventListener("pointerdown", outside, true); if (!addRow.contains(e.target)) closeAdd(); };
  const openAdd = () => {
    newEmail.hidden = cancelBtn.hidden = false;
    addBtn.textContent = "이메일로 추가";
    newEmail.focus();
    document.addEventListener("pointerdown", outside, true);
  };
  const closeAdd = () => {
    newEmail.hidden = cancelBtn.hidden = true;
    newEmail.value = "";
    addBtn.textContent = "추가";
    document.removeEventListener("pointerdown", outside, true);
  };
  const addBtn = h("button", {
    class: "link", type: "button",
    onclick: devOnly(async () => {
      if (newEmail.hidden) return openAdd();
      const who = newEmail.value.trim().toLowerCase();
      if (!EMAIL_RE.test(who)) { centerNote("이메일 형식이 올바르지 않습니다"); newEmail.focus(); return; }
      addBtn.disabled = true;
      if (!(await set(who, true))) { addBtn.disabled = false; newEmail.focus(); }
    }),
  }, "추가");

  // 직위 스위치: 선생님 ⇄ 관찰자. 직위만 바뀌고 수업·폴더는 그대로다
  const roleSwitch = (t) => h("button", {
    type: "button", role: "switch", "aria-checked": String(!!t.observer), class: "role-switch" + (t.observer ? " on" : ""),
    title: t.observer ? "누르면 선생님으로 바꿉니다" : "누르면 관찰자로 바꿉니다", "aria-label": t.email + " 직위",
    onclick: devOnly(async () => {
      const { data, error } = await sb.rpc("admin_set_observer", { p_email: t.email, p_on: !t.observer });
      if (error || data.error) return centerNote("직위를 바꾸지 못했습니다: " + (error ? error.message : data.error));
      await loadProfile();
    }),
  }, h("span", { class: "knob", "aria-hidden": "true" }), h("span", {}, t.observer ? "관찰자" : "선생님"));
  // 오늘 재설정 메일 횟수와 3번 한도 초기화(개발자만). 0번이면 단추는 자리만 남겨 칸 너비가 변하지 않게 한다
  const resetCell = (t) => h("td", { class: "reset-cell" }, (t.reset_used || 0) + " / 3 ", h("button", {
    class: "link", type: "button", style: t.reset_used ? null : "visibility:hidden", "aria-label": t.email + " 재설정 횟수 초기화",
    onclick: devOnly(async () => {
      const { error } = await sb.rpc("admin_reset_quota", { p_email: t.email });
      if (error) return centerNote("초기화하지 못했습니다: " + error.message);
      centerNote(t.email + " 재설정 횟수를 초기화했습니다");
      await loadProfile();
    }),
  }, "초기화"));
  const decide = async (r, ok) => {
    if (!ok && !confirm(nameOf(r) + " 의 가입 요청(" + r.email + ")을 거절할까요?")) return;
    const { data, error } = await sb.rpc("decide_teacher_request", { p_student: r.student_id, p_ok: ok });
    const why = { no_request: "요청이 이미 처리되었습니다", not_promoted: "승격이 해제된 학생이라 요청을 지웠습니다", email_taken: "그 이메일은 다른 선생님이 씁니다" };
    centerNote(error ? "처리하지 못했습니다: " + error.message : data.error ? why[data.error] || data.error : ok ? nameOf(r) + " 가입을 승인했습니다" : "가입 요청을 거절했습니다");
    await loadProfile();
  };
  const requests = p.requests || [];
  const picked = peoplePick.teachers;
  const ids = (p.teachers || []).filter((t) => !t.admin).map((t) => t.email);   // 개발자는 뺄 수 없어 고르지 않는다
  pickPrune(picked, ids);
  const repaint = () => { const old = main && main.querySelector(".teachers-card"); if (old) old.replaceWith(teachersCard(p)); };
  const removeMany = async () => {
    const who = [...picked];
    if (!confirm(who.length + "명의 선생님을 뺄까요?\n" + who.join(", ") + "\n회원탈퇴와 같아서 그 계정과 폴더·버그 신고가 지워지고 되돌릴 수 없습니다. 수업(슬라이드·학생 응답 포함)은 개발자 소유로 남습니다.")) return;
    const fails = [];
    for (const w of who) {
      const { data, error } = await sb.rpc("admin_set_teacher", { p_email: w, p_on: false });
      if (error || data.error) fails.push(w + ": " + (error ? error.message : data.error)); else picked.delete(w);
    }
    if (fails.length) alert("빼지 못한 선생님:\n" + fails.join("\n")); else flash(who.length + "명의 선생님을 뺐습니다.");
    await loadProfile();
  };
  // 입력란·단추는 칸 위에 띄워(.add-line) 열 너비·줄 높이·다른 요소 위치가 바뀌지 않게 한다. 숨은 「추가」 글자가 줄 높이를 잡는다
  const addRow = h("tr", { class: "add-row" }, h("td", { class: "pick" }),
    h("td", { class: "add-cell", colspan: 7 }, h("span", { class: "add-spacer", "aria-hidden": "true" }, "추가"), h("div", { class: "add-line" }, addBtn, newEmail, cancelBtn)));
  return h("section", { class: "card stack teachers-card" },
    h("h3", {}, "선생님 관리"),
    bulkBar(picked, ids, repaint, h("button", { class: "ghost small danger", type: "button", onclick: devOnly(removeMany) }, "빼기" + (picked.size ? " (" + picked.size + ")" : ""))),
    h("div", { class: "table-wrap" }, h("table", { class: "teachers-table" },
      h("thead", {}, h("tr", {}, pickHead(picked, ids, repaint), ["ID", "이메일", "직위", "수업", "마지막 로그인", "오늘 비밀번호 재설정", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, (p.teachers || []).map((t) => h("tr", { class: picked.has(t.email) ? "picked-row" : null },
        t.admin ? h("td", { class: "pick" }) : pickCell(picked, t.email, t.email, repaint),
        h("td", {}, t.code), h("td", {}, isPendingEmail(t.email) ? h("span", { class: "muted" }, "가입 전") : t.email),
        h("td", {}, t.admin ? h("span", { class: "tag warn" }, "개발자") : roleSwitch(t)),
        h("td", {}, t.lessons + "개"), h("td", {}, t.last_sign_in ? dateText(t.last_sign_in) : "로그인 안 함"), resetCell(t),
        h("td", {}, t.admin ? null : h("button", { class: "link danger", type: "button", onclick: devOnly(() => set(t.email, false)) }, "빼기")))),
        addRow))),
    requests.length ? h("div", { class: "stack" }, h("h4", {}, "가입 요청 (" + requests.length + ")"),
      h("div", { class: "table-wrap" }, h("table", { class: "teachers-table" },
        h("thead", {}, h("tr", {}, ["학번", "이름", "가입 이메일", "요청한 때", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, requests.map((r) => h("tr", {},
          h("td", {}, r.class_no || "—"), h("td", {}, r.name || "—"),
          h("td", {}, r.email, r.confirmed ? null : h("span", { class: "tag info" }, "메일 인증 전")), h("td", {}, dateText(r.at)),
          h("td", { class: "row" },
            h("button", { class: "link", type: "button", onclick: devOnly(() => decide(r, true)) }, "승인"),
            h("button", { class: "link danger", type: "button", onclick: devOnly(() => decide(r, false)) }, "거절")))))))) : "",
    h("p", { class: "muted small" }, "추가한 선생님은 교사 화면의 「가입하기」에서 같은 이메일로 가입하면 로그인할 수 있습니다. 승격된 학생은 「가입하기」에서 학번·이름을 적어 가입 요청을 보내고, 여기서 승인하면 그 이메일로 로그인합니다."));
}
