import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';
import { rewriteAltText } from '@/lib/qa/critic';
import { renderArticleHtml } from '@/lib/html/render';
import type { ParsedDoc } from '@/lib/db/types';

export const autofixAltTags = inngest.createFunction(
  {
    id: 'autofix-alt-tags',
    name: 'Auto-fix alt tags',
    retries: 2,
    triggers: [{ event: 'article/fix.alt-tags' }],
  },
  async ({ event, step }) => {
    const { article_id, org_id } = event.data;
    const db = createServiceClient();

    const article = await step.run('load', async () => {
      const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
      if (error) throw error;
      return data;
    });

    if (!article?.raw_doc) throw new Error('No parsed doc for article');
    const doc = article.raw_doc as ParsedDoc;

    const altMap: Record<string, string> = {};
    for (const img of doc.images) {
      if (img.alt && img.alt.length >= 3) continue;
      const surrounding =
        doc.headings.find((h) => h.level === 1)?.text ?? doc.title;
      const newAlt = await step.run(`rewrite-${img.id}`, async () => {
        return rewriteAltText(img, article.article_title ?? doc.title, surrounding);
      });
      altMap[img.id] = newAlt;
    }

    const html = renderArticleHtml(doc, { altMap });

    await step.run('persist', async () => {
      const updatedDoc: ParsedDoc = {
        ...doc,
        images: doc.images.map((i) => ({ ...i, alt: altMap[i.id] ?? i.alt })),
      };
      await db
        .from('articles')
        .update({ article_html: html, raw_doc: updatedDoc })
        .eq('id', article_id);
      await db.from('article_versions').insert({
        article_id,
        org_id,
        reason: 'autofix-alt-tags',
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        article_title: article.article_title,
        article_html: html,
      });
      // Mark check resolved
      await db
        .from('qa_checks')
        .update({ severity: 'pass', fixed_at: new Date().toISOString() })
        .eq('article_id', article_id)
        .eq('check_type', 'rule:image_alt_tags');
    });

    return { fixed: Object.keys(altMap).length };
  },
);
