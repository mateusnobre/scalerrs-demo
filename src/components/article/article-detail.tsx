'use client';

import { useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fmtMoney, fmtRelative } from '@/lib/utils';
import { toast } from 'sonner';
import { RotateCcw, Send, Wand2, RefreshCw } from 'lucide-react';
import type { Article, QaCheck, Run, RunStep } from '@/lib/db/types';
import {
  triggerPublish,
  reprocess,
  requestLinkSuggestions,
  replayFailedRun,
} from './actions';
import { Visualizer } from './visualizer';
import { DownloadHtmlButton } from './download-html-button';
import { useArticleSync } from './use-article-sync';
import {
  QaTab,
  MetaTab,
  LinksTab,
  PreviewTab,
  HtmlTab,
  TraceTab,
  HistoryTab,
  type LinkSuggestion,
} from './tabs';

interface VisualizerData {
  html: string;
  counts: { fail: number; warn: number; fix: number };
  metaTitleChanged: boolean;
  metaDescriptionChanged: boolean;
  initialMetaTitle: string | null;
  initialMetaDescription: string | null;
}

const STATUS_TONE: Record<string, 'pass' | 'warning' | 'fail' | 'info' | 'neutral' | 'accent'> = {
  ready_for_review: 'info',
  published: 'pass',
  processing: 'warning',
  pending: 'neutral',
  failed: 'fail',
};

export function ArticleDetail({
  article: initialArticle,
  checks: initialChecks,
  run: initialRun,
  steps: initialSteps,
  versions,
  suggestions: initialSuggestions,
  visualizer,
}: {
  article: Article;
  checks: QaCheck[];
  run: Run | null;
  steps: RunStep[];
  versions: { id: string; reason: string; created_at: string }[];
  suggestions: LinkSuggestion[];
  visualizer: VisualizerData;
}) {
  const { article, checks, run, steps, suggestions } = useArticleSync({
    article: initialArticle,
    checks: initialChecks,
    run: initialRun,
    steps: initialSteps,
    suggestions: initialSuggestions,
  });
  const [pending, startTransition] = useTransition();

  const fail = checks.filter((c) => c.severity === 'fail').length;
  const warn = checks.filter((c) => c.severity === 'warning').length;
  const pass = checks.filter((c) => c.severity === 'pass').length;
  const canPublish = article.status === 'ready_for_review' && fail === 0;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-6">
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
          <DownloadHtmlButton
            filename={article.article_title ?? article.gdoc_id}
            metaTitle={article.meta_title}
            metaDescription={article.meta_description}
            articleTitle={article.article_title}
            html={article.article_html}
          />
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
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Failing" value={fail} tone="fail" />
        <StatCard label="Warnings" value={warn} tone="warning" />
        <StatCard label="Passing" value={pass} tone="pass" />
        <StatCard label="Link ideas" value={suggestions.length} tone="info" />
      </div>

      <Tabs defaultValue="visualizer">
        <TabsList>
          <TabsTrigger value="visualizer">Visualizer</TabsTrigger>
          <TabsTrigger value="qa">QA ({checks.length})</TabsTrigger>
          <TabsTrigger value="meta">Meta</TabsTrigger>
          <TabsTrigger value="links">Internal links ({suggestions.length})</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="html">Article HTML</TabsTrigger>
          <TabsTrigger value="trace">Run trace</TabsTrigger>
          <TabsTrigger value="history">History ({versions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="visualizer">
          <Visualizer
            html={visualizer.html}
            counts={visualizer.counts}
            metaTitleChanged={visualizer.metaTitleChanged}
            metaDescriptionChanged={visualizer.metaDescriptionChanged}
            initialMetaTitle={visualizer.initialMetaTitle}
            initialMetaDescription={visualizer.initialMetaDescription}
            currentMetaTitle={article.meta_title}
            currentMetaDescription={article.meta_description}
            checks={checks}
          />
        </TabsContent>
        <TabsContent value="qa">
          <QaTab checks={checks} articleId={article.id} />
        </TabsContent>
        <TabsContent value="meta">
          <MetaTab article={article} />
        </TabsContent>
        <TabsContent value="links">
          <LinksTab suggestions={suggestions} />
        </TabsContent>
        <TabsContent value="preview">
          <PreviewTab
            cleanHtml={article.article_html}
            annotatedHtml={visualizer.html}
            checks={checks}
          />
        </TabsContent>
        <TabsContent value="html">
          <HtmlTab
            html={article.article_html}
            articleTitle={article.article_title}
            metaTitle={article.meta_title}
            metaDescription={article.meta_description}
            filename={article.article_title ?? article.gdoc_id}
          />
        </TabsContent>
        <TabsContent value="trace">
          <TraceTab run={run} steps={steps} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab versions={versions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'pass' | 'warning' | 'fail' | 'info';
}) {
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
