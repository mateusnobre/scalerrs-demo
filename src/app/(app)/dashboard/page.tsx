import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtMoney, fmtRelative } from '@/lib/utils';
import { FileText, Network, Activity } from 'lucide-react';

const STATUS_TONE: Record<string, 'pass' | 'warning' | 'fail' | 'info' | 'neutral' | 'accent'> = {
  ready_for_review: 'info',
  published: 'pass',
  processing: 'warning',
  pending: 'neutral',
  failed: 'fail',
};

export default async function Dashboard() {
  const supabase = await createClient();
  const [articlesQ, sitemapsQ, urlsQ] = await Promise.all([
    supabase
      .from('articles')
      .select('id, gdoc_url, status, article_title, meta_title, cost_cents, updated_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('sitemaps').select('id, url, status, url_count'),
    supabase
      .from('sitemap_urls')
      .select('id, index_state', { count: 'exact', head: false })
      .limit(0),
  ]);

  const articles = articlesQ.data ?? [];
  const sitemapCount = sitemapsQ.data?.length ?? 0;
  const urlCount = urlsQ.count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Articles</h1>
        </div>
        <Button asChild variant="accent">
          <Link href="/articles/new">+ New article</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={FileText} label="Articles" value={articles.length} hint="In this org" />
        <StatTile icon={Network} label="Sitemaps" value={sitemapCount} hint="Ingested for internal linking" />
        <StatTile icon={Activity} label="Crawled URLs" value={urlCount} hint="Available for link suggestions" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>Every row is durable. Kill it, refresh it — the state survives.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!articles.length && (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-[var(--fg-2)]">No articles yet.</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/articles/new">Process your first Google Doc →</Link>
              </Button>
            </div>
          )}
          {!!articles.length && (
            <div className="divide-y divide-[var(--border)]">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/articles/${a.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-[var(--bg-2)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.article_title ?? a.meta_title ?? '(parsing…)'}</p>
                    <p className="mono truncate text-[11px] text-[var(--fg-3)]">{a.gdoc_url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="mono text-[11px] text-[var(--fg-2)]">{fmtMoney(a.cost_cents)}</span>
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                    <span className="mono w-20 text-right text-[11px] text-[var(--fg-3)]">{fmtRelative(a.updated_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{label}</p>
          <p className="mono mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-[11px] text-[var(--fg-2)]">{hint}</p>
        </div>
        <Icon className="size-4 text-[var(--fg-3)]" />
      </CardContent>
    </Card>
  );
}
