// Pre-recording smoke test. Runs the full offline pipeline against the
// assessment article and asserts the expected outputs.
//
// Usage:
//   pnpm smoke
//
// Exit non-zero if anything is off — so you don't record a broken demo.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

console.log('Running pipeline against assessment article…');
execSync(
  'tsx scripts/dump-html.ts "https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit" smoke',
  { stdio: 'inherit' },
);

const json = JSON.parse(readFileSync('samples/smoke.qa.json', 'utf8'));
const html = readFileSync('samples/smoke.html', 'utf8');

const allQa = [...(json.qa_rules ?? []), ...(json.qa_readability ?? [])];
const fails = allQa.filter((c: { severity: string }) => c.severity === 'fail').length;

const checks: { label: string; ok: boolean; got: string | number; want: string }[] = [
  { label: 'rules + readability fails', ok: fails >= 3, got: fails, want: '≥3' },
  { label: 'FAQPage JSON-LD in HTML', ok: html.includes('FAQPage'), got: String(html.includes('FAQPage')), want: 'true' },
  { label: 'Article JSON-LD in HTML', ok: html.includes('"@type":"Article"'), got: String(html.includes('"@type":"Article"')), want: 'true' },
  { label: 'meta_title present', ok: !!json.meta_title, got: json.meta_title ?? '∅', want: 'non-empty' },
  { label: 'word count > 1000', ok: json.word_count > 1000, got: json.word_count, want: '>1000' },
];

let bad = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}: ${c.got} (want ${c.want})`);
  if (!c.ok) bad++;
}

if (bad === 0) {
  console.log('\nSMOKE OK · safe to record');
} else {
  console.error(`\nSMOKE FAIL · ${bad} check(s) failed. Do NOT record.`);
  process.exit(1);
}
