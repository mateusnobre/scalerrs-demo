// ArticleRenderer — the single Module that turns a ParsedDoc into the
// WordPress-ready HTML payload.
//
// Why this seam exists:
//   The pipeline used to chain renderArticleHtml → detectAndEmitFaqSchema →
//   buildArticleJsonLd → detectHowTo → injectJsonLd in the orchestrator,
//   stringly-coupled. The orchestrator had to know which detectors to call
//   AND in what order. Adding a new schema type (Review, Product) meant
//   editing the orchestrator. That's leak across the seam.
//
// Now: orchestrator says `renderArticle(doc, opts)`. Detectors are private
// dependencies of this module. Adding a new schema kind = a new detector
// import + one line below.

import { renderArticleHtml, type RenderOptions as BaseRenderOptions } from '@/lib/html/render';
import { detectAndEmitFaqSchema } from '@/lib/seo/faq-schema';
import { buildArticleJsonLd, detectHowTo, injectJsonLd, type SchemaEmission } from '@/lib/seo/jsonld';
import type { ParsedDoc } from '@/lib/db/types';

export interface RenderOptions extends BaseRenderOptions {
  publisherName?: string | null;
}

export interface RenderResult {
  /** WordPress-ready HTML with all transforms applied + JSON-LD injected. */
  html: string;
  /** Schema.org blocks emitted (Article + optional FAQ + optional HowTo). */
  schemas: SchemaEmission[];
  /** Detector signals, surfaced so the workflow can write QA pass rows. */
  faq: { injected: boolean; questions: number };
  howTo: { injected: boolean; steps: number };
  /** Bytes of the final HTML payload. */
  bytes: number;
}

export function renderArticle(doc: ParsedDoc, opts: RenderOptions = {}): RenderResult {
  // 1. Body transforms — lazy-loading on <img>, sponsored rel on product
  //    links, alt/rehost swaps. Existing renderArticleHtml stays as the
  //    private impl; this is the only thing the renderer exposes outwards.
  let html = renderArticleHtml(doc, opts);

  // 2. FAQ schema — detector inspects the rendered HTML and injects
  //    <script type="application/ld+json"> before the FAQ heading.
  const faq = detectAndEmitFaqSchema(html);
  html = faq.html;

  // 3. Article schema — always emitted. Missing required fields surface
  //    as `validation_issues` on the SchemaEmission.
  const schemas: SchemaEmission[] = [];
  schemas.push(
    buildArticleJsonLd({
      headline: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
      description: doc.meta_description,
      publisherName: opts.publisherName ?? null,
    }),
  );

  // 4. HowTo schema — opt-in. Detector returns null if the doc isn't a
  //    how-to (no /^how to|steps to|tutorial/i heading + ordered list).
  const howTo = detectHowTo(html);
  if (howTo) schemas.push(howTo);

  // 5. Inject all JSON-LD blocks at the top of the fragment.
  html = injectJsonLd(html, schemas);

  return {
    html,
    schemas,
    faq: { injected: faq.inserted, questions: faq.questions },
    howTo: {
      injected: !!howTo,
      steps: (howTo?.jsonld as { step?: unknown[] } | null)?.step?.length ?? 0,
    },
    bytes: html.length,
  };
}
