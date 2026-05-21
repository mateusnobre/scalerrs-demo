import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { processArticle } from '@/lib/inngest/functions/process-article';
import { autofixAltTags } from '@/lib/inngest/functions/autofix-alt';
import { autofixMeta } from '@/lib/inngest/functions/autofix-meta';
import { publishWordpress } from '@/lib/inngest/functions/publish';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processArticle, autofixAltTags, autofixMeta, publishWordpress],
});

// Inngest needs a sync endpoint that responds quickly; we route it via Vercel
// Functions (Node runtime, default 300s timeout on Fluid Compute). The actual
// long-running work happens server-side and is checkpointed step-by-step.
export const runtime = 'nodejs';
export const maxDuration = 300;
