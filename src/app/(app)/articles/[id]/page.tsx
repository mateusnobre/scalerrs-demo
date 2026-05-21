import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArticleDetail } from '@/components/article/article-detail';

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: article } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!article) notFound();

  const [{ data: checks }, { data: runs }, { data: versions }, { data: suggestions }] = await Promise.all([
    supabase
      .from('qa_checks')
      .select('*')
      .eq('article_id', id)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('runs')
      .select('*')
      .eq('article_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('article_versions')
      .select('id, reason, created_at')
      .eq('article_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('internal_link_suggestions')
      .select('id, target_url, target_title, anchor_text, score, reason')
      .eq('article_id', id)
      .order('score', { ascending: false }),
  ]);

  const latestRun = runs?.[0] ?? null;
  let steps: unknown[] = [];
  if (latestRun) {
    const { data } = await supabase
      .from('run_steps')
      .select('*')
      .eq('run_id', latestRun.id)
      .order('position');
    steps = data ?? [];
  }

  return (
    <ArticleDetail
      article={article}
      checks={checks ?? []}
      run={latestRun}
      steps={steps as never}
      versions={versions ?? []}
      suggestions={suggestions ?? []}
    />
  );
}
