import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[var(--accent)]">
        <Sparkles className="size-3" /> Scalerrs · Article QA
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Ship 100s of SEO articles a month <span className="text-[var(--accent)]">without breaking content</span>.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-[var(--fg-1)]">
        Paste a Google Doc. We parse it, run rule-based + AI editorial QA, rehost broken images,
        regenerate weak meta, emit FAQ schema, score it against your sitemap for internal-link
        opportunities, and queue it for WordPress — all on durable, resumable workflows you can
        kill mid-flight and replay.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild variant="accent" size="lg">
          <Link href="/dashboard">Open dashboard →</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/architecture">View architecture</Link>
        </Button>
      </div>
      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <Feature title="Content Creation" body="Rule + AI QA, auto-fix loop, FAQ JSON-LD, WP-ready HTML." />
        <Feature title="Internal Linking" body="Sitemap → pg_trgm similarity → ranked anchor suggestions." />
        <Feature title="On-Page SEO" body="Heading hierarchy, alt tags, meta lengths, word count." />
        <Feature title="Indexation" body="Noindex / canonical drift / fetch-fail flagged at crawl." />
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-4">
      <p className="text-[11px] uppercase tracking-widest text-[var(--accent)]">{title}</p>
      <p className="mt-2 text-[var(--fg-1)]">{body}</p>
    </div>
  );
}
