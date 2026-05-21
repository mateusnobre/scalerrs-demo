'use server';

import { start } from 'workflow/api';
import { createClient } from '@/lib/supabase/server';
import { processArticle } from '@/lib/workflow/process-article';
import { autofixAltTags, autofixMeta, autofixPlaceholderAlts } from '@/lib/workflow/autofix';
import { publishWordpress } from '@/lib/workflow/publish';
import { suggestInternalLinks } from '@/lib/workflow/suggest-links';

async function orgFor(articleId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('org_id, gdoc_url')
    .eq('id', articleId)
    .maybeSingle();
  if (error || !data) throw new Error('Article not found or access denied');
  return { supabase, org_id: data.org_id as string, gdoc_url: data.gdoc_url as string };
}

export async function triggerAutofix(articleId: string, fixKind: string) {
  const { org_id } = await orgFor(articleId);
  switch (fixKind) {
    case 'rewrite_alt_tags':
      await start(autofixAltTags, [articleId, org_id]);
      return;
    case 'regenerate_meta_title':
      await start(autofixMeta, [articleId, org_id, 'meta_title' as const]);
      return;
    case 'regenerate_meta_description':
      await start(autofixMeta, [articleId, org_id, 'meta_description' as const]);
      return;
    case 'rehost_images':
      await reprocess(articleId);
      return;
    case 'rewrite_placeholder_alts':
      await start(autofixPlaceholderAlts, [articleId, org_id]);
      return;
    default:
      throw new Error(`Unknown fix kind: ${fixKind}`);
  }
}

export async function triggerPublish(articleId: string) {
  const { org_id } = await orgFor(articleId);
  await start(publishWordpress, [articleId, org_id]);
}

export async function reprocess(articleId: string) {
  const { org_id, gdoc_url } = await orgFor(articleId);
  await start(processArticle, [articleId, org_id, gdoc_url]);
}

export async function requestLinkSuggestions(articleId: string) {
  const { org_id } = await orgFor(articleId);
  await start(suggestInternalLinks, [articleId, org_id]);
}

/**
 * Replay a failed run. Workflow DevKit's step memoization is per-run, so
 * starting a new run *does* re-execute steps — but per-step retry semantics
 * still apply, so transient failures (the simulated gateway timeout) recover
 * automatically. The article reaches `ready_for_review` without manual cleanup.
 */
export async function replayFailedRun(articleId: string) {
  const { supabase, org_id, gdoc_url } = await orgFor(articleId);
  await supabase.from('articles').update({ status: 'pending' }).eq('id', articleId);
  await start(processArticle, [articleId, org_id, gdoc_url]);
}
