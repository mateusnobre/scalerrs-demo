// qa.config.mjs — e2e + correctness harness for Scalerrs Article QA.
//
// Reconciles UI tallies against the Supabase Postgres source-of-truth.
// "Filters" don't exist as UI controls in this app; tenant isolation
// (RLS by org_id) is the closest analogue, exercised by logging in as
// a second org and asserting the empty-state.

import { postgres } from '/Users/mateusn/.claude/skills/qa-dashboard/harness/adapters/postgres.mjs';

const pg = postgres();
const ANDAR_ORG_ID = '11111111-1111-1111-1111-111111111111';

export default {
  // Dashboard route — the page that hosts the KPI tally cards. Middleware
  // redirects unauthenticated requests to /login, where auth.setup runs.
  url: (process.env.QA_URL ?? 'https://scalerrs-demo.vercel.app') + '/dashboard',

  login: {
    flow: async (page) => {
      await page.goto((process.env.QA_URL ?? 'https://scalerrs-demo.vercel.app') + '/login');
      await page.getByTestId('login-email').fill(process.env.QA_EMAIL ?? 'andar@demo.com');
      await page.getByTestId('login-password').fill(process.env.QA_PASS ?? 'demo1234!');
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/dashboard/);
    },
  },
  loginTtlMinutes: 30,
  snapshotTtlMinutes: 0,

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
      ),
    },
  ],

  tables: [],
  cohortChecks: [],
  crossCardChecks: [],

  schema: {
    enabled: true,
    tables: [
      { name: 'articles', requiredColumns: ['id', 'org_id', 'status', 'source_kind', 'gdoc_url'] },
      { name: 'qa_checks', requiredColumns: ['article_id', 'check_type', 'severity', 'fix_available'] },
      { name: 'runs', requiredColumns: ['article_id', 'status', 'cost_cents', 'external_run_id'] },
      { name: 'sitemap_urls', requiredColumns: ['sitemap_id', 'index_state', 'http_status'] },
    ],
  },

  emptyState: {
    enabled: true,
    asUser: { email: 'acme@demo.com', password: 'demo1234!' },
    locator: '[data-qa=empty-state]',
  },

  volume: {
    enabled: true,
    table: 'qa_checks',
    where: `article_id in (select id from articles where org_id = '${ANDAR_ORG_ID}' and status = 'ready_for_review')`,
    minRows: 15,
  },

  fastCheck: { enabled: false },
};
