-- ============================================================
-- 수업 응답 웹앱 · 버전 2 · Supabase 설정
-- 교사(선생님)와 학생만 쓰는 판. 교사는 맨 아래에 적은 이메일로 로그인한다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 괜찮습니다.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- 교사 목록: 여기에 있는 이메일로 로그인한 사람만 교사 화면을 쓸 수 있다.
create table if not exists teachers (
  email text primary key
);

-- 수업(반) 하나. 수업 코드는 서버가 겹치지 않게 만든다.
create table if not exists lessons (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  code        text not null check (code ~ '^[A-Z0-9]{4,12}$'),
  title       text not null check (length(title) <= 100),
  slide_dir   text not null default '' check (length(slide_dir) <= 500),   -- 슬라이드 그림 주소({n} = 쪽 번호)
  slide_count int  not null default 0 check (slide_count between 0 and 300),
  page        int  not null default 1,
  open        boolean not null default true,
  created_at  timestamptz not null default now()
);
-- 나중에 더한 칸: 수업 종류(슬라이드 수업 / 설문만)
alter table lessons add column if not exists kind text not null default 'lesson' check (kind in ('lesson', 'survey'));
create unique index if not exists lessons_code_key on lessons (code);
create index if not exists lessons_owner on lessons (owner);

create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references lessons(id) on delete cascade,
  kind        text not null check (kind in ('slide', 'survey', 'quiz')),
  title       text not null check (length(title) <= 100),
  page        int,
  show_answer boolean not null default true,
  named       boolean not null default false,
  shared      boolean not null default false,
  questions   jsonb not null default '[]' check (octet_length(questions::text) <= 50000),
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists activities_lesson on activities (lesson_id);
-- 나중에 더한 칸: 여러 쪽에 걸친 질문의 끝 쪽(비우면 page 한 쪽)
alter table activities add column if not exists page_to int;
-- 나중에 더한 칸: 시뮬레이션(html 한 파일)과 '슬라이드 자리에 띄우기'
alter table activities add column if not exists html text;
alter table activities add column if not exists sim_full boolean not null default false;
-- 슬라이드 위에 얹는 시뮬레이션(테두리 없음)의 자리: 슬라이드 크기에 대한 비율 {"x","y","w","h"}(0~1). 비어 있으면 얹지 않는다.
alter table activities add column if not exists sim_place jsonb;
alter table activities drop constraint if exists activities_kind_check;
alter table activities add constraint activities_kind_check check (kind in ('slide', 'survey', 'quiz', 'sim'));
alter table activities drop constraint if exists activities_html_size;
alter table activities add constraint activities_html_size check (html is null or length(html) <= 500000);

-- 학생: 웹앱 전체에 한 명당 하나(학번 + 이름 + 4자리 비밀번호). 어느 수업에 들어와도 같은 비밀번호를 쓴다.
create table if not exists students (
  id           uuid primary key default gen_random_uuid(),
  class_no     text not null,        -- 학번
  name         text not null,
  pin_hash     text,                 -- 비어 있으면 다음에 들어올 때 새로 정한다(처음, 또는 교사가 초기화)
  pin_set      boolean generated always as (pin_hash is not null) stored,
  token        text unique,          -- 입장한 기기가 쓰는 열쇠. 초기화하면 지워져 모든 기기가 나가진다
  fails        int not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);
alter table students add column if not exists last_seen timestamptz;
-- 수업 중 화면 보기 동의: 가입할 때 한 번 묻고(비어 있으면 아직 안 물음) 학생 계정에 남긴다.
-- 학생은 언제든 바꿀 수 있고, 교사가 비밀번호를 초기화해도 그대로이며, 계정을 지우면 함께 지워진다.
alter table students add column if not exists monitor_consent boolean;
alter table students add column if not exists monitor_consent_at timestamptz;

-- 수업 참여: 학생이 어느 수업에 들어왔는지, 그 수업 화면을 마지막으로 연 때(교사 화면의 '접속 중')
create table if not exists lesson_students (
  lesson_id  uuid not null references lessons(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz,
  primary key (lesson_id, student_id)
);
create index if not exists lesson_students_student on lesson_students (student_id);

create table if not exists responses (
  student_id  uuid not null references students(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  answers     jsonb not null default '{}',
  score       int,
  total       int,
  updated_at  timestamptz not null default now(),
  primary key (student_id, activity_id)
);
create index if not exists responses_activity on responses (activity_id);

-- 예전 구조(수업마다 학생이 따로)에서 옮기기. 이미 새 구조면 아무것도 하지 않는다.
-- 같은 학번+이름은 한 명으로 합치고, 가장 최근에 들어온 기록의 비밀번호를 쓴다. 응답은 모두 그 학생에게 옮긴다.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'lesson_id') then
    drop table if exists pg_temp.keep_students;
    create temp table keep_students as
      select id, first_value(id) over (partition by class_no, name
                                       order by coalesce(last_seen, created_at) desc, created_at desc) as keep_id
      from students;
    insert into lesson_students (lesson_id, student_id, joined_at, last_seen)
      select s.lesson_id, k.keep_id, s.created_at, s.last_seen
      from students s join keep_students k on k.id = s.id
      on conflict (lesson_id, student_id) do nothing;
    update responses r set student_id = k.keep_id
      from keep_students k where r.student_id = k.id and k.id <> k.keep_id;
    delete from students s using keep_students k where s.id = k.id and k.id <> k.keep_id;
    alter table students drop column lesson_id;   -- 수업별 제약도 함께 없어진다
    drop table pg_temp.keep_students;
  end if;
end $$;
-- 이름만으로 들어온 학생은 학번이 '' 라 같은 이름이 여러 수업에 있을 수 있다
drop index if exists students_who;
create unique index if not exists students_who on students (class_no, name) where class_no <> '';

-- ------------------------------------------------------------
-- 보안(RLS): 표는 교사만 직접 읽고 쓴다. 학생은 아래 함수 세 개(입장, 상태, 저장)로만 들어온다.
-- ------------------------------------------------------------
alter table teachers   enable row level security;
alter table lessons    enable row level security;
alter table activities enable row level security;
alter table students   enable row level security;
alter table responses  enable row level security;
alter table lesson_students enable row level security;

-- 메일 인증을 마친 계정의 이메일(인증 전이면 null → 교사·개발자 아님)
create or replace function verified_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;
revoke all on function verified_email() from public;
grant execute on function verified_email() to authenticated;

create or replace function is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers where email = verified_email())
$$;

