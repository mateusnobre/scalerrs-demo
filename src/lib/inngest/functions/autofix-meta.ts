import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';
import { regenerateMetaDescription, regenerateMetaTitle } from '@/lib/qa/critic';
import type { ParsedDoc } from '@/lib/db/types';

export const autofixMeta = inngest.createFunction(
  {
    id: 'autofix-meta',
    name: 'Auto-fix meta title/description',
    retries: 2,
    triggers: [{ event: 'article/fix.meta' }],
  },
  async ({ event, step }) => {
    const { article_id, org_id, field } = event.data;
    const db = createServiceClient();

    const article = await step.run('load', async () => {
      const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
      if (error) throw error;
      return data;
    });
    const doc = article.raw_doc as ParsedDoc;

    const next = await step.run(`regen-${field}`, async () => {
      return field === 'meta_title'
        ? regenerateMetaTitle(doc)
        : regenerateMetaDescription(doc);
    });

    await step.run('persist', async () => {
      await db.from('articles').update({ [field]: next }).eq('id', article_id);
      await db.from('article_versions').insert({
        article_id,
        org_id,
        reason: `autofix-${field}`,
        meta_title: field === 'meta_title' ? next : article.meta_title,
        meta_description: field === 'meta_description' ? next : article.meta_description,
        article_title: article.article_title,
        article_html: article.article_html,
      });
      const checkType = field === 'meta_title' ? 'rule:meta_title' : 'rule:meta_description';
      await db
        .from('qa_checks')
        .update({ severity: 'pass', fixed_at: new Date().toISOString(), data: { value: next, length: next.length } })
        .eq('article_id', article_id)
        .eq('check_type', checkType);
    });

    return { field, length: next.length };
  },
);
