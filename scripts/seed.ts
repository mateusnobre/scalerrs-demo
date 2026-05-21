// Demo seed: makes the dashboard look lived-in on first open.
//
// What gets created (idempotent — re-running wipes and re-seeds):
//   - 2 auth users (andar@demo.com, acme@demo.com) with password 'demo1234!'
//   - Both linked to their orgs via org_members
//   - For Andar:
//       1 ingested sitemap (status=ready) + 10 sitemap_urls with realistic
//         titles/h1s so internal-link suggestions return something interesting.
//       1 already-processed article (status=ready_for_review) with full QA
//         checks, a complete run + run_steps with realistic durations.
//       1 deliberately-failed article (status=failed) with a partial run that
//         died on the AI critic step. This is the target for the Replay stunt.
//
// Usage:
//   pnpm seed
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', override: true });

// Read the rendered HTML + QA findings produced by `pnpm smoke` against the
// assessment doc. Embedding the real artifacts (instead of stub strings)
// makes the Visualizer work on cold open — every overlay is grounded in the
// actual article body the pipeline produced.
function loadSmoke() {
  const htmlPath = 'samples/smoke.html';
  const qaPath = 'samples/smoke.qa.json';
  if (!existsSync(htmlPath) || !existsSync(qaPath)) {
    throw new Error(
      'samples/smoke.{html,qa.json} not found. Run `pnpm smoke` before `pnpm seed`.',
    );
  }
  return {
    html: readFileSync(htmlPath, 'utf8'),
    qa: JSON.parse(readFileSync(qaPath, 'utf8')) as {
      meta_title: string | null;
      meta_description: string | null;
      article_title: string;
      word_count: number;
      image_count: number;
      link_count: number;
      product_links: number;
      qa_rules: Array<{
        check_type: string;
        severity: 'pass' | 'warning' | 'fail';
        title: string;
        detail: string;
        data?: Record<string, unknown>;
        fix_available?: boolean;
        fix_kind?: string;
      }>;
      qa_readability: Array<{
        check_type: string;
        severity: 'pass' | 'warning' | 'fail';
        title: string;
        detail: string;
        data?: Record<string, unknown>;
      }>;
    },
  };
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ANDAR_ORG = '11111111-1111-1111-1111-111111111111';
const ACME_ORG = '22222222-2222-2222-2222-222222222222';
const DEMO_PASSWORD = 'demo1234!';

const ANDAR_SITEMAP_URLS = [
  { url: 'https://www.andar.com/products/the-leather-wallet', title: 'The Leather Wallet — Andar', h1: 'The Leather Wallet' },
  { url: 'https://www.andar.com/products/the-leather-keychain', title: 'The Leather Keychain — Andar', h1: 'The Leather Keychain' },
  { url: 'https://www.andar.com/products/the-leather-belt', title: 'The Leather Belt — Andar', h1: 'The Leather Belt' },
  { url: 'https://www.andar.com/products/the-leather-card-holder', title: 'The Card Holder — Andar', h1: 'The Leather Card Holder' },
  { url: 'https://www.andar.com/products/the-leather-passport', title: 'The Leather Passport Holder — Andar', h1: 'The Passport Holder' },
  { url: 'https://www.andar.com/products/the-leather-dog-leash', title: 'The Leather Dog Leash — Andar', h1: 'The Dog Leash' },
  { url: 'https://www.andar.com/products/the-leather-dog-collar', title: 'The Leather Dog Collar — Andar', h1: 'The Dog Collar' },
  { url: 'https://www.andar.com/blog/leather-care-guide', title: 'How to Care for Full-Grain Leather', h1: 'Leather Care Guide' },
  { url: 'https://www.andar.com/blog/why-full-grain', title: 'Why Full-Grain Leather Outlasts Everything Else', h1: 'Why Full-Grain Leather' },
  { url: 'https://www.andar.com/blog/dog-collar-sizing', title: 'How to Size a Dog Collar Correctly', h1: 'Dog Collar Sizing' },
];

const SAMPLE_DOC_URL = 'https://docs.google.com/document/d/1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY/edit';

async function ensureUser(email: string, orgId: string) {
  // Try to find existing.
  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  let user = existing;
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user!;
    console.log(`  created auth user ${email}`);
  } else {
    // Reset password so the demo password always works.
    await db.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD });
    console.log(`  refreshed auth user ${email}`);
  }
  await db.from('org_members').upsert(
    { user_id: user.id, org_id: orgId, role: 'owner' },
    { onConflict: 'org_id,user_id' },
  );
  return user;
}

