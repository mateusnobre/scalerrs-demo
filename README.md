# Scalerrs · Article QA + SEO Workflow Engine

A durable, multi-tenant system that covers **all four** of Scalerrs's named
SEO workflows on a single Supabase + Inngest + Vercel stack:

1. **Content Creation** — Google Doc → rule + AI QA → auto-fix loop → WP HTML
2. **Internal Linking** — sitemap.xml ingest → pg_trgm similarity → ranked anchor suggestions
3. **On-Page SEO** — heading hierarchy, alt tags, meta lengths, FAQ JSON-LD emission
4. **Indexation** — per-URL noindex / canonical drift / fetch-fail captured at crawl

Built around three primitives:

- **Inngest** — durable, step-checkpointed execution with retries + concurrency caps.
- **Supabase + flat indexed RLS** — multi-tenancy via one indexed lookup per query (no recursive joins).
- **A hard cost cap per run** — fail-fast before runaway LLM spend on bad inputs.

---

## Architecture

```mermaid
flowchart LR
  subgraph Client
    U[Next.js App Router<br/>RSC + Server Actions]
  end
  subgraph Edge
    A[/api/inngest serve]
  end
  subgraph Workers["Inngest Functions (durable + retryable)"]
    P[process-article<br/>fetch → parse → QA → critic → meta → rehost → render → faq]
    F1[autofix-alt-tags]
    F2[autofix-meta]
    F3[publish-wordpress]
    S[ingest-sitemap<br/>batched 8/sec, cap 200 URLs]
    L[suggest-internal-links<br/>pg_trgm rank]
  end
  subgraph Data["Supabase Postgres + RLS by org_id"]
    DB[(articles · qa_checks · runs · article_versions<br/>sitemaps · sitemap_urls · internal_link_suggestions)]
  end
  subgraph External
    G[Google Docs export]
    AI[AI Gateway → Claude Opus 4.7]
    VB[Vercel Blob]
  end
  U -- inngest.send --> A
  A --> P
  A --> F1
  A --> F2
  A --> F3
  A --> S
  A --> L
  P -- fetch --> G
  P -- generateObject / generateText --> AI
  P -- rehost --> VB
  P -- step.sendEvent --> L
  P -- writes + reads --> DB
  S -- upsert --> DB
  L -- rpc suggest_internal_links --> DB
  DB -- Realtime --> U
```

### Mapping to the Scalerrs JD

| Scalerrs workflow | What's wired |
|---|---|
| Content Creation | `process-article` Inngest function: fetch, parse, rule QA, AI critic, image rehost, render. |
| Internal Linking | `ingest-sitemap` (XML parser + batched crawl) + `suggest-internal-links` (pg_trgm rank). |
| On-Page SEO | Rule engine (10 checks) + FAQ JSON-LD emission + WP-ready HTML. |
| Indexation | Per-URL noindex, canonical drift, fetch-fail captured at crawl, surfaced in Sitemap detail. |

### Mapping to the cybersecurity bullets

- **AuthN/AuthZ** — Supabase Auth + flat RLS on every table. Service-role mutations only inside Inngest workers (never user-facing) and always pass `org_id` explicitly.
- **API key handling** — Server-only env vars. Anon key is the only thing shipped to the browser.
- **Input validation** — Zod schemas on AI critic responses; URL extraction is regex-bounded; sitemap parser is depth-capped (≤3) to prevent recursive bombs.
- **OWASP** — No SSRF (URL allowlist via `extractDocId`), XSS surface kept tight via cheerio re-serialisation, no SQL injection (parameterised RPC + Supabase client).
- **Least privilege** — `suggest_internal_links` is `revoke all` + `grant execute` to `authenticated, service_role` only.
- **Cost / DoS guard** — Per-run cost cap (`COST_CAP_CENTS = 50`), per-sitemap URL cap (200), per-step retries bounded to 3.

---

## Tour by file

```
src/lib/
  inngest/functions/
    process-article.ts      ← orchestrator: 10 steps + fan-out to suggest-links
    autofix-alt.ts          ← per-image alt rewrite via Opus
    autofix-meta.ts         ← regenerate meta title / description
    publish.ts              ← placeholder WP REST upload
    ingest-sitemap.ts       ← XML parse + batched crawl + upsert
    suggest-links.ts        ← pg_trgm RPC + persist top-N suggestions
  seo/
    sitemap.ts              ← fast-xml-parser + per-URL signal extraction
    faq-schema.ts           ← detect FAQ section → schema.org FAQPage JSON-LD
    anchor.ts               ← natural anchor-text picker (h1 → title → slug)
  qa/
    rules.ts                ← 10 deterministic checks
    critic.ts               ← Opus 4.7 editorial critic, zod-validated
  google/
    docs.ts                 ← public HTML export + jittered retry
    parser.ts               ← cheerio: title, meta, headings, images, links
  rehost/blob.ts            ← Vercel Blob image rehost
  html/render.ts            ← WP-ready HTML (lazy + sponsored rel)
  supabase/                 ← @supabase/ssr (getAll/setAll) + service client
supabase/migrations/
  20260521000001_init.sql        ← orgs, articles, qa_checks, runs, versions
  20260521000002_rls.sql         ← flat indexed RLS policies
  20260521000003_seed.sql        ← 2 demo orgs (Andar / Acme)
  20260521000004_sitemaps.sql    ← sitemaps + sitemap_urls + suggestions + pg_trgm
  20260521000005_suggest_links.sql  ← suggest_internal_links RPC
```

