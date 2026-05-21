'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Article, QaCheck, Run, RunStep } from '@/lib/db/types';

interface LinkSuggestion {
  id: string;
  target_url: string;
  target_title: string | null;
  anchor_text: string;
  score: number;
  reason: string | null;
}

interface InitialState {
  article: Article;
  checks: QaCheck[];
  run: Run | null;
  steps: RunStep[];
  suggestions: LinkSuggestion[];
}

/**
 * Custom hook owning the article's Realtime sync. Extracted from
 * ArticleDetail so the parent component is a thin composition; the hook
 * is the only place Supabase channels are wired.
 */
export function useArticleSync(initial: InitialState) {
  const [article, setArticle] = useState(initial.article);
  const [checks, setChecks] = useState(initial.checks);
  const [run, setRun] = useState(initial.run);
  const [steps, setSteps] = useState(initial.steps);
  const [suggestions, setSuggestions] = useState(initial.suggestions);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`article-${article.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'articles', filter: `id=eq.${article.id}` },
        (p) => setArticle((prev) => ({ ...prev, ...(p.new as Article) })),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qa_checks', filter: `article_id=eq.${article.id}` },
        async () => {
          const { data } = await supabase
            .from('qa_checks')
            .select('*')
            .eq('article_id', article.id)
            .order('severity', { ascending: false });
          setChecks((data ?? []) as QaCheck[]);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'runs', filter: `article_id=eq.${article.id}` },
        (p) => setRun(p.new as Run),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'run_steps' },
        async (p) => {
          const next = p.new as RunStep;
          if (run && next.run_id !== run.id) return;
          const { data } = await supabase
            .from('run_steps')
            .select('*')
            .eq('run_id', run?.id ?? next.run_id)
            .order('position');
          setSteps((data ?? []) as RunStep[]);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'internal_link_suggestions',
          filter: `article_id=eq.${article.id}`,
        },
        async () => {
          const { data } = await supabase
            .from('internal_link_suggestions')
            .select('id, target_url, target_title, anchor_text, score, reason')
            .eq('article_id', article.id)
            .order('score', { ascending: false });
          setSuggestions((data ?? []) as LinkSuggestion[]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [article.id, run]);

  return { article, checks, run, steps, suggestions };
}
