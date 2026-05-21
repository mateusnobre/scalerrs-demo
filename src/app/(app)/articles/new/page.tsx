import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';
import { extractDocId } from '@/lib/google/docs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

async function startProcessing(formData: FormData) {
  'use server';
  const url = String(formData.get('gdoc_url') ?? '').trim();
  if (!url) return;

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

  const gdoc_id = extractDocId(url);

  const { data: article, error } = await supabase
    .from('articles')
    .insert({ org_id, created_by: user.id, gdoc_id, gdoc_url: url, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;

  await inngest.send({
    name: 'article/process.requested',
    data: { article_id: article.id, org_id, gdoc_url: url },
  });

  redirect(`/articles/${article.id}`);
}

const SAMPLE = 'https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit';

export default function NewArticlePage() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Process a Google Doc</CardTitle>
        <CardDescription>
          Paste a publicly-shared Google Doc URL. We&apos;ll dispatch an Inngest run that fetches,
          parses, QA-checks, AI-reviews, rehosts images, and renders WP-ready HTML.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={startProcessing} className="space-y-3">
          <Input name="gdoc_url" defaultValue={SAMPLE} required />
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">Sample doc pre-filled (the assessment article).</p>
            <Button type="submit">Start processing →</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
