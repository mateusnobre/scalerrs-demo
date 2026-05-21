import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-xs font-medium uppercase tracking-widest text-emerald-700">
        Scalerrs · Article QA
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Ship 100s of SEO articles a month without breaking content.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-zinc-600">
        Paste a Google Doc. We parse it, run rule-based + AI editorial QA, rehost broken images,
        regenerate weak meta, and queue it for WordPress — all on durable, resumable workflows
        you can kill mid-flight and replay.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg">
          <Link href="/dashboard">Open dashboard →</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3 text-sm">
        <Feature title="Durable execution" body="Inngest checkpoints every step. Kill the tab; the run resumes." />
        <Feature title="Multi-tenant by default" body="Supabase RLS scoped by org_id. One indexed lookup per query." />
        <Feature title="Cost-capped agents" body="Per-run budget caps prevent runaway LLM spend on bad inputs." />
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-zinc-600">{body}</p>
    </div>
  );
}
