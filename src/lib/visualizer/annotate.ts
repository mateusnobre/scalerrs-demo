import * as cheerio from 'cheerio';
import type { QaCheck, ParsedDoc } from '@/lib/db/types';

// Renders an annotated copy of the article HTML where every QA finding is
// overlaid as an inline <mark> + every AI fix is highlighted in green.
//
// Mark classes (styled in globals.css):
//   .qa-mark-fail — red, fail-severity finding (e.g. placeholder image marker)
//   .qa-mark-warn — amber, warning-severity finding (passive voice, inclusive)
//   .qa-mark-fix  — green, AI-rewritten alt tag (compared to initial version)
//
// Each mark carries a `title` attribute → native browser tooltip explains
// the finding. Filter toggles in the UI add `.hide-fail` / `.hide-warn` /
// `.hide-fix` to the container to suppress categories cosmetically.

interface InitialVersion {
  article_html: string | null;
  meta_title: string | null;
  meta_description: string | null;
}

interface LinkProbeData {
  url: string;
  http_status: number;
  status: string;
  ms: number;
  error?: string;
}

export interface AnnotateOptions {
  html: string;
  checks: QaCheck[];
  rawDoc: ParsedDoc | null;
  initialVersion: InitialVersion | null;
  currentMetaTitle: string | null;
  currentMetaDescription: string | null;
}

export interface AnnotateResult {
  html: string;
  counts: { fail: number; warn: number; fix: number };
  metaTitleChanged: boolean;
  metaDescriptionChanged: boolean;
  initialMetaTitle: string | null;
  initialMetaDescription: string | null;
}

const PLACEHOLDER_RE =
  /IMAGE\s*\d+\s*\.?\s*Alt tag:\s*[\u201C\u201D"'][^\u201C\u201D"']+[\u201C\u201D"']/gi;

