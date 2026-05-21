// Internal-link suggestion workflow. Scored via pg_trgm in a Postgres RPC.

import { createServiceClient } from '@/lib/supabase/service';
import { pickAnchor } from '@/lib/seo/anchor';
import type { ParsedDoc } from '@/lib/db/types';

const TOP_N = 5;
const MIN_SCORE = 0.15;

async function loadArticle(article_id: string) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
  if (error) throw error;
  return data;
}

async function querySuggestions(org_id: string, probe: string) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db.rpc('suggest_internal_links', {
    p_org_id: org_id,
    p_probe: probe,
    p_limit: TOP_N,
    p_min_score: MIN_SCORE,
  });
  if (error) throw error;
  return (data ?? []) as { url: string; title: string | null; h1: string | null; score: number }[];
}

async function persistSuggestions(
  article_id: string,
  org_id: string,
  rows: { url: string; title: string | null; h1: string | null; score: number }[],
) {
  'use step';
  const db = createServiceClient();
  await db.from('internal_link_suggestions').delete().eq('article_id', article_id);
  if (rows.length === 0) return 0;
  await db.from('internal_link_suggestions').insert(
    rows.map((r) => ({
      article_id,
      org_id,
      target_url: r.url,
      target_title: r.title,
      anchor_text: pickAnchor({ title: r.title, h1: r.h1, url: r.url }),
      score: r.score,
      reason: 'Lexical match against article title and H1 (pg_trgm similarity)',
    })),
  );
  return rows.length;
}

export async function suggestInternalLinks(article_id: string, org_id: string) {
  'use workflow';
  const article = await loadArticle(article_id);
  const doc = article.raw_doc as ParsedDoc | null;
  const probe =
    (doc?.headings.find((h) => h.level === 1)?.text ?? article.article_title ?? doc?.title ?? '').trim();
  if (!probe) return { suggestions: 0, reason: 'no-probe-text' };
  const rows = await querySuggestions(org_id, probe);
  const persisted = await persistSuggestions(article_id, org_id, rows);
  return { suggestions: persisted };
}
