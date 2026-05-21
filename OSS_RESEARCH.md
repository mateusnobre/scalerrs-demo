# Backend OSS research — what we evaluated and why we picked what we picked

This is the audit trail behind the stack choices in this repo. Eight categories,
top picks per category, integration cost, and a final ordered hit list.

The constraint baked into every pick: **Scalerrs's stack is Supabase + Vercel +
TypeScript**. Anything that doesn't live happily inside that loses points,
regardless of merit. The goal is *less new infra, more leverage*.

---

## 1. Durable workflow engines

Picks evaluated:
- [vercel/workflow](https://github.com/vercel/workflow) — Apache-2.0. Native Vercel runtime, `'use workflow'` + `'use step'` directives, no external service, no signing keys, zero-config deploy.
- [inngest/inngest](https://github.com/inngest/inngest) — Apache-2.0 SDK, proprietary platform. Strong fan-out + dev dashboard, but introduces an external service + signing-key wiring.
- [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) — Apache-2.0. Long-lived workers, exceptional DX, but the worker model overlaps badly with Vercel Fluid Compute.
- [hatchet-dev/hatchet](https://github.com/hatchet-dev/hatchet) — MIT. DAG semantics, per-step concurrency caps, priority lanes — the closest fit for "agent reasoning with retries + budget caps" if we ever outgrow WDK.
- Temporal TS SDK — overkill for this scope; setup cost is days, not hours.
- Restate — too new in TS; production stories thin.

**Chosen: Vercel Workflow DevKit.** Pure Vercel stack — no third-party
orchestrator, no signing keys to ship, no separate dashboard to context-switch
to. Directives map cleanly to RSC mental model (`'use workflow'` ~ `'use
server'`). Step memoization handles the Replay flow exactly the same as
Inngest would.

**Honest follow-up:** Hatchet is the dark horse for the Indexation crawler.
DAG semantics mean we could express "fan out 200 URLs × Lighthouse + indexation
checks, gather, score" as a typed graph rather than a `for` loop inside a single
Workflow step. Earmarked as a v2 swap-in.

---

## 2. Sitemap / SEO crawlers

Picks evaluated:
- [apify/crawlee](https://github.com/apify/crawlee) — Apache-2.0. The standard at every serious SEO shop. Fingerprint rotation, request queues, retries, proxy auth out of the box.
- [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) — Apache-2.0. LCP / INP / CLS / SEO score in one shot.
- [berstend/puppeteer-extra](https://github.com/berstend/puppeteer-extra) + stealth — MIT. Anti-detection for crawling protected sites.
- `fast-xml-parser` — what's wired today. Adequate for the demo, not for production.

**Chosen for the demo: fast-xml-parser + bare `fetch`.** Predictable, no headless
Chrome dep, fits inside Workflow steps cleanly.

**Production upgrade path written into the README:** Crawlee + Lighthouse CI
running per-URL inside a Workflow step, captured into `sitemap_urls` alongside
indexation signals. Single crawl pass gives us indexation health *and* Core
Web Vitals — the "we do what Screaming Frog does, but inside your workflow"
talking point that nobody who has seen an AirOps clone before has heard.

---

## 3. Internal linking / semantic search

Picks evaluated:
- pgvector + [timescale/pgvectorscale](https://github.com/timescale/pgvectorscale) — PostgreSQL license. Streaming DiskANN index, benchmarks at Qdrant parity up to ~50M vectors. Stays inside Supabase.
- [qdrant/qdrant](https://github.com/qdrant/qdrant) — Apache-2.0. Best dedicated vector DB, but introduces a new service.
- [paradedb/paradedb](https://github.com/paradedb/paradedb) — AGPL. BM25 in Postgres. Lets us do hybrid (BM25 + pgvector) with RRF fusion inside one DB.
- Embeddings:
  - voyage-3-large — 67.1 MTEB, $0.18/M, the retrieval leader in 2026.
  - jina-embeddings-v3 — $0.02/M, 8k context, 65.5 MTEB, price/perf winner.
  - cohere-embed-v3 — solid but more expensive than jina for similar quality.

**Chosen for v1: pg_trgm.** Lexical similarity over `(title, h1)` with a GIN
trigram index. Zero new dep, zero API key, sub-millisecond ranking. Wraps in
a Postgres function `suggest_internal_links(p_org_id, p_probe, p_limit,
p_min_score)` with revoke-all + grant-execute to keep the privilege boundary
clean.

**Production upgrade path:** swap the RPC body to use pgvector + voyage-3-large
embeddings; the surrounding Workflow (`suggest-links.ts`) doesn't
change. **One-file swap.** That's the headline.

---

## 4. Readability / content QA

Picks evaluated:
- [retextjs/retext](https://github.com/retextjs/retext) — MIT. Composable plugins: `retext-readability` (grade level), `retext-passive` (passive voice), `retext-equality` (inclusive language), `retext-sentence-spacing`. Server-side, Node-native.
- [errata-ai/vale](https://github.com/errata-ai/vale) — MIT. Stronger brand-voice rules (Scalerrs-specific style guides in YAML), but it's a Go binary and child-process is friction.
- `textlint`, `text-readability`, `readability-score-js` — single-purpose, weaker than retext's composable pipeline.

**Chosen + wired: retext.** New step `readability-qa` in
`process-article` runs:
- Flesch reading ease (approx, our own calculator)
- Grade-level outliers via `retext-readability`
- Passive voice density via `retext-passive`
- Inclusive-language flags via `retext-equality`
- Sentence-spacing via `retext-sentence-spacing`

Findings stored under `check_type LIKE 'readability:%'` so the existing QA
panel renders them with no UI changes. On the dog-collar assessment article
it flags reading-level outliers (16 sentences too dense), inclusive-language
issues (8 occurrences), and a Flesch score of 33 (fail; target 60+).

**Future:** Vale layered on top of retext when a client provides a YAML
brand-voice guide. Pitch that as the "per-org style guide" feature.

---

## 5. AI agent frameworks

Picks evaluated:
- [mastra-ai/mastra](https://github.com/mastra-ai/mastra) — MIT, ~24k stars, $35M raised. TypeScript-native, zod schemas, deterministic workflows + agents in the same primitives, MCP-native.
- [vercel/ai](https://github.com/vercel/ai) — Apache-2.0. SDK v6 ships `generateObject` + agent helpers; that's what we use.
- [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) — MIT. Python-first ecosystem; TS port lags. The 11x team publicly migrated off it onto Mastra.

**Chosen: Vercel AI SDK 6 + AI Gateway, no agent framework.** Reasoning:
SEO is a *structured workflow*, not a chat loop. Every "agent call" in this
codebase is a `generateObject` (zod-validated) or `generateText` (single
turn). A full agent framework would add a layer without buying anything.

**When to graduate to Mastra:** when we have ≥3 LLM-driven steps that need
to share state and tools. Today we have 2 (critic + meta-regen) and they
don't share anything.

---

## 6. WordPress / Shopify headless publishers

Picks evaluated:
- [wp-graphql/wp-graphql](https://github.com/wp-graphql/wp-graphql) — GPL-3.0. Typed mutations beat REST hand-rolling.
- [dotansimha/graphql-code-generator](https://github.com/dotansimha/graphql-code-generator) — MIT. Generates the TS client.
- Faust.js — Next.js *frontend* framework. Overkill if we only need the publish step.

**Chosen for the demo: a placeholder Workflow** that simulates the
WP upload with `step.sleep`. Production swap-in: WPGraphQL + codegen-typed
`createPost` mutation, media upload via `uploadMedia`, idempotency-keyed on
`article_versions.id`. Shopify equivalent slots in behind the same
`PublishTarget` interface.

---

## 7. Schema.org tooling

Picks evaluated:
- [google/schema-dts](https://github.com/google/schema-dts) — Apache-2.0, by Google. TypeScript types for the entire schema.org vocabulary; missing required props are tsc errors.
- structured-data-testing-tool — encodes Google's *rich-result* required-field rules (stricter than schema.org validity), but stale.

**Chosen + wired: schema-dts + a thin in-house rich-result validator.**
The pipeline now emits:
- `FAQPage` JSON-LD (existing — inserted before the FAQ heading).
- `Article` JSON-LD on every article, with a `validateArticle` function that
  flags missing required fields (image, author, publisher with logo) as a
  warning QA check.
- `HowTo` JSON-LD when the body matches `/^(how to|steps to|guide to|
  tutorial)/i` and contains an `<ol>` — confirmed *not* triggered for the
  dog-collar article, correctly.

On the assessment article the output is now ~19 KB (vs 15 KB pre-schemas)
and ships rich-result-eligible Article + FAQ markup straight from the
pipeline.

---

## 8. RLS / Supabase hardening

Picks evaluated:
- Drizzle ORM `pgPolicy` builder + transaction-scoped client that sets `request.jwt.claims` — gives typed queries that *actually respect RLS*. Major lift to swap from supabase-js.
- [psteinroe/supabase-cache-helpers](https://github.com/psteinroe/supabase-cache-helpers) — SWR/React Query with RLS-aware cache keys.
- [sbdchd/squawk](https://github.com/sbdchd/squawk) — lints migrations for unsafe schema changes pre-deploy.

**Chosen for v1: supabase-js + manual discipline.** Service role only inside
Workflow steps; always pass `org_id` explicitly on every mutation. Documented
in `src/lib/supabase/service.ts`.

**Production upgrade path:** introduce Drizzle for new RLS-sensitive tables
only — keeps the migration story small and gives us typed RLS-aware clients
where it matters most.

---

## Dark horses (mentioned in the interview)

- [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) — LLM-ready
  markdown extraction. Beats cheerio for competitor-content ingest when we
  build the "what topics are competitors ranking on?" feature.
- [chonkie-ai/chonkie](https://github.com/chonkie-ai/chonkie) — semantic
  chunking for long-form SEO content. Improves embedding quality over naive
  paragraph splits.
- opentelemetry-js + Braintrust — agent-loop observability. Production
  debugging for "why did the critic reject this article."

---

## Top 5 to add immediately — impact-per-cost for this project

1. ~~**schema-dts + in-house rich-result validator**~~ — **wired**. Article + FAQ + HowTo, with a warning when required fields are missing.
2. ~~**retext pipeline**~~ — **wired**. Flesch, grade level, passive voice, inclusive language. Server-side, zero token cost.
3. **pgvector + voyage-3-large** for internal linking — migration drafted, gated behind an env var. Becomes the demo headline as soon as a key is available.
4. **Crawlee + Lighthouse CI** for indexation + Core Web Vitals in one pass — biggest "this isn't AirOps" beat we could add. Heaviest lift (needs headless Chrome path).
5. **Mastra** wrapping Opus loops — defer until we have ≥3 LLM-driven steps that need shared state.

---

Sources consulted:
- [Hatchet vs Trigger.dev vs Inngest 2026](https://www.pkgpulse.com/blog/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026)
- [Mastra repo](https://github.com/mastra-ai/mastra)
- [Crawlee for SEO 2026](https://mobileproxy.space/en/pages/crawlee-for-web-scraping-in-2026-practical-use-cases-instructions-and-comparisons.html)
- [Voyage vs Jina vs Cohere benchmark 2026](https://pecollective.com/tools/best-embedding-models/)
- [pgvector vs Qdrant 2026](https://www.tigerdata.com/blog/pgvector-vs-qdrant)
- [Vale prose linting](https://www.meilisearch.com/blog/prose-linting-with-vale)
- [Drizzle Supabase RLS](https://orm.drizzle.team/docs/rls)
- [WPGraphQL 2.x](https://www.wpgraphql.com/)
- [Agent framework comparison 2026](https://www.speakeasy.com/blog/ai-agent-framework-comparison)
- [Mastra vs LangGraph TS 2026](https://andrew.ooo/answers/mastra-vs-langgraph-vs-microsoft-agent-framework-2026/)
