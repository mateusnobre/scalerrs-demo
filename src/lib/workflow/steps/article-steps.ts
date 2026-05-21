// Business step functions for processArticle workflow. Each is its own
// `'use step'` function so Workflow DevKit memoizes their results and
// auto-retries on failure.

import { createServiceClient } from '@/lib/supabase/service';
import { extractDocId, fetchDocHtml } from '@/lib/google/docs';
import { parseGoogleDocHtml } from '@/lib/google/parser';
import { runRuleChecks } from '@/lib/qa/rules';
import { runReadability } from '@/lib/qa/readability';
import { aiCritic, regenerateMetaDescription, regenerateMetaTitle } from '@/lib/qa/critic';
import { renderArticleHtml } from '@/lib/html/render';
import { rehostImage } from '@/lib/rehost/blob';
import { detectAndEmitFaqSchema } from '@/lib/seo/faq-schema';
import { buildArticleJsonLd, detectHowTo, injectJsonLd, type SchemaEmission } from '@/lib/seo/jsonld';
import type { ParsedDoc } from '@/lib/db/types';

// Source-aware fetch. Branches on the URL:
//   - "docx://uploaded" sentinel: pre-parsed by the upload server action,
//     html lives in articles.raw_doc.raw_html. Skip the remote fetch.
//   - else: treat as a Google Doc URL.
export async function fetchDocStep(article_id: string, gdoc_url: string) {
  'use step';
  if (gdoc_url.startsWith('docx://')) {
    const db = createServiceClient();
    const { data, error } = await db
      .from('articles')
      .select('raw_doc')
      .eq('id', article_id)
      .single();
    if (error) throw error;
    const html = (data?.raw_doc as { raw_html?: string } | null)?.raw_html ?? '';
    if (!html) throw new Error('Uploaded .docx article has no pre-parsed html');
    return { html, bytes: html.length };
  }
  const docId = extractDocId(gdoc_url);
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
  const db = createServiceClient();
  const findings = await runReadability(doc);
  await db.from('qa_checks').delete().eq('article_id', article_id).like('check_type', 'readability:%');
  if (findings.length) {
    await db.from('qa_checks').insert(
      findings.map((f) => ({
        article_id,
        org_id,
        check_type: f.check_type,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        data: f.data,
      })),
    );
  }
  const fails = findings.filter((f) => f.severity === 'fail').length;
  return { fails, total: findings.length };
}

export async function ruleQaStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const db = createServiceClient();
  const results = runRuleChecks(doc);
  await db.from('qa_checks').delete().eq('article_id', article_id).like('check_type', 'rule:%');
  if (results.length) {
    await db.from('qa_checks').insert(
      results.map((r) => ({
        article_id,
        org_id,
        check_type: `rule:${r.check_type}`,
        severity: r.severity,
        title: r.title,
        detail: r.detail,
        data: r.data ?? null,
        fix_available: r.fix_available ?? false,
        fix_kind: r.fix_kind ?? null,
      })),
    );
  }
  const fails = results.filter((r) => r.severity === 'fail').length;
  return { fails, total: results.length };
}

export async function aiCriticStep(article_id: string, org_id: string, doc: ParsedDoc) {
  'use step';
  const db = createServiceClient();
  const report = await aiCritic(doc);
  await db.from('qa_checks').delete().eq('article_id', article_id).like('check_type', 'ai:%');
  if (report.issues.length) {
    await db.from('qa_checks').insert(
      report.issues.map((i) => ({
        article_id,
        org_id,
        check_type: `ai:${i.check_type}`,
        severity: i.severity,
        title: i.title,
        detail: i.detail,
        fix_available: !!i.fix_kind,
        fix_kind: i.fix_kind,
      })),
    );
  }
  return { issues: report.issues.length, overall: report.overall_severity };
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
  let html = renderArticleHtml(doc, { rehostMap });
  const faq = detectAndEmitFaqSchema(html);
  html = faq.html;
  if (faq.inserted) {
    await db.from('qa_checks').insert({
      article_id,
      org_id,
      check_type: 'seo:faq_schema',
      severity: 'pass',
      title: `Injected FAQPage JSON-LD with ${faq.questions} Q&A`,
      detail: 'schema.org/FAQPage block emitted before the FAQ heading.',
      data: { questions: faq.questions },
    });
  }
  const blocks: SchemaEmission[] = [];
  const article = buildArticleJsonLd({
    headline: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
    description: doc.meta_description,
    publisherName: 'Andar',
  });
  blocks.push(article);
  const howTo = detectHowTo(html);
  if (howTo) {
    blocks.push(howTo);
    await db.from('qa_checks').insert({
      article_id,
      org_id,
      check_type: 'seo:howto_schema',
      severity: 'pass',
      title: `Detected HowTo with ${(howTo.jsonld as { step?: unknown[] }).step?.length ?? 0} steps`,
      detail: 'schema.org/HowTo block emitted.',
    });
  }
  html = injectJsonLd(html, blocks);
  await db.from('articles').update({ article_html: html, cost_cents }).eq('id', article_id);
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: 'initial-render',
    meta_title: doc.meta_title,
    meta_description: doc.meta_description,
    article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
    article_html: html,
  });
  return { bytes: html.length };
}
