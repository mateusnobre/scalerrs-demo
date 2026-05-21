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
    // The rule we visualise inline is `image_placeholders` (the writer's
    // "IMAGE N. Alt tag" markers). The text is matched at render-time —
    // the finding payload only tells us which markers exist, not their
    // positions, so we re-scan via cheerio. This keeps the Visualizer
    // hop-free even when findings are stale relative to the body.
    const $ = cheerio.load(html, null, false);
    walkTextNodes($, (text) => {
      if (!PLACEHOLDER_RE.test(text)) return null;
      PLACEHOLDER_RE.lastIndex = 0;
      return text.replace(PLACEHOLDER_RE, (m) =>
        `<mark class="qa-mark qa-mark-fail" title="Placeholder image marker — the writer left this in instead of embedding a real image. Fails WCAG 1.1.1.">${escapeHtml(m)}</mark>`,
      );
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
