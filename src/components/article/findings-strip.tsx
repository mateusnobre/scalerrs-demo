'use client';

import { useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import type { QaCheck } from '@/lib/db/types';

/**
 * Findings strip — every fail / warning rendered as a pill above the article
 * body. Click a pill to scroll the page to the first matching inline mark.
 * Pills for *global* findings (rule:image_count, readability:flesch_score, …)
 * have no inline target — they're informational only.
 *
 * Mapping check_type → selector lives in `targetSelector` below. Annotators
 * own the class names; this map mirrors them. Out of date here? Cycle the
 * pill click; should jump to the right mark.
 */
export function FindingsStrip({ checks }: { checks: QaCheck[] }) {
  // Cursor per check_type so repeated clicks step through all instances.
  const cursors = useRef<Record<string, number>>({});

  const noisy = checks.filter((c) => c.severity === 'fail' || c.severity === 'warning');
  if (noisy.length === 0) return null;

  const sorted = [...noisy].sort((a, b) => {
    const s = scoreSeverity(a.severity) - scoreSeverity(b.severity);
    if (s !== 0) return s;
    return a.check_type.localeCompare(b.check_type);
  });

  function scrollToFinding(check_type: string) {
    const sel = targetSelector(check_type);
    if (!sel) return;
    const container = document.querySelector('.qa-annotated');
    if (!container) return;
    const matches = container.querySelectorAll<HTMLElement>(sel);
    if (matches.length === 0) return;
    const idx = (cursors.current[check_type] ?? -1) + 1;
    const next = idx % matches.length;
    cursors.current[check_type] = next;
    const el = matches[next];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('qa-flash');
    setTimeout(() => el.classList.remove('qa-flash'), 1600);
  }

  return (
    <div className="qa-findings-strip mb-4 rounded-md border border-[var(--border)] bg-[var(--bg-2)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">
          Findings · {sorted.length}
        </p>
        <p className="text-[11px] text-[var(--fg-3)]">
          Click a pill to jump to it · hover for WHAT / WHY / FIX
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((c) => {
          const hasTarget = !!targetSelector(c.check_type);
          return (
            <button
              key={c.id}
              type="button"
              data-tip={buildTip(c)}
              title={buildTip(c)}
              onClick={() => scrollToFinding(c.check_type)}
              className={pillClass(c.severity, hasTarget)}
              disabled={!hasTarget}
            >
              <Badge tone={c.severity}>{c.severity}</Badge>
              <span className="truncate">{c.title}</span>
              <code className="mono text-[9px] text-[var(--fg-3)]">{c.check_type}</code>
              {hasTarget && <span className="mono text-[10px] text-[var(--fg-3)]">↓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function scoreSeverity(s: string): number {
  return s === 'fail' ? 0 : s === 'warning' ? 1 : 2;
}

function pillClass(severity: string, clickable: boolean): string {
  const base =
    'inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs text-left relative transition-colors';
  const tone =
    severity === 'fail'
      ? 'border-red-500/30 bg-red-500/5 text-[var(--fg-1)]'
      : 'border-amber-500/30 bg-amber-500/5 text-[var(--fg-1)]';
  const interaction = clickable
    ? 'cursor-pointer hover:bg-[var(--bg-3)] hover:border-[var(--border-strong)]'
    : 'cursor-help opacity-80';
  return `${base} ${tone} ${interaction}`;
}

function buildTip(c: QaCheck): string {
  const detail = c.detail ?? '';
  if (detail.startsWith('WHAT')) return detail;
  return `${c.title}\n${detail}`;
}

/**
 * Map check_type → CSS selector that matches its inline mark inside
 * `.qa-annotated`. Returning `null` means the finding is *global* — no
 * body location, pill is informational only.
 */
function targetSelector(check_type: string): string | null {
  if (check_type === 'rule:image_placeholders' || check_type === 'rule:image_alt_accessibility')
    return '.qa-mark-fail-block';
  if (check_type === 'links:broken' || check_type === 'links:network_error')
    return 'a.qa-mark-fail-link';
  if (check_type === 'links:rate_limited' || check_type === 'links:cf_challenge')
    return 'a.qa-mark-warn-link';
  if (
    check_type === 'gdrive:private_drive_image' ||
    check_type === 'gdrive:unreachable_drive_image'
  )
    return 'a.qa-mark-fail-link, .qa-mark-fail-block';
  if (check_type.startsWith('readability:')) {
    if (check_type === 'readability:reading_level')
      return 'p.qa-mark-warn-block, li.qa-mark-warn-block';
    if (
      check_type === 'readability:passive_voice' ||
      check_type === 'readability:inclusive_language' ||
      check_type === 'readability:sentence_spacing'
    )
      return 'mark.qa-mark-warn';
    // flesch_score remains a global metric — no inline target.
    return null;
  }
  return null;
}
