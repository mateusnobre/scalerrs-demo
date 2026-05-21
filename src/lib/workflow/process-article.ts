// Durable article-processing workflow.
//
// Lives on Vercel Workflow DevKit. Each `'use step'` function below is a
// memoized, auto-retried unit. The workflow function below is the sandboxed
// orchestrator — it has no Node.js access, only step calls + workflow
// primitives like `sleep` and `createHook`.
//
// Reads top-to-bottom: every business step is a `session.run(name, position,
// () => fn(), format)` call. The RunSession Module owns begin/end/fail rows,
// cost accumulation, and run finalisation — orchestrator only declares the
// sequence + cost cap.

import { FatalError } from 'workflow';
import { start } from 'workflow/api';
import { createRunSession } from './run-session';
import {
  fetchDocStep,
  loadSourceStep,
  parseAndPersistStep,
  readabilityQaStep,
  ruleQaStep,
  linkHealthQaStep,
  gdriveAccessQaStep,
  aiCriticStep,
  autogenMetaDescStep,
  autogenMetaTitleStep,
  rehostImagesStep,
  renderHtmlStep,
} from './steps/article-steps';
import { suggestInternalLinks } from './suggest-links';

// Hard cap. If a single article costs more than this, the workflow aborts.
const COST_CAP_CENTS = 50;

// Fire the internal-linking engine as a child workflow. Per WDK rule,
// `start()` from inside a workflow must be wrapped in a step.
async function fanOutSuggestLinks(article_id: string, org_id: string) {
  'use step';
  await start(suggestInternalLinks, [article_id, org_id]);
}

export async function processArticle(article_id: string, org_id: string) {
  'use workflow';

  // The ArticleSource (gdoc URL or pre-parsed .docx upload) is reconstituted
  // from the article row. Server actions write the row first, then dispatch
  // the workflow with just (article_id, org_id) — no source plumbing through
  // workflow args.
  const source = await loadSourceStep(article_id);
  const session = createRunSession({ article_id, org_id });
  await session.begin();

  const enforceCostCap = () => {
    if (session.totalCost > COST_CAP_CENTS) {
      throw new FatalError(`Cost cap exceeded ($${(session.totalCost / 100).toFixed(2)})`);
    }
  };

  try {
    const { html, bytes } = await session.run(
      'fetch-doc',
      1,
      () => fetchDocStep(source),
      (r) => ({ detail: `${(r.bytes / 1024).toFixed(1)} KB · ${source.kind}` }),
    );

    const doc = await session.run(
      'parse',
      2,
      () => parseAndPersistStep(article_id, html),
      (d) => ({ detail: `${d.images.length} images, ${d.links.length} links, ${d.word_count} words` }),
    );

    await session.run(
      'rule-qa',
      3,
      () => ruleQaStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.fails} failing · ${r.total} total` }),
    );

    await session.run(
      'readability-qa',
      4,
      () => readabilityQaStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.fails} failing · ${r.total} total` }),
    );

    await session.run(
      'link-health',
      45,
      () => linkHealthQaStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.broken} broken · ${r.warnings} unverifiable · ${r.ok} ok` }),
    );

    await session.run(
      'gdrive-access',
      46,
      () => gdriveAccessQaStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.fails} private / unreachable · ${r.total} total` }),
    );

    await session.run(
      'ai-critic',
      5,
      () => aiCriticStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.issues} editorial issues · ${r.fails} fail`, cost: 2 }),
    );
    enforceCostCap();

    if (!doc.meta_description || doc.meta_description.length < 120) {
      await session.run(
        'autogen-meta-desc',
        6,
        () => autogenMetaDescStep(article_id, doc),
        (r) => ({ detail: `${r.length} chars`, cost: 1 }),
      );
      enforceCostCap();
    }

    if (!doc.meta_title || doc.meta_title.length < 30) {
      await session.run(
        'autogen-meta-title',
        7,
        () => autogenMetaTitleStep(article_id, doc),
        (r) => ({ detail: `${r.length} chars`, cost: 1 }),
      );
      enforceCostCap();
    }

    const { rehostMap } = await session.run(
      'rehost-images',
      8,
      () => rehostImagesStep(article_id, org_id, doc),
      (r) => ({ detail: `${r.rehosted} rehosted` }),
    );

    const render = await session.run(
      'render-html',
      9,
      () => renderHtmlStep(article_id, org_id, doc, rehostMap, session.totalCost),
      (r) => ({ detail: `${(r.bytes / 1024).toFixed(1)} KB` }),
    );

    await session.complete();

    // Fan out: independently-scored internal-link suggestions.
    await fanOutSuggestLinks(article_id, org_id);

    return {
      article_id,
      run_id: session.id,
      cost_cents: session.totalCost,
      html_bytes: render.bytes,
    };
  } catch (err) {
    await session.fail((err as Error).message);
    throw err;
  }
}
