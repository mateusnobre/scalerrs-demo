import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchSitemap, extractUrlSignals } from '@/lib/seo/sitemap';

// Concurrency-limited per-URL crawl. Inngest's `concurrency.limit` is per
// function instance; we additionally batch in-memory so a 500-URL sitemap
// doesn't fan out 500 parallel HTTP requests.
const PER_BATCH = 8;
const MAX_URLS = 200; // demo cap

export const ingestSitemap = inngest.createFunction(
  {
    id: 'ingest-sitemap',
    name: 'Ingest sitemap',
    retries: 3,
    concurrency: { limit: 3 },
    triggers: [{ event: 'sitemap/ingest.requested' }],
  },
  async ({ event, step }) => {
    const { sitemap_id, org_id, url } = event.data as {
      sitemap_id: string;
      org_id: string;
      url: string;
    };
    const db = createServiceClient();

    await step.run('mark-fetching', async () => {
      await db.from('sitemaps').update({ status: 'fetching' }).eq('id', sitemap_id);
    });

    const urls = await step.run('fetch-sitemap-xml', async () => {
      const all = await fetchSitemap(url);
      const limited = all.slice(0, MAX_URLS);
      await db
        .from('sitemaps')
        .update({ url_count: limited.length, fetched_at: new Date().toISOString(), status: 'crawling' })
        .eq('id', sitemap_id);
      return limited;
    });

    // Crawl in batches to keep memory + outbound TCP bounded.
    for (let i = 0; i < urls.length; i += PER_BATCH) {
      const batch = urls.slice(i, i + PER_BATCH);
      await step.run(`crawl-batch-${i}`, async () => {
        const signals = await Promise.all(batch.map((u) => extractUrlSignals(u.loc)));
        const rows = signals.map((s) => ({
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
        }));
        // Upsert by (org_id, url) so re-ingesting the same sitemap refreshes
        // signals instead of duplicating rows.
        await db.from('sitemap_urls').upsert(rows, { onConflict: 'org_id,url' });
      });
    }

    await step.run('mark-ready', async () => {
      await db.from('sitemaps').update({ status: 'ready' }).eq('id', sitemap_id);
    });

    return { sitemap_id, crawled: urls.length };
  },
);
