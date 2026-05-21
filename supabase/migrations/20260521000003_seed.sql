-- Two demo orgs so the RLS isolation demo has something to show.
-- Users are created via the auth API in the README; this seeds orgs only.
insert into public.orgs (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Andar SEO', 'andar'),
  ('22222222-2222-2222-2222-222222222222', 'Acme SEO', 'acme')
on conflict (id) do nothing;
