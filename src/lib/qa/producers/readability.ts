import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';
import { runReadability } from '@/lib/qa/readability';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';

// retext messages quote tokens with backticks (`easy`), curly quotes
// (\u201Ceasy\u201D), or plain quotes ('easy'). Match any of them.
const QUOTED_TOKEN_RE = /[\u201C\u201D"'`]([^\u201C\u201D"'`]{2,30})[\u201C\u201D"'`]/g;

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
    const sentencePrefixes: string[] = [];
    for (const f of findings) {
      if (f.severity !== 'warning' && f.severity !== 'fail') continue;
      // Token-quoted messages (passive, inclusive, sentence-spacing).
      const examples = (f.data as { examples?: string[] } | null)?.examples ?? [];
      for (const ex of examples) {
        if (!ex || ex.length < 4) continue;
        const quoted = [...ex.matchAll(QUOTED_TOKEN_RE)]
          .map((m) => m[1])
          .filter(Boolean);
        for (const t of quoted) tokens.add(t);
      }
      // Sentence-level messages (reading_level). The underlying module
      // slices the flagged sentence text and passes it as data.sentences.
      const sentences =
        (f.data as { sentences?: string[] } | null)?.sentences ?? [];
      for (const s of sentences) {
        const prefix = s.replace(/\s+/g, ' ').trim().slice(0, 40);
        if (prefix.length >= 12) sentencePrefixes.push(prefix);
      }
    }
    if (tokens.size === 0 && sentencePrefixes.length === 0) return html;

    const $ = cheerio.load(html, null, false);

    // 1) Token-level marks (inline mark.qa-mark-warn around the word).
    if (tokens.size > 0) {
      const sorted = [...tokens].sort((a, b) => b.length - a.length);
      const tokenTip = [
        'WHAT - Readability flag (retext)',
        'WHY - retext caught this word as either passive voice, non-inclusive phrasing, or a complex-sentence trigger. Hurts the Flesch score and the reading-level target.',
        'FIX - Rephrase to active voice, swap the word, or shorten the sentence.',
      ].join('\n');
      walkTextNodes($, (text) => {
        let out = text;
        let changed = false;
        for (const token of sorted) {
          const re = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
          if (re.test(out)) {
            re.lastIndex = 0;
            out = out.replace(
              re,
              (m) =>
                `<mark class="qa-mark qa-mark-warn" data-tip="${escapeHtml(tokenTip)}" title="${escapeHtml(tokenTip)}">${escapeHtml(m)}</mark>`,
            );
            changed = true;
          }
        }
        return changed ? out : null;
      });
    }

    // 2) Block-level marks for reading_level (whole-paragraph amber rule).
    //    Match by normalised prefix: if a paragraph's text starts with one
    //    of the sentence prefixes, mark the paragraph.
    if (sentencePrefixes.length > 0) {
      const sentenceTip = [
        'WHAT - Hard-to-read sentence',
        'WHY - retext flagged this sentence as above the target reading age (16 years). Long, dense, or syllable-heavy.',
        'FIX - Split into two sentences or replace the longer words.',
      ].join('\n');
      $('p, li').each((_, el) => {
        const $el = $(el);
        const flat = $el.text().replace(/\s+/g, ' ').trim();
        if (flat.length < 12) return;
        const hit = sentencePrefixes.find((p) => flat.includes(p));
        if (!hit) return;
        const existing = ($el.attr('class') ?? '').trim();
        if (existing.includes('qa-mark-warn-block')) return; // already marked
        $el.attr('class', `${existing} qa-mark-warn-block`.trim());
        $el.attr('title', sentenceTip);
        $el.attr('data-tip', sentenceTip);
      });
    }

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
