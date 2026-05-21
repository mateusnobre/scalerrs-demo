-- Scalerrs demo schema
-- Designed for flat, index-optimized RLS (no recursive policies).

create extension if not exists "pgcrypto";

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Membership table joins auth.users to an org.
-- A user can belong to multiple orgs (future-proof) but RLS is org-scoped.
create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members(user_id);

create type public.article_status as enum (
  'pending',
  'processing',
  'ready_for_review',
  'published',
  'failed'
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  gdoc_id text not null,
  gdoc_url text not null,
  status public.article_status not null default 'pending',
  meta_title text,
  meta_description text,
  article_title text,
  article_html text,
  raw_doc jsonb,
  cost_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index articles_org_idx on public.articles(org_id, created_at desc);

-- Immutable history of every state of the article (initial parse + each AI fix)
create table public.article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  reason text not null,
  meta_title text,
  meta_description text,
  article_title text,
  article_html text,
  created_at timestamptz not null default now()
);

create index article_versions_article_idx on public.article_versions(article_id, created_at desc);
create index article_versions_org_idx on public.article_versions(org_id);

create type public.qa_severity as enum ('pass','warning','fail');

create table public.qa_checks (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  check_type text not null,
  severity public.qa_severity not null,
  title text not null,
  detail text,
  data jsonb,
  fix_available boolean not null default false,
  fix_kind text,
  fixed_at timestamptz,
  created_at timestamptz not null default now()
);

create index qa_checks_article_idx on public.qa_checks(article_id);
create index qa_checks_org_idx on public.qa_checks(org_id);

create type public.run_status as enum ('queued','running','succeeded','failed','cancelled');

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  inngest_run_id text,
  status public.run_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  cost_cents integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index runs_article_idx on public.runs(article_id, created_at desc);
create index runs_org_idx on public.runs(org_id);

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  status public.run_status not null default 'queued',
  detail text,
  started_at timestamptz,
  completed_at timestamptz,
  cost_cents integer not null default 0,
  position integer not null
);

create index run_steps_run_idx on public.run_steps(run_id, position);

-- Realtime publication for live trace
alter publication supabase_realtime add table public.runs;
alter publication supabase_realtime add table public.run_steps;
alter publication supabase_realtime add table public.qa_checks;
alter publication supabase_realtime add table public.articles;

-- Helper to keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger articles_touch
before update on public.articles
for each row execute function public.touch_updated_at();
