import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase/server-service';
import { extractDocId, fetchDocHtml } from '@/lib/google/docs';
import { parseGoogleDocHtml } from '@/lib/google/parser';
import { runRuleChecks } from '@/lib/qa/rules';
import { aiCritic, regenerateMetaDescription, regenerateMetaTitle } from '@/lib/qa/critic';
import { renderArticleHtml } from '@/lib/html/render';
import { rehostImage } from '@/lib/rehost/blob';
import { detectAndEmitFaqSchema } from '@/lib/seo/faq-schema';
import type { ParsedDoc } from '@/lib/db/types';

// Budget cap. If a single run costs more than $0.50 worth of model + bytes,
// we abort and mark the article failed. Prevents the "runaway agent" pattern
// where a bad input triggers infinite retries at the LLM layer.
const COST_CAP_CENTS = 50;

// Per-step retry policy (Inngest applies exponentially-backed-off retries
// automatically; we just declare attempts). Combined with the budget cap
// this gives durable execution under flaky upstream APIs.
const RETRIES = 3;

export const processArticle = inngest.createFunction(
  {
    id: 'process-article',
    name: 'Process article',
    retries: RETRIES,
    concurrency: { limit: 5 },
    triggers: [{ event: 'article/process.requested' }],
  },
  async ({ event, step }) => {
    const { article_id, org_id, gdoc_url } = event.data;
    const db = createServiceClient();

    // Create a Run record up-front so the UI can subscribe to it.
    const run = await step.run('create-run', async () => {
      const { data, error } = await db
        .from('runs')
        .insert({
          article_id,
          org_id,
          inngest_run_id: event.id ?? null,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    });

    const runId = run.id;
    const startStep = async (name: string, position: number) => {
      const { data, error } = await db
        .from('run_steps')
        .insert({
          run_id: runId,
          org_id,
          name,
          position,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    };
    const finishStep = async (id: string, detail?: string, cost = 0) => {
      await db
        .from('run_steps')
        .update({
          status: 'succeeded',
          detail: detail ?? null,
          completed_at: new Date().toISOString(),
          cost_cents: cost,
        })
        .eq('id', id);
    };
    const failStep = async (id: string, detail: string) => {
      await db
        .from('run_steps')
        .update({ status: 'failed', detail, completed_at: new Date().toISOString() })
        .eq('id', id);
    };

    let totalCost = 0;
    const trackCost = (c: number) => {
      totalCost += c;
      if (totalCost > COST_CAP_CENTS) {
        throw new Error(`Cost cap exceeded ($${(totalCost / 100).toFixed(2)})`);
      }
    };

    try {
      // 1. Mark article processing
      await step.run('mark-processing', async () => {
        await db.from('articles').update({ status: 'processing' }).eq('id', article_id);
      });

      // 2. Fetch doc (durable retry inside the step)
      const fetched = await step.run('fetch-doc', async () => {
        const stepId = await startStep('fetch-doc', 1);
        try {
          const docId = extractDocId(gdoc_url);
          const result = await fetchDocHtml(docId, { maxAttempts: 3 });
          await finishStep(stepId, `${(result.bytes / 1024).toFixed(1)} KB`);
          return result.html;
        } catch (e) {
          await failStep(stepId, (e as Error).message);
          throw e;
        }
      });

      // 3. Parse
      const parsed: ParsedDoc = await step.run('parse', async () => {
        const stepId = await startStep('parse', 2);
        const { doc } = parseGoogleDocHtml(fetched);
        await db.from('articles').update({
          raw_doc: doc,
          article_title: doc.headings.find((h) => h.level === 1)?.text ?? doc.title,
          meta_title: doc.meta_title,
          meta_description: doc.meta_description,
        }).eq('id', article_id);
        await finishStep(stepId, `${doc.images.length} images, ${doc.links.length} links, ${doc.word_count} words`);
        return doc;
      });

      // 4. Rule QA
      await step.run('rule-qa', async () => {
        const stepId = await startStep('rule-qa', 3);
        const results = runRuleChecks(parsed);
        // Clear stale checks then insert fresh.
        await db.from('qa_checks').delete().eq('article_id', article_id).like('check_type', 'rule:%');
        if (results.length) {
          await db.from('qa_checks').insert(
            results.map((r) => ({
              article_id,
              org_id,
              check_type: `rule:${r.check_type}`,
              severity: r.severity,
              title: r.title,
              detail: r.detail,
              data: r.data ?? null,
              fix_available: r.fix_available ?? false,
              fix_kind: r.fix_kind ?? null,
            })),
          );
        }
        const failCount = results.filter((r) => r.severity === 'fail').length;
        await finishStep(stepId, `${failCount} failing, ${results.length - failCount} passing`);
      });

      // 5. AI critic (in parallel with image rehost). Inngest's step.run
      //    serialises within a function; we await separately so each
      //    failure is checkpointed.
      await step.run('ai-critic', async () => {
        const stepId = await startStep('ai-critic', 4);
        try {
          const report = await aiCritic(parsed);
          trackCost(2); // rough Opus prompt cost estimate
          await db.from('qa_checks').delete().eq('article_id', article_id).like('check_type', 'ai:%');
          if (report.issues.length) {
            await db.from('qa_checks').insert(
              report.issues.map((i) => ({
                article_id,
                org_id,
                check_type: `ai:${i.check_type}`,
                severity: i.severity,
                title: i.title,
                detail: i.detail,
                fix_available: !!i.fix_kind,
                fix_kind: i.fix_kind,
              })),
            );
          }
          await finishStep(stepId, `${report.issues.length} editorial issues — ${report.overall_severity}`, 2);
        } catch (e) {
          await failStep(stepId, (e as Error).message);
          throw e;
        }
      });

      // 6. Auto-regenerate meta if missing/short
      if (!parsed.meta_description || parsed.meta_description.length < 120) {
        await step.run('autogen-meta-desc', async () => {
          const stepId = await startStep('autogen-meta-desc', 5);
          const next = await regenerateMetaDescription(parsed);
          trackCost(1);
          await db.from('articles').update({ meta_description: next }).eq('id', article_id);
          await finishStep(stepId, `${next.length} chars`, 1);
        });
      }
      if (!parsed.meta_title || parsed.meta_title.length < 30) {
        await step.run('autogen-meta-title', async () => {
          const stepId = await startStep('autogen-meta-title', 6);
          const next = await regenerateMetaTitle(parsed);
          trackCost(1);
          await db.from('articles').update({ meta_title: next }).eq('id', article_id);
          await finishStep(stepId, `${next.length} chars`, 1);
        });
      }

      // 7. Image rehost (only the ones flagged as non-GDrive)
      const rehostMap = await step.run('rehost-images', async () => {
        const stepId = await startStep('rehost-images', 7);
        const map: Record<string, string> = {};
        let rehosted = 0;
        for (const img of parsed.images) {
          if (img.host !== 'other') continue;
          try {
            const r = await rehostImage(img.src, `articles/${article_id}`);
            map[img.src] = r.hosted;
            if (r.rehosted) rehosted++;
            trackCost(Math.ceil(r.bytes / 50_000)); // ~1 cent per 50KB
          } catch (e) {
            await db.from('qa_checks').insert({
              article_id,
              org_id,
              check_type: 'rehost:image-fetch-fail',
              severity: 'warning',
              title: `Could not rehost image ${img.id}`,
              detail: (e as Error).message,
            });
          }
        }
        await finishStep(stepId, `${rehosted} of ${parsed.images.filter((i) => i.host === 'other').length} rehosted`);
        return map;
      });

      // 8. Render final HTML + inject FAQ JSON-LD if an FAQ section exists.
      const finalHtml = await step.run('render-html', async () => {
        const stepId = await startStep('render-html', 8);
        const renderedHtml = renderArticleHtml(parsed, { rehostMap });
        const faq = detectAndEmitFaqSchema(renderedHtml);
        const html = faq.html;
        if (faq.inserted) {
          await db.from('qa_checks').insert({
            article_id,
            org_id,
            check_type: 'seo:faq_schema',
            severity: 'pass',
            title: `Injected FAQPage JSON-LD with ${faq.questions} Q&A`,
            detail: 'schema.org/FAQPage block emitted before the FAQ heading. SERP eligibility unlocked.',
            data: { questions: faq.questions },
          });
        }
        await db.from('articles').update({ article_html: html, cost_cents: totalCost }).eq('id', article_id);
        await db.from('article_versions').insert({
          article_id,
          org_id,
          reason: 'initial-render',
          meta_title: parsed.meta_title,
          meta_description: parsed.meta_description,
          article_title: parsed.headings.find((h) => h.level === 1)?.text ?? parsed.title,
          article_html: html,
        });
        await finishStep(stepId, `${(html.length / 1024).toFixed(1)} KB`);
        return html;
      });

      // 9. Done
      await step.run('mark-ready', async () => {
        await db.from('articles').update({ status: 'ready_for_review' }).eq('id', article_id);
        await db.from('runs').update({
          status: 'succeeded',
          completed_at: new Date().toISOString(),
          cost_cents: totalCost,
        }).eq('id', runId);
      });

      // 10. Fan out: ask the internal-linking engine to score this article
      //     against the org's crawled sitemap URLs. Runs as a separate
      //     Inngest function so it can fail/retry independently.
      await step.sendEvent('fanout-suggest-links', {
        name: 'article/suggest.links',
        data: { article_id, org_id },
      });

      return { article_id, run_id: runId, cost_cents: totalCost, html_bytes: finalHtml.length };
    } catch (err) {
      const msg = (err as Error).message;
      await db.from('runs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: msg,
        cost_cents: totalCost,
      }).eq('id', runId);
      await db.from('articles').update({ status: 'failed' }).eq('id', article_id);
      throw err;
    }
  },
);
