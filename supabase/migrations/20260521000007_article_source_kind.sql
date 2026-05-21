-- Article source provenance. Replaces the "docx://uploaded" sentinel that
-- used to live in articles.gdoc_url as a discriminator. Backfills existing
-- rows: any URL starting with "docx://" is treated as an upload.
alter table public.articles
  add column source_kind text not null default 'gdoc'
    check (source_kind in ('gdoc', 'docx_upload'));

update public.articles set source_kind = 'docx_upload' where gdoc_url like 'docx://%';
