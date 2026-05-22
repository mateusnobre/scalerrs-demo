// Sitemap ingest workflow. Batched per-URL crawl with bounded concurrency.

import { createServiceClient } from '@/lib/supabase/service';
import { fetchSitemap, extractUrlSignals } from '@/lib/seo/sitemap';

const PER_BATCH = 8;
const MAX_URLS = 200;

async function markFetching(sitemap_id: string) {
  'use step';
  const db = createServiceClient();
  await db.from('sitemaps').update({ status: 'fetching' }).eq('id', sitemap_id);
}

async function fetchAndCount(sitemap_id: string, url: string) {
  'use step';
  const all = await fetchSitemap(url);
  const limited = all.slice(0, MAX_URLS);
  const db = createServiceClient();
  await db
    .from('sitemaps')
    .update({
      url_count: limited.length,
      fetched_at: new Date().toISOString(),
      status: 'crawling',
    })
    .eq('id', sitemap_id);
  return limited.map((u) => u.loc);
}

async function crawlBatch(sitemap_id: string, org_id: string, urls: string[]) {
  'use step';
  const db = createServiceClient();
  const signals = await Promise.all(urls.map((u) => extractUrlSignals(u)));
  await db.from('sitemap_urls').upsert(
    signals.map((s) => ({
      sitemap_id,
      org_id,
      url: s.url,
      title: s.title,
      h1: s.h1,
      meta_description: s.meta_description,
      canonical: s.canonical,
      word_count: s.word_count,
      index_state: s.index_state,
      http_status: s.http_status,
      fetch_error: s.fetch_error ?? null,
      last_fetched_at: new Date().toISOString(),
    })),
    { onConflict: 'org_id,url' },
  );
}

async function markReady(sitemap_id: string) {
  'use step';
  const db = createServiceClient();
  await db.from('sitemaps').update({ status: 'ready' }).eq('id', sitemap_id);
}

async function markFailed(sitemap_id: string, reason: string) {
  'use step';
  const db = createServiceClient();
  await db
    .from('sitemaps')
    .update({ status: 'failed', fetched_at: new Date().toISOString() })
    .eq('id', sitemap_id);
  // Log the reason into a sitemap_url-shaped error row so the user sees it.
  // (We don't have a sitemap-level error column; reusing sitemap_urls with a
  //  synthetic url + fetch_error keeps the error visible on the detail page.)
  await db.from('sitemap_urls').upsert(
    {
      sitemap_id,
      org_id: '00000000-0000-0000-0000-000000000000',
      url: `error://${sitemap_id}`,
      title: 'Sitemap ingest failed',
      fetch_error: reason.slice(0, 500),
      index_state: 'fetch_failed',
      http_status: 0,
      last_fetched_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,url' },
  );
}

export async function ingestSitemap(sitemap_id: string, org_id: string, url: string) {
  'use workflow';
  try {
    await markFetching(sitemap_id);
    const urls = await fetchAndCount(sitemap_id, url);
    for (let i = 0; i < urls.length; i += PER_BATCH) {
      await crawlBatch(sitemap_id, org_id, urls.slice(i, i + PER_BATCH));
    }
    await markReady(sitemap_id);
    return { sitemap_id, crawled: urls.length };
  } catch (err) {
    const reason = (err as Error).message ?? String(err);
    await markFailed(sitemap_id, reason);
    throw err;
  }
}
