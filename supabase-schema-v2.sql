-- ============================================================================
-- LeadForge 360 — relational v2 schema
--
-- scripts/migrate-to-relational.js:11 requires this file, but it was missing
-- from the repo. Reconstructed from the row-mapping functions in db-repo.js,
-- which are the authoritative definition of every column the server reads and
-- writes:
--     leadDocToRow / LEAD_MAP        db-repo.js:170,192
--     taskDocToRow / TASK_MAP        db-repo.js:224,211
--     subvendorDocToRow / SV_COL     db-repo.js:323,318
--     createPartner                  db-repo.js:372
--     createJobApplicant             db-repo.js:379
--     upsertMember                   db-repo.js:387
--     addLeadActivity                db-repo.js:277
--     replacePicklists               db-repo.js:440
--
-- Run once in Supabase -> SQL Editor. Safe to re-run.
-- Ids are application-generated prefixed strings ('sv_', 'pt_', 'ja_' — see
-- db-server.js:347,437,491), so primary keys are text, not uuid.
--
-- All access is via the service-role/secret key, which bypasses RLS. RLS is
-- enabled with no policies so the publishable key can never read this data.
-- ============================================================================

create table if not exists public.tenants (
  id   text primary key,
  name text
);

create table if not exists public.team_members (
  id            text primary key,
  tenant_id     text not null references public.tenants(id) on delete cascade,
  name          text not null default '',
  email         text not null default '',
  role          text not null default 'AE',
  team          text,
  avatar        text,
  status        text not null default 'active',
  grp           text,
  username      text,
  password_hash text,
  must_reset    boolean not null default false,
  invited_at    timestamptz,
  last_login    timestamptz,
  permissions   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.leads (
  id                text primary key,
  tenant_id         text not null references public.tenants(id) on delete cascade,
  first_name        text,
  last_name         text,
  name              text,
  email             text,
  phone             text,
  company           text,
  industry          text,
  city              text,
  country           text,
  source            text,
  owner_id          text references public.team_members(id) on delete set null,
  stage             text not null default 'New',
  score             integer not null default 0,
  amount            numeric not null default 0,
  currency          text not null default 'INR',
  notes             text,
  service_domain_id text,
  service_id        text,
  tags              text[]  not null default '{}',
  consent           jsonb   not null default '{}'::jsonb,
  visibility        jsonb   not null default '{"mode":"all","users":[]}'::jsonb,
  outcome           jsonb   not null default '{}'::jsonb,
  qualifications    jsonb   not null default '{}'::jsonb,
  action_plan       jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists leads_tenant_idx on public.leads (tenant_id);
create index if not exists leads_owner_idx  on public.leads (owner_id);

-- deleteLead relies on the cascade (db-repo.js:270 "cascades activities").
create table if not exists public.lead_activities (
  id       bigserial primary key,
  lead_id  text not null references public.leads(id) on delete cascade,
  at       timestamptz not null default now(),
  actor_id text references public.team_members(id) on delete set null,
  type     text,
  note     text
);
create index if not exists lead_activities_lead_idx on public.lead_activities (lead_id, at);

create table if not exists public.scheduled_tasks (
  id            text primary key,
  tenant_id     text not null references public.tenants(id) on delete cascade,
  lead_id       text references public.leads(id)        on delete cascade,
  assignee_id   text references public.team_members(id) on delete set null,
  title         text not null default '',
  description   text,
  priority      text not null default 'med',
  status        text not null default 'todo',
  kanban_status text not null default 'todo',
  remind        boolean not null default false,
  due_at        timestamptz,
  completed_at  timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists scheduled_tasks_tenant_idx on public.scheduled_tasks (tenant_id);

create table if not exists public.subvendors (
  id                  text primary key,
  tenant_id           text not null references public.tenants(id) on delete cascade,
  stage               text not null default 'New',
  owner_id            text references public.team_members(id) on delete set null,
  source              text,
  company_name        text,
  legal_company_name  text,
  contact_person      text,
  official_email      text,
  contact_number      text,
  whatsapp_number     text,
  company_website     text,
  social_links        text,
  year_established    text,
  team_size           text,
  gst_number          text,
  pan_number          text,
  cin_number          text,
  gst_registered      text,
  internal_notes      text,
  regions             text[] not null default '{}',
  services            text[] not null default '{}',
  industries          text[] not null default '{}',
  delivery_models     text[] not null default '{}',
  engagement_models   text[] not null default '{}',
  details             jsonb  not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists subvendors_tenant_idx on public.subvendors (tenant_id);

create table if not exists public.subvendor_activities (
  id           bigserial primary key,
  subvendor_id text not null references public.subvendors(id) on delete cascade,
  at           timestamptz not null default now(),
  actor_id     text references public.team_members(id) on delete set null,
  note         text
);
create index if not exists subvendor_activities_sv_idx on public.subvendor_activities (subvendor_id, at);

-- Light tables: the full inbound payload is kept in `details`.
create table if not exists public.partners (
  id             text primary key,
  tenant_id      text not null references public.tenants(id) on delete cascade,
  stage          text not null default 'New',
  company_name   text,
  contact_person text,
  official_email text,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.job_applicants (
  id           text primary key,
  tenant_id    text not null references public.tenants(id) on delete cascade,
  stage        text not null default 'New',
  full_name    text,
  email        text,
  role_applied text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.app_settings (
  tenant_id  text primary key references public.tenants(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.picklists (
  id        bigserial primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  kind      text not null,
  value     text not null,
  meta      jsonb,
  sort      integer not null default 0
);
create index if not exists picklists_tenant_kind_idx on public.picklists (tenant_id, kind, sort);

-- The tenant every row hangs off (db-repo.js:18 TENANT = 'ab7-solutions').
insert into public.tenants (id, name)
values ('ab7-solutions', 'AB7 Solutions')
on conflict (id) do nothing;

-- RLS on, zero policies: only the secret key (which bypasses RLS) gets in.
do $$
declare t text;
begin
  foreach t in array array['tenants','team_members','leads','lead_activities',
                           'scheduled_tasks','subvendors','subvendor_activities',
                           'partners','job_applicants','app_settings','picklists']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
