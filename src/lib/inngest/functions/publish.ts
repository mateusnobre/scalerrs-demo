import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';

// Placeholder "publish to WordPress" worker. In production this would call
// the WP REST API: POST /wp-json/wp/v2/posts with auth header.
// For the demo it just marks the article published and writes an event row.
export const publishWordpress = inngest.createFunction(
  {
    id: 'publish-wordpress',
    name: 'Publish to WordPress (placeholder)',
    retries: 3,
    triggers: [{ event: 'article/publish.wordpress' }],
  },
  async ({ event, step }) => {
    const { article_id, org_id } = event.data;
    const db = createServiceClient();

    const article = await step.run('load', async () => {
      const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
      if (error) throw error;
      return data;
    });

    if (!article.article_html || !article.meta_title || !article.meta_description) {
      throw new Error('Article not ready: missing html or meta fields');
    }

    await step.sleep('simulate-wp-upload', '1s');

    await step.run('mark-published', async () => {
      await db.from('articles').update({ status: 'published' }).eq('id', article_id);
      await db.from('article_versions').insert({
        article_id,
        org_id,
        reason: 'published-to-wordpress',
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        article_title: article.article_title,
        article_html: article.article_html,
      });
    });

    return { ok: true, fake_wp_post_id: `wp_${Date.now()}` };
  },
);
