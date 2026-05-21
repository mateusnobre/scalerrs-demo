// Auto-fix workflows (alt tags + meta regeneration). Each `'use step'`
// function is its own retryable unit.

import { createServiceClient } from '@/lib/supabase/service';
import {
  rewriteAltText,
  regenerateMetaDescription,
  regenerateMetaTitle,
  rewritePlaceholderAlt,
} from '@/lib/qa/critic';
import { renderArticleHtml } from '@/lib/html/render';
import type { ParsedDoc } from '@/lib/db/types';

async function loadArticleFix(article_id: string) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db.from('articles').select('*').eq('id', article_id).single();
  if (error) throw error;
  return data;
}

async function rewriteOneAlt(
  article_id: string,
  org_id: string,
  imgId: string,
  imgSrc: string,
  imgAlt: string | null,
  imgHost: 'gdrive' | 'gdrive-content' | 'other',
  articleTitle: string,
  surrounding: string,
) {
  'use step';
  const newAlt = await rewriteAltText(
    { id: imgId, src: imgSrc, alt: imgAlt, host: imgHost },
    articleTitle,
    surrounding,
  );
  // Return both the id and the new alt; persistence happens in a later step.
  return { id: imgId, alt: newAlt };
}

async function persistAltFixes(
  article_id: string,
  org_id: string,
  altMap: Record<string, string>,
  metaTitle: string | null,
  metaDescription: string | null,
  articleTitle: string | null,
) {
  'use step';
  const db = createServiceClient();
  const { data: a } = await db.from('articles').select('raw_doc').eq('id', article_id).single();
  const doc = a?.raw_doc as ParsedDoc;
  const html = renderArticleHtml(doc, { altMap });
  const updatedDoc: ParsedDoc = {
    ...doc,
    images: doc.images.map((i) => ({ ...i, alt: altMap[i.id] ?? i.alt })),
  };
  await db.from('articles').update({ article_html: html, raw_doc: updatedDoc }).eq('id', article_id);
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: 'autofix-alt-tags',
    meta_title: metaTitle,
    meta_description: metaDescription,
    article_title: articleTitle,
    article_html: html,
  });
  await db
    .from('qa_checks')
    .update({ severity: 'pass', fixed_at: new Date().toISOString() })
    .eq('article_id', article_id)
    .eq('check_type', 'rule:image_alt_tags');
}

export async function autofixAltTags(article_id: string, org_id: string) {
  'use workflow';
  const article = await loadArticleFix(article_id);
  if (!article?.raw_doc) throw new Error('No parsed doc for article');
  const doc = article.raw_doc as ParsedDoc;
  const surrounding = doc.headings.find((h) => h.level === 1)?.text ?? doc.title;
  const altMap: Record<string, string> = {};
  for (const img of doc.images) {
    if (img.alt && img.alt.length >= 3) continue;
    const r = await rewriteOneAlt(
      article_id,
      org_id,
      img.id,
      img.src,
      img.alt,
      img.host,
      article.article_title ?? doc.title,
      surrounding,
    );
    altMap[r.id] = r.alt;
  }
  await persistAltFixes(
    article_id,
    org_id,
    altMap,
    article.meta_title,
    article.meta_description,
    article.article_title,
  );
  return { fixed: Object.keys(altMap).length };
}

async function regenMetaStep(
  article_id: string,
  org_id: string,
  field: 'meta_title' | 'meta_description',
) {
  'use step';
  const db = createServiceClient();
  const { data: a } = await db.from('articles').select('*').eq('id', article_id).single();
  const doc = a.raw_doc as ParsedDoc;
  const next = field === 'meta_title' ? await regenerateMetaTitle(doc) : await regenerateMetaDescription(doc);
  await db.from('articles').update({ [field]: next }).eq('id', article_id);
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: `autofix-${field}`,
    meta_title: field === 'meta_title' ? next : a.meta_title,
    meta_description: field === 'meta_description' ? next : a.meta_description,
    article_title: a.article_title,
    article_html: a.article_html,
  });
  const checkType = field === 'meta_title' ? 'rule:meta_title' : 'rule:meta_description';
  await db
    .from('qa_checks')
    .update({
      severity: 'pass',
      fixed_at: new Date().toISOString(),
      data: { value: next, length: next.length },
    })
    .eq('article_id', article_id)
    .eq('check_type', checkType);
  return { field, length: next.length };
}

