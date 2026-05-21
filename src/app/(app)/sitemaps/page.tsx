import Link from 'next/link';
import { start } from 'workflow/api';
import { createClient } from '@/lib/supabase/server';
import { ingestSitemap } from '@/lib/workflow/ingest-sitemap';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtRelative } from '@/lib/utils';

async function startIngest(formData: FormData) {
  'use server';
  const url = String(formData.get('url') ?? '').trim();
  if (!url) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');
  const { data: members } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1);
  const org_id = members?.[0]?.org_id;
  if (!org_id) throw new Error('no-org');

  const { data: row, error } = await supabase
    .from('sitemaps')
    .upsert({ org_id, created_by: user.id, url, status: 'pending' }, { onConflict: 'org_id,url' })
    .select('id')
    .single();
  if (error) throw error;

  await start(ingestSitemap, [row.id, org_id, url]);
}

export default async function SitemapsPage() {
  const supabase = await createClient();
  const { data: sitemaps } = await supabase
    .from('sitemaps')
    .select('id, url, status, url_count, fetched_at, updated_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">Internal-linking corpus</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sitemaps</h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Ingest your existing site to power internal-link suggestions and indexation health checks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingest a sitemap</CardTitle>
          <CardDescription>Supports both sitemap-index and urlset. Capped at 200 URLs for the demo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startIngest} className="flex gap-2">
            <Input name="url" placeholder="https://www.andar.com/sitemap.xml" required />
            <Button type="submit" variant="accent">Start ingest →</Button>
          </form>
          <p className="mt-2 text-[11px] text-[var(--fg-3)]">
            Try{' '}
            <code className="mono">https://blog.vercel.com/sitemap.xml</code> or{' '}
            <code className="mono">https://www.andar.com/sitemap.xml</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Ingested</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!sitemaps?.length && (
            <p className="px-5 py-8 text-center text-sm text-[var(--fg-2)]">No sitemaps ingested yet.</p>
          )}
          {!!sitemaps?.length && (
            <div className="divide-y divide-[var(--border)]">
              {sitemaps.map((s) => (
                <Link
                  key={s.id}
                  href={`/sitemaps/${s.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[var(--bg-2)]"
                >
                  <div className="min-w-0">
                    <p className="mono truncate text-xs">{s.url}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--fg-3)]">
                      {s.url_count} URLs · last fetched {fmtRelative(s.fetched_at)}
                    </p>
                  </div>
                  <Badge tone={s.status === 'ready' ? 'pass' : s.status === 'failed' ? 'fail' : 'warning'}>
                    {s.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
