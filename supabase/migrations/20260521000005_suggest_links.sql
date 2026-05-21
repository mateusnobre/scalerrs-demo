-- Tenant-scoped internal-link suggestion via pg_trgm. Kept as a SQL function
-- so the query plan stays close to the GIN indices and we don't have to
-- re-pull every URL across the wire to rank in app code.
create or replace function public.suggest_internal_links(
  p_org_id uuid,
  p_probe  text,
  p_limit  integer default 5,
  p_min_score real default 0.15
)
returns table (url text, title text, h1 text, score real)
language sql
stable
as $$
  select
    u.url,
    u.title,
    u.h1,
    greatest(
      similarity(coalesce(u.title, ''), p_probe),
      similarity(coalesce(u.h1,    ''), p_probe)
    )::real as score
  from public.sitemap_urls u
  where u.org_id = p_org_id
    and u.index_state = 'indexable'
  order by score desc
  limit p_limit
$$;

-- Restrict execution to the authenticated role; service role bypasses RLS
-- and is the only caller from Workflow steps.
revoke all on function public.suggest_internal_links(uuid, text, integer, real) from public;
grant execute on function public.suggest_internal_links(uuid, text, integer, real) to authenticated, service_role;