---

## QA checks shipped

Rule-based (deterministic, sub-10 ms per article):

| Check | Severity behaviour |
|---|---|
| image count (target 3-8) | fail outside |
| image hosting (GDrive only) | warning per non-GDrive |
| image alt tags | fail per missing |
| image placeholder text (`IMAGE 1. Alt tag: …`) | fail per marker |
| product links (target 1-5) | fail outside |
| exactly one H1 | fail otherwise |
| heading hierarchy (no skip levels) | warning per orphan |
| meta title length 30-65 | warning out of range |
| meta description length 120-160 | warning out of range |
| word count ≥ 600 | warning below |

AI-based (Claude Opus 4.7 via AI Gateway, zod-validated):

- tonal inconsistency
- filler phrases ("delve into", "in the realm of")
- keyword stuffing / brand over-repetition
- weak alt text
- shallow product mentions
- undefined claims ("premium", "high quality")

Each issue declares a `fix_kind` → one-click **Auto-fix** in the UI → its
own Inngest function → snapshot in `article_versions`.

---

## Internal linking engine

```sql
select
  u.url, u.title, u.h1,
  greatest(
    similarity(coalesce(u.title, ''), p_probe),
    similarity(coalesce(u.h1,    ''), p_probe)
  )::real as score
from sitemap_urls u
where u.org_id = p_org_id
  and u.index_state = 'indexable'
order by score desc
limit p_limit
```

Backed by GIN trigram indices on both `title` and `h1`. No embeddings, no
extra API key. Drop-in upgrade to pgvector + voyage-3 is a one-file change.

---

## FAQ JSON-LD

After rendering the article HTML, the pipeline detects a heading matching
`/faq|frequently asked questions/i`, walks its sibling Q&A pairs, and emits a
`<script type="application/ld+json">` block with `FAQPage` schema right
before the FAQ heading. SERP rich-result eligibility unlocked, no manual work.

---

## Multi-tenancy

`org_members(user_id, org_id, role)` is the source of truth. Every tenant
table carries `org_id` denormalised so RLS policies are:

```sql
org_id in (select org_id from public.org_members where user_id = auth.uid())
```

That's one indexed lookup (`org_members_user_idx`). No recursive joins, no
performance cliff at scale.

---

## Setup

```bash
pnpm install
cp .env.example .env.local
supabase start && supabase db reset    # boots Postgres + applies all 5 migrations
pnpm dev                                # :3000
pnpm dev:inngest                        # :8288 (Inngest dev UI)
```

Create demo users via Supabase Studio (`http://127.0.0.1:54323`) and link them to orgs:

```sql
insert into public.org_members (org_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', (select id from auth.users where email='andar@demo.com'), 'owner'),
  ('22222222-2222-2222-2222-222222222222', (select id from auth.users where email='acme@demo.com'),  'owner');
```

---

## Standalone deliverable

For the assessment, the rendered output HTML can be produced without any of
the infra:

```bash
pnpm dump-html "https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit" dog-collar-output
```

Writes `samples/dog-collar-output.{html,qa.json}`.

---

## Future ideas

1. **Bulk pipeline**: 50 doc URLs at once with batch auto-fix.
2. **Real WP + Shopify adapters** behind one `PublishTarget` interface, idempotency-keyed on `article_versions.id`.
3. **Editorial diff view** between any two `article_versions`.
4. **pgvector + voyage-3** swap for semantic internal linking (one-file change).
5. **Per-org brand voice** doc piped into AI critic system prompt.
6. **Slack/email alerts** on QA regression post-publish (broken images, lost canonical, web vitals).
7. **Schema.org coverage** beyond FAQ: HowTo, Article, Product.
8. **Per-org token cost dashboard** + monthly budget alarm (we already capture `cost_cents`).
9. **Robots.txt cross-check** layered on indexation — flag URLs in sitemap that robots.txt disallows.
10. **Anchor-text drift detection** across published versions of the same target URL.

---

## Stack

Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth + RLS + Realtime + pg_trgm) ·
Inngest 4 · Vercel AI SDK 6 + AI Gateway → Claude Opus 4.7 · Vercel Blob ·
shadcn/ui + Tailwind 4 · cmdk · framer-motion · cheerio · fast-xml-parser · zod.

Deploys on Vercel Fluid Compute. The Inngest worker route runs on Node
(300s max), but durability comes from the worker checkpoints — no single
function needs to finish in one execution.
