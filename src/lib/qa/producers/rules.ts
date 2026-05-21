import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';
import { runRuleChecks } from '@/lib/qa/rules';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';

const PLACEHOLDER_RE =
  /IMAGE\s*\d+\s*\.?\s*Alt tag:\s*[\u201C\u201D"']([^\u201C\u201D"']+)[\u201C\u201D"']/gi;

export const rulesProducer: QaProducer = {
  namespace: 'rule',
  produceChecks(doc: ParsedDoc): QaCheckInput[] {
    return runRuleChecks(doc).map((r) => ({
      check_type: r.check_type,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      data: r.data ?? null,
      fix_available: r.fix_available ?? false,
      fix_kind: r.fix_kind ?? null,
    }));
  },
  annotate(html, _findings): string {
    // Placeholder text often spans nested tags (Google's exported HTML wraps
    // "IMAGE 1" in an <a> and ". Alt tag: ..." in the next <span>). A naive
    // text-node walker can't see across that break, so we mark at the
    // BLOCK level: any <p>/<li>/<div> whose flattened text matches the
    // placeholder regex gets a red side-rule + tooltip.
    const $ = cheerio.load(html, null, false);
    const tip = [
      'WHAT — Placeholder image marker',
      'WHY — The writer left "IMAGE N. Alt tag: …" text in the doc instead of embedding a real image. Reader sees the literal placeholder string; screen readers read it aloud. Fails WCAG 1.1.1.',
      'FIX — Embed an <img> with descriptive alt, or run Auto-fix on the WCAG row.',
    ].join('\n');
    $('p, li, div').each((_, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ');
      if (!PLACEHOLDER_RE.test(text)) {
        PLACEHOLDER_RE.lastIndex = 0;
        return;
      }
      PLACEHOLDER_RE.lastIndex = 0;
      const existing = ($el.attr('class') ?? '').trim();
      if (existing.includes('qa-mark-fail-block')) return; // already marked
      $el.attr('class', `${existing} qa-mark-fail-block`.trim());
      $el.attr('data-tip', tip);
      $el.attr('title', tip);
    });
    return $.html();
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function walkTextNodes(
  $: cheerio.CheerioAPI,
  transform: (text: string) => string | null,
) {
  const candidates: { node: object; replacement: string }[] = [];
  $('*').each((_, el) => {
    const elTag = (el as { tagName?: string }).tagName;
    if (elTag === 'script' || elTag === 'style') return;
    const children = (el as { children?: object[] }).children ?? [];
    for (const child of children) {
      const c = child as { type?: string; data?: string };
      if (c.type !== 'text' || !c.data) continue;
      const out = transform(c.data);
      if (out !== null && out !== c.data) {
        candidates.push({ node: child, replacement: out });
      }
    }
  });
  for (const { node, replacement } of candidates) {
    $(node as unknown as Parameters<typeof $>[0]).replaceWith(replacement);
  }
}
