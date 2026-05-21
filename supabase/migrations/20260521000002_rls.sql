-- Flat, index-backed RLS. No recursive joins beyond the membership lookup.
-- Membership is cached by Postgres via the org_members_user_idx index.

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.articles enable row level security;
alter table public.article_versions enable row level security;
alter table public.qa_checks enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;

-- A user can see orgs they belong to.
create policy orgs_select on public.orgs
for select using (
  exists (
    select 1 from public.org_members m
    where m.org_id = orgs.id and m.user_id = auth.uid()
  )
);

-- Membership: user can see their own rows.
create policy org_members_select on public.org_members
for select using (user_id = auth.uid());

-- Articles: scoped by org_id, single index hit.
create policy articles_select on public.articles
for select using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);
create policy articles_insert on public.articles
for insert with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);
create policy articles_update on public.articles
for update using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

-- Child tables: same shape, denormalised org_id so no join needed.
create policy article_versions_rw on public.article_versions
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

create policy qa_checks_rw on public.qa_checks
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

create policy runs_rw on public.runs
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);

create policy run_steps_rw on public.run_steps
for all using (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
) with check (
  org_id in (select org_id from public.org_members where user_id = auth.uid())
);