export async function autofixMeta(
  article_id: string,
  org_id: string,
  field: 'meta_title' | 'meta_description',
) {
  'use workflow';
  return regenMetaStep(article_id, org_id, field);
}

// ---------- Placeholder alt rewriter ----------
//
// Replaces every "IMAGE N. Alt tag: 'weak alt'" marker in the article body
// with a new "IMAGE N. Alt tag: 'WCAG-compliant alt'" so the writer can
// embed the image with a real, accessible alt when they swap the marker
// for an <img>. Marks the placeholder + a11y QA checks as resolved.

const PLACEHOLDER_RE_G =
  /IMAGE\s*\d+\s*\.?\s*Alt tag:\s*[\u201C\u201D"']([^\u201C\u201D"']+)[\u201C\u201D"']/gi;

async function rewriteOnePlaceholderStep(
  articleTitle: string,
  h1: string,
  marker: string,
  oldAlt: string,
  surrounding: string,
) {
  'use step';
  const newAlt = await rewritePlaceholderAlt({
    articleTitle,
    h1,
    marker,
    oldAlt,
    surroundingText: surrounding,
  });
  return { marker, oldAlt, newAlt };
}

async function persistPlaceholderRewritesStep(
  article_id: string,
  org_id: string,
  rewrites: { marker: string; oldAlt: string; newAlt: string }[],
) {
  'use step';
  const db = createServiceClient();
  const { data: a } = await db.from('articles').select('*').eq('id', article_id).single();
  const doc = a.raw_doc as ParsedDoc;

  // Replace each marker (matched verbatim) with a new marker that has the
  // rewritten alt. We do textual replacement on the rendered html and the
  // raw_doc.raw_html so the Visualizer reads the new alts on next render.
  let newHtml = a.article_html as string;
  let newRawHtml = doc.raw_html;
  for (const r of rewrites) {
    const replacement = r.marker.replace(
      /Alt tag:\s*[\u201C\u201D"'][^\u201C\u201D"']+[\u201C\u201D"']/i,
      `Alt tag: "${r.newAlt}"`,
    );
    // Escape regex specials in marker.
    const re = new RegExp(r.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    newHtml = newHtml.replace(re, replacement);
    newRawHtml = newRawHtml.replace(re, replacement);
  }
  const updatedDoc: ParsedDoc = { ...doc, raw_html: newRawHtml };

  await db
    .from('articles')
    .update({ article_html: newHtml, raw_doc: updatedDoc })
    .eq('id', article_id);
  await db.from('article_versions').insert({
    article_id,
    org_id,
    reason: 'autofix-placeholder-alts',
    meta_title: a.meta_title,
    meta_description: a.meta_description,
    article_title: a.article_title,
    article_html: newHtml,
  });
  await db
    .from('qa_checks')
    .update({ severity: 'pass', fixed_at: new Date().toISOString() })
    .eq('article_id', article_id)
    .in('check_type', ['rule:image_placeholders', 'rule:image_alt_accessibility']);
}

export async function autofixPlaceholderAlts(article_id: string, org_id: string) {
  'use workflow';
  const article = await loadArticleFix(article_id);
  if (!article?.raw_doc) throw new Error('No parsed doc for article');
  const doc = article.raw_doc as ParsedDoc;
  const flat = doc.raw_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const matches = [...flat.matchAll(PLACEHOLDER_RE_G)];
  if (matches.length === 0) return { fixed: 0, reason: 'no placeholders' };

  const h1 = doc.headings.find((h) => h.level === 1)?.text ?? doc.title;
  const articleTitle = article.article_title ?? doc.title;
  const surrounding = flat.slice(0, 1200);

  const rewrites: { marker: string; oldAlt: string; newAlt: string }[] = [];
  for (const m of matches) {
    const r = await rewriteOnePlaceholderStep(articleTitle, h1, m[0], m[1] ?? '', surrounding);
    rewrites.push(r);
  }
  await persistPlaceholderRewritesStep(article_id, org_id, rewrites);
  return { fixed: rewrites.length };
}
