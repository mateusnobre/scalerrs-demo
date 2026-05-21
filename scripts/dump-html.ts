// Standalone CLI: fetch a Google Doc, run rule-QA, render WordPress-ready
// HTML, and write samples/{slug}.html + samples/{slug}.qa.json.
// No Supabase, no Workflow runtime — just the pure parsing + rendering pipeline so
// you can attach the output HTML to the assessment submission directly.
//
// Usage:
//   pnpm tsx scripts/dump-html.ts <gdoc-url-or-id> [output-slug]

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extractDocId, fetchDocHtml } from '../src/lib/google/docs';
import { parseGoogleDocHtml } from '../src/lib/google/parser';
import { runRuleChecks } from '../src/lib/qa/rules';
import { runReadability } from '../src/lib/qa/readability';
import { checkLinkHealth, summarise as summariseLinks } from '../src/lib/qa/link-health';
import { gdriveAccessProducer } from '../src/lib/qa/producers/gdrive-access';
import { renderArticleHtml } from '../src/lib/html/render';
import { buildArticleJsonLd, detectHowTo, injectJsonLd, type SchemaEmission } from '../src/lib/seo/jsonld';
import { detectAndEmitFaqSchema } from '../src/lib/seo/faq-schema';

async function main() {
  const arg = process.argv[2];
  const slugArg = process.argv[3];
  if (!arg) {
    console.error('Usage: pnpm tsx scripts/dump-html.ts <gdoc-url-or-id> [slug]');
    process.exit(1);
  }

  const docId = extractDocId(arg);
  console.log(`Fetching ${docId}…`);
  const { html: raw, bytes } = await fetchDocHtml(docId);
  console.log(`  ${(bytes / 1024).toFixed(1)} KB exported`);

  const { doc } = parseGoogleDocHtml(raw);
  console.log(`  parsed: ${doc.images.length} images, ${doc.links.length} links, ${doc.word_count} words`);

  const rules = runRuleChecks(doc);
  const readability = await runReadability(doc);
  console.log('  checking link health…');
  const linkProbes = await checkLinkHealth(doc.links);
  const linkSummary = summariseLinks(linkProbes);
  const linkRows: { check_type: string; severity: 'fail' | 'warning' | 'pass'; title: string; detail: string; data: Record<string, unknown> }[] = [];
  if (linkSummary.broken.length)
    linkRows.push({
      check_type: 'links:broken',
      severity: 'fail',
      title: `${linkSummary.broken.length} broken link(s) (4xx / 5xx)`,
      detail: linkSummary.broken.map((p) => `${p.http_status} ${p.url}`).join(' · '),
      data: { probes: linkSummary.broken },
    });
  if (linkSummary.networkError.length)
    linkRows.push({
      check_type: 'links:network_error',
      severity: 'fail',
      title: `${linkSummary.networkError.length} link(s) failed to connect`,
      detail: linkSummary.networkError.map((p) => `${p.url}`).join(' · '),
      data: { probes: linkSummary.networkError },
    });
  if (linkSummary.rateLimited.length)
    linkRows.push({
      check_type: 'links:rate_limited',
      severity: 'warning',
      title: `${linkSummary.rateLimited.length} link(s) rate-limited (429)`,
      detail: 'Could not verify.',
      data: { probes: linkSummary.rateLimited },
    });
  if (linkSummary.cfChallenge.length)
    linkRows.push({
      check_type: 'links:cf_challenge',
      severity: 'warning',
      title: `${linkSummary.cfChallenge.length} link(s) behind Cloudflare bot wall`,
      detail: 'Page exists but crawler blocked.',
      data: { probes: linkSummary.cfChallenge },
    });
  console.log('  probing Google Drive image share state…');
  const gdriveFindings = await gdriveAccessProducer.produceChecks(doc);
  const gdriveRows = gdriveFindings.map((f) => ({
    check_type: `gdrive:${f.check_type}`,
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    data: f.data ?? {},
  }));
  if (gdriveFindings.length) {
    console.log(`  GDrive: ${gdriveFindings.length} finding(s) — ${gdriveFindings.map((f) => f.title).join(' · ')}`);
  }
  const allQa = [...rules, ...readability, ...linkRows, ...gdriveRows];
  const fail = allQa.filter((r) => r.severity === 'fail').length;
  const warn = allQa.filter((r) => r.severity === 'warning').length;
  const pass = allQa.filter((r) => r.severity === 'pass').length;
  console.log(`  QA: ${fail} fail, ${warn} warn, ${pass} pass (rules + readability + links)`);
  console.log(`  Links: ${linkSummary.broken.length} broken, ${linkSummary.rateLimited.length} 429, ${linkSummary.cfChallenge.length} CF, ${linkSummary.ok.length} ok`);

  let html = renderArticleHtml(doc);
  const faq = detectAndEmitFaqSchema(html);
  html = faq.html;
  if (faq.inserted) console.log(`  FAQ JSON-LD: ${faq.questions} Q&A injected`);

  const blocks: SchemaEmission[] = [];
  blocks.push(buildArticleJsonLd({
    headline: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
    description: doc.meta_description,
    publisherName: 'Andar',
  }));
  const howTo = detectHowTo(html);
  if (howTo) {
    blocks.push(howTo);
    console.log(`  HowTo JSON-LD: ${(howTo.jsonld as { step?: unknown[] }).step?.length ?? 0} steps`);
  }
  html = injectJsonLd(html, blocks);

  const slug = (slugArg ?? (doc.headings.find((h) => h.level === 1)?.text ?? 'article'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const outHtml = join('samples', `${slug}.html`);
  const outJson = join('samples', `${slug}.qa.json`);
  await mkdir(dirname(outHtml), { recursive: true });

  const wpReady = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(doc.headings.find((h) => h.level === 1)?.text ?? doc.title)}</title>
<meta name="title" content="${escape(doc.meta_title ?? '')}" />
<meta name="description" content="${escape(doc.meta_description ?? '')}" />
</head>
<body>
${html}
</body>
</html>`;

  await writeFile(outHtml, wpReady, 'utf8');
  await writeFile(
    outJson,
    JSON.stringify(
      {
        meta_title: doc.meta_title,
        meta_description: doc.meta_description,
        article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
        word_count: doc.word_count,
        image_count: doc.images.length,
        link_count: doc.links.length,
        product_links: doc.links.filter((l) => l.is_product).length,
        qa_rules: rules,
        qa_readability: readability,
        qa_links: linkRows,
        qa_gdrive: gdriveRows,
        link_probes: linkProbes,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\nWrote:\n  ${outHtml}\n  ${outJson}`);
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
