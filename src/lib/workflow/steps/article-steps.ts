// Business step functions for processArticle workflow. Each is its own
// `'use step'` function so Workflow DevKit memoizes their results and
// auto-retries on failure.

import { createServiceClient } from '@/lib/supabase/service';
import { extractDocId, fetchDocHtml } from '@/lib/google/docs';
import { parseGoogleDocHtml } from '@/lib/google/parser';
import { regenerateMetaDescription, regenerateMetaTitle } from '@/lib/qa/critic';
import { rehostImage } from '@/lib/rehost/blob';
import { renderArticle } from '@/lib/render/article-renderer';
import { runProducer } from '@/lib/qa/producer';
import { supabasePersist } from '@/lib/qa/persist-supabase';
import {
  rulesProducer,
  readabilityProducer,
  linkHealthProducer,
  criticProducer,
} from '@/lib/qa/producers';
import type { ParsedDoc } from '@/lib/db/types';

// Source-aware fetch. Dispatches on the ArticleSource discriminated union
// loaded from the article row — no string-typed sentinels.
import { loadArticleSourceById, type ArticleSource } from '@/lib/sources/article-source';
export { loadArticleSourceById };
export type { ArticleSource };

export async function loadSourceStep(article_id: string): Promise<ArticleSource> {
  'use step';
  return loadArticleSourceById(article_id);
}

export async function fetchDocStep(source: ArticleSource) {
  'use step';
  if (source.kind === 'docx_upload') {
    return { html: source.preloadedHtml, bytes: source.preloadedHtml.length };
  }
  const docId = extractDocId(source.url);
  const { html, bytes } = await fetchDocHtml(docId, { maxAttempts: 3 });
  return { html, bytes };
}

export async function parseAndPersistStep(article_id: string, html: string) {
  'use step';
  const db = createServiceClient();
  const { doc } = parseGoogleDocHtml(html);
  await db
    .from('articles')
    .update({
      raw_doc: doc,
      article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
      meta_title: doc.meta_title,
      meta_description: doc.meta_description,
    })
    .eq('id', article_id);
  return doc;
}

export async function readabilityQaStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const r = await runProducer(readabilityProducer, doc, {
    article_id,
    org_id,
    persist: supabasePersist(),
  });
  return { fails: r.fails, total: r.total };
}

// ---- QA Producer step wrappers ----
//
// Each QA Step is now a four-line wrapper around runProducer(producer, doc, …).
// The Producer Adapter owns its findings shape AND its inline annotator.
// Persistence is shared via supabasePersist().

export async function linkHealthQaStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const r = await runProducer(linkHealthProducer, doc, {
    article_id,
    org_id,
    persist: supabasePersist(),
  });
  return { broken: r.fails, warnings: r.warnings, ok: r.passes, total: r.total };
}

export async function ruleQaStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const r = await runProducer(rulesProducer, doc, {
    article_id,
    org_id,
    persist: supabasePersist(),
  });
  return { fails: r.fails, total: r.total };
}

export async function aiCriticStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const r = await runProducer(criticProducer, doc, {
    article_id,
    org_id,
    persist: supabasePersist(),
  });
  return { issues: r.total, fails: r.fails };
}

export async function autogenMetaDescStep(article_id: string, doc: ParsedDoc) {
  'use step';
  const db = createServiceClient();
  const next = await regenerateMetaDescription(doc);
  await db.from('articles').update({ meta_description: next }).eq('id', article_id);
  return { length: next.length };
}

export async function autogenMetaTitleStep(article_id: string, doc: ParsedDoc) {
  'use step';
  const db = createServiceClient();
  const next = await regenerateMetaTitle(doc);
  await db.from('articles').update({ meta_title: next }).eq('id', article_id);
  return { length: next.length };
}

export async function rehostImagesStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const db = createServiceClient();
  const rehostMap: Record<string, string> = {};
  let bytes = 0;
  let rehosted = 0;
  for (const img of doc.images) {
    if (img.host !== 'other') continue;
    try {
      const r = await rehostImage(img.src, `articles/${article_id}`);
      rehostMap[img.src] = r.hosted;
      if (r.rehosted) rehosted++;
      bytes += r.bytes;
    } catch (e) {
      await db.from('qa_checks').insert({
        article_id,
        org_id,
        check_type: 'rehost:image-fetch-fail',
        severity: 'warning',
        title: `Could not rehost image ${img.id}`,
        detail: (e as Error).message,
      });
    }
  }
  return { rehostMap, rehosted, bytes };
}

export async function renderHtmlStep(
  article_id: string,
  org_id: string,
  doc: ParsedDoc,
  rehostMap: Record<string, string>,
  cost_cents: number,
) {
  'use step';
  const db = createServiceClient();
  const render = renderArticle(doc, { rehostMap, publisherName: 'Andar' });

  if (render.faq.injected) {
    await db.from('qa_checks').insert({
      article_id,
      org_id,
      check_type: 'seo:faq_schema',
      severity: 'pass',
      title: `Injected FAQPage JSON-LD with ${render.faq.questions} Q&A`,
      detail: 'schema.org/FAQPage block emitted before the FAQ heading.',
      data: { questions: render.faq.questions },
    });
  }
  if (render.howTo.injected) {
    await db.from('qa_checks').insert({
      article_id,
      org_id,
      check_type: 'seo:howto_schema',
      severity: 'pass',
      title: `Detected HowTo with ${render.howTo.steps} steps`,
      detail: 'schema.org/HowTo block emitted.',
    });
  }

  await db.from('articles').update({ article_html: render.html, cost_cents }).eq('id', article_id);
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: 'initial-render',
    meta_title: doc.meta_title,
    meta_description: doc.meta_description,
    article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
    article_html: render.html,
  });
  return { bytes: render.bytes };
}
