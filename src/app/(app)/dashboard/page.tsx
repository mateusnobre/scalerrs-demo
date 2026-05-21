import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtMoney, fmtRelative } from '@/lib/utils';

const STATUS_TONE: Record<string, 'pass' | 'warning' | 'fail' | 'info' | 'neutral'> = {
  ready_for_review: 'info',
  published: 'pass',
  processing: 'warning',
  pending: 'neutral',
  failed: 'fail',
};

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: articles } = await supabase
    .from('articles')
    .select('id, gdoc_url, status, article_title, meta_title, cost_cents, updated_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Articles</h1>
          <p className="text-sm text-zinc-500">Every row is durable: kill it, refresh it, the state survives.</p>
        </div>
        <Button asChild>
          <Link href="/articles/new">+ New article</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription className="text-xs">Scoped to your org via Supabase RLS. Other orgs are invisible.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!articles?.length && (
            <div className="px-6 py-12 text-center text-sm text-zinc-500">
              No articles yet — paste a Google Doc to start.
            </div>
          )}
          {!!articles?.length && (
            <div className="divide-y divide-zinc-100">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/articles/${a.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.article_title ?? a.meta_title ?? '(parsing…)'}</p>
                    <p className="truncate text-xs text-zinc-500">{a.gdoc_url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-zinc-500">{fmtMoney(a.cost_cents)}</span>
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                    <span className="w-24 text-right text-xs text-zinc-500">{fmtRelative(a.updated_at)}</span>
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
