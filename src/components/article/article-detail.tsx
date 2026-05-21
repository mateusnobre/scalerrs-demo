'use client';

import { useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fmtMoney, fmtRelative } from '@/lib/utils';
import { toast } from 'sonner';
import type { Article, QaCheck, Run, RunStep } from '@/lib/db/types';
import { triggerAutofix, triggerPublish, reprocess } from './actions';

const STATUS_TONE: Record<string, 'pass' | 'warning' | 'fail' | 'info' | 'neutral'> = {
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

export function ArticleDetail({
  article: initial,
  checks: initialChecks,
  run: initialRun,
  steps: initialSteps,
  versions,
}: {
  article: Article;
  checks: QaCheck[];
  run: Run | null;
  steps: RunStep[];
  versions: { id: string; reason: string; created_at: string }[];
}) {
  const [article, setArticle] = useState(initial);
  const [checks, setChecks] = useState(initialChecks);
  const [run, setRun] = useState(initialRun);
  const [steps, setSteps] = useState(initialSteps);
  const [pending, startTransition] = useTransition();

  // Realtime: subscribe to article + checks + run + steps for this article.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`article-${article.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'articles', filter: `id=eq.${article.id}` }, (p) => {
        setArticle((prev) => ({ ...prev, ...(p.new as Article) }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qa_checks', filter: `article_id=eq.${article.id}` }, async () => {
        const { data } = await supabase
          .from('qa_checks')
          .select('*')
          .eq('article_id', article.id)
          .order('severity', { ascending: false });
        setChecks((data ?? []) as QaCheck[]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs', filter: `article_id=eq.${article.id}` }, (p) => {
        setRun(p.new as Run);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'run_steps' }, async (p) => {
        const next = p.new as RunStep;
        if (run && next.run_id !== run.id) return;
        const { data } = await supabase.from('run_steps').select('*').eq('run_id', run?.id ?? next.run_id).order('position');
        setSteps((data ?? []) as RunStep[]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [article.id, run]);

  const fail = checks.filter((c) => c.severity === 'fail').length;
  const warn = checks.filter((c) => c.severity === 'warning').length;
  const pass = checks.filter((c) => c.severity === 'pass').length;
  const canPublish = article.status === 'ready_for_review' && fail === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">{article.gdoc_id}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {article.article_title ?? '(parsing…)'}
          </h1>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Badge tone={STATUS_TONE[article.status] ?? 'neutral'}>{article.status}</Badge>
            <span className="text-zinc-500">spend {fmtMoney(article.cost_cents)}</span>
            <span className="text-zinc-500">updated {fmtRelative(article.updated_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await reprocess(article.id);
                toast.success('Reprocess queued');
              })
            }
          >
            Reprocess
          </Button>
          <Button
            variant="accent"
            disabled={!canPublish || pending}
            onClick={() =>
              startTransition(async () => {
                await triggerPublish(article.id);
                toast.success('Publish queued (placeholder WP upload)');
              })
            }
            title={!canPublish ? 'Fix all failing checks first' : 'Send to WordPress'}
          >
            Publish to WordPress →
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Failing" value={fail} tone="fail" />
        <StatCard label="Warnings" value={warn} tone="warning" />
        <StatCard label="Passing" value={pass} tone="pass" />
      </div>

      <Tabs defaultValue="qa">
        <TabsList>
          <TabsTrigger value="qa">QA ({checks.length})</TabsTrigger>
          <TabsTrigger value="meta">Meta + WP fields</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="html">Article HTML</TabsTrigger>
          <TabsTrigger value="trace">Run trace</TabsTrigger>
          <TabsTrigger value="history">History ({versions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="qa">
          <QaList checks={checks} articleId={article.id} pending={pending} startTransition={startTransition} />
        </TabsContent>

        <TabsContent value="meta">
          <MetaPanel article={article} pending={pending} startTransition={startTransition} />
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardContent className="prose-article p-6">
              {article.article_html ? (
                <div dangerouslySetInnerHTML={{ __html: article.article_html }} />
              ) : (
                <p className="text-sm text-zinc-500">No HTML rendered yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="html">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WordPress-ready HTML</CardTitle>
              <CardDescription>Copy-paste into the WP block editor or POST to /wp-json/wp/v2/posts.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
                {article.article_html ?? '(none)'}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trace">
          <RunTrace run={run} steps={steps} />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="divide-y divide-zinc-100 p-0">
              {versions.length === 0 && <p className="p-6 text-sm text-zinc-500">No versions yet.</p>}
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between px-6 py-3 text-sm">
                  <span className="font-medium">{v.reason}</span>
                  <span className="text-zinc-500">{fmtRelative(v.created_at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'pass' | 'warning' | 'fail' }) {
  const colors = {
    pass: 'text-emerald-700',
    warning: 'text-amber-700',
    fail: 'text-red-700',
  };
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <span className="text-sm text-zinc-500">{label}</span>
        <span className={`text-2xl font-semibold ${colors[tone]}`}>{value}</span>
      </CardContent>
    </Card>
  );
}

function QaList({
  checks,
  articleId,
  pending,
  startTransition,
}: {
  checks: QaCheck[];
  articleId: string;
  pending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  if (!checks.length) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">No QA results yet — the run is still gathering data.</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {checks.map((c) => (
        <Card key={c.id}>
          <CardContent className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge tone={c.severity}>{c.severity}</Badge>
                <p className="truncate font-medium">{c.title}</p>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{c.check_type}</code>
              </div>
              {c.detail && <p className="mt-1 text-sm text-zinc-600">{c.detail}</p>}
            </div>
            {c.fix_available && c.severity !== 'pass' && c.fix_kind && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await triggerAutofix(articleId, c.fix_kind!);
                    toast.success('Auto-fix queued');
                  })
                }
              >
                Auto-fix
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetaPanel({
  article,
  pending,
  startTransition,
}: {
  article: Article;
  pending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <Field label="Meta title" value={article.meta_title} />
        <Field label="Meta description" value={article.meta_description} />
        <Field label="Article title" value={article.article_title} />
        <Field
          label="Article HTML size"
          value={article.article_html ? `${(article.article_html.length / 1024).toFixed(1)} KB` : '—'}
        />
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await triggerAutofix(article.id, 'regenerate_meta_title');
                toast.success('Regenerating meta title');
              })
            }
          >
            Regenerate meta title
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await triggerAutofix(article.id, 'regenerate_meta_description');
                toast.success('Regenerating meta description');
              })
            }
          >
            Regenerate meta description
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-sm">{value ?? <span className="text-zinc-400">—</span>}</p>
    </div>
  );
}

function RunTrace({ run, steps }: { run: Run | null; steps: RunStep[] }) {
  if (!run) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-500">No runs yet.</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run {run.id.slice(0, 8)}</CardTitle>
        <CardDescription className="text-xs">
          status <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge> · started {fmtRelative(run.started_at)} · spend {fmtMoney(run.cost_cents)}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y divide-zinc-100">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-6 text-right text-xs text-zinc-400">{s.position}</span>
                <span className="font-mono">{s.name}</span>
              </div>
              <div className="flex items-center gap-3">
                {s.detail && <span className="text-xs text-zinc-500">{s.detail}</span>}
                <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
              </div>
            </li>
          ))}
          {run.error && (
            <li className="px-6 py-3 text-sm text-red-700">Error: {run.error}</li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}
