'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export interface LinkSuggestion {
  id: string;
  target_url: string;
  target_title: string | null;
  anchor_text: string;
  score: number;
  reason: string | null;
}

export function LinksTab({ suggestions }: { suggestions: LinkSuggestion[] }) {
  if (!suggestions.length) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--fg-2)]">
          No suggestions yet. Ingest a sitemap from the Sitemaps page, then click{' '}
          <strong>Suggest links</strong>.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal-link suggestions</CardTitle>
        <CardDescription>
          Ranked by lexical similarity (pg_trgm) against the org&apos;s crawled sitemap URLs.
          Highest-scoring first.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-[var(--border)]">
          {suggestions.map((s) => (
            <div key={s.id} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-xs">
              <div className="col-span-7 min-w-0">
                <p className="truncate text-sm text-[var(--fg-0)]">
                  {s.target_title ?? s.target_url}
                </p>
                <a
                  href={s.target_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-0.5 block truncate text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                >
                  {s.target_url}
                </a>
              </div>
              <div className="col-span-3 min-w-0">
                <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">Anchor</p>
                <p className="truncate text-[var(--fg-1)]">&ldquo;{s.anchor_text}&rdquo;</p>
              </div>
              <div className="col-span-2 text-right">
                <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">Score</p>
                <p className="mono text-base font-semibold text-[var(--accent)]">
                  {s.score.toFixed(3)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
