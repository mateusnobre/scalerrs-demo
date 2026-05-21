// Shared step functions for run/step tracking. Every business step writes
// its own row into `run_steps` so the UI's live trace (Supabase Realtime
// on run_steps) keeps working the same way it did under Inngest.

import { createServiceClient } from '@/lib/supabase/service';
import type { RunStatus } from '@/lib/db/types';

export async function createRun(article_id: string, org_id: string) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db
    .from('runs')
    .insert({
      article_id,
      org_id,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  await db.from('articles').update({ status: 'processing' }).eq('id', article_id);
  return data.id as string;
}

export async function beginStep(
  run_id: string,
  org_id: string,
  name: string,
  position: number,
) {
  'use step';
  const db = createServiceClient();
  const { data, error } = await db
    .from('run_steps')
    .insert({
      run_id,
      org_id,
      name,
      position,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function endStep(
  step_id: string,
  detail: string | null,
  cost_cents = 0,
) {
  'use step';
  const db = createServiceClient();
  await db
    .from('run_steps')
    .update({
      status: 'succeeded',
      detail,
      cost_cents,
      completed_at: new Date().toISOString(),
    })
    .eq('id', step_id);
}

export async function failStepRow(step_id: string, detail: string) {
  'use step';
  const db = createServiceClient();
  await db
    .from('run_steps')
    .update({
      status: 'failed',
      detail,
      completed_at: new Date().toISOString(),
    })
    .eq('id', step_id);
}

export async function finalizeRun(
  run_id: string,
  article_id: string,
  status: Extract<RunStatus, 'succeeded' | 'failed'>,
  cost_cents: number,
  error: string | null = null,
) {
  'use step';
  const db = createServiceClient();
  await db
    .from('runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      cost_cents,
      error,
    })
    .eq('id', run_id);
  await db
    .from('articles')
    .update({ status: status === 'succeeded' ? 'ready_for_review' : 'failed' })
    .eq('id', article_id);
}
