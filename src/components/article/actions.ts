'use server';

import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

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
      await inngest.send({
        name: 'article/fix.alt-tags',
        data: { article_id: articleId, org_id },
      });
      return;
    case 'regenerate_meta_title':
      await inngest.send({
        name: 'article/fix.meta',
        data: { article_id: articleId, org_id, field: 'meta_title' },
      });
      return;
    case 'regenerate_meta_description':
      await inngest.send({
        name: 'article/fix.meta',
        data: { article_id: articleId, org_id, field: 'meta_description' },
      });
      return;
    case 'rehost_images':
      // Image rehost runs as part of process-article; trigger a reprocess.
      await reprocess(articleId);
      return;
    default:
      throw new Error(`Unknown fix kind: ${fixKind}`);
  }
}

export async function triggerPublish(articleId: string) {
  const { org_id } = await orgFor(articleId);
  await inngest.send({
    name: 'article/publish.wordpress',
    data: { article_id: articleId, org_id },
  });
}

export async function reprocess(articleId: string) {
  const { org_id, gdoc_url } = await orgFor(articleId);
  await inngest.send({
    name: 'article/process.requested',
    data: { article_id: articleId, org_id, gdoc_url },
  });
}
