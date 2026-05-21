'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { startBatch } from '@/app/(app)/dashboard/actions';
import { toast } from 'sonner';
import { Zap } from 'lucide-react';

export function BatchButton() {
  const [pending, startTransition] = useTransition();
  const [count] = useState(5);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { dispatched } = await startBatch(count);
          toast.success(`Dispatched ${dispatched} runs — watch the concurrency cap kick in`);
        })
      }
    >
      <Zap className="size-3.5" /> Run {count} in parallel
    </Button>
  );
}
