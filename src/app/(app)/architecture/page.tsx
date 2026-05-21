import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ArchitecturePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">System design</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Architecture</h1>
        <p className="mt-1 text-sm text-[var(--fg-2)]">
          Three primitives carry the load: durable execution, flat RLS multi-tenancy, and a per-run cost cap.
        </p>
      </div>

      <Diagram />

      <div className="grid gap-4 lg:grid-cols-2">
        <Box
          title="Vercel Workflow DevKit · durable execution"
          tone="accent"
          body={`Every '\`use step\`' function is a memoized, retryable unit. The orchestrator is a sandboxed '\`use workflow\`' function that calls steps and suspends between them. Kill the tab; the run resumes server-side. No external service — all .well-known/workflow/* endpoints auto-served by withWorkflow(nextConfig).`}
          bullets={[
            'processArticle: 11 steps + fan-out to suggestInternalLinks',
            'autofixAltTags, autofixMeta, autofixPlaceholderAlts',
            'publishWordpress, ingestSitemap',
            'link-health probes every outbound link mid-flight',
          ]}
        />
        <Box
          title="Supabase · flat indexed RLS"
          tone="info"
          body="Every tenant table carries org_id denormalised. Policies are a single index hit against org_members, never recursive joins. Service-role mutations live only inside Workflow steps and always pass org_id explicitly."
          bullets={[
            'GIN trigram index on sitemap_urls.title + h1',
            'Realtime subscriptions on runs / qa_checks / sitemap_urls',
            '@supabase/ssr getAll/setAll cookie API (no session loss)',
            'article_versions snapshot per change — full audit trail',
          ]}
        />
        <Box
          title="AI · Claude Opus 4.7 via Gateway"
          tone="pass"
          body="Structured outputs validated with zod before they ever hit the DB. Cost is metered per-step and the run aborts at a $0.50 cap. Provider failover comes free via the gateway."
          bullets={[
            'AI critic (editorial issues)',
            'Auto-rewrite alt text per image',
            'Regenerate meta title / description',
            'Cost cap = $0.50/run, fail-fast on overrun',
          ]}
        />
        <Box
          title="On-page signals · pure Postgres"
          tone="warning"
          body="Internal-link suggestions use pg_trgm against the org's crawled sitemap_urls. No embeddings dep, no extra API key. Indexation health (noindex, canonical drift, fetch fails) is captured at crawl time."
          bullets={[
            'fast-xml-parser for sitemap-index + urlset',
            'Concurrency-limited crawl (8/batch, 200/sitemap)',
            'public.suggest_internal_links(p_org_id, p_probe, …)',
            'Drop-in upgrade path: pgvector + voyage-3-large',
          ]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Why this scales to Scalerrs's four workflows</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-[var(--fg-1)] sm:grid-cols-2">
          <Row k="Content Creation" v="Article QA pipeline + AI critic + auto-fix loop, all durable." />
          <Row k="Internal Linking" v="Sitemap ingest → pg_trgm suggestions ranked per article." />
          <Row k="On-Page SEO" v="Rule engine + heading hierarchy + FAQ JSON-LD emission." />
          <Row k="Indexation" v="Per-URL noindex / canonical drift / fetch-fail flags at crawl." />
        </CardContent>
      </Card>
    </div>
  );
}

function Diagram() {
  return (
    <Card>
      <CardContent className="p-6">
        <svg viewBox="0 0 900 380" className="w-full" role="img" aria-label="System diagram">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#5eead4" />
            </marker>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5eead4" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#5eead4" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {/* Lanes */}
          <text x="20" y="24" fill="#5a5a64" fontSize="11" letterSpacing="2">CLIENT</text>
          <text x="20" y="120" fill="#5a5a64" fontSize="11" letterSpacing="2">EDGE</text>
          <text x="20" y="220" fill="#5a5a64" fontSize="11" letterSpacing="2">WORKERS</text>
          <text x="20" y="330" fill="#5a5a64" fontSize="11" letterSpacing="2">DATA</text>

          {/* Browser */}
          <Node x={120} y={30} w={180} label="Next.js App (RSC)" sub="dashboard · sitemaps · architecture" />

          {/* Server actions */}
          <Node x={340} y={30} w={200} label="Server Actions" sub="start(workflowFn, [args])" />

          {/* Workflow endpoints */}
          <Node x={580} y={30} w={200} label=".well-known/workflow/*" sub="withWorkflow(nextConfig)" tone="accent" />

          {/* Workers */}
          <Node x={120} y={170} w={180} label="process-article" sub="fetch · parse · QA · critic · rehost · render · faq · suggest" tone="accent" big />
          <Node x={340} y={170} w={180} label="ingest-sitemap" sub="XML → URLs → batched crawl → upsert" tone="accent" />
          <Node x={580} y={170} w={200} label="autofix-* / publish / suggest-links" sub="parallel, retryable, snapshotted" tone="accent" />

          {/* Data */}
          <Node x={120} y={300} w={220} label="Supabase Postgres + RLS" sub="articles · qa_checks · runs · sitemap_urls" tone="info" />
          <Node x={380} y={300} w={180} label="Vercel Blob" sub="image rehost" />
          <Node x={600} y={300} w={180} label="AI Gateway → Opus 4.7" sub="critic · alt · meta · faq" />

          {/* Arrows */}
          <Arrow from={[210, 70]} to={[440, 70]} />
          <Arrow from={[540, 70]} to={[680, 70]} />
          <Arrow from={[680, 100]} to={[210, 170]} />
          <Arrow from={[680, 100]} to={[430, 170]} />
          <Arrow from={[680, 100]} to={[680, 170]} />
          <Arrow from={[210, 250]} to={[230, 300]} />
          <Arrow from={[430, 250]} to={[230, 300]} />
          <Arrow from={[680, 250]} to={[230, 300]} />
          <Arrow from={[210, 250]} to={[470, 300]} dashed />
          <Arrow from={[680, 250]} to={[690, 300]} />
        </svg>
      </CardContent>
    </Card>
  );
}

function Node({
  x,
  y,
  w,
  label,
  sub,
  tone = 'neutral',
  big,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  sub?: string;
  tone?: 'neutral' | 'accent' | 'info';
  big?: boolean;
}) {
  const h = big ? 70 : 60;
  const stroke = tone === 'accent' ? '#5eead4' : tone === 'info' ? '#60a5fa' : '#353540';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={tone === 'accent' ? 'url(#g1)' : '#16161a'} stroke={stroke} strokeWidth={1} />
      <text x={x + 12} y={y + 22} fill="#f5f5f7" fontSize="13" fontWeight="600">{label}</text>
      {sub && <text x={x + 12} y={y + 40} fill="#8a8a94" fontSize="10">{sub}</text>}
    </g>
  );
}

function Arrow({ from, to, dashed }: { from: [number, number]; to: [number, number]; dashed?: boolean }) {
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke="#5eead4"
      strokeWidth={1}
      strokeDasharray={dashed ? '4 4' : undefined}
      markerEnd="url(#arrow)"
      opacity={0.6}
    />
  );
}

function Box({
  title,
  tone,
  body,
  bullets,
}: {
  title: string;
  tone: 'pass' | 'warning' | 'fail' | 'info' | 'accent';
  body: string;
  bullets: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{title.split(' ')[0]}</Badge>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription className="pt-1">{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-xs text-[var(--fg-1)]">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-[var(--fg-3)]">—</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-2)] p-3">
      <p className="text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{k}</p>
      <p className="mt-1">{v}</p>
    </div>
  );
}
