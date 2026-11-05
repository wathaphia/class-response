// 교사 화면 · 「그래픽」 탭(설정 아래 줄, 모든 선생님): 학생 슬라이드 화질 · 학생 모니터링(크게 보기) 화질.

// 학생 모니터링(학생 화면 크게 보기) 화질. 다음에 여는 크게 보기부터 적용된다(일괄 미리보기 작은 칸은 그대로)
// 학생 슬라이드 화질: 내 수업(공동 작업 수업은 주인의 설정)을 보는 학생 모두에게 적용(teachers.slide_q · set_my_slide_q)
const STUDENT_SLIDE_Q = { mid: { name: "보통", w: 1024, note: "데이터를 아낍니다(휴대폰·느린 와이파이)" }, hi: { name: "높음", w: 1920, note: "글씨가 작은 슬라이드도 또렷합니다" } };
function slideQualityView() {
  const now = profile && !profile.error ? profile.slide_q || "hi" : null;
  if (!now) return h("p", { class: "muted small" }, profile && profile.error ? "불러오지 못했습니다: " + profile.error : "불러오는 중…");
  return h("div", { class: "stack" },
    h("div", { class: "quality-pick" }, Object.entries(STUDENT_SLIDE_Q).map(([k, q]) => h("label", { class: "quality-opt" + (k === now ? " on" : "") },
      h("input", { type: "radio", name: "slide-quality", value: k, checked: k === now, async onchange() {
        const { error } = await sb.rpc("set_my_slide_q", { p: k });
        if (error) alert("바꾸지 못했습니다: " + error.message);
        else profile.slide_q = k;
        paintGraphic();
      } }),
      h("span", {}, h("b", {}, q.name + " "), h("span", { class: "muted small" }, "슬라이드 그림 가로 " + q.w + "px")),
      h("span", { class: "muted small" }, q.note)))),
    h("p", { class: "muted small" }, "학생 화면에 몇 초 안에 바로 적용됩니다. 학생이 슬라이드를 눌러 크게 볼 때는 늘 높은 화질입니다. 예전에 올려 작은 그림이 없는 수업은 높음으로 보입니다."));
}

function screenQualityView() {
  const now = screenQuality();
  return h("div", { class: "stack" },
    h("div", { class: "quality-pick" }, Object.entries(SCREEN_QUALITY).map(([k, q]) => h("label", { class: "quality-opt" + (k === now ? " on" : "") },
      h("input", { type: "radio", name: "screen-quality", value: k, checked: k === now, onchange() {
        try { localStorage.setItem(SCREEN_QUALITY_KEY, k); } catch {}
        paintGraphic();
      } }),
      h("span", {}, h("b", {}, q.name + " "), h("span", { class: "muted small" }, "전체 화면 " + q.h + "p · " + q.fps + " FPS · 최대 " + (q.br / 1e6) + " Mbps · 시뮬레이션 그림 가로 " + q.simW)),
      h("span", { class: "muted small" }, "학생 1명 1시간 최대 약 " + q.gb + "GB · " + q.note)))),
    h("p", { class: "muted small" }, "영상이 중계 서버로 이어지면 Cloudflare TURN(월 1,000GB)에서, 영상이 안 될 때 보내는 그림은 Supabase 전송량(월 5GB)에서 빠집니다. 화면이 거의 안 바뀌면 실제 사용량은 최대치보다 훨씬 적습니다. 다음에 여는 크게 보기부터 적용됩니다."));
}

function drawGraphic() {
  paintGraphic();
  if (!profile || profile.error) loadProfile().then(paintGraphic, () => {});   // 학생 슬라이드 화질은 프로필(slide_q)에서 읽는다
}
function paintGraphic() {
  if (tab !== "graphic" || !main) return;
  const section = (name, what, view) => h("section", { class: "card stack graphic-card" }, h("div", {}, h("h3", {}, name), h("span", { class: "muted small" }, what)), view());
  main.replaceChildren(h("div", { class: "stack" },
    h("h2", {}, "그래픽"),
    section("학생 슬라이드", "학생 화면의 슬라이드 그림 화질 · 내 모든 수업에 저장", slideQualityView),
    section("학생 모니터링", "학생 화면 크게 보기(한 명씩) 화질 · 이 기기에 저장", screenQualityView)));
}
