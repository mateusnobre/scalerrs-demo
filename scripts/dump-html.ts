// Standalone CLI: fetch a Google Doc, run rule-QA, render WordPress-ready
// HTML, and write samples/{slug}.html + samples/{slug}.qa.json.
// No Supabase, no Inngest — just the pure parsing + rendering pipeline so
// you can attach the output HTML to the assessment submission directly.
//
// Usage:
//   pnpm tsx scripts/dump-html.ts <gdoc-url-or-id> [output-slug]

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extractDocId, fetchDocHtml } from '../src/lib/google/docs';
import { parseGoogleDocHtml } from '../src/lib/google/parser';
import { runRuleChecks } from '../src/lib/qa/rules';
import { renderArticleHtml } from '../src/lib/html/render';

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
  const fail = rules.filter((r) => r.severity === 'fail').length;
  const warn = rules.filter((r) => r.severity === 'warning').length;
  const pass = rules.filter((r) => r.severity === 'pass').length;
  console.log(`  QA: ${fail} fail, ${warn} warn, ${pass} pass`);

  const html = renderArticleHtml(doc);

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
        qa: rules,
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
