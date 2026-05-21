import type { ParsedDoc, QaSeverity } from '@/lib/db/types';

/**
 * QaProducer — the single seam for QA findings.
 *
 * Each Adapter (rules, readability, critic, link-health) is a Producer with:
 *   - a `namespace` (becomes the check_type prefix — "rule", "readability",
 *     "ai", "links"). One namespace per Adapter; never collide.
 *   - a `produceChecks(doc)` that returns findings WITHOUT the namespace
 *     prefix. The runner glues `${namespace}:${check_type}` for storage.
 *   - an optional `annotate(html, findings)` that returns annotated HTML.
 *     Producers own how their findings are visualised. The Visualizer Module
 *     is a dispatcher that loops Annotators.
 *
 * Why this seam exists:
 *   Previously 4 sibling modules each had bespoke return types AND 4 sibling
 *   Steps in the workflow did the same delete-old/insert-new dance against
 *   qa_checks. That's "one pattern, four times" — repeated friction. With
 *   this seam, persistence collapses into runQaProducer, and new check
 *   kinds are a 30-line adapter file.
 */
export interface QaCheckInput {
  /** Check type WITHOUT the namespace prefix. The runner adds it. */
  check_type: string;
  severity: QaSeverity;
  title: string;
  detail: string;
  data?: Record<string, unknown> | null;
  fix_available?: boolean;
  fix_kind?: string | null;
}

export interface QaProducer {
  readonly namespace: string;
  produceChecks(doc: ParsedDoc): Promise<QaCheckInput[]> | QaCheckInput[];
  /**
   * Optional. Mark the rendered HTML for the Visualizer. The dispatcher
   * passes ONLY this Producer's findings (filtered by namespace) so the
   * Adapter doesn't have to discriminate.
   */
  annotate?(html: string, findings: QaCheckInput[]): string;
}

/**
 * Persist a single Producer's findings. Idempotent — wipes its namespace
 * rows first, then inserts fresh. Returns the count.
 *
 * Lives in the producer module (not the workflow step) so callers across
 * the codebase (workflow steps, the offline `pnpm dump-html` script, tests)
 * share one persistence contract.
 */
export interface PersistDeps {
  delete(filter: { article_id: string; check_type_like: string }): Promise<void>;
  insert(rows: PersistedRow[]): Promise<void>;
}

export interface PersistedRow {
  article_id: string;
  org_id: string;
  check_type: string;
  severity: QaSeverity;
  title: string;
  detail: string | null;
  data: Record<string, unknown> | null;
  fix_available: boolean;
  fix_kind: string | null;
}

export interface RunProducerOptions {
  article_id: string;
  org_id: string;
  persist: PersistDeps;
}

export interface RunProducerResult {
  namespace: string;
  total: number;
  fails: number;
  warnings: number;
  passes: number;
  findings: QaCheckInput[]; // raw findings (without namespace prefix)
}

export async function runProducer(
  producer: QaProducer,
  doc: ParsedDoc,
  opts: RunProducerOptions,
): Promise<RunProducerResult> {
  const findings = await producer.produceChecks(doc);
  await opts.persist.delete({
    article_id: opts.article_id,
    check_type_like: `${producer.namespace}:%`,
  });
  const rows: PersistedRow[] = findings.map((f) => ({
    article_id: opts.article_id,
    org_id: opts.org_id,
    check_type: `${producer.namespace}:${f.check_type}`,
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    data: f.data ?? null,
    fix_available: f.fix_available ?? false,
    fix_kind: f.fix_kind ?? null,
  }));
  if (rows.length > 0) await opts.persist.insert(rows);
  return {
    namespace: producer.namespace,
    total: findings.length,
    fails: findings.filter((f) => f.severity === 'fail').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    passes: findings.filter((f) => f.severity === 'pass').length,
    findings,
  };
}
