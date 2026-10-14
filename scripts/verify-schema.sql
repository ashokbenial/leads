-- LeadForge 360 — schema verification (Phase C).
-- Paste into the Supabase SQL editor AFTER applying supabase-scoring-v3.sql.
-- PostgREST cannot read pg_catalog, so these are the checks verify-supabase.js
-- marks MANUAL.

-- 1. tables — expect 11 rows
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('scoring_models','scoring_rules_v2','scoring_rule_conditions',
     'scoring_rule_actions','lead_scores','lead_score_components','lead_score_events',
     'score_history','qualification_events','score_audit_logs','lead_score_overrides')
 order by table_name;

-- 2. indexes — expect 24 idx_* plus uq_leads_id_tenant and uq_score_events_event
select tablename, indexname from pg_indexes
 where schemaname = 'public' and (indexname like 'idx_%' or indexname like 'uq_%')
 order by tablename, indexname;

-- 3. composite tenant foreign keys — expect 5, each on (lead_id, tenant_id)
select tc.table_name, tc.constraint_name,
       string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
 where tc.constraint_type = 'FOREIGN KEY'
   and tc.table_schema = 'public'
   and tc.table_name in ('lead_scores','lead_score_components','lead_score_events',
                         'qualification_events','lead_score_overrides')
 group by 1, 2
 order by 1;

-- 4. RLS — expect relrowsecurity = true on all 11, and ZERO policies (by design)
select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('scoring_models','scoring_rules_v2','scoring_rule_conditions',
     'scoring_rule_actions','lead_scores','lead_score_components','lead_score_events',
     'score_history','qualification_events','score_audit_logs','lead_score_overrides')
 order by relname;

select schemaname, tablename, policyname from pg_policies where schemaname = 'public';

-- 5. idempotency guard — expect one partial unique index on (tenant_id, event_id)
select indexdef from pg_indexes
 where schemaname = 'public' and indexname = 'uq_score_events_event';

-- 6. no destructive change reached production tables
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'leads'
 order by ordinal_position;
