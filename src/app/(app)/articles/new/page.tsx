import { redirect } from 'next/navigation';
import { ingestGoogleDoc, ingestDocxUpload } from '@/lib/sources/ingest';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

async function startFromUrl(formData: FormData) {
  'use server';
  const url = String(formData.get('gdoc_url') ?? '').trim();
  if (!url) return;
  const { article_id } = await ingestGoogleDoc(url);
  redirect(`/articles/${article_id}`);
}

async function startFromUpload(formData: FormData) {
  'use server';
  const file = formData.get('docx') as File | null;
  if (!file) throw new Error('No file uploaded');
  const { article_id } = await ingestDocxUpload(file);
  redirect(`/articles/${article_id}`);
}

const SAMPLE_URL = 'https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit';

export default function NewArticlePage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">New article</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Process a draft</h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Two ways in. Pick the one the writer used.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>From a Google Doc URL</CardTitle>
          <CardDescription>
            Doc must be shared with &ldquo;Anyone with the link&rdquo; access.
            Workflow run fans out QA, AI critic, image rehost, schema injection,
            and internal-linking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startFromUrl} className="space-y-3">
            <Input name="gdoc_url" defaultValue={SAMPLE_URL} required />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-[var(--fg-3)]">Sample pre-filled (assessment article).</p>
              <Button type="submit" variant="accent">Start →</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>From a .docx upload</CardTitle>
          <CardDescription>
            For agencies where writers hand over Word files. Parsed server-side
            via mammoth, then funneled through the same workflow as Google Docs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startFromUpload} className="space-y-3" encType="multipart/form-data">
            <input
              type="file"
              name="docx"
              accept=".docx"
              required
              className="block w-full text-sm text-[var(--fg-1)] file:mr-3 file:rounded-md file:border file:border-[var(--border-strong)] file:bg-[var(--bg-3)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--fg-0)] hover:file:bg-[var(--border)]"
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-[var(--fg-3)]">Max 10 MB. .docx only.</p>
              <Button type="submit" variant="accent">Upload + start →</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
