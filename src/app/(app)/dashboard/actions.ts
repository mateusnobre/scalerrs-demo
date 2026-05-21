'use server';

import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';
import { extractDocId } from '@/lib/google/docs';
import { revalidatePath } from 'next/cache';

const SAMPLE_DOCS = [
  'https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit',
  // For the demo we reprocess the same doc N times to keep the run repeatable
  // and the visible concurrency behaviour deterministic. In production this
  // would be N distinct doc URLs from a writer's queue.
];

async function getOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');
  const { data } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1);
  const org_id = data?.[0]?.org_id;
  if (!org_id) throw new Error('no-org');
  return { supabase, user, org_id };
}

/**
 * Batch-process N articles in a single fan-out. Proves the Inngest
 * `concurrency.limit` on `process-article` — all N start simultaneously but
 * only the configured cap (5) run in parallel; the rest queue.
 */
export async function startBatch(count: number) {
  const n = Math.max(1, Math.min(10, count | 0));
  const { supabase, user, org_id } = await getOrgId();

  const url = SAMPLE_DOCS[0];
  const gdoc_id = extractDocId(url);

  const rows = Array.from({ length: n }, () => ({
    org_id,
    created_by: user.id,
    gdoc_id,
    gdoc_url: url,
    status: 'pending' as const,
  }));

  const { data: inserted, error } = await supabase.from('articles').insert(rows).select('id');
  if (error) throw error;

  await inngest.send(
    inserted.map((a) => ({
      name: 'article/process.requested' as const,
      data: { article_id: a.id, org_id, gdoc_url: url },
    })),
  );

  revalidatePath('/dashboard');
  return { dispatched: inserted.length };
}
