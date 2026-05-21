'use client';

import { useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Article } from '@/lib/db/types';
import { triggerAutofix } from '../actions';

export function MetaTab({ article }: { article: Article }) {
  const [pending, startTransition] = useTransition();
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
      <p className="mt-1 text-sm text-[var(--fg-0)]">
        {value ?? <span className="text-[var(--fg-3)]">—</span>}
      </p>
    </div>
  );
}
