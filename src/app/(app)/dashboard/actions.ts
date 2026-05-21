'use server';

import { start } from 'workflow/api';
import { createClient } from '@/lib/supabase/server';
import { processArticle } from '@/lib/workflow/process-article';
import { extractDocId } from '@/lib/google/docs';
import { revalidatePath } from 'next/cache';

const SAMPLE_DOCS = [
  'https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit',
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
 * Batch-start N workflow runs in parallel. Workflow DevKit handles per-run
 * concurrency at the platform layer — the demo just fires N starts and lets
 * the runtime queue / schedule them.
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
    source_kind: 'gdoc' as const,
    status: 'pending' as const,
  }));

  const { data: inserted, error } = await supabase.from('articles').insert(rows).select('id');
  if (error) throw error;

  await Promise.all(inserted.map((a) => start(processArticle, [a.id, org_id])));

  revalidatePath('/dashboard');
  return { dispatched: inserted.length };
}
