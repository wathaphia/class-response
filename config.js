// Supabase 연결 정보. Supabase 대시보드 → Project Settings → API 에서 복사해 붙여넣으세요.
// publishable(anon) 키는 공개되어도 괜찮습니다. service_role(secret) 키는 절대 넣지 마세요.
const SUPABASE_URL = "https://jijhiqnyyneuynnnxdyr.supabase.co";
const SUPABASE_KEY = "sb_publishable_Si3H0MawtrxoNwQ2o5u2sg_Gbh0yUWr";

// (선택) 실시간 화면 영상이 학교망에서 막힐 때 쓰는 중계 서버(Cloudflare TURN) 접속 정보 발급 주소.
// 비워 두면 무료 STUN만 씁니다(직접 연결이 되는 곳에서는 충분합니다).
// Cloudflare 결제 수단이 필요해 보류 중. 쓰게 되면 "https://class-turn.wathaphia.workers.dev" 를 넣으세요.
const TURN_URL = "";