async function wipeAndar() {
  // Children cascade via FK on org_id, but be explicit so the order is clear.
  await db.from('internal_link_suggestions').delete().eq('org_id', ANDAR_ORG);
  await db.from('qa_checks').delete().eq('org_id', ANDAR_ORG);
  await db.from('run_steps').delete().eq('org_id', ANDAR_ORG);
  await db.from('runs').delete().eq('org_id', ANDAR_ORG);
  await db.from('article_versions').delete().eq('org_id', ANDAR_ORG);
  await db.from('articles').delete().eq('org_id', ANDAR_ORG);
  await db.from('sitemap_urls').delete().eq('org_id', ANDAR_ORG);
  await db.from('sitemaps').delete().eq('org_id', ANDAR_ORG);
}

async function seedSitemap() {
  const { data: sm, error } = await db
    .from('sitemaps')
    .insert({
      org_id: ANDAR_ORG,
      url: 'https://www.andar.com/sitemap.xml',
      status: 'ready',
      url_count: ANDAR_SITEMAP_URLS.length,
      fetched_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  await db.from('sitemap_urls').insert(
    ANDAR_SITEMAP_URLS.map((u, i) => ({
      sitemap_id: sm.id,
      org_id: ANDAR_ORG,
      url: u.url,
      title: u.title,
      h1: u.h1,
      meta_description: `Discover ${u.h1.toLowerCase()} crafted with full-grain leather.`,
      canonical: u.url,
      word_count: 800 + i * 40,
      index_state: i === 3 ? 'canonical_drift' : i === 7 ? 'noindex' : 'indexable',
      http_status: 200,
      last_fetched_at: new Date(Date.now() - 1000 * 60 * (10 - i)).toISOString(),
    })),
  );
  console.log(`  seeded sitemap with ${ANDAR_SITEMAP_URLS.length} URLs`);
  return sm.id;
}

async function seedReadyArticle(userId: string) {
  const articleId = crypto.randomUUID();
  const startedAt = new Date(Date.now() - 1000 * 60 * 8);
  const { html: smokeHtml, qa: smokeQa } = loadSmoke();

  await db.from('articles').insert({
    id: articleId,
    org_id: ANDAR_ORG,
    created_by: userId,
    gdoc_id: '1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY',
    gdoc_url: SAMPLE_DOC_URL,
    status: 'ready_for_review',
    article_title: smokeQa.article_title,
    meta_title: smokeQa.meta_title,
    meta_description: smokeQa.meta_description,
    cost_cents: 4,
    article_html: smokeHtml,
    raw_doc: {
      title: smokeQa.article_title,
      meta_title: smokeQa.meta_title,
      meta_description: smokeQa.meta_description,
      headings: [{ level: 1, text: smokeQa.article_title }],
      paragraphs: 24,
      word_count: smokeQa.word_count,
      images: [],
      links: [],
      raw_html: smokeHtml,
    },
  });

  // Run + steps with realistic durations totalling ~8.4s.
  const completedAt = new Date(startedAt.getTime() + 8400);
  const { data: run } = await db
    .from('runs')
    .insert({
      article_id: articleId,
      org_id: ANDAR_ORG,
      status: 'succeeded',
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      cost_cents: 4,
    })
    .select('id')
    .single();

  const stepDurations: [string, number, number, string][] = [
    ['fetch-doc', 1, 1200, '42.6 KB exported'],
    ['parse', 2, 80, '0 images, 14 links, 1354 words'],
    ['readability-qa', 25, 220, '3 fail · 5 total'],
    ['rule-qa', 3, 40, '4 failing, 6 passing'],
    ['ai-critic', 4, 4400, '5 editorial issues — fail'],
    ['autogen-meta-desc', 5, 1100, '147 chars'],
    ['rehost-images', 7, 50, '0 of 0 rehosted'],
    ['render-html', 8, 90, '18.9 KB'],
    ['mark-ready', 9, 20, null as unknown as string],
  ];
  let cursor = startedAt.getTime();
  await db.from('run_steps').insert(
    stepDurations.map(([name, pos, ms, detail]) => {
      const s = new Date(cursor).toISOString();
      cursor += ms;
      const e = new Date(cursor).toISOString();
      const cost = name === 'ai-critic' ? 2 : name === 'autogen-meta-desc' ? 1 : 0;
      return {
        run_id: run!.id,
        org_id: ANDAR_ORG,
        name,
        position: pos,
        status: 'succeeded',
        started_at: s,
        completed_at: e,
        cost_cents: cost,
        detail,
      };
    }),
  );

  // Insert every QA finding the real pipeline produced (rules + readability)
  // so the QA tab and the Visualizer agree.
  const ruleRows = smokeQa.qa_rules.map((r) => ({
    article_id: articleId,
    org_id: ANDAR_ORG,
    check_type: r.check_type.startsWith('rule:') ? r.check_type : `rule:${r.check_type}`,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    data: r.data ?? null,
    fix_available: r.fix_available ?? false,
    fix_kind: r.fix_kind ?? null,
  }));
  const readabilityRows = smokeQa.qa_readability.map((r) => ({
    article_id: articleId,
    org_id: ANDAR_ORG,
    check_type: r.check_type,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    data: r.data ?? null,
  }));
  // Plus an AI-critic finding (we can't run the real critic without spending
  // tokens in seed; a representative warning keeps the AI category visible
  // alongside the deterministic checks).
  const aiRows = [
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      check_type: 'ai:filler_phrases',
      severity: 'warning' as const,
      title: 'Filler phrases detected',
      detail: '"delve into the realm of" and "through our meticulous research" weaken authority.',
      fix_available: true,
      fix_kind: 'rewrite_intro',
    },
  ];
  // FAQ JSON-LD finding (we know smoke injected it).
  const seoRows = [
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      check_type: 'seo:faq_schema',
      severity: 'pass' as const,
      title: 'Injected FAQPage JSON-LD with 4 Q&A',
      detail: 'schema.org/FAQPage block emitted before the FAQ heading. SERP eligibility unlocked.',
    },
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      check_type: 'seo:article_schema',
      severity: 'pass' as const,
      title: 'Article JSON-LD emitted',
      detail: 'schema.org/Article block emitted at the top of the body.',
    },
  ];
  await db.from('qa_checks').insert([...ruleRows, ...readabilityRows, ...aiRows, ...seoRows]);

  // Pre-populate internal-link suggestions from the seeded sitemap.
  await db.from('internal_link_suggestions').insert([
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      target_url: 'https://www.andar.com/products/the-leather-dog-collar',
      target_title: 'The Leather Dog Collar — Andar',
      anchor_text: 'The Dog Collar',
      score: 0.812,
      reason: 'Lexical match against article title and H1 (pg_trgm similarity)',
    },
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      target_url: 'https://www.andar.com/blog/dog-collar-sizing',
      target_title: 'How to Size a Dog Collar Correctly',
      anchor_text: 'Dog Collar Sizing',
      score: 0.694,
      reason: 'Lexical match against article title and H1 (pg_trgm similarity)',
    },
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      target_url: 'https://www.andar.com/products/the-leather-dog-leash',
      target_title: 'The Leather Dog Leash — Andar',
      anchor_text: 'The Dog Leash',
      score: 0.487,
      reason: 'Lexical match against article title and H1 (pg_trgm similarity)',
    },
    {
      article_id: articleId,
      org_id: ANDAR_ORG,
      target_url: 'https://www.andar.com/blog/leather-care-guide',
      target_title: 'How to Care for Full-Grain Leather',
      anchor_text: 'Leather Care Guide',
      score: 0.312,
      reason: 'Lexical match against article title and H1 (pg_trgm similarity)',
    },
  ]);

  await db.from('article_versions').insert({
    article_id: articleId,
    org_id: ANDAR_ORG,
    reason: 'initial-render',
    meta_title: 'Best Leather Dog Collars: Pamper Your Pooch In Style!',
    meta_description: "Discover the best leather dog collars…",
    article_title: 'Best Leather Dog Collars',
    article_html: '<h1>Best Leather Dog Collars</h1>',
  });

  console.log('  seeded ready article (id ' + articleId.slice(0, 8) + ')');
}

