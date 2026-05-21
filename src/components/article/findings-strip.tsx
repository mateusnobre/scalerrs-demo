'use client';

import { Badge } from '@/components/ui/badge';
import type { QaCheck } from '@/lib/db/types';

/**
 * Findings strip — every fail / warning rendered as a pill above the article
 * body. Bridges the gap between the inline Visualizer annotations (which only
 * mark *localized* findings — placeholders, broken links, retext tokens) and
 * the *global* findings that can't be mapped to a span of body text:
 *   - rule:image_count          (0 images)
 *   - rule:heading_h1           (multiple H1s)
 *   - rule:product_links        (count out of range)
 *   - rule:meta_title / description length
 *   - readability:flesch_score
 *   - readability:reading_level (whole-sentence; we don't have positions)
 *
 * Each pill carries the full WHAT / WHY / FIX detail in a hover tooltip
 * (same CSS path as the inline marks). Click does nothing in v1 — for v2
 * we'd jump-scroll to the first inline mark if one exists.
 */
export function FindingsStrip({ checks }: { checks: QaCheck[] }) {
  // Only show fail + warning. Pass rows would drown the signal.
  const noisy = checks.filter((c) => c.severity === 'fail' || c.severity === 'warning');
  if (noisy.length === 0) return null;

  // Stable order: fails first, then warnings, then by check_type alpha.
  const sorted = [...noisy].sort((a, b) => {
    const s = scoreSeverity(a.severity) - scoreSeverity(b.severity);
    if (s !== 0) return s;
    return a.check_type.localeCompare(b.check_type);
  });

  return (
    <div className="qa-findings-strip mb-4 rounded-md border border-[var(--border)] bg-[var(--bg-2)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">
          Findings · {sorted.length}
        </p>
        <p className="text-[11px] text-[var(--fg-3)]">
          Hover any pill for WHAT / WHY / FIX. Body marks show the localized ones.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((c) => (
          <span
            key={c.id}
            data-tip={buildTip(c)}
            title={buildTip(c)}
            className={pillClass(c.severity)}
          >
            <Badge tone={c.severity}>{c.severity}</Badge>
            <span className="truncate">{c.title}</span>
            <code className="mono text-[9px] text-[var(--fg-3)]">{c.check_type}</code>
          </span>
        ))}
      </div>
    </div>
  );
}

function scoreSeverity(s: string): number {
  return s === 'fail' ? 0 : s === 'warning' ? 1 : 2;
}

function pillClass(severity: string): string {
  const base =
    'inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs cursor-help relative';
  if (severity === 'fail')
    return `${base} border-red-500/30 bg-red-500/5 text-[var(--fg-1)]`;
  return `${base} border-amber-500/30 bg-amber-500/5 text-[var(--fg-1)]`;
}

function buildTip(c: QaCheck): string {
  // Many findings already encode WHAT / WHY / FIX in their detail. For the
  // ones that don't, render the title + detail straight.
  const detail = c.detail ?? '';
  if (detail.startsWith('WHAT')) return detail;
  return `${c.title}\n${detail}`;
}
