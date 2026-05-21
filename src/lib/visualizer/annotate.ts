import * as cheerio from 'cheerio';
import type { QaCheck, ParsedDoc } from '@/lib/db/types';
import { QA_PRODUCERS } from '@/lib/qa/producers';
import type { QaCheckInput } from '@/lib/qa/producer';

/**
 * Visualizer Module — dispatcher.
 *
 * Walks the registered QA Producers; for each Producer with an `annotate()`
 * method, filters the article's QA Checks by that Producer's namespace
 * and asks the Producer to annotate the HTML. Composes the results.
 *
 * The Visualizer used to be the union of every check type's logic
 * (placeholder regexes, retext tokens, link probes, alt diffs). After the
 * QaProducer refactor, the only thing the Visualizer still owns is what
 * cuts ACROSS Producers:
 *   - image alt diffs (compared against the initial-render version)
 *   - meta-title / meta-description diffs (surfaced at the chip level)
 *
 * Everything else is delegated.
 */

interface InitialVersion {
  article_html: string | null;
  meta_title: string | null;
  meta_description: string | null;
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

export function annotateArticleHtml(opts: AnnotateOptions): AnnotateResult {
  let html = opts.html;
  const counts = { fail: 0, warn: 0, fix: 0 };

  // 1) Per-Producer annotation pass. Each Producer gets only ITS findings.
  for (const producer of QA_PRODUCERS) {
    if (!producer.annotate) continue;
    const ns = `${producer.namespace}:`;
    const myFindings: QaCheckInput[] = opts.checks
      .filter((c) => c.check_type.startsWith(ns))
      .map((c) => ({
        check_type: c.check_type.slice(ns.length),
        severity: c.severity,
        title: c.title,
        detail: c.detail ?? '',
        data: c.data,
        fix_available: c.fix_available,
        fix_kind: c.fix_kind,
      }));
    if (myFindings.length === 0) continue;
    html = producer.annotate(html, myFindings);
    for (const f of myFindings) {
      if (f.severity === 'fail') counts.fail++;
      else if (f.severity === 'warning') counts.warn++;
    }
  }

  // 2) Cross-Producer concern: image alt diffs vs initial render. Lives
  //    here because no single QA Producer owns "alt was rewritten by the
  //    AI" — that's history, not a check.
  const initialAltMap = extractInitialAltMap(opts.initialVersion?.article_html ?? null);
  const $ = cheerio.load(html, null, false);
  $('img').each((_, el) => {
    const $el = $(el);
    const alt = ($el.attr('alt') ?? '').trim();
    const src = $el.attr('src') ?? '';
    const initialAlt = initialAltMap.get(src);
    if (!alt || alt.length < 3) {
      const tip = [
        'WHAT — Missing or too-short alt text',
        'WHY — Screen readers announce "image" with no description. Fails WCAG 1.1.1.',
        'FIX — Add a 6-15 word alt that names the article subject and a visible feature.',
      ].join('\n');
      $el.attr('class', `${($el.attr('class') ?? '')} qa-mark-fail-img`.trim());
      $el.attr('title', tip);
      $el.attr('data-tip', tip);
      counts.fail++;
    } else if (initialAlt !== undefined && initialAlt !== alt) {
      const tip = [
        'WHAT — AI rewrote this alt text',
        `WHY — Original was "${initialAlt}". New: "${alt}". Better accessibility + SEO.`,
      ].join('\n');
      $el.attr('class', `${($el.attr('class') ?? '')} qa-mark-fix-img`.trim());
      $el.attr('title', tip);
      $el.attr('data-tip', tip);
      counts.fix++;
    }
  });
  html = $.html();

  // 3) Meta diff — these aren't in the body html; surface via result flags.
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
    html,
    counts,
    metaTitleChanged,
    metaDescriptionChanged,
    initialMetaTitle: opts.initialVersion?.meta_title ?? null,
    initialMetaDescription: opts.initialVersion?.meta_description ?? null,
  };
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