async function seedFailedArticle(userId: string) {
  const articleId = crypto.randomUUID();
  const startedAt = new Date(Date.now() - 1000 * 60 * 3);
  const failedAt = new Date(Date.now() - 1000 * 60 * 3 + 3700);

  await db.from('articles').insert({
    id: articleId,
    org_id: ANDAR_ORG,
    created_by: userId,
    gdoc_id: '1s0fZsDcXJtiwrqUT1fVInS6q1yCZwVKkyCEGcxUiIYY',
    gdoc_url: SAMPLE_DOC_URL,
    status: 'failed',
    article_title: 'Best Leather Dog Collars (retry me)',
    cost_cents: 2,
  });

  const { data: run } = await db
    .from('runs')
    .insert({
      article_id: articleId,
      org_id: ANDAR_ORG,
      status: 'failed',
      started_at: startedAt.toISOString(),
      completed_at: failedAt.toISOString(),
      cost_cents: 2,
      error: 'AI Gateway timed out after 3 attempts (simulated for the demo)',
    })
    .select('id')
    .single();

  let cursor = startedAt.getTime();
  const seq: [string, number, number, string, 'succeeded' | 'failed'][] = [
    ['fetch-doc', 1, 1200, '42.6 KB exported', 'succeeded'],
    ['parse', 2, 80, '0 images, 14 links', 'succeeded'],
    ['readability-qa', 25, 220, '3 fail · 5 total', 'succeeded'],
    ['rule-qa', 3, 40, '4 failing', 'succeeded'],
    ['ai-critic', 4, 2100, 'AI Gateway timed out after 3 attempts', 'failed'],
  ];
  await db.from('run_steps').insert(
    seq.map(([name, pos, ms, detail, status]) => {
      const s = new Date(cursor).toISOString();
      cursor += ms;
      const e = new Date(cursor).toISOString();
      return {
        run_id: run!.id,
        org_id: ANDAR_ORG,
        name,
        position: pos,
        status,
        started_at: s,
        completed_at: e,
        cost_cents: status === 'succeeded' && name === 'ai-critic' ? 2 : 0,
        detail,
      };
    }),
  );

  console.log('  seeded failed article (id ' + articleId.slice(0, 8) + ') — target for the Replay stunt');
}

async function main() {
  console.log('Seeding…');
  console.log('\n1. Auth users');
  const andarUser = await ensureUser('andar@demo.com', ANDAR_ORG);
  await ensureUser('acme@demo.com', ACME_ORG);

  console.log('\n2. Wiping Andar tenant data');
  await wipeAndar();

  console.log('\n3. Sitemap');
  await seedSitemap();

  console.log('\n4. Ready article');
  await seedReadyArticle(andarUser.id);

  console.log('\n5. Failed article (Replay target)');
  await seedFailedArticle(andarUser.id);

  console.log('\nDone. Sign in at http://localhost:3000/login as:');
  console.log('  andar@demo.com / ' + DEMO_PASSWORD + '  (has data)');
  console.log('  acme@demo.com  / ' + DEMO_PASSWORD + '  (empty — RLS isolation proof)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
