-- Internal linking + indexation health requires a corpus of existing URLs.
-- We ingest one sitemap.xml at a time, fetch each URL, and store its
-- on-page signals so we can:
--   - propose internal links (pg_trgm similarity over titles + h1s)
--   - flag noindex/canonical drift
--   - cluster URLs by topic

create extension if not exists pg_trgm;

create type public.sitemap_status as enum (
  'pending',
  'fetching',
  'crawling',
  'ready',
  'failed'
);

create table public.sitemaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  url text not null,
  status public.sitemap_status not null default 'pending',
  url_count integer not null default 0,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, url)
);

create index sitemaps_org_idx on public.sitemaps(org_id, created_at desc);

create type public.url_index_state as enum (
  'unknown',
  'indexable',
  'noindex',
  'canonical_drift',
  'fetch_failed'
);

create table public.sitemap_urls (
  id uuid primary key default gen_random_uuid(),
  sitemap_id uuid not null references public.sitemaps(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  url text not null,
  title text,
  h1 text,
  meta_description text,
  canonical text,
  word_count integer,
  index_state public.url_index_state not null default 'unknown',
  http_status integer,
  fetch_error text,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create index sitemap_urls_sitemap_idx on public.sitemap_urls(sitemap_id);
create index sitemap_urls_org_idx on public.sitemap_urls(org_id);
create index sitemap_urls_url_idx on public.sitemap_urls(org_id, url);

-- pg_trgm indices for fast similarity lookups (the internal-linking engine).
-- GIN index supports both title and h1 similarity in one shot.
create index sitemap_urls_title_trgm on public.sitemap_urls using gin (title gin_trgm_ops);
create index sitemap_urls_h1_trgm    on public.sitemap_urls using gin (h1    gin_trgm_ops);

create table public.internal_link_suggestions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  target_url text not null,
  target_title text,
  anchor_text text,
  score real not null,
  reason text,
  accepted boolean,
  created_at timestamptz not null default now()
);

create index internal_link_suggestions_article_idx on public.internal_link_suggestions(article_id);

alter table public.sitemaps enable row level security;
alter table public.sitemap_urls enable row level security;
alter table public.internal_link_suggestions enable row level security;

create policy sitemaps_rw on public.sitemaps
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

create policy sitemap_urls_rw on public.sitemap_urls
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

create policy ils_rw on public.internal_link_suggestions
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

alter publication supabase_realtime add table public.sitemaps;
alter publication supabase_realtime add table public.sitemap_urls;
alter publication supabase_realtime add table public.internal_link_suggestions;

create trigger sitemaps_touch
before update on public.sitemaps
for each row execute function public.touch_updated_at();
