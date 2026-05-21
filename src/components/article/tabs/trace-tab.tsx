'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtMoney, fmtRelative, fmtDuration } from '@/lib/utils';
import type { Run, RunStep } from '@/lib/db/types';

const STATUS_TONE: Record<string, 'pass' | 'warning' | 'fail' | 'info' | 'neutral' | 'accent'> = {
  ready_for_review: 'info',
  published: 'pass',
  processing: 'warning',
  pending: 'neutral',
  failed: 'fail',
  succeeded: 'pass',
  running: 'warning',
  queued: 'neutral',
  cancelled: 'neutral',
};

export function TraceTab({ run, steps }: { run: Run | null; steps: RunStep[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [run?.status]);

  if (!run) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--fg-2)]">No runs yet.</CardContent>
      </Card>
    );
  }

  const totalMs = run.started_at
    ? (run.completed_at ? new Date(run.completed_at).getTime() : now) -
      new Date(run.started_at).getTime()
    : 0;
  const elapsed = totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div>
          <CardTitle className="mono">Run {run.id.slice(0, 8)}</CardTitle>
          <CardDescription>
            status <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge> ·
            started {fmtRelative(run.started_at)}
          </CardDescription>
        </div>
        <div className="text-right">
          <p className="mono text-2xl font-semibold tabular-nums text-[var(--accent)]">{elapsed}</p>
          <p className="mono text-[11px] text-[var(--fg-3)]">
            {fmtMoney(run.cost_cents)} · {steps.length} steps
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y divide-[var(--border)]">
          {steps.map((s) => {
            const dur = fmtDuration(s.started_at, s.completed_at);
            return (
              <li
                key={s.id}
                className={`flex items-center justify-between gap-4 px-5 py-2.5 text-xs ${
                  s.status === 'running' ? 'step-running' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mono w-6 text-right text-[10px] text-[var(--fg-3)]">
                    {s.position}
                  </span>
                  <span className="mono truncate text-[var(--fg-1)]">{s.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {s.detail && (
                    <span className="truncate text-[11px] text-[var(--fg-2)]">{s.detail}</span>
                  )}
                  <span className="mono w-14 text-right text-[11px] text-[var(--fg-2)]">{dur}</span>
                  {s.cost_cents > 0 && (
                    <span className="mono w-12 text-right text-[11px] text-[var(--fg-3)]">
                      {fmtMoney(s.cost_cents)}
                    </span>
                  )}
                  <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                </div>
              </li>
            );
          })}
          {run.error && <li className="px-5 py-3 text-xs text-red-300">Error: {run.error}</li>}
        </ol>
      </CardContent>
    </Card>
  );
}
