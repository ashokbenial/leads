-- Run this once in your Supabase project (SQL Editor).
-- It creates ONE table that holds the entire LeadForge workspace as a JSON
-- record shared by everyone. It does not touch your website's tables.
create table if not exists public.leadforge_state (
  tenant     text primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The server uses the service-role key (which bypasses RLS). Keep RLS ON with
-- no public policies so the public/anon key cannot read this data directly.
alter table public.leadforge_state enable row level security;
