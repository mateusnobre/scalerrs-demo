# Context

Shared vocabulary for the Scalerrs demo codebase. Domain terms describe the
*business* surface; architecture terms describe the *code* surface. Stable
names mean an LLM can navigate the repo without reverse-engineering synonyms.

---

## Domain

**Article**
A long-form SEO post the agency wants to ship. Has a primary subject (the
H1's last meaningful noun), zero or more **Image Placeholders**, a meta
title, a meta description, and a publish target (WordPress today; Shopify
next). Materialised in `public.articles`.

**Article Source**
The thing the writer hands over. Two adapters today: a **Google Doc URL**
(public-share required) and a **`.docx` upload**. The system treats both
identically downstream — the only seam is `ArticleSource` itself.

**ParsedDoc**
The normalised intermediate after parsing an Article Source. One shape
regardless of source — headings, paragraphs, links, image markers, meta
title, meta description, raw HTML body.

**QA Check**
A single finding about an Article, persisted to `public.qa_checks`. Every
finding has a `check_type` (namespaced — `rule:`, `readability:`, `ai:`,
`links:`, `seo:`), a severity (`pass | warning | fail`), and an optional
`fix_kind` that wires the **Auto-fix** action.

**QaProducer**
A module that produces QA Checks from a ParsedDoc. The repo ships four
adapters at this seam: `rules` (deterministic), `readability` (retext),
`critic` (Claude editorial), `link-health` (HEAD probes). Each Producer
owns its `check_type` namespace AND its **Annotator** (how to mark the
finding on the rendered HTML).

**Annotator**
The Visualizer contract. Each QaProducer ships an Annotator that takes
the rendered HTML + its findings and returns annotated HTML with `<mark>`
overlays. The Visualizer Module is the dispatcher that loops Annotators.

**Run**
A single execution of the article-processing workflow against an Article.
Has a status (`queued | running | succeeded | failed | cancelled`), a
total cost in cents, and an ordered list of **Run Steps**.

**Run Step**
One row in the live trace shown to reviewers. Materialised in
`public.run_steps`. Steps write their own row via the **RunSession** helper
(see Architecture).

**Image Placeholder**
A `IMAGE N. Alt tag: "..."` string the writer leaves in the doc when they
haven't embedded the image yet. The rule engine flags placeholders that
fail WCAG 1.1.1 (wrong topic, generic, fewer than 3 descriptive words).

**Sitemap / Sitemap URL**
The org's existing corpus, ingested via `sitemap.xml` and stored in
`public.sitemaps` / `public.sitemap_urls`. Drives the
**Internal-Linking Engine**: `pg_trgm` similarity over title + h1 against
the Article's primary subject.

**Internal Link Suggestion**
A target URL + suggested anchor text + similarity score, materialised in
`public.internal_link_suggestions`. Ranked top-N per Article.

**Org / Org Member**
The tenant boundary. Every `articles`, `sitemaps`, `runs`, `qa_checks`,
`internal_link_suggestions` row carries an `org_id`. RLS policies look
the user up in `org_members` (one indexed lookup, no recursive joins).

---

## Architecture

This section uses the LANGUAGE.md terms exactly: **Module · Interface ·
Implementation · Depth · Seam · Adapter · Leverage · Locality**.

**Workflow**
The orchestrator Module. Lives in `src/lib/workflow/process-article.ts`.
Uses Vercel Workflow DevKit's `'use workflow'` directive — sandboxed, no
Node.js, calls only Step functions. The Run is durable: kill the tab and
it resumes server-side from the last memoized Step.

**Step**
A `'use step'` function. Full Node.js access. Auto-memoized by Workflow
DevKit: same args = cached result. The unit of retry. Each Step writes
its own Run Step row via RunSession (see below).

**RunSession**
The Module that owns Run-state bookkeeping. Exposes
`session.step(name, position, lambda)` — the lambda runs as a Workflow
Step; the surrounding code handles begin/end/fail/cost-tracking. Replaces
five thin DB helpers + manual interleaving in the orchestrator.

**ArticleSource**
Discriminated union (`{ kind: 'gdoc', url } | { kind: 'docx', html, doc }`)
shipped by server actions and consumed by the workflow. Adapters: Google
Doc fetcher (public HTML export + cheerio) and `.docx` parser (mammoth +
the same cheerio parser).

**QaProducer**
The architectural seam at the heart of QA. Interface:
`produceChecks(doc: ParsedDoc, org: { id }): Promise<QaCheck[]>`
plus an Annotator (see Domain). Adapters: `rules`, `readability`,
`critic`, `link-health`. The Workflow runs them in parallel via a single
`qa-producers` Step.

**ArticleRenderer**
The Module that produces the final WordPress-ready HTML. Owns a single
cheerio context, runs detectors (FAQ, Article, HowTo, …) in order, injects
JSON-LD blocks once at the end. Replaces three loosely-coupled
transforms that each re-parsed the HTML.

**Visualizer**
Renders the **Annotated HTML** for the Visualizer tab. After the
QaProducer refactor it's a dispatcher Module — for each QA Check it asks
the originating Producer's Annotator to mark the HTML, then composes the
result.

**dispatchWorkflow**
Server-action helper. Wraps the auth + org-lookup + `start(workflowFn,
args)` boilerplate. Server actions become one-liners.

---

## Seam ownership

Each architectural Seam has a single owner:

| Seam | Owner Module | Adapters today |
|------|---------------|----------------|
| ArticleSource | `src/lib/sources/article-source.ts` | gdoc, docx |
| QaProducer    | `src/lib/qa/producer.ts` | rules, readability, critic, link-health |
| Annotator     | each QaProducer | (per-producer) |
| ArticleRenderer | `src/lib/render/article-renderer.ts` | one — collapses old html/seo/* |
| RunSession    | `src/lib/workflow/run-session.ts` | one |

Adding a new source kind, new QA check, or new schema detector touches
exactly one Module + one adapter file.
