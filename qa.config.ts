// qa.config.ts — e2e + correctness harness for Scalerrs Article QA.
//
// Scalerrs isn't a filter-driven analytics dashboard, so the canonical
// `reconciliation` / `filter-propagation` invariants are reframed:
//   - SOT = Supabase Postgres (same DB the UI reads from).
//   - "Filters" → tenant boundary (RLS by org_id). Exercised by logging
//     in as a second org and asserting empty state.
//   - KPIs = the tally cards on /dashboard + /articles/[id] + /sitemaps/[id].

import type { Page } from '@playwright/test';
// @ts-ignore — global skill path
import { postgres } from '/Users/mateusn/.claude/skills/qa-dashboard/harness/adapters/postgres.mjs';

const pg = postgres();
const ANDAR_ORG_ID = '11111111-1111-1111-1111-111111111111';

export default {
  url: process.env.QA_URL ?? 'https://scalerrs-demo.vercel.app',

  login: {
    flow: async (page: Page) => {
      await page.goto((process.env.QA_URL ?? 'https://scalerrs-demo.vercel.app') + '/login');
      await page.getByTestId('login-email').fill(process.env.QA_EMAIL ?? 'andar@demo.com');
      await page.getByTestId('login-password').fill(process.env.QA_PASS ?? 'demo1234!');
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/dashboard/);
    },
  },
  loginTtlMinutes: 30,
  snapshotTtlMinutes: 0,

  // No UI filters — keep this empty to suppress the filter-propagation
  // and metamorphic combinatoric specs (they'd produce noise here).
  filters: [],

  dateProbe: { from: '2026-01-01', earlierTo: '2026-12-30', laterTo: '2026-12-31' },

  kpis: [
    {
      name: 'Articles',
      selector: '[data-qa=stat-articles]',
      additive: true,
      tolerance: 0,
      absTolerance: 0,
      truth: pg.sql(
        `select count(*)::int as v from articles where org_id = $1`,
        [ANDAR_ORG_ID],
        'v',
      ),
    },
    {
      name: 'Sitemaps',
      selector: '[data-qa=stat-sitemaps]',
      additive: true,
      tolerance: 0,
      absTolerance: 0,
      truth: pg.sql(
        `select count(*)::int as v from sitemaps where org_id = $1`,
        [ANDAR_ORG_ID],
        'v',
      ),
    },
    {
      name: 'Crawled URLs',
      selector: '[data-qa=stat-crawled-urls]',
      additive: true,
      tolerance: 0,
      absTolerance: 0,
      truth: pg.sql(
        `select count(*)::int as v from sitemap_urls where org_id = $1`,
        [ANDAR_ORG_ID],
        'v',
      ),
    },
  ],

  tables: [],
  cohortChecks: [],
  crossCardChecks: [],

  // Schema-stability invariant — required columns must remain.
  schema: {
    enabled: true,
    tables: [
      { name: 'articles', requiredColumns: ['id', 'org_id', 'status', 'source_kind', 'gdoc_url'] },
      { name: 'qa_checks', requiredColumns: ['article_id', 'check_type', 'severity', 'fix_available'] },
      { name: 'runs', requiredColumns: ['article_id', 'status', 'cost_cents', 'external_run_id'] },
      { name: 'sitemap_urls', requiredColumns: ['sitemap_id', 'index_state', 'http_status'] },
    ],
  },

  // Empty-state: signing in as acme@demo.com → no articles, no sitemaps.
  emptyState: {
    enabled: true,
    asUser: { email: 'acme@demo.com', password: 'demo1234!' },
    locator: '[data-qa=empty-state]',
  },

  // Volume baseline: a seeded ready article must carry ≥15 qa_checks rows.
  volume: {
    enabled: true,
    table: 'qa_checks',
    where: `article_id in (select id from articles where org_id = '${ANDAR_ORG_ID}' and status = 'ready_for_review')`,
    minRows: 15,
  },

  fastCheck: { enabled: false },
};
