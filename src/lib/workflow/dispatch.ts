// dispatchForArticle — shared helper for "given an article id, look up its
// org, then start a Workflow that needs (article_id, org_id, …)". Server
// actions collapse to one-liners.
//
// The dispatch lambda takes (article_id, org_id) and may forward extra args
// to its workflow. Keeps the typing simple while still letting callers vary
// the workflow shape.

import { createClient } from '@/lib/supabase/server';

export interface DispatchResult {
  article_id: string;
  org_id: string;
}

export async function dispatchForArticle(
  articleId: string,
  dispatch: (article_id: string, org_id: string) => Promise<unknown>,
): Promise<DispatchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('org_id')
    .eq('id', articleId)
    .maybeSingle();
  if (error || !data) throw new Error('Article not found or access denied');
  await dispatch(articleId, data.org_id as string);
  return { article_id: articleId, org_id: data.org_id as string };
}

/**
 * Variant for actions that need a pre-dispatch DB mutation (e.g. flipping
 * the article status before replay). The mutation runs after the org lookup
 * and before the workflow start.
 */
export async function dispatchForArticleWithMutation(
  articleId: string,
  mutate: (
    supabase: Awaited<ReturnType<typeof createClient>>,
    article_id: string,
    org_id: string,
  ) => Promise<void>,
  dispatch: (article_id: string, org_id: string) => Promise<unknown>,
): Promise<DispatchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('articles')
    .select('org_id')
    .eq('id', articleId)
    .maybeSingle();
  if (error || !data) throw new Error('Article not found or access denied');
  const org_id = data.org_id as string;
  await mutate(supabase, articleId, org_id);
  await dispatch(articleId, org_id);
  return { article_id: articleId, org_id };
}
