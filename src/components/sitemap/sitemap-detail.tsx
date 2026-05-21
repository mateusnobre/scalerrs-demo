'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

type Sitemap = {
  id: string;
  url: string;
  status: string;
  url_count: number;
  fetched_at: string | null;
};
type SitemapUrl = {
  id: string;
  url: string;
  title: string | null;
  h1: string | null;
  canonical: string | null;
  word_count: number | null;
  index_state: 'unknown' | 'indexable' | 'noindex' | 'canonical_drift' | 'fetch_failed';
  http_status: number | null;
};

const STATE_TONE: Record<SitemapUrl['index_state'], 'pass' | 'warning' | 'fail' | 'neutral'> = {
  indexable: 'pass',
  noindex: 'fail',
  canonical_drift: 'warning',
  fetch_failed: 'fail',
  unknown: 'neutral',
};

export function SitemapDetail({ sitemap: initialMap, urls: initialUrls }: { sitemap: Sitemap; urls: SitemapUrl[] }) {
  const [sitemap, setSitemap] = useState(initialMap);
  const [urls, setUrls] = useState(initialUrls);
  const [q, setQ] = useState('');

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`sitemap-${sitemap.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sitemaps', filter: `id=eq.${sitemap.id}` }, (p) => {
        setSitemap((prev) => ({ ...prev, ...(p.new as Sitemap) }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sitemap_urls', filter: `sitemap_id=eq.${sitemap.id}` }, async () => {
        const { data } = await supabase.from('sitemap_urls').select('*').eq('sitemap_id', sitemap.id).order('url');
        setUrls((data ?? []) as SitemapUrl[]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [sitemap.id]);

  const tallies = useMemo(() => {
    const t: Record<string, number> = { indexable: 0, noindex: 0, canonical_drift: 0, fetch_failed: 0, unknown: 0 };
    urls.forEach((u) => (t[u.index_state] += 1));
    return t;
  }, [urls]);

  const filtered = q
    ? urls.filter((u) =>
        [u.url, u.title, u.h1].some((v) => v?.toLowerCase().includes(q.toLowerCase())),
      )
    : urls;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">Sitemap</p>
        <h1 className="mono mt-1 text-lg">{sitemap.url}</h1>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <Badge tone={sitemap.status === 'ready' ? 'pass' : 'warning'}>{sitemap.status}</Badge>
          <span className="text-[var(--fg-2)]">{urls.length} URLs crawled</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Tally label="Indexable" value={tallies.indexable} tone="pass" />
        <Tally label="Noindex" value={tallies.noindex} tone="fail" />
        <Tally label="Canonical drift" value={tallies.canonical_drift} tone="warning" />
        <Tally label="Fetch failed" value={tallies.fetch_failed} tone="fail" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle>URL table</CardTitle>
            <CardDescription>On-page signals captured at crawl time. Powers internal-linking suggestions via pg_trgm.</CardDescription>
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="w-64" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-12 gap-2 border-y border-[var(--border)] bg-[var(--bg-2)] px-5 py-2 text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
            <span className="col-span-6">URL · Title</span>
            <span className="col-span-2">H1</span>
            <span className="col-span-1 text-right">Words</span>
            <span className="col-span-1 text-right">HTTP</span>
            <span className="col-span-2 text-right">Index state</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {filtered.slice(0, 200).map((u) => (
              <div key={u.id} className="grid grid-cols-12 items-center gap-2 px-5 py-2 text-xs hover:bg-[var(--bg-2)]">
                <div className="col-span-6 min-w-0">
                  <p className="mono truncate text-[11px] text-[var(--fg-2)]">{u.url}</p>
                  <p className="truncate text-[var(--fg-0)]">{u.title ?? <span className="text-[var(--fg-3)]">—</span>}</p>
                </div>
                <p className="col-span-2 truncate text-[var(--fg-1)]">{u.h1 ?? <span className="text-[var(--fg-3)]">—</span>}</p>
                <p className="mono col-span-1 text-right text-[var(--fg-2)]">{u.word_count ?? '—'}</p>
                <p className="mono col-span-1 text-right text-[var(--fg-2)]">{u.http_status ?? '—'}</p>
                <div className="col-span-2 flex justify-end">
                  <Badge tone={STATE_TONE[u.index_state]}>{u.index_state.replace('_', ' ')}</Badge>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <p className="px-5 py-8 text-center text-sm text-[var(--fg-2)]">No URLs match.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: 'pass' | 'warning' | 'fail' }) {
  const colors = {
    pass: 'text-emerald-300',
    warning: 'text-amber-300',
    fail: 'text-red-300',
  };
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{label}</p>
        <p className={`mono mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
