-- AutoTutor Supabase schema.
-- Apply once in the Supabase SQL editor (Dashboard → SQL → paste → Run).
-- Idempotent: safe to re-run.

create table if not exists students (
  id            text primary key,          -- e.g. 'stu-itai-h11'
  name          text not null,
  track         text not null default '5u',
  exam_date     date not null,             -- upcoming bagrut exam date
  target_grade  int  not null default 90,
  created_at    timestamptz not null default now()
);

create table if not exists concepts (
  id           text primary key,           -- e.g. '5u.geo3d.vectors-dot'
  sheelon      text not null,              -- '581' | '582' | 'foundation'
  topic        text not null,
  name_en      text not null,
  name_he      text not null,
  description  text not null default '',
  exam_weight  numeric not null default 0  -- share of final grade via its exam topic
);

create table if not exists concept_edges (
  src      text not null references concepts(id),  -- concept
  dst      text not null references concepts(id),  -- its prerequisite
  strength numeric not null default 0.5,
  primary key (src, dst)
);

create table if not exists mastery (
  student_id      text not null references students(id),
  concept_id      text not null references concepts(id),
  mastery         numeric not null default 0.5,   -- 0..1
  confidence      numeric not null default 0.2,   -- 0..1, grows with evidence
  evidence_count  int not null default 0,
  last_evidence_at timestamptz,
  error_patterns  jsonb not null default '[]',    -- e.g. ["sign-flip","quadrant-confusion"]
  primary key (student_id, concept_id)
);

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  student_id   text not null references students(id),
  session_date date not null default current_date,
  transcript   text not null,
  summary      text,
  evidence     jsonb not null default '[]',       -- extracted evidence events
  created_at   timestamptz not null default now()
);

-- The agent's own predictions — the self-audit trail read by ForecastAuditor.
create table if not exists forecasts (
  id              uuid primary key default gen_random_uuid(),
  student_id      text not null references students(id),
  predicted_grade numeric not null,
  interval_low    numeric not null,
  interval_high   numeric not null,
  lessons_needed  int not null,
  basis           jsonb not null default '{}',    -- what the prediction assumed
  created_at      timestamptz not null default now()
);

create table if not exists plans (
  id         uuid primary key default gen_random_uuid(),
  student_id text not null references students(id),
  roadmap    jsonb not null default '[]',         -- ordered lesson task list
  brief      text,                                -- next-session brief for the tutor
  status     text not null default 'active',      -- 'active' | 'superseded'
  created_at timestamptz not null default now()
);

create table if not exists llm_usage (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  module            text not null,
  run_id            text,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0
);

create index if not exists idx_mastery_student on mastery(student_id);
create index if not exists idx_sessions_student on sessions(student_id, session_date desc);
create index if not exists idx_forecasts_student on forecasts(student_id, created_at desc);
create index if not exists idx_plans_student on plans(student_id, created_at desc);
create index if not exists idx_usage_run on llm_usage(run_id);
