// The ArticleSource seam.
//
// Two Adapters today: Google Doc URL + .docx upload. Both produce a
// ParsedDoc downstream; the only thing that varies is HOW we get the HTML.
//
// Workflow code consumes the discriminated union via `loadArticleSource`,
// which reads from the article row. Server actions populate the row; the
// workflow doesn't care whether the writer pasted a URL or uploaded a file.

import { createServiceClient } from '@/lib/supabase/service';

export type ArticleSource =
  | { kind: 'gdoc'; url: string }
  | { kind: 'docx_upload'; preloadedHtml: string; filename: string };

export interface ArticleSourceRow {
  source_kind: 'gdoc' | 'docx_upload';
  gdoc_url: string;
  raw_doc: { raw_html?: string } | null;
}

export function articleSourceFromRow(row: ArticleSourceRow): ArticleSource {
  if (row.source_kind === 'docx_upload') {
    const html = row.raw_doc?.raw_html ?? '';
    if (!html) throw new Error('docx_upload article has no pre-parsed html');
    const filename = row.gdoc_url.startsWith('docx://')
      ? row.gdoc_url.slice('docx://'.length)
      : row.gdoc_url;
    return { kind: 'docx_upload', preloadedHtml: html, filename };
  }
  return { kind: 'gdoc', url: row.gdoc_url };
}

export async function loadArticleSourceById(article_id: string): Promise<ArticleSource> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('articles')
    .select('source_kind, gdoc_url, raw_doc')
    .eq('id', article_id)
    .single();
  if (error) throw error;
  return articleSourceFromRow(data as ArticleSourceRow);
}