export function annotateArticleHtml(opts: AnnotateOptions): AnnotateResult {
  const $ = cheerio.load(opts.html, null, false);
  const counts = { fail: 0, warn: 0, fix: 0 };

  // 1) Placeholder image markers — red wrap on the text node.
  walkTextNodes($, (text) => {
    if (!PLACEHOLDER_RE.test(text)) return null;
    PLACEHOLDER_RE.lastIndex = 0;
    return text.replace(PLACEHOLDER_RE, (m) => {
      counts.fail++;
      return `<mark class="qa-mark qa-mark-fail" title="Placeholder image marker — the writer left this text in the doc instead of embedding a real image. Replace with a real <img> before publishing.">${escapeHtml(m)}</mark>`;
    });
  });

  // 2) Retext warnings — match the example phrases verbatim, wrap in amber.
  const warnExamples = new Set<string>();
  for (const c of opts.checks) {
    if (!c.check_type.startsWith('readability:')) continue;
    if (c.severity !== 'warning' && c.severity !== 'fail') continue;
    const examples = (c.data as { examples?: string[] } | null)?.examples ?? [];
    for (const ex of examples) {
      if (!ex || ex.length < 4) continue;
      // retext messages look like "Use “their” instead of “his”" — extract
      // each quoted token rather than try to match the whole sentence.
      const tokens = [...ex.matchAll(/[\u201C\u201D"']([^\u201C\u201D"']{2,30})[\u201C\u201D"']/g)]
        .map((m) => m[1])
        .filter(Boolean);
      for (const t of tokens) warnExamples.add(t);
    }
  }
  if (warnExamples.size > 0) {
    const sorted = [...warnExamples].sort((a, b) => b.length - a.length);
    walkTextNodes($, (text) => {
      let changed = false;
      let out = text;
      for (const token of sorted) {
        const re = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
        if (re.test(out)) {
          re.lastIndex = 0;
          out = out.replace(re, (m) => {
            counts.warn++;
            return `<mark class="qa-mark qa-mark-warn" title="Editorial flag: this word/phrase was caught by retext. Consider rephrasing.">${escapeHtml(m)}</mark>`;
          });
          changed = true;
        }
      }
      return changed ? out : null;
    });
  }

  // 3) Images — flag missing/short alts as fail; if alt changed from the
  //    initial version → green "AI rewrote this" pill.
  const initialAltMap = extractInitialAltMap(opts.initialVersion?.article_html ?? null);
  $('img').each((_, el) => {
    const $el = $(el);
    const alt = ($el.attr('alt') ?? '').trim();
    const src = $el.attr('src') ?? '';
    const initialAlt = initialAltMap.get(src);
    if (!alt || alt.length < 3) {
      $el.attr('class', ((($el.attr('class') ?? '') + ' qa-mark-fail-img').trim()));
      $el.attr('title', 'Missing or too-short alt text.');
      counts.fail++;
    } else if (initialAlt !== undefined && initialAlt !== alt) {
      $el.attr('class', ((($el.attr('class') ?? '') + ' qa-mark-fix-img').trim()));
      $el.attr('title', `AI rewrote alt: "${initialAlt}" → "${alt}"`);
      counts.fix++;
    }
  });

  // 3b) Broken / unverifiable links — wrap the <a> in a red (fail) or amber
  //     (warning) outline + carry the HTTP status into the title attr so
  //     hovering reveals the exact code.
  const linkVerdicts = new Map<string, { tone: 'fail' | 'warn'; tip: string }>();
  for (const c of opts.checks) {
    if (!c.check_type.startsWith('links:')) continue;
    const probes = ((c.data as { probes?: LinkProbeData[] } | null)?.probes ?? []) as LinkProbeData[];
    const tone: 'fail' | 'warn' = c.severity === 'fail' ? 'fail' : 'warn';
    for (const p of probes) {
      const tip = describeLink(p);
      linkVerdicts.set(p.url, { tone, tip });
    }
  }
  if (linkVerdicts.size > 0) {
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = ($a.attr('href') ?? '').trim();
      const v = linkVerdicts.get(href);
      if (!v) return;
      const existing = ($a.attr('class') ?? '').trim();
      const klass = v.tone === 'fail' ? 'qa-mark-fail-link' : 'qa-mark-warn-link';
      $a.attr('class', `${existing} ${klass}`.trim());
      $a.attr('title', v.tip);
      // Counts: don't double-count if already counted by another rule.
      if (v.tone === 'fail') counts.fail++;
      else counts.warn++;
    });
  }

  // 4) Meta diff — these aren't in the body html; we surface them at the
  //    component level via the result flags.
  const metaTitleChanged = !!(
    opts.initialVersion &&
    opts.initialVersion.meta_title !== opts.currentMetaTitle
  );
  const metaDescriptionChanged = !!(
    opts.initialVersion &&
    opts.initialVersion.meta_description !== opts.currentMetaDescription
  );
  if (metaTitleChanged) counts.fix++;
  if (metaDescriptionChanged) counts.fix++;

  return {
    html: $.html(),
    counts,
    metaTitleChanged,
    metaDescriptionChanged,
    initialMetaTitle: opts.initialVersion?.meta_title ?? null,
    initialMetaDescription: opts.initialVersion?.meta_description ?? null,
  };
}

function describeLink(p: LinkProbeData): string {
  switch (p.status) {
    case 'broken':
      return `Broken link · HTTP ${p.http_status} · ${p.ms}ms`;
    case 'network_error':
      return `Network error: ${p.error ?? 'no response'} · ${p.ms}ms`;
    case 'rate_limited':
      return `Rate-limited (HTTP 429) — could not verify · ${p.ms}ms`;
    case 'cf_challenge':
      return `Cloudflare bot wall — page exists but crawler couldn't access`;
    default:
      return `HTTP ${p.http_status} · ${p.ms}ms`;
  }
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
    // cheerio accepts any tree node; cast through unknown to satisfy TS.
    $(node as unknown as Parameters<typeof $>[0]).replaceWith(replacement);
  }
}

function extractInitialAltMap(initialHtml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!initialHtml) return map;
  const $ = cheerio.load(initialHtml, null, false);
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const alt = ($(el).attr('alt') ?? '').trim();
    if (src) map.set(src, alt);
  });
  return map;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