drop policy if exists teacher_all on lessons;
drop policy if exists teacher_all on activities;
drop policy if exists teacher_all on students;
drop policy if exists teacher_all on responses;
drop policy if exists teacher_all on lesson_students;
-- 교사 고유 ID(6자리 숫자, 공동 작업자 추가에 씀) · 개발자(is_admin)는 모든 교사의 수업에 손댈 수 있다
alter table teachers add column if not exists code text;
alter table teachers add column if not exists is_admin boolean not null default false;
alter table teachers add column if not exists created_at timestamptz not null default now();
create unique index if not exists teachers_code_key on teachers (code);
create or replace function new_teacher_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := (floor(random() * 900000) + 100000)::int::text;
    exit when not exists (select 1 from teachers where code = c);
  end loop;
  return c;
end $$;
create or replace function teachers_set_code() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(new.email);
  if new.code is null then new.code := new_teacher_code(); end if;
  return new;
end $$;
drop trigger if exists teachers_code on teachers;
create trigger teachers_code before insert on teachers for each row execute function teachers_set_code();
update teachers set code = new_teacher_code() where code is null;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers where email = verified_email() and is_admin)
$$;

-- 공동 작업자: 수업 주인(또는 개발자)이 다른 교사(ID로 찾음)에게 수업 하나씩 권한을 나눈다.
-- 공동 작업자는 그 수업을 보고 고치고 진행할 수 있지만, 지우거나 다른 사람에게 다시 나누지는 못한다.
create table if not exists lesson_collaborators (
  lesson_id  uuid not null references lessons(id) on delete cascade,
  email      text not null references teachers(email) on delete cascade,
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (lesson_id, email)
);
alter table lesson_collaborators enable row level security;
create index if not exists lesson_collaborators_email on lesson_collaborators (email);

-- 이 수업에 손댈 수 있는지: 개발자 · 주인 · 공동 작업자
create or replace function can_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_teacher() and (is_admin()
    or exists (select 1 from lessons where id = p_lesson and owner = auth.uid())
    or exists (select 1 from lesson_collaborators where lesson_id = p_lesson and email = lower(auth.jwt() ->> 'email')))
$$;
-- 수업을 지우거나 공동 작업자를 바꿀 수 있는지: 개발자 · 주인
create or replace function owns_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_teacher() and (is_admin() or exists (select 1 from lessons where id = p_lesson and owner = auth.uid()))
$$;

drop policy if exists teacher_select on lessons;
drop policy if exists teacher_insert on lessons;
drop policy if exists teacher_update on lessons;
drop policy if exists teacher_delete on lessons;
create policy teacher_select on lessons for select to authenticated using (can_lesson(id));
create policy teacher_insert on lessons for insert to authenticated with check (is_teacher() and (owner = auth.uid() or is_admin()));
create policy teacher_update on lessons for update to authenticated using (can_lesson(id)) with check (can_lesson(id));
create policy teacher_delete on lessons for delete to authenticated using (owns_lesson(id));
create policy teacher_all on activities for all to authenticated using (can_lesson(lesson_id)) with check (can_lesson(lesson_id));
-- 학생 계정은 웹앱 전체에 하나라 모든 교사가 함께 쓴다(비밀번호 초기화 등)
-- students 정책은 맨 아래 「보안 손질」(열 단위 권한과 함께)
create policy teacher_all on responses  for all to authenticated
  using (exists (select 1 from activities a where a.id = activity_id and can_lesson(a.lesson_id)))
  with check (exists (select 1 from activities a where a.id = activity_id and can_lesson(a.lesson_id)));
create policy teacher_all on lesson_students for all to authenticated using (can_lesson(lesson_id)) with check (can_lesson(lesson_id));
drop policy if exists teacher_read on lesson_collaborators;
create policy teacher_read on lesson_collaborators for select to authenticated using (can_lesson(lesson_id));

-- 전체 수업 관리: 교사가 만든 폴더와 수업 순서(끌어서 옮기기). 폴더를 지우면 안의 수업은 「폴더 없음」으로 나온다.
create table if not exists lesson_folders (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid(),
  name       text not null check (length(name) between 1 and 60),
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table lesson_folders enable row level security;
drop policy if exists teacher_all on lesson_folders;
-- 폴더는 교사마다 따로(개발자는 모두)
create policy teacher_all on lesson_folders for all to authenticated
  using (is_teacher() and (owner = auth.uid() or is_admin())) with check (is_teacher() and (owner = auth.uid() or is_admin()));
alter table lessons add column if not exists folder_id uuid references lesson_folders(id) on delete set null;
alter table lessons add column if not exists sort int not null default 0;

-- 새 수업 만들기: 겹치지 않는 수업 코드를 서버가 정한다(헷갈리는 0, O, 1, I 는 쓰지 않음)
-- p_kind: 'lesson'(슬라이드 수업) 또는 'survey'(설문만)
drop function if exists create_lesson(text);
create or replace function create_lesson(p_title text, p_kind text default 'lesson')
returns lessons language plpgsql security definer set search_path = public, extensions as $$
declare
  c text;
  l lessons;
  letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not is_teacher() then raise exception 'not a teacher'; end if;
  if coalesce(trim(p_title), '') = '' or length(p_title) > 100 then raise exception 'bad title'; end if;
  loop
    select string_agg(substr(letters, 1 + (get_byte(b, i) % length(letters)), 1), '')
      into c from (select gen_random_bytes(5) b) x, generate_series(0, 4) i;
    begin
      insert into lessons (owner, code, title, kind)
        values (auth.uid(), c, trim(p_title), case when p_kind = 'survey' then 'survey' else 'lesson' end) returning * into l;
      return l;
    exception when unique_violation then
      -- 드물게 겹치면 다시 뽑는다
    end;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 학생용 함수 (class-response-app 과 같음)
-- ------------------------------------------------------------
create or replace function tidy(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t, ''), '\s', '', 'g') $$;

