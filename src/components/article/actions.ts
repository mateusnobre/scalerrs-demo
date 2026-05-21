'use server';

import { start } from 'workflow/api';
import { processArticle } from '@/lib/workflow/process-article';
import { autofixAltTags, autofixMeta, autofixPlaceholderAlts } from '@/lib/workflow/autofix';
import { publishWordpress } from '@/lib/workflow/publish';
import { suggestInternalLinks } from '@/lib/workflow/suggest-links';
import { dispatchForArticle, dispatchForArticleWithMutation } from '@/lib/workflow/dispatch';

export async function triggerAutofix(articleId: string, fixKind: string) {
  switch (fixKind) {
    case 'rewrite_alt_tags':
      await dispatchForArticle(articleId, (a, o) => start(autofixAltTags, [a, o]));
      return;
    case 'regenerate_meta_title':
      await dispatchForArticle(articleId, (a, o) =>
        start(autofixMeta, [a, o, 'meta_title' as const]),
      );
      return;
    case 'regenerate_meta_description':
      await dispatchForArticle(articleId, (a, o) =>
        start(autofixMeta, [a, o, 'meta_description' as const]),
      );
      return;
    case 'rehost_images':
      await reprocess(articleId);
      return;
    case 'rewrite_placeholder_alts':
      await dispatchForArticle(articleId, (a, o) => start(autofixPlaceholderAlts, [a, o]));
      return;
    default:
      throw new Error(`Unknown fix kind: ${fixKind}`);
  }
}

export async function triggerPublish(articleId: string) {
  await dispatchForArticle(articleId, (a, o) => start(publishWordpress, [a, o]));
}

export async function reprocess(articleId: string) {
  await dispatchForArticle(articleId, (a, o) => start(processArticle, [a, o]));
}

export async function requestLinkSuggestions(articleId: string) {
  await dispatchForArticle(articleId, (a, o) => start(suggestInternalLinks, [a, o]));
}

/**
 * Replay a failed run. Workflow DevKit's step memoization is per-run, so
 * starting a new run *does* re-execute steps — but per-step retry semantics
 * still apply, so transient failures recover automatically. The article
 * reaches `ready_for_review` without manual cleanup.
 */
export async function replayFailedRun(articleId: string) {
  await dispatchForArticleWithMutation(
    articleId,
    async (supabase, a) => {
      await supabase.from('articles').update({ status: 'pending' }).eq('id', a);
    },
    (a, o) => start(processArticle, [a, o]),
  );
}
