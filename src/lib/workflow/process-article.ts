// Durable article-processing workflow.
//
// Lives on Vercel Workflow DevKit. Each `'use step'` function below is a
// memoized, auto-retried unit. The workflow function below is the sandboxed
// orchestrator — it has no Node.js access, only step calls + workflow
// primitives like `sleep` and `createHook`.
//
// Why Workflow DevKit (not an external orchestrator):
//   - No `someOrchestrator.createFunction({...}, handler)` boilerplate.
//   - No `step.run("id", cb)` wrappers — each `'use step'` function is
//     auto-memoized by Workflow.
//   - Fan-out to the internal-linking engine uses `start()` wrapped in a
//     step (per WDK rule: `start()` cannot be called directly in workflow
//     context).
//
// What stayed the same:
//   - Per-step row in `run_steps` so the UI's live trace keeps working.
//   - Per-article snapshot in `article_versions` for full audit history.
//   - $0.50 cost cap (enforced in the orchestrator via FatalError).

import { FatalError } from 'workflow';
import { start } from 'workflow/api';
import {
  createRun,
  beginStep,
  endStep,
  failStepRow,
  finalizeRun,
} from './db-steps';
import {
  fetchDocStep,
  parseAndPersistStep,
  readabilityQaStep,
  ruleQaStep,
  linkHealthQaStep,
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

export async function processArticle(
  article_id: string,
  org_id: string,
  gdoc_url: string,
) {
  'use workflow';

  const run_id = await createRun(article_id, org_id);
  let totalCost = 0;

  const trackCost = (c: number) => {
    totalCost += c;
    if (totalCost > COST_CAP_CENTS) {
      throw new FatalError(`Cost cap exceeded ($${(totalCost / 100).toFixed(2)})`);
    }
  };

  try {
    // 1. fetch (handles both gdoc URL and pre-uploaded .docx sentinel)
    const sFetch = await beginStep(run_id, org_id, 'fetch-doc', 1);
    const { html, bytes } = await fetchDocStep(article_id, gdoc_url);
    await endStep(sFetch, `${(bytes / 1024).toFixed(1)} KB`);

    // 2. parse
    const sParse = await beginStep(run_id, org_id, 'parse', 2);
    const doc = await parseAndPersistStep(article_id, html);
    await endStep(
      sParse,
      `${doc.images.length} images, ${doc.links.length} links, ${doc.word_count} words`,
    );

    // 3. rule QA
    const sRule = await beginStep(run_id, org_id, 'rule-qa', 3);
    const rule = await ruleQaStep(article_id, org_id, doc);
    await endStep(sRule, `${rule.fails} failing · ${rule.total} total`);

    // 4. readability QA
    const sRead = await beginStep(run_id, org_id, 'readability-qa', 4);
    const read = await readabilityQaStep(article_id, org_id, doc);
    await endStep(sRead, `${read.fails} failing · ${read.total} total`);

    // 4.5 link-health QA (HEAD/GET every outbound link, flag 404 etc.)
    const sLink = await beginStep(run_id, org_id, 'link-health', 45);
    const link = await linkHealthQaStep(article_id, org_id, doc);
    await endStep(
      sLink,
      `${link.broken + link.networkError} broken · ${link.rateLimited + link.cfChallenge} unverifiable · ${link.ok} ok`,
    );

    // 5. AI critic
    const sAI = await beginStep(run_id, org_id, 'ai-critic', 5);
    const ai = await aiCriticStep(article_id, org_id, doc);
    trackCost(2);
    await endStep(sAI, `${ai.issues} editorial issues — ${ai.overall}`, 2);

    // 6. autogen meta desc if missing/short
    if (!doc.meta_description || doc.meta_description.length < 120) {
      const sMD = await beginStep(run_id, org_id, 'autogen-meta-desc', 6);
      const r = await autogenMetaDescStep(article_id, doc);
      trackCost(1);
      await endStep(sMD, `${r.length} chars`, 1);
    }

    // 7. autogen meta title if missing/short
    if (!doc.meta_title || doc.meta_title.length < 30) {
      const sMT = await beginStep(run_id, org_id, 'autogen-meta-title', 7);
      const r = await autogenMetaTitleStep(article_id, doc);
      trackCost(1);
      await endStep(sMT, `${r.length} chars`, 1);
    }

    // 8. rehost images
    const sRehost = await beginStep(run_id, org_id, 'rehost-images', 8);
    const { rehostMap, rehosted } = await rehostImagesStep(article_id, org_id, doc);
    await endStep(sRehost, `${rehosted} rehosted`);

    // 9. render final HTML + schema injection
    const sRender = await beginStep(run_id, org_id, 'render-html', 9);
    const render = await renderHtmlStep(article_id, org_id, doc, rehostMap, totalCost);
    await endStep(sRender, `${(render.bytes / 1024).toFixed(1)} KB`);

    // 10. mark ready
    await finalizeRun(run_id, article_id, 'succeeded', totalCost);

    // Fan out: independently scored internal-link suggestions.
    await fanOutSuggestLinks(article_id, org_id);

    return { article_id, run_id, cost_cents: totalCost, html_bytes: render.bytes };
  } catch (err) {
    const msg = (err as Error).message;
    await finalizeRun(run_id, article_id, 'failed', totalCost, msg);
    throw err;
  }
}
