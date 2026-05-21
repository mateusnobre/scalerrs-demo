'use client';

import { useTransition, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { QaCheck } from '@/lib/db/types';
import { triggerAutofix } from '../actions';

export function QaTab({
  checks,
  articleId,
}: {
  checks: QaCheck[];
  articleId: string;
}): ReactNode {
  const [pending, startTransition] = useTransition();
  if (!checks.length) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-[var(--fg-2)]">
          No QA results yet — the run is still gathering data.
        </CardContent>
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
                    <code className="mono rounded bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-[var(--fg-2)]">
                      {c.check_type}
                    </code>
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
