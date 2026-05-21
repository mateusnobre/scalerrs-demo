// Shared article-ingest helper. The two server actions (URL + upload) both
// land here after their source-specific work — auth, org lookup, row insert,
// workflow dispatch all in one place.

import { start } from 'workflow/api';
import { createClient } from '@/lib/supabase/server';
import { processArticle } from '@/lib/workflow/process-article';
import { extractDocId } from '@/lib/google/docs';
import type { ArticleSource } from './article-source';
import { parseDocxBuffer } from './docx';

interface IngestResult {
  article_id: string;
  org_id: string;
}

async function authAndOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: members } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1);
  const org_id = members?.[0]?.org_id;
  if (!org_id) throw new Error('User has no org membership');
  return { supabase, user, org_id };
}

/** Ingest a Google Doc URL: insert article row + start the workflow. */
export async function ingestGoogleDoc(url: string): Promise<IngestResult> {
  const { supabase, user, org_id } = await authAndOrg();
  const gdoc_id = extractDocId(url);
  const { data, error } = await supabase
    .from('articles')
    .insert({
      org_id,
      created_by: user.id,
      gdoc_id,
      gdoc_url: url,
      source_kind: 'gdoc',
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw error;
  await start(processArticle, [data.id, org_id]);
  return { article_id: data.id, org_id };
}

/**
 * Ingest a .docx upload: parse server-side, persist HTML + ParsedDoc to
 * the article row, then dispatch the workflow. The workflow reads the
 * ArticleSource back from the row — no payload threading through args.
 */
export async function ingestDocxUpload(file: File): Promise<IngestResult> {
  if (file.size === 0) throw new Error('Empty upload');
  if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('Only .docx is supported');
  if (file.size > 10 * 1024 * 1024) throw new Error('File too large (>10MB)');

  const { supabase, user, org_id } = await authAndOrg();
  const buffer = await file.arrayBuffer();
  const doc = await parseDocxBuffer(buffer);

  const { data, error } = await supabase
    .from('articles')
    .insert({
      org_id,
      created_by: user.id,
      gdoc_id: `docx-${file.name.replace(/\.docx$/i, '')}`,
      gdoc_url: `docx://${file.name}`,
      source_kind: 'docx_upload',
      status: 'pending',
      raw_doc: doc,
      article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
      meta_title: doc.meta_title,
      meta_description: doc.meta_description,
    })
    .select('id')
    .single();
  if (error) throw error;
  await start(processArticle, [data.id, org_id]);
  return { article_id: data.id, org_id };
}

/** Type-driven re-ingest. Useful for adapters added later. */
export async function ingestArticleSource(source: ArticleSource): Promise<IngestResult> {
  if (source.kind === 'gdoc') return ingestGoogleDoc(source.url);
  // No first-class re-ingest for docx (the File is gone). Caller should
  // use replayFailedRun or reprocess on the existing article row.
  throw new Error(`Re-ingest not supported for source.kind=${source.kind}`);
}
