// Typed schema.org emitters. Uses Google's schema-dts package so missing
// required fields are caught by tsc, not by Google Search Console after
// the article is already published.
//
// This file knows about:
//   - Article         — emitted for every processed article
//   - FAQPage         — emitted when an FAQ section is detected (existing path)
//   - HowTo           — emitted when the body contains an ordered list inside
//                       a heading like "How to …" / "Steps to …"
//
// All emitters return a JSON-LD object validated by schema-dts's typings.
// A thin in-house `validateRichResult` mirrors the *required* fields per
// type from Google's documented rich-result rules (which are stricter than
// schema.org validity).

import type {
  Article as SchemaArticle,
  FAQPage as SchemaFAQPage,
  HowTo as SchemaHowTo,
  HowToStep,
  WithContext,
} from 'schema-dts';
import * as cheerio from 'cheerio';

export type AnySchema = WithContext<SchemaArticle | SchemaFAQPage | SchemaHowTo>;

export interface SchemaEmission {
  type: 'Article' | 'FAQPage' | 'HowTo';
  jsonld: AnySchema;
  rich_result_eligible: boolean;
  validation_issues: string[];
}

export function buildArticleJsonLd(opts: {
  headline: string;
  description?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  authorName?: string | null;
  publisherName?: string | null;
  publisherLogo?: string | null;
  datePublished?: string;
  dateModified?: string;
}): SchemaEmission {
  const jsonld: WithContext<SchemaArticle> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description ?? undefined,
    image: opts.imageUrl ?? undefined,
    datePublished: opts.datePublished ?? new Date().toISOString(),
    dateModified: opts.dateModified ?? new Date().toISOString(),
    ...(opts.authorName && { author: { '@type': 'Person', name: opts.authorName } }),
    ...(opts.publisherName && {
      publisher: {
        '@type': 'Organization',
        name: opts.publisherName,
        ...(opts.publisherLogo && { logo: { '@type': 'ImageObject', url: opts.publisherLogo } }),
      },
    }),
    ...(opts.url && { mainEntityOfPage: opts.url }),
  };

  const issues = validateArticle(jsonld);
  return {
    type: 'Article',
    jsonld,
    rich_result_eligible: issues.length === 0,
    validation_issues: issues,
  };
}

export function detectHowTo(html: string): SchemaEmission | null {
  const $ = cheerio.load(html, null, false);
  // Find a heading whose text looks like a how-to lead-in.
  const headings = $('h1, h2, h3').toArray();
  const howToHeading = headings.find((el) =>
    /^(how to|steps to|guide to|tutorial[:\s])/i.test($(el).text().trim()),
  );
  if (!howToHeading) return null;

  // Look for the first <ol> following the heading.
  let cursor = $(howToHeading).next();
  while (cursor.length && cursor[0].type === 'tag' && cursor[0].tagName !== 'ol') {
    cursor = cursor.next();
  }
  if (!cursor.length || (cursor[0] as { tagName?: string }).tagName !== 'ol') return null;

  const steps: HowToStep[] = cursor
    .find('> li')
    .toArray()
    .map((li, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: $(li).text().split(/[.:]/)[0].trim().slice(0, 80) || `Step ${idx + 1}`,
      text: $(li).text().trim(),
    }));

  if (steps.length < 2) return null;

  const jsonld: WithContext<SchemaHowTo> = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: $(howToHeading).text().trim(),
    step: steps,
  };

  const issues = steps.length >= 2 ? [] : ['HowTo requires at least 2 steps'];
  return { type: 'HowTo', jsonld, rich_result_eligible: issues.length === 0, validation_issues: issues };
}

function validateArticle(article: WithContext<SchemaArticle>): string[] {
  const issues: string[] = [];
  if (!article.headline || String(article.headline).length === 0) issues.push('headline is required');
  if (!article.image) issues.push('image is required for rich result eligibility');
  if (!article.author) issues.push('author is required for rich result eligibility');
  if (!article.publisher) issues.push('publisher (Organization with logo) is required for rich result eligibility');
  return issues;
}

export function injectJsonLd(html: string, blocks: SchemaEmission[]): string {
  if (blocks.length === 0) return html;
  // We're dealing with a body fragment (no <html>/<body> wrappers), so we
  // prepend the JSON-LD blocks directly to the fragment.
  const tags = blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b.jsonld)}</script>`)
    .join('\n');
  return `${tags}\n${html}`;
}
