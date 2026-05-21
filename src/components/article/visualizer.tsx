'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FindingsStrip } from './findings-strip';
import type { QaCheck } from '@/lib/db/types';

interface VisualizerProps {
  html: string;
  counts: { fail: number; warn: number; fix: number };
  metaTitleChanged: boolean;
  metaDescriptionChanged: boolean;
  initialMetaTitle: string | null;
  initialMetaDescription: string | null;
  currentMetaTitle: string | null;
  currentMetaDescription: string | null;
  checks: QaCheck[];
}

export function Visualizer(props: VisualizerProps) {
  const [showFail, setShowFail] = useState(true);
  const [showWarn, setShowWarn] = useState(true);
  const [showFix, setShowFix] = useState(true);

  const containerClass = useMemo(
    () =>
      cn(
        'prose-article qa-annotated p-6',
        !showFail && 'hide-fail',
        !showWarn && 'hide-warn',
        !showFix && 'hide-fix',
      ),
    [showFail, showWarn, showFix],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Visualizer</CardTitle>
        <CardDescription>
          Inline overlay of every QA finding + every AI fix. Hover any mark for the detail. Toggle a chip to hide that category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label={`Fails · ${props.counts.fail}`}
            tone="fail"
            active={showFail}
            onClick={() => setShowFail((v) => !v)}
          />
          <Chip
            label={`Warnings · ${props.counts.warn}`}
            tone="warn"
            active={showWarn}
            onClick={() => setShowWarn((v) => !v)}
          />
          <Chip
            label={`AI fixes · ${props.counts.fix}`}
            tone="fix"
            active={showFix}
            onClick={() => setShowFix((v) => !v)}
          />
          <span className="ml-auto text-[11px] text-[var(--fg-3)]">Hover any highlight to see the AI&apos;s rationale.</span>
        </div>

        {(props.metaTitleChanged || props.metaDescriptionChanged) && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
            <p className="font-semibold text-emerald-300">AI also rewrote meta fields ↓</p>
            {props.metaTitleChanged && (
              <p className="mt-2 text-[var(--fg-1)]">
                <span className="text-[var(--fg-3)]">Meta title:</span>{' '}
                <span className="line-through opacity-60">{props.initialMetaTitle ?? '∅'}</span>{' '}
                → <span className="text-emerald-300">{props.currentMetaTitle ?? '∅'}</span>
              </p>
            )}
            {props.metaDescriptionChanged && (
              <p className="mt-1 text-[var(--fg-1)]">
                <span className="text-[var(--fg-3)]">Meta description:</span>{' '}
                <span className="line-through opacity-60">{props.initialMetaDescription ?? '∅'}</span>{' '}
                → <span className="text-emerald-300">{props.currentMetaDescription ?? '∅'}</span>
              </p>
            )}
          </div>
        )}

        <FindingsStrip checks={props.checks} />

        <div
          className={containerClass}
          // Annotated HTML is server-rendered + sanitised by cheerio re-serialisation.
          dangerouslySetInnerHTML={{ __html: props.html }}
        />
      </CardContent>
    </Card>
  );
}

function Chip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: 'fail' | 'warn' | 'fix';
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    fail: active
      ? 'bg-red-500/15 text-red-300 border-red-500/40'
      : 'bg-transparent text-[var(--fg-3)] border-[var(--border)]',
    warn: active
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
      : 'bg-transparent text-[var(--fg-3)] border-[var(--border)]',
    fix: active
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : 'bg-transparent text-[var(--fg-3)] border-[var(--border)]',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors',
        tones[tone],
      )}
    >
      {label}
    </button>
  );
}
