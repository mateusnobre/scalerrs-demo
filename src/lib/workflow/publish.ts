// Placeholder WordPress publisher. In production: POST /wp-json/wp/v2/posts
// with media upload + idempotency keyed on article_versions.id.

import { sleep } from 'workflow';
import { FatalError } from 'workflow';
import { createServiceClient } from '@/lib/supabase/service';

async function loadForPublish(article_id: string) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
  if (error) throw error;
  return data;
}

async function markPublished(article_id: string, org_id: string) {
  'use step';
  const db = createServiceClient();
  await db.from('articles').update({ status: 'published' }).eq('id', article_id);
  const { data: a } = await db.from('articles').select('*').eq('id', article_id).single();
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: 'published-to-wordpress',
    meta_title: a.meta_title,
    meta_description: a.meta_description,
    article_title: a.article_title,
    article_html: a.article_html,
  });
}

export async function publishWordpress(article_id: string, org_id: string) {
  'use workflow';
  const article = await loadForPublish(article_id);
  if (!article.article_html || !article.meta_title || !article.meta_description) {
    throw new FatalError('Article not ready: missing html or meta fields');
  }
  await sleep('1s'); // simulate WP upload latency
  await markPublished(article_id, org_id);
  return { ok: true, fake_wp_post_id: `wp_${Date.now()}` };
}
