import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';
import { pickAnchor } from '@/lib/seo/anchor';
import type { ParsedDoc } from '@/lib/db/types';

// Suggest top-N internal links for an article by similarity over the org's
// crawled sitemap URLs. Pure pg_trgm — no embeddings, no extra API key.
// The query asks Postgres for the top matches against (title + h1) of every
// other URL the org owns, ranked by GREATEST(title-sim, h1-sim).
//
// Trade-off vs. pgvector + embeddings:
//   + Zero external dependency, fully tenant-scoped via RLS.
//   - Lexical, not semantic. Misses synonyms ("dog leash" vs "canine lead").
//   The code path is small and isolated so swapping to pgvector later is
//   a one-file change.

const TOP_N = 5;
const MIN_SCORE = 0.15;

export const suggestInternalLinks = inngest.createFunction(
  {
    id: 'suggest-internal-links',
    name: 'Suggest internal links',
    retries: 2,
    triggers: [{ event: 'article/suggest.links' }],
  },
  async ({ event, step }) => {
    const { article_id, org_id } = event.data as { article_id: string; org_id: string };
    const db = createServiceClient();

    const article = await step.run('load-article', async () => {
      const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
      if (error) throw error;
      return data;
    });
    const doc = article.raw_doc as ParsedDoc | null;
    const probe = (doc?.headings.find((h) => h.level === 1)?.text ?? article.article_title ?? doc?.title ?? '').trim();
    if (!probe) return { suggestions: 0, reason: 'no-probe-text' };

    // Call a Postgres function for the actual ranking — keeps the SQL near
    // the index. Defined in migrations as `public.suggest_internal_links`.
    const { data: matches, error } = await step.run('query-suggestions', async () => {
      return db.rpc('suggest_internal_links', {
        p_org_id: org_id,
        p_probe: probe,
        p_limit: TOP_N,
        p_min_score: MIN_SCORE,
      });
    });
    if (error) throw error;

    const rows = (matches ?? []) as {
      url: string;
      title: string | null;
      h1: string | null;
      score: number;
    }[];

    await step.run('persist', async () => {
      await db.from('internal_link_suggestions').delete().eq('article_id', article_id);
      if (rows.length === 0) return;
      await db.from('internal_link_suggestions').insert(
        rows.map((r) => ({
          article_id,
          org_id,
          target_url: r.url,
          target_title: r.title,
          anchor_text: pickAnchor({ title: r.title, h1: r.h1, url: r.url }),
          score: r.score,
          reason: `Lexical match against article title and H1 (pg_trgm similarity)`,
        })),
      );
    });

    return { suggestions: rows.length };
  },
);
