'use client';

import { useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fmtMoney, fmtRelative, fmtDuration } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RotateCcw, Send, Wand2, RefreshCw } from 'lucide-react';
import type { Article, QaCheck, Run, RunStep } from '@/lib/db/types';
import { triggerAutofix, triggerPublish, reprocess, requestLinkSuggestions, replayFailedRun } from './actions';

interface LinkSuggestion {
  id: string;
  target_url: string;
  target_title: string | null;
  anchor_text: string;
  score: number;
  reason: string | null;
}

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

export function ArticleDetail({
  article: initial,
  checks: initialChecks,
  run: initialRun,
  steps: initialSteps,
  versions,
  suggestions: initialSuggestions,
}: {
  article: Article;
  checks: QaCheck[];
  run: Run | null;
  steps: RunStep[];
  versions: { id: string; reason: string; created_at: string }[];
  suggestions: LinkSuggestion[];
}) {
  const [article, setArticle] = useState(initial);
  const [checks, setChecks] = useState(initialChecks);
  const [run, setRun] = useState(initialRun);
  const [steps, setSteps] = useState(initialSteps);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [pending, startTransition] = useTransition();

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_link_suggestions', filter: `article_id=eq.${article.id}` }, async () => {
        const { data } = await supabase
          .from('internal_link_suggestions')
          .select('id, target_url, target_title, anchor_text, score, reason')
          .eq('article_id', article.id)
          .order('score', { ascending: false });
        setSuggestions((data ?? []) as LinkSuggestion[]);
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
        <div className="min-w-0">
          <p className="mono text-[11px] text-[var(--fg-3)]">{article.gdoc_id}</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">
            {article.article_title ?? '(parsing…)'}
          </h1>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Badge tone={STATUS_TONE[article.status] ?? 'neutral'}>{article.status}</Badge>
            <span className="mono text-[var(--fg-2)]">spend {fmtMoney(article.cost_cents)}</span>
            <span className="text-[var(--fg-3)]">updated {fmtRelative(article.updated_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {article.status === 'failed' && (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await replayFailedRun(article.id);
                  toast.success('Replay queued — picking up from last checkpoint');
                })
              }
              title="Re-fire the workflow event. Already-completed steps are memoized."
            >
              <RefreshCw className="size-3.5" /> Replay failed run
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await reprocess(article.id);
                toast.success('Reprocess queued');
              })
            }
          >
            <RotateCcw className="size-3.5" /> Reprocess
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await requestLinkSuggestions(article.id);
                toast.success('Internal-link engine queued');
              })
            }
          >
            <Wand2 className="size-3.5" /> Suggest links
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!canPublish || pending}
            onClick={() =>
              startTransition(async () => {
                await triggerPublish(article.id);
                toast.success('Publish queued (placeholder WP upload)');
              })
            }
            title={!canPublish ? 'Fix all failing checks first' : 'Send to WordPress'}
          >
            <Send className="size-3.5" /> Publish
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Failing" value={fail} tone="fail" />
        <StatCard label="Warnings" value={warn} tone="warning" />
        <StatCard label="Passing" value={pass} tone="pass" />
        <StatCard label="Link ideas" value={suggestions.length} tone="info" />
      </div>

      <Tabs defaultValue="qa">
        <TabsList>
          <TabsTrigger value="qa">QA ({checks.length})</TabsTrigger>
          <TabsTrigger value="meta">Meta</TabsTrigger>
          <TabsTrigger value="links">Internal links ({suggestions.length})</TabsTrigger>
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

        <TabsContent value="links">
          <LinkSuggestions suggestions={suggestions} />
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardContent className="prose-article p-6">
              {article.article_html ? (
                <div dangerouslySetInnerHTML={{ __html: article.article_html }} />
              ) : (
                <p className="text-sm text-[var(--fg-2)]">No HTML rendered yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="html">
          <Card>
            <CardHeader>
              <CardTitle>WordPress-ready HTML</CardTitle>
              <CardDescription>Copy into the WP block editor or POST to /wp-json/wp/v2/posts.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="mono max-h-[60vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-4 text-[11px] leading-relaxed text-[var(--fg-1)]">
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
            <CardContent className="divide-y divide-[var(--border)] p-0">
              {versions.length === 0 && <p className="p-6 text-sm text-[var(--fg-2)]">No versions yet.</p>}
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="font-medium">{v.reason}</span>
                  <span className="mono text-[11px] text-[var(--fg-3)]">{fmtRelative(v.created_at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'pass' | 'warning' | 'fail' | 'info' }) {
  const colors = {
    pass: 'text-emerald-300',
    warning: 'text-amber-300',
    fail: 'text-red-300',
    info: 'text-sky-300',
  };
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <span className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{label}</span>
        <span className={`mono text-2xl font-semibold ${colors[tone]}`}>{value}</span>
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
        <CardContent className="p-6 text-sm text-[var(--fg-2)]">No QA results yet — the run is still gathering data.</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {checks.map((c) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Card>
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.severity}>{c.severity}</Badge>
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <code className="mono rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-[var(--fg-2)]">{c.check_type}</code>
                  </div>
                  {c.detail && <p className="mt-1 text-xs text-[var(--fg-1)]">{c.detail}</p>}
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
                    <Sparkles className="size-3" /> Auto-fix
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
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
            <Sparkles className="size-3" /> Regenerate meta title
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
            <Sparkles className="size-3" /> Regenerate meta description
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{label}</p>
      <p className="mt-1 text-sm text-[var(--fg-0)]">{value ?? <span className="text-[var(--fg-3)]">—</span>}</p>
    </div>
  );
}

function LinkSuggestions({ suggestions }: { suggestions: LinkSuggestion[] }) {
  if (!suggestions.length) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--fg-2)]">
          No suggestions yet. Ingest a sitemap from the Sitemaps page, then click <strong>Suggest links</strong>.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal-link suggestions</CardTitle>
        <CardDescription>
          Ranked by lexical similarity (pg_trgm) against the org&apos;s crawled sitemap URLs. Highest-scoring
          first. Swap to pgvector + embeddings for semantic match — one file change.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-[var(--border)]">
          {suggestions.map((s) => (
            <div key={s.id} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-xs">
              <div className="col-span-7 min-w-0">
                <p className="truncate text-sm text-[var(--fg-0)]">{s.target_title ?? s.target_url}</p>
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
                <p className="mono text-base font-semibold text-[var(--accent)]">{s.score.toFixed(3)}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RunTrace({ run, steps }: { run: Run | null; steps: RunStep[] }) {
  // Live elapsed ticker — re-renders every 500ms while the run is active so
  // viewers see the seconds counting up in real time.
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
    ? (run.completed_at ? new Date(run.completed_at).getTime() : now) - new Date(run.started_at).getTime()
    : 0;
  const elapsed = totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div>
          <CardTitle className="mono">Run {run.id.slice(0, 8)}</CardTitle>
          <CardDescription>
            status <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge> · started {fmtRelative(run.started_at)}
          </CardDescription>
        </div>
        <div className="text-right">
          <p className="mono text-2xl font-semibold tabular-nums text-[var(--accent)]">{elapsed}</p>
          <p className="mono text-[11px] text-[var(--fg-3)]">{fmtMoney(run.cost_cents)} · {steps.length} steps</p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y divide-[var(--border)]">
          {steps.map((s) => {
            const dur = fmtDuration(s.started_at, s.completed_at);
            return (
              <li
                key={s.id}
                className={`flex items-center justify-between gap-4 px-5 py-2.5 text-xs ${s.status === 'running' ? 'step-running' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mono w-6 text-right text-[10px] text-[var(--fg-3)]">{s.position}</span>
                  <span className="mono truncate text-[var(--fg-1)]">{s.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {s.detail && <span className="truncate text-[11px] text-[var(--fg-2)]">{s.detail}</span>}
                  <span className="mono w-14 text-right text-[11px] text-[var(--fg-2)]">{dur}</span>
                  {s.cost_cents > 0 && (
                    <span className="mono w-12 text-right text-[11px] text-[var(--fg-3)]">{fmtMoney(s.cost_cents)}</span>
                  )}
                  <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                </div>
              </li>
            );
          })}
          {run.error && (
            <li className="px-5 py-3 text-xs text-red-300">Error: {run.error}</li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}
