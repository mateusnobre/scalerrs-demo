import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';
import { runReadability } from '@/lib/qa/readability';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';

export const readabilityProducer: QaProducer = {
  namespace: 'readability',
  async produceChecks(doc: ParsedDoc): Promise<QaCheckInput[]> {
    const findings = await runReadability(doc);
    return findings.map((f) => ({
      // Strip the legacy "readability:" prefix the underlying module emits;
      // the runner re-adds it. Keeps storage shape consistent across
      // Producers.
      check_type: f.check_type.replace(/^readability:/, ''),
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      data: f.data,
    }));
  },
  annotate(html, findings): string {
    const tokens = new Set<string>();
    for (const f of findings) {
      if (f.severity !== 'warning' && f.severity !== 'fail') continue;
      const examples = (f.data as { examples?: string[] } | null)?.examples ?? [];
      for (const ex of examples) {
        if (!ex || ex.length < 4) continue;
        const quoted = [...ex.matchAll(/[\u201C\u201D"']([^\u201C\u201D"']{2,30})[\u201C\u201D"']/g)]
          .map((m) => m[1])
          .filter(Boolean);
        for (const t of quoted) tokens.add(t);
      }
    }
    if (tokens.size === 0) return html;

    const sorted = [...tokens].sort((a, b) => b.length - a.length);
    const $ = cheerio.load(html, null, false);
    walkTextNodes($, (text) => {
      let out = text;
      let changed = false;
      for (const token of sorted) {
        const re = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
        if (re.test(out)) {
          re.lastIndex = 0;
          out = out.replace(re, (m) => {
            const tip = [
              'WHAT — Readability flag (retext)',
              'WHY — Caught by retext as either passive voice, non-inclusive phrasing, or a complex-sentence trigger. Hurts the Flesch score and grades the article above the 12-year-old reading-level target.',
              'FIX — Rephrase to active voice, swap the word, or shorten the sentence.',
            ].join('\n');
            return `<mark class="qa-mark qa-mark-warn" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}">${escapeHtml(m)}</mark>`;
          });
          changed = true;
        }
      }
      return changed ? out : null;
    });
    return $.html();
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      if (out !== null && out !== c.data) candidates.push({ node: child, replacement: out });
    }
  });
  for (const { node, replacement } of candidates) {
    $(node as unknown as Parameters<typeof $>[0]).replaceWith(replacement);
  }
}
