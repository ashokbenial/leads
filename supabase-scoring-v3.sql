-- ============================================================================
-- LeadForge 360 — Scoring & Qualification, schema v3.
-- ADDITIVE ONLY. Creates new tables; drops, renames and column changes: none.
-- Safe to re-run (every statement is IF NOT EXISTS).
--
-- NAMING NOTE: the legacy `scoring_rules` table (id, label, points, enabled,
-- sort) is left completely untouched as the rollback copy — exactly as
-- `leadforge_state` was kept for the v2 relational move. The evaluatable rules
-- live in `scoring_rules_v2`. Legacy rows carry no field/operator/value and
-- cannot be auto-migrated; an admin must author conditions for them.
--
-- RLS: enabled with no policies on every table, matching the existing model —
-- the server's secret key bypasses RLS, the publishable key sees nothing.
-- ============================================================================

-- ---------------------------------------------------------------- models
create table if not exists public.scoring_models (
  id              text primary key,
  tenant_id       text        not null,
  name            text        not null,
  description     text,
  version         text        not null default '1.0.0',
  status          text        not null default 'draft',   -- draft|active|paused|archived
  score_range     jsonb       not null default '{"min":0,"max":100}'::jsonb,
  weights         jsonb       not null default
                  '{"fit":0.25,"engagement":0.20,"intent":0.25,"behavior":0.10,"source":0.05,"qualification":0.15}'::jsonb,
  category_max    jsonb       not null default
                  '{"fit":100,"engagement":100,"intent":100,"behavior":100,"source":100,"qualification":100}'::jsonb,
  category_cap    jsonb       not null default '{}'::jsonb,
  thresholds      jsonb       not null default '[]'::jsonb,  -- [{tier,min,max,label}]
  qualified_tiers jsonb       not null default '["qualified","hot"]'::jsonb,
  gate_fail_status text       not null default 'nurture',
  priority        integer     not null default 0,
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_scoring_models_tenant        on public.scoring_models (tenant_id);
create index if not exists idx_scoring_models_tenant_status on public.scoring_models (tenant_id, status);

-- ----------------------------------------------------------------- rules
create table if not exists public.scoring_rules_v2 (
  id               text primary key,
  tenant_id        text        not null,
  scoring_model_id text        not null references public.scoring_models(id) on delete cascade,
  name             text        not null,
  description      text,
  category         text        not null,      -- fit|engagement|intent|behavior|source|qualification|negative
  priority         integer     not null default 100,
  active           boolean     not null default true,
  points           numeric     not null default 0,
  max_points       numeric,                   -- per-rule lifetime cap
  frequency_mode   text        not null default 'once',  -- once|always|perDay|maxN
  max_times        integer,
  lifetime_cap     numeric,
  logic            text        not null default 'AND',   -- root group logic
  effective_from   timestamptz,
  effective_to     timestamptz,
  version          text        not null default '1.0.0',
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_rules_v2_tenant on public.scoring_rules_v2 (tenant_id);
create index if not exists idx_rules_v2_model  on public.scoring_rules_v2 (scoring_model_id, active, priority);

-- ------------------------------------------------------------ conditions
-- System of record for rule criteria. Nesting via parent_id; the repo
-- assembles these rows into the tree the engine evaluates, so there is exactly
-- ONE source of truth (no cached JSON copy that can drift).
create table if not exists public.scoring_rule_conditions (
  id          text primary key,
  tenant_id   text not null,
  rule_id     text not null references public.scoring_rules_v2(id) on delete cascade,
  parent_id   text references public.scoring_rule_conditions(id) on delete cascade,
  node_type   text not null default 'condition',  -- condition|group
  logic       text,                               -- AND|OR, groups only
  field       text,
  operator    text,
  value       jsonb,
  sort        integer not null default 0,
  depth       integer not null default 0,         -- engine supports up to 10
  created_at  timestamptz not null default now()
);
create index if not exists idx_conditions_rule   on public.scoring_rule_conditions (rule_id, sort);
create index if not exists idx_conditions_parent on public.scoring_rule_conditions (parent_id);
create index if not exists idx_conditions_tenant on public.scoring_rule_conditions (tenant_id);

-- --------------------------------------------------------------- actions
create table if not exists public.scoring_rule_actions (
  id          text primary key,
  tenant_id   text not null,
  rule_id     text not null references public.scoring_rules_v2(id) on delete cascade,
  action_type text not null,        -- add|subtract|set|cap|qualify|disqualify
  points      numeric,
  category    text,
  qualification_status text,        -- for qualify/disqualify actions
  reason      text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_actions_rule   on public.scoring_rule_actions (rule_id, sort);
create index if not exists idx_actions_tenant on public.scoring_rule_actions (tenant_id);

-- Defence in depth for tenant isolation. `leads.id` is already the primary key,
-- so this index is redundant for uniqueness — it exists so the scoring tables
-- can carry a COMPOSITE foreign key on (lead_id, tenant_id). That makes a
-- cross-tenant scoring row impossible at the database level, not just in the
-- application layer. Purely additive.
create unique index if not exists uq_leads_id_tenant on public.leads (id, tenant_id);

-- ---------------------------------------- current authoritative lead score
create table if not exists public.lead_scores (
  lead_id                text not null,
  tenant_id              text not null,
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete cascade,
  scoring_model_id       text not null,
  model_version          text not null,
  engine_version         text,
  total_score            numeric not null default 0,
  system_score           numeric not null default 0,
  override_score         numeric,
  fit_score              numeric not null default 0,
  engagement_score       numeric not null default 0,
  intent_score           numeric not null default 0,
  behavior_score         numeric not null default 0,
  source_score           numeric not null default 0,
  qualification_score    numeric not null default 0,
  positive_score         numeric not null default 0,
  negative_score         numeric not null default 0,
  touchpoint_score       numeric not null default 0,
  qualification_status   text,
  qualification_reasons  jsonb not null default '[]'::jsonb,
  conversion_probability numeric,    -- null until real historical data exists
  confidence             text,       -- null until real historical data exists
  calculated_at          timestamptz not null default now(),
  primary key (lead_id, scoring_model_id)
);
create index if not exists idx_lead_scores_tenant on public.lead_scores (tenant_id);
create index if not exists idx_lead_scores_qual   on public.lead_scores (tenant_id, qualification_status);
create index if not exists idx_lead_scores_total  on public.lead_scores (tenant_id, total_score desc);
create index if not exists idx_lead_scores_calc   on public.lead_scores (tenant_id, calculated_at desc);

-- ------------------------------------------------- rule-level attribution
create table if not exists public.lead_score_components (
  id               bigserial primary key,
  lead_id          text not null,
  tenant_id        text not null,
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete cascade,
  scoring_model_id text not null,
  model_version    text not null,
  rule_id          text,
  rule_name        text,
  category         text,
  points_awarded   numeric not null default 0,
  matched          boolean not null default true,
  direction        text,
  reason           text,
  calculated_at    timestamptz not null default now()
);
create index if not exists idx_components_lead   on public.lead_score_components (lead_id, scoring_model_id);
create index if not exists idx_components_tenant on public.lead_score_components (tenant_id);

-- ------------------------------------------------- score-changing events
-- event_id is the idempotency key: the same touchpoint can never be scored
-- twice. Unique per tenant.
create table if not exists public.lead_score_events (
  id               bigserial primary key,
  lead_id          text not null,
  tenant_id        text not null,
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete cascade,
  event_type       text not null,
  source           text,
  event_id         text,
  previous_score   numeric,
  score_delta      numeric,
  new_score        numeric,
  scoring_model_id text,
  model_version    text,
  created_at       timestamptz not null default now()
);
create unique index if not exists uq_score_events_event
  on public.lead_score_events (tenant_id, event_id) where event_id is not null;
create index if not exists idx_score_events_lead on public.lead_score_events (lead_id, created_at desc);

-- ------------------------------------------------ immutable score history
create table if not exists public.score_history (
  id               bigserial primary key,
  lead_id          text not null,
  tenant_id        text not null,
  scoring_model_id text not null,
  model_version    text not null,
  total_score      numeric not null,
  components       jsonb not null default '{}'::jsonb,
  qualification_status text,
  legacy           boolean not null default false,   -- pre-engine score, kept for reference
  calculated_at    timestamptz not null default now()
);
create index if not exists idx_score_history_lead on public.score_history (lead_id, calculated_at desc);
create index if not exists idx_score_history_tn   on public.score_history (tenant_id, calculated_at desc);

-- ------------------------------------------------- qualification changes
create table if not exists public.qualification_events (
  id               bigserial primary key,
  lead_id          text not null,
  tenant_id        text not null,
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete cascade,
  from_status      text,
  to_status        text not null,
  reason           text,
  triggering_rule  text,
  score_at_event   numeric,
  scoring_model_id text,
  model_version    text,
  actor            text not null default 'system',
  created_at       timestamptz not null default now()
);
create index if not exists idx_qual_events_lead on public.qualification_events (lead_id, created_at desc);
create index if not exists idx_qual_events_tn   on public.qualification_events (tenant_id, created_at desc);

-- ----------------------------------------------------------- audit trail
create table if not exists public.score_audit_logs (
  id          bigserial primary key,
  tenant_id   text not null,
  actor       text,
  action      text not null,
  entity_type text,
  entity_id   text,
  before_val  jsonb,
  after_val   jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_score_audit_tn on public.score_audit_logs (tenant_id, created_at desc);

-- --------------------------------------------- manual overrides (spec §11)
create table if not exists public.lead_score_overrides (
  id               bigserial primary key,
  lead_id          text not null,
  tenant_id        text not null,
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete cascade,
  system_score     numeric not null,
  override_score   numeric not null,
  reason           text not null,
  actor            text not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_overrides_lead on public.lead_score_overrides (lead_id, active);

-- ---------------------------------------------------------------- RLS on
alter table public.scoring_models          enable row level security;
alter table public.scoring_rules_v2        enable row level security;
alter table public.scoring_rule_conditions enable row level security;
alter table public.scoring_rule_actions    enable row level security;
alter table public.lead_scores             enable row level security;
alter table public.lead_score_components   enable row level security;
alter table public.lead_score_events       enable row level security;
alter table public.score_history           enable row level security;
alter table public.qualification_events    enable row level security;
alter table public.score_audit_logs        enable row level security;
alter table public.lead_score_overrides    enable row level security;

-- ============================================================================
-- RLS POSTURE — read this before adding policies.
--
-- Every table above has RLS ENABLED WITH NO POLICIES. That is deliberate and is
-- the correct posture for this application, not an oversight:
--
--   • The server authenticates to Supabase with the SECRET key, which bypasses
--     RLS entirely. Tenant isolation for the server path is enforced in
--     db-repo-scoring.js (every query carries a tenant predicate) and by the
--     composite foreign keys above.
--   • The publishable key is subject to RLS. With no policies it can read
--     NOTHING here — which is exactly what we want, since lead scores are PII-
--     adjacent and no browser should reach them directly.
--
-- Writing policies that reference auth.jwt() would be theatre: this app does
-- not use Supabase Auth and issues no Supabase JWT, so such policies would
-- never evaluate against a real claim. If Supabase Auth is adopted later, add
-- policies of the form:
--     using (tenant_id = auth.jwt() ->> 'tenant_id')
-- and only then.
-- ============================================================================