-- 학생 입장: 학번+이름+비밀번호로 확인하고 이 수업에 참여시킨다.
-- 처음이거나 초기화된 학생은 p_confirm = true 로 다시 불러야 비밀번호가 정해진다. 5번 틀리면 10분 잠금.
create or replace function student_enter(p_code text, p_class_no text, p_name text, p_pin text, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l lessons;
  s students;
  c text := tidy(p_class_no);
  n text := tidy(p_name);
  existed boolean;
begin
  select * into l from lessons where code = upper(tidy(p_code));
  if not found then return jsonb_build_object('error', 'no_lesson'); end if;
  if c = '' or n = '' or length(c) > 20 or length(n) > 20 then return jsonb_build_object('error', 'bad_name'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then return jsonb_build_object('error', 'bad_pin'); end if;

  select * into s from students where class_no = c and name = n for update;
  existed := found;

  if not existed or s.pin_hash is null then
    if not p_confirm then return jsonb_build_object('error', 'need_confirm', 'reset', existed); end if;
    if not existed then
      if (select count(*) from students) >= 5000 then return jsonb_build_object('error', 'full'); end if;
      insert into students (class_no, name) values (c, n) returning * into s;
    end if;
    update students
      set pin_hash = crypt(p_pin, gen_salt('bf')), fails = 0, locked_until = null,
          token = coalesce(token, encode(gen_random_bytes(24), 'hex'))
      where id = s.id returning * into s;
  else
    if s.locked_until > now() then
      return jsonb_build_object('error', 'locked', 'minutes', ceil(extract(epoch from s.locked_until - now()) / 60));
    end if;
    if s.pin_hash <> crypt(p_pin, s.pin_hash) then
      if s.fails + 1 >= 5 then
        update students set fails = 0, locked_until = now() + interval '10 minutes' where id = s.id;
        return jsonb_build_object('error', 'locked', 'minutes', 10);
      end if;
      update students set fails = fails + 1 where id = s.id;
      return jsonb_build_object('error', 'wrong_pin', 'left', 4 - s.fails);
    end if;
    update students
      set fails = 0, locked_until = null, token = coalesce(token, encode(gen_random_bytes(24), 'hex'))
      where id = s.id returning * into s;
  end if;

  if not exists (select 1 from lesson_students where lesson_id = l.id and student_id = s.id) then
    if (select count(*) from lesson_students where lesson_id = l.id) >= 200 then return jsonb_build_object('error', 'full'); end if;
    insert into lesson_students (lesson_id, student_id) values (l.id, s.id) on conflict do nothing;
  end if;
  return jsonb_build_object('token', s.token, 'class_no', s.class_no, 'name', s.name, 'code', l.code);
end $$;

-- 학생 입장(수업 코드 + 이름): 이 수업에 같은 이름이 있으면 그 학생으로, 없으면 새로 만든다.
-- 새로 만들 때는 화면 보기 동의(p_consent)를 받아야 한다(비어 있으면 need_consent).
create or replace function student_join(p_code text, p_name text, p_consent boolean default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l lessons;
  s students;
  n text := tidy(p_name);
  made boolean := false;
begin
  select * into l from lessons where code = upper(tidy(p_code));
  if not found then return jsonb_build_object('error', 'no_lesson'); end if;
  if n = '' or length(n) > 20 then return jsonb_build_object('error', 'bad_name'); end if;

  select st.* into s from students st join lesson_students ls on ls.student_id = st.id
    where ls.lesson_id = l.id and st.name = n
    order by ls.last_seen desc nulls last limit 1;
  if not found then
    if p_consent is null then return jsonb_build_object('error', 'need_consent'); end if;
    if (select count(*) from students) >= 5000 then return jsonb_build_object('error', 'full'); end if;
    if (select count(*) from lesson_students where lesson_id = l.id) >= 200 then return jsonb_build_object('error', 'full'); end if;
    insert into students (class_no, name, monitor_consent, monitor_consent_at)
      values ('', n, p_consent, now()) returning * into s;
    insert into lesson_students (lesson_id, student_id) values (l.id, s.id) on conflict do nothing;
    made := true;
  end if;
  update students set token = coalesce(token, encode(gen_random_bytes(24), 'hex'))
    where id = s.id returning * into s;
  return jsonb_build_object('token', s.token, 'class_no', s.class_no, 'name', s.name, 'code', l.code, 'new', made);
end $$;
revoke all on function student_join(text, text, boolean) from public;
grant execute on function student_join(text, text, boolean) to anon, authenticated;

-- 학생 입장(수업 코드 + 학번(번호) + 이름): 같은 학번+이름이면 같은 학생(어느 수업이든), 이 수업에 이름만으로 들어왔던 학생이면 학번을 채운다.
-- 새로 만들 때는 화면 보기 동의(p_consent)를 받아야 한다(비어 있으면 need_consent).
create or replace function student_join_no(p_code text, p_class_no text, p_name text, p_consent boolean default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l lessons;
  s students;
  c text := tidy(p_class_no);
  n text := tidy(p_name);
  made boolean := false;
begin
  select * into l from lessons where code = upper(tidy(p_code));
  if not found then return jsonb_build_object('error', 'no_lesson'); end if;
  if n = '' or length(n) > 20 then return jsonb_build_object('error', 'bad_name'); end if;
  if c = '' or length(c) > 20 then return jsonb_build_object('error', 'bad_no'); end if;

  select * into s from students where class_no = c and name = n;
  if not found then
    select st.* into s from students st join lesson_students ls on ls.student_id = st.id
      where ls.lesson_id = l.id and st.name = n and st.class_no = ''
      order by ls.last_seen desc nulls last limit 1;
    if found then
      update students set class_no = c where id = s.id returning * into s;
    else
      if p_consent is null then return jsonb_build_object('error', 'need_consent'); end if;
      if (select count(*) from students) >= 5000 then return jsonb_build_object('error', 'full'); end if;
      insert into students (class_no, name, monitor_consent, monitor_consent_at)
        values (c, n, p_consent, now()) returning * into s;
      made := true;
    end if;
  end if;
  if not exists (select 1 from lesson_students where lesson_id = l.id and student_id = s.id) then
    if (select count(*) from lesson_students where lesson_id = l.id) >= 200 then
      if made then delete from students where id = s.id; end if;
      return jsonb_build_object('error', 'full');
    end if;
    insert into lesson_students (lesson_id, student_id) values (l.id, s.id) on conflict do nothing;
  end if;
  update students set token = coalesce(token, encode(gen_random_bytes(24), 'hex'))
    where id = s.id returning * into s;
  return jsonb_build_object('token', s.token, 'class_no', s.class_no, 'name', s.name, 'code', l.code, 'new', made);
end $$;
revoke all on function student_join_no(text, text, text, boolean) from public;
grant execute on function student_join_no(text, text, text, boolean) to anon, authenticated;


-- 학생 화면에 필요한 것 전부: 이 수업의 상태, 활동, 내 응답, 공개된 친구들 응답.
-- 이미 입장한 학생(열쇠가 있는 기기)이 새 수업 코드로 오면 비밀번호 없이 그 수업에 참여시킨다.
-- p_have: 학생 화면이 지난번에 받은 내용의 지문(v). 그대로면 {same:true}만 돌려줘 전송량을 아낀다.
drop function if exists student_state(text);
drop function if exists student_state(text, text);
create or replace function student_state(p_token text, p_code text, p_have text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s students;
  l lessons;
  m lesson_students;
  res jsonb;
  v text;
begin
  select * into s from students where token = p_token and p_token is not null;
  if not found then return jsonb_build_object('error', 'logged_out'); end if;
  select * into l from lessons where code = upper(tidy(p_code));
  if not found then return jsonb_build_object('error', 'no_lesson'); end if;
  select * into m from lesson_students where lesson_id = l.id and student_id = s.id;
  if not found then
    if (select count(*) from lesson_students where lesson_id = l.id) >= 200 then return jsonb_build_object('error', 'full'); end if;
    insert into lesson_students (lesson_id, student_id) values (l.id, s.id) on conflict do nothing returning * into m;
  end if;
  -- 접속 중 표시: 10초에 한 번만 적는다
  if m.last_seen is null or m.last_seen < now() - interval '10 seconds' then
    update lesson_students set last_seen = now() where lesson_id = l.id and student_id = s.id;
  end if;

  res := jsonb_build_object(
    'me', jsonb_build_object('id', s.id, 'class_no', s.class_no, 'name', s.name, 'monitor', s.monitor_consent),
    'lesson', jsonb_build_object('id', l.id, 'code', l.code, 'title', l.title, 'slide_dir', l.slide_dir,
                                 'slide_count', l.slide_count, 'page', l.page, 'open', l.open, 'kind', l.kind),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'title', a.title, 'page', a.page, 'page_to', a.page_to, 'named', a.named, 'shared', a.shared,
        'sim_full', a.sim_full, 'sim_place', a.sim_place, 'html_ver', case when a.kind = 'sim' then md5(coalesce(a.html, '')) end,
        'questions', case
          when a.kind = 'quiz' and a.show_answer and r.student_id is not null then a.questions
          else (select coalesce(jsonb_agg(q - 'answer' - 'explain'), '[]'::jsonb) from jsonb_array_elements(a.questions) q)
        end,
        'mine', r.answers, 'score', r.score, 'total', r.total, 'saved_at', r.updated_at,
        -- 공개한 응답. 익명은 질문마다 정한다(questions[].anon, 없으면 예전처럼 활동의 named를 따름).
        -- 한 학생의 답을 「이름 붙은 질문」과 「익명 질문」 두 묶음으로 나누고, 익명 묶음은 이름 없이 다른 순서로 섞어
        -- 이름 붙은 답과 이어 맞춰 누가 썼는지 알아낼 수 없게 한다.
        'others', case when a.shared then (
          with ids as (
            select q ->> 'id' as id, case when q ? 'anon' then (q ->> 'anon') <> 'true' else a.named end as named
            from jsonb_array_elements(a.questions) q
          ), parts as (
            select x.updated_at::text as at, md5(x.student_id::text || x.activity_id::text) as mix, o.class_no || ' ' || o.name as nm,
                   (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(x.answers) e join ids on ids.id = e.key and ids.named) as named_a,
                   (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(x.answers) e join ids on ids.id = e.key and not ids.named) as anon_a
            from responses x join students o on o.id = x.student_id
            where x.activity_id = a.id
          )
          select coalesce(jsonb_agg(d order by g, k), '[]'::jsonb) from (
            select jsonb_build_object('name', nm, 'answers', named_a) as d, 0 as g, at as k from parts where named_a <> '{}'::jsonb
            union all
            select jsonb_build_object('name', null, 'answers', anon_a), 1, mix from parts where anon_a <> '{}'::jsonb
          ) t) end,
        'others_n', case when a.shared then (select count(*) from responses x where x.activity_id = a.id) end
      ) order by a.page nulls last, a.sort, a.created_at)
      from activities a
      left join responses r on r.activity_id = a.id and r.student_id = s.id
      where a.lesson_id = l.id), '[]'::jsonb)
  );
  v := md5(res::text);
  if p_have = v then return jsonb_build_object('same', true); end if;
  return res || jsonb_build_object('v', v);
end $$;

-- 학생 응답 저장. 그 수업에 참여한 학생만, 제출이 열려 있을 때만. 퀴즈는 한 번만 제출하고 서버에서 채점한다.
create or replace function student_save(p_token text, p_activity uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s students;
  l lessons;
  a activities;
  sc int;
  tot int;
begin
  select * into s from students where token = p_token and p_token is not null;
  if not found then return jsonb_build_object('error', 'logged_out'); end if;
  select * into a from activities where id = p_activity;
  if not found or a.kind = 'sim' or not exists (select 1 from lesson_students where lesson_id = a.lesson_id and student_id = s.id) then
    return jsonb_build_object('error', 'no_activity');
  end if;
  select * into l from lessons where id = a.lesson_id;
  if not l.open then return jsonb_build_object('error', 'closed'); end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 20000 then
    return jsonb_build_object('error', 'too_big');
  end if;

  if a.kind = 'quiz' then
    if exists (select 1 from responses where student_id = s.id and activity_id = a.id) then
      return jsonb_build_object('error', 'already');
    end if;
    select count(*) filter (where q ? 'answer'),
           count(*) filter (where q ? 'answer' and p_answers -> (q ->> 'id') = q -> 'answer')
      into tot, sc
      from jsonb_array_elements(a.questions) q;
  end if;

  if a.kind = 'quiz' then
    insert into responses (student_id, activity_id, answers, score, total, updated_at)
      values (s.id, a.id, p_answers, sc, tot, now())
      on conflict (student_id, activity_id) do nothing;
    if not found then return jsonb_build_object('error', 'already'); end if;
    return jsonb_build_object('ok', true);
  end if;
  insert into responses (student_id, activity_id, answers, score, total, updated_at)
    values (s.id, a.id, p_answers, sc, tot, now())
    on conflict (student_id, activity_id)
    do update set answers = excluded.answers, score = excluded.score, total = excluded.total, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 시뮬레이션 html: 크기가 커서 3초마다 받는 상태에는 넣지 않고, 바뀌었을 때(html_ver)만 이것으로 한 번 받는다
create or replace function student_sim(p_token text, p_activity uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s students;
  a activities;
begin
  select * into s from students where token = p_token and p_token is not null;
  if not found then return null; end if;
  select * into a from activities where id = p_activity and kind = 'sim';
  if not found or not exists (select 1 from lesson_students where lesson_id = a.lesson_id and student_id = s.id) then return null; end if;
  return a.html;
end $$;

-- 교사 화면: 이 수업에 들어온 학생 목록(비밀번호 대신 '정해졌는지'만)
create or replace function teacher_students(p_lesson uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_lesson(p_lesson) then raise exception 'not your lesson'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'class_no', s.class_no, 'name', s.name, 'pin_set', s.pin_set, 'fails', s.fails,
      'locked_until', s.locked_until, 'created_at', s.created_at, 'joined_at', m.joined_at, 'last_seen', m.last_seen,
      'monitor', s.monitor_consent))
    from lesson_students m join students s on s.id = m.student_id
    where m.lesson_id = p_lesson), '[]'::jsonb);
