'use client';

import { Card, CardContent } from '@/components/ui/card';
import { fmtRelative } from '@/lib/utils';

export function HistoryTab({
  versions,
}: {
  versions: { id: string; reason: string; created_at: string }[];
}) {
  return (
    <Card>
      <CardContent className="divide-y divide-[var(--border)] p-0">
        {versions.length === 0 && (
          <p className="p-6 text-sm text-[var(--fg-2)]">No versions yet.</p>
        )}
        {versions.map((v) => (
          <div key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="font-medium">{v.reason}</span>
            <span className="mono text-[11px] text-[var(--fg-3)]">{fmtRelative(v.created_at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