end $$;

-- 학생이 자기 화면 보기 동의를 정하거나 바꾼다(자기 열쇠로만)
create or replace function student_set_monitor(p_token text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_consent is null then return jsonb_build_object('error', 'bad_value'); end if;
  update students set monitor_consent = p_consent, monitor_consent_at = now()
    where token = p_token and p_token is not null;
  if not found then return jsonb_build_object('error', 'logged_out'); end if;
  return jsonb_build_object('ok', true, 'monitor', p_consent);
end $$;

revoke all on function student_set_monitor(text, boolean) from public;
grant execute on function student_set_monitor(text, boolean) to anon, authenticated;
revoke all on function student_enter(text, text, text, text, boolean) from public;
revoke all on function student_state(text, text, text) from public;
revoke all on function teacher_students(uuid) from public;
revoke all on function student_sim(text, uuid) from public;
revoke all on function student_save(text, uuid, jsonb) from public;
revoke all on function create_lesson(text, text) from public;
grant execute on function student_enter(text, text, text, text, boolean) to anon, authenticated;
grant execute on function student_state(text, text, text) to anon, authenticated;
grant execute on function teacher_students(uuid) to authenticated;
grant execute on function student_sim(text, uuid) to anon, authenticated;
grant execute on function student_save(text, uuid, jsonb) to anon, authenticated;
grant execute on function create_lesson(text, text) to authenticated;
grant execute on function is_teacher() to authenticated;

-- ------------------------------------------------------------
-- 슬라이드 저장소(그림·PPTX): 누구나 주소로 볼 수 있고(학생 화면), 교사만 올리고 지운다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('slides', 'slides', true, 52428800, array['image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
  on conflict (id) do update set public = true, file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];

drop policy if exists slides_teacher_read on storage.objects;
drop policy if exists slides_teacher_insert on storage.objects;
drop policy if exists slides_teacher_update on storage.objects;
drop policy if exists slides_teacher_delete on storage.objects;
create policy slides_teacher_read on storage.objects for select to authenticated using (bucket_id = 'slides' and is_teacher());
-- 올리기·고치기·지우기 정책은 맨 아래 「보안 손질」

-- ------------------------------------------------------------
-- 인증 메일 기록: 함수 send-email(class-tools\mail-hook)이 Gmail(Apps Script, 하루 100통)로 보낼 때마다 한 줄. 화면에선 못 읽음(서비스 키만)
create table if not exists mail_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null
);
alter table mail_log enable row level security;

-- 비밀번호 재설정 전에: 이 이메일에 연결된 계정이 있는가(없으면 메일을 보내지 않고 화면에 알림)
create or replace function email_has_account(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;
revoke all on function email_has_account(text) from public;
grant execute on function email_has_account(text) to anon, authenticated;

-- 비밀번호 재설정 메일 횟수: 한 사람(이메일)이 하루(한국 시간) 3번까지, 3초 간격. 화면은 보내기 전에 claim_password_reset 으로 한 번을 받아 간다
create table if not exists reset_log (
  id bigint generated always as identity primary key,
  email text not null,
  at timestamptz not null default now()
);
create index if not exists reset_log_email_at on reset_log (email, at);
alter table reset_log enable row level security;

create or replace function claim_password_reset(p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  n int;
  last_at timestamptz;
begin
  if not exists (select 1 from auth.users where lower(email) = e) then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;
  perform pg_advisory_xact_lock(hashtext('reset:' || e));
  select count(*), max(at) into n, last_at from reset_log
   where email = e and at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  if n >= 3 then return jsonb_build_object('ok', false, 'reason', 'limit', 'used', n, 'limit', 3); end if;
  if last_at > now() - interval '3 seconds' then return jsonb_build_object('ok', false, 'reason', 'cooldown', 'used', n, 'limit', 3); end if;
  insert into reset_log (email) values (e);
  return jsonb_build_object('ok', true, 'used', n + 1, 'limit', 3);
end $$;
revoke all on function claim_password_reset(text) from public;
grant execute on function claim_password_reset(text) to anon, authenticated;

-- 로그인한 사람의 오늘 재설정 메일 횟수(프로필 표시용)
create or replace function my_reset_quota()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('used', count(*), 'limit', 3) from reset_log
   where email = lower(auth.email()) and at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function my_reset_quota() from public;
grant execute on function my_reset_quota() to authenticated;

-- ------------------------------------------------------------
-- 기타 관리(교사 화면): 무료 한도에 견줄 사용량. 교사만 부를 수 있다.
-- 접속 중 = 최근 20초 안에 수업 화면을 연 학생(교사 화면의 「접속 중」과 같은 기준)
-- ------------------------------------------------------------
create or replace function resource_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_teacher() then raise exception 'not a teacher'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'storage_files', (select count(*) from storage.objects),
    'mau', (select count(*) from auth.users where last_sign_in_at >= date_trunc('month', now())),
    'db_conn', (select count(*) from pg_stat_activity where datname = current_database()),
    'db_conn_max', current_setting('max_connections')::int,
    'online', (select count(distinct student_id) from lesson_students where last_seen > now() - interval '20 seconds'),
    'students', (select count(*) from students),
    'lessons', (select count(*) from lessons),
    'responses', (select count(*) from responses),
    'mail_day', (select count(*) from mail_log where at > now() - interval '24 hours'),
    'reset_day', (select count(*) from reset_log where at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'mail_month', (select count(*) from mail_log where at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
    'tables', (select jsonb_agg(jsonb_build_object('name', relname, 'rows', n_live_tup, 'bytes', pg_total_relation_size(relid))
                                order by pg_total_relation_size(relid) desc)
               from pg_stat_user_tables where schemaname = 'public'));
end $$;
revoke all on function resource_usage() from public;
grant execute on function resource_usage() to authenticated;

-- ------------------------------------------------------------
-- 프로필(교사 화면 오른쪽 위): 내 정보 · 공동 작업자 · (개발자) 교사 목록
-- ------------------------------------------------------------
create or replace function my_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := lower(auth.jwt() ->> 'email');
  t teachers;
begin
  select * into t from teachers where email = me;
  if not found then raise exception 'not a teacher'; end if;
  if t.code is null then update teachers set code = new_teacher_code() where email = me returning * into t; end if;
  return jsonb_build_object(
    'email', t.email, 'code', t.code, 'admin', t.is_admin, 'since', t.created_at, 'student', t.student_id is not null,
    'promoted', promoted_students(),   -- 선생님으로 승격된 학생(아래)
    -- 공동 작업자로 고를 수 있는 다른 선생님(「선생님 추가」로 넣은 선생님 먼저, 그다음 승격된 학생)
    'colleagues', coalesce((select jsonb_agg(jsonb_build_object('email', x.email, 'code', x.code, 'account', u.id is not null,
        'class_no', s.class_no, 'name', s.name) order by s.id is not null, s.class_no, s.name, x.email)
      from teachers x left join students s on s.id = x.student_id left join auth.users u on lower(u.email) = x.email
      where x.email <> me), '[]'::jsonb),
    'own', (select count(*) from lessons where owner = auth.uid()),
    'shared', (select count(*) from lesson_collaborators where email = me),
    -- 내가 나눈(개발자는 모든) 수업의 공동 작업자
    'collaborators', coalesce((select jsonb_agg(jsonb_build_object('lesson_id', c.lesson_id, 'title', l.title, 'lesson_code', l.code,
        'email', c.email, 'code', x.code) order by l.title, c.email)
      from lesson_collaborators c join lessons l on l.id = c.lesson_id join teachers x on x.email = c.email
      where l.owner = auth.uid() or t.is_admin), '[]'::jsonb),
    -- 다른 교사가 나에게 나눈 수업
    'shared_with_me', coalesce((select jsonb_agg(jsonb_build_object('lesson_id', l.id, 'title', l.title, 'owner', u.email) order by l.title)
      from lesson_collaborators c join lessons l on l.id = c.lesson_id left join auth.users u on u.id = l.owner
      where c.email = me), '[]'::jsonb),
    'teachers', case when t.is_admin then coalesce((select jsonb_agg(jsonb_build_object('email', x.email, 'code', x.code, 'admin', x.is_admin,
        'since', x.created_at, 'last_sign_in', u.last_sign_in_at, 'lessons', (select count(*) from lessons l where l.owner = u.id)) order by x.created_at)
      from teachers x left join auth.users u on lower(u.email) = x.email), '[]'::jsonb) end,
    -- (개발자) 승격된 학생의 가입 요청(아래 teacher_requests)
    'requests', case when t.is_admin then coalesce((select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'class_no', s.class_no, 'name', s.name,
        'email', r.email, 'at', r.created_at, 'confirmed', u.email_confirmed_at is not null) order by r.created_at)
      from teacher_requests r join students s on s.id = r.student_id left join auth.users u on lower(u.email) = r.email), '[]'::jsonb) end);
end $$;

-- 공동 작업자 추가: 상대 교사의 6자리 ID와 나눌 수업들(내 수업만, 개발자는 모든 수업)
create or replace function add_collaborator(p_code text, p_lessons uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who text;
  n int;
begin
  if not is_admin() then raise exception 'admin only'; end if;   -- 공동 작업자는 개발자만 붙인다
  select email into who from teachers where code = trim(p_code);
  if who is null then return jsonb_build_object('error', 'no_teacher'); end if;
  if who = lower(auth.jwt() ->> 'email') then return jsonb_build_object('error', 'self'); end if;
  -- 그 교사가 주인인 수업은 건너뛴다
  insert into lesson_collaborators (lesson_id, email)
    select x, who from unnest(p_lessons) x
    where not exists (select 1 from lessons l join auth.users u on u.id = l.owner where l.id = x and lower(u.email) = who)
    on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'email', who, 'added', n);
end $$;

create or replace function remove_collaborator(p_lesson uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- 주인·개발자가 빼거나, 공동 작업자가 스스로 빠진다
  if not (owns_lesson(p_lesson) or (is_teacher() and lower(p_email) = lower(auth.jwt() ->> 'email'))) then raise exception 'not allowed'; end if;
  delete from lesson_collaborators where lesson_id = p_lesson and email = lower(p_email);
  return jsonb_build_object('ok', true);
end $$;

-- 개발자 전용: 선생님 추가·빼기(빼도 그 교사의 수업은 남고 개발자가 볼 수 있다)
create or replace function admin_set_teacher(p_email text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('error', 'bad_email'); end if;
  if p_on then insert into teachers (email) values (e) on conflict do nothing;
  else
    if e = lower(auth.jwt() ->> 'email') then return jsonb_build_object('error', 'self'); end if;
    delete from teachers where email = e and not is_admin;
  end if;
  return jsonb_build_object('ok', true, 'code', (select code from teachers where email = e));
end $$;

revoke all on function my_profile() from public;
revoke all on function add_collaborator(text, uuid[]) from public;
revoke all on function remove_collaborator(uuid, text) from public;
revoke all on function admin_set_teacher(text, boolean) from public;
revoke all on function new_teacher_code() from public;
grant execute on function my_profile() to authenticated;
grant execute on function add_collaborator(text, uuid[]) to authenticated;
grant execute on function remove_collaborator(uuid, text) to authenticated;
grant execute on function admin_set_teacher(text, boolean) to authenticated;
grant execute on function is_admin() to authenticated;
grant execute on function can_lesson(uuid) to authenticated;
grant execute on function owns_lesson(uuid) to authenticated;

-- ------------------------------------------------------------
-- 학생을 선생님으로 승격(개발자만, 「학생 관리」에서): 학생 계정에 로그인 이메일을 붙여 teachers 에 넣는다.
-- 승격된 학생은 그 이메일로 교사 화면의 「가입하기」를 해 로그인하고,
-- 선생님들은 「공동 작업자 추가」에서 승격된 학생이나 「선생님 추가」로 넣은 선생님을 골라 수업을 함께 쓴다.
-- 학생 계정을 지우면 선생님 자격도 함께 없어진다(그 사람이 만든 수업은 남고 개발자가 볼 수 있다).
-- ------------------------------------------------------------
alter table teachers add column if not exists student_id uuid references students(id) on delete cascade;
create unique index if not exists teachers_student_key on teachers (student_id);

create or replace function promote_student(p_student uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not is_admin() then raise exception 'admin only'; end if;
  -- 이메일을 비워 두면 임시 주소(가입 전)를 붙이고, 학생이 「가입하기」에서 보낸 요청을 개발자가 승인할 때 진짜 이메일로 바뀐다
  if coalesce(e, '') = '' then e := 'pending-' || replace(p_student::text, '-', '') || '@promoted.invalid'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('error', 'bad_email'); end if;
  if not exists (select 1 from students where id = p_student) then return jsonb_build_object('error', 'no_student'); end if;
  if exists (select 1 from teachers where student_id = p_student) then return jsonb_build_object('error', 'already'); end if;
  if exists (select 1 from teachers where email = e) then return jsonb_build_object('error', 'email_taken'); end if;
  insert into teachers (email, student_id) values (e, p_student);
  return jsonb_build_object('ok', true, 'code', (select code from teachers where email = e));
end $$;

-- 선생님 자격 해제: 학생 계정은 그대로 두고, 공동 작업자 권한은 함께 없어진다
create or replace function demote_student(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  delete from teachers where student_id = p_student and not is_admin;
  return jsonb_build_object('ok', true);
end $$;

-- 승격된 학생 목록(모든 선생님이 봄: 학생 관리 위쪽 표 · 공동 작업자 고르기)
create or replace function promoted_students()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_teacher() then coalesce((select jsonb_agg(jsonb_build_object(
      'student_id', s.id, 'class_no', s.class_no, 'name', s.name, 'email', t.email, 'code', t.code, 'since', t.created_at,
      'account', u.id is not null, 'confirmed', u.email_confirmed_at is not null, 'last_sign_in', u.last_sign_in_at,
      'own', (select count(*) from lessons l where l.owner = u.id),
      'shared', (select count(*) from lesson_collaborators c where c.email = t.email))
    order by s.class_no, s.name)
    from teachers t join students s on s.id = t.student_id left join auth.users u on lower(u.email) = t.email), '[]'::jsonb) end
$$;

revoke all on function promote_student(uuid, text) from public;
revoke all on function demote_student(uuid) from public;
revoke all on function promoted_students() from public;
grant execute on function promote_student(uuid, text) to authenticated;
grant execute on function demote_student(uuid) to authenticated;
grant execute on function promoted_students() to authenticated;

-- ------------------------------------------------------------
-- 승격된 학생의 가입 요청: 교사 화면 「가입하기」에서 「학생에서 승격되었습니까? 예」를 고르고 학번·이름·이메일을 적는다.
-- 학번·이름이 승격된 학생과 맞으면 요청이 남고, 개발자가 「전체 선생님 및 학생」 → 선생님 관리에서 승인하면
-- 그 이메일이 그 학생의 교사 로그인 이메일이 된다(승격할 때 적은 이메일은 바뀐다). 학생 한 명에 요청 하나(다시 보내면 덮어씀).
-- ------------------------------------------------------------
create table if not exists teacher_requests (
  student_id uuid primary key references students(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
alter table teacher_requests enable row level security;   -- 정책 없음: 아래 RPC로만 읽고 쓴다

-- 승인하면 교사 이메일이 바뀌므로 공동 작업자 표도 따라 바뀌게
alter table lesson_collaborators drop constraint if exists lesson_collaborators_email_fkey;
alter table lesson_collaborators add constraint lesson_collaborators_email_fkey
  foreign key (email) references teachers(email) on delete cascade on update cascade;

create or replace function request_teacher_signup(p_class_no text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(p_email));
  sid uuid;
begin
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('error', 'bad_email'); end if;
  select s.id into sid from students s join teachers t on t.student_id = s.id
    where tidy(s.class_no) = tidy(p_class_no) and tidy(s.name) = tidy(p_name) limit 1;
  if sid is null then return jsonb_build_object('error', 'no_match'); end if;
  if exists (select 1 from teachers where email = e and student_id is distinct from sid) then return jsonb_build_object('error', 'email_taken'); end if;
  if exists (select 1 from teacher_requests where student_id = sid and email <> e) then return jsonb_build_object('error', 'pending'); end if;
  insert into teacher_requests (student_id, email) values (sid, e)
    on conflict (student_id) do update set created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 개발자: 가입 요청 승인(p_ok) 또는 거절
create or replace function decide_teacher_request(p_student uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r teacher_requests;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into r from teacher_requests where student_id = p_student;
  if not found then return jsonb_build_object('error', 'no_request'); end if;
  if p_ok then
    if not exists (select 1 from teachers where student_id = p_student) then
      delete from teacher_requests where student_id = p_student;
      return jsonb_build_object('error', 'not_promoted');
    end if;
    if exists (select 1 from teachers where email = r.email and student_id is distinct from p_student) then return jsonb_build_object('error', 'email_taken'); end if;
    update teachers set email = r.email where student_id = p_student;
  end if;
  delete from teacher_requests where student_id = p_student;
  return jsonb_build_object('ok', true, 'email', r.email);
end $$;

revoke all on function request_teacher_signup(text, text, text) from public;
revoke all on function decide_teacher_request(uuid, boolean) from public;
grant execute on function request_teacher_signup(text, text, text) to anon, authenticated;
grant execute on function decide_teacher_request(uuid, boolean) to authenticated;

-- 버그 제보(편집 모드 「버그 제보」 탭): 선생님 누구나 쓰고 모두 읽는다. 고치기·지우기는 쓴 사람과 개발자(is_admin)만.
-- 한 사람당 5개까지(지우면 다시 쓸 수 있음). 쓴 사람·이메일·시각은 서버가 채운다.
create table if not exists bug_reports (
  id           uuid primary key default gen_random_uuid(),
  author       uuid not null default auth.uid(),
  author_email text not null default '',
  body         text not null check (length(btrim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table bug_reports enable row level security;
create or replace function bug_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author := auth.uid();
    new.author_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.created_at := now();
    if (select count(*) from bug_reports where author = new.author) >= 5 then
      raise exception '버그 제보는 한 사람당 5개까지 쓸 수 있습니다. 예전 제보를 지우거나 고쳐 주세요.';
    end if;
  else
    new.author := old.author; new.author_email := old.author_email; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bug_reports_guard on bug_reports;
create trigger bug_reports_guard before insert or update on bug_reports for each row execute function bug_reports_guard();
drop policy if exists bug_read on bug_reports;
drop policy if exists bug_write on bug_reports;
drop policy if exists bug_edit on bug_reports;
drop policy if exists bug_del on bug_reports;
create policy bug_read  on bug_reports for select to authenticated using (is_teacher());
create policy bug_write on bug_reports for insert to authenticated with check (is_teacher());
create policy bug_edit  on bug_reports for update to authenticated using (is_teacher() and (author = auth.uid() or is_admin())) with check (is_teacher());
create policy bug_del   on bug_reports for delete to authenticated using (is_teacher() and (author = auth.uid() or is_admin()));
grant select, insert, update, delete on bug_reports to authenticated;

-- ------------------------------------------------------------
-- 교사 이메일: teacher@example.com 을 자기 이메일(소문자)로 바꾸세요. 여러 명이면 줄을 더하면 됩니다.
-- ------------------------------------------------------------
insert into teachers (email) values ('wathaphia@gmail.com') on conflict do nothing;
-- 이 웹앱의 개발자: 모든 교사의 수업·공동 작업자·교사 목록을 관리한다
update teachers set is_admin = true where email = 'wathaphia@gmail.com';

-- ---------- 보안 손질(2026-10-30) ----------
-- 보안 손질(2026-10-30)
-- 1) 학생 표: 교사도 학생 열쇠(token)·PIN 해시는 못 읽게 열 단위 권한. 고치기는 RPC로만. 지우기는 자기 수업 학생(또는 어느 수업에도 없는 학생)·개발자만.
revoke all on students from anon;
revoke select, insert, update, references, trigger, truncate on students from authenticated;
grant select (id, class_no, name, created_at, last_seen, monitor_consent, monitor_consent_at, pin_set) on students to authenticated;
grant insert (class_no, name) on students to authenticated;
grant delete on students to authenticated;
drop policy if exists teacher_all on students;
drop policy if exists teacher_read on students;
drop policy if exists teacher_insert on students;
drop policy if exists teacher_delete on students;
create policy teacher_read on students for select to authenticated using (is_teacher());
create policy teacher_insert on students for insert to authenticated with check (is_teacher());
create policy teacher_delete on students for delete to authenticated using (is_teacher() and (is_admin()
  or exists (select 1 from lesson_students ls where ls.student_id = students.id and can_lesson(ls.lesson_id))
  or not exists (select 1 from lesson_students ls where ls.student_id = students.id)));

-- 2) 수업 주인은 개발자만 바꾼다(공동 작업자가 주인을 자기로 바꿔 수업을 가져가지 못하게)
create or replace function lessons_owner_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner and not is_admin() and auth.uid() is not null then
    raise exception '수업 주인은 바꿀 수 없습니다';
  end if;
  return new;
end $$;
drop trigger if exists lessons_owner_guard on lessons;
create trigger lessons_owner_guard before update of owner on lessons for each row execute function lessons_owner_guard();

-- 3) Supabase 슬라이드 저장소: 올리기·고치기는 자기 폴더(교사 id/수업 id/)만, 지우기는 자기 폴더 또는 손댈 수 있는 수업 폴더
drop policy if exists slides_teacher_insert on storage.objects;
drop policy if exists slides_teacher_update on storage.objects;
drop policy if exists slides_teacher_delete on storage.objects;
create policy slides_teacher_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'slides' and is_teacher() and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
create policy slides_teacher_update on storage.objects for update to authenticated
  using (bucket_id = 'slides' and is_teacher() and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()))
  with check (bucket_id = 'slides' and is_teacher() and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
create policy slides_teacher_delete on storage.objects for delete to authenticated
  using (bucket_id = 'slides' and is_teacher() and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()
    or exists (select 1 from lessons l where l.id::text = (storage.foldername(name))[2] and can_lesson(l.id))));
