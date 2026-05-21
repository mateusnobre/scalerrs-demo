// RunSession — the Module that owns Run-state bookkeeping.
//
// Replaces five thin functions (createRun, beginStep, endStep, failStepRow,
// finalizeRun) plus manual interleaving in the orchestrator. The orchestrator
// now reads as a flat list of `await session.run('name', N, () => stepFn())`
// calls with business logic inside each lambda.
//
// Locality: step lifecycle (start row, end row, cost tracking, run
// finalisation) lives in one place. Adding a new business step type doesn't
// require knowing the bookkeeping shape.
//
// Note: `session.run()` itself is NOT a `'use step'` function — it's a
// plain workflow-context helper that calls beginStep + the lambda + endStep
// in sequence. The lambda is expected to call its own Step(s) or workflow
// primitives.

import { createRun, beginStep, endStep, failStepRow, finalizeRun } from './db-steps';

export interface RunSession {
  /** Initialise the run row. Returns the run id. Must be called once. */
  begin(): Promise<string>;
  /**
   * Run a single Workflow Step under this session. The lambda typically
   * calls a `'use step'` function. The wrapper handles begin/end rows,
   * cost accumulation, and failure persistence.
   *
   * `format(result)` — optional. Returns `{ detail, cost }` to populate the
   * step row. Without it, the trace shows the step name only.
   */
  run<T>(
    name: string,
    position: number,
    fn: () => Promise<T>,
    format?: (result: T) => { detail?: string; cost?: number },
  ): Promise<T>;
  /** Add cost cents to the running total. Throws via the cap check below. */
  addCost(cents: number): number;
  /** Total cost in cents accumulated so far. */
  readonly totalCost: number;
  /** Mark the run + article as succeeded. */
  complete(): Promise<void>;
  /** Mark the run + article as failed with the given error message. */
  fail(error: string): Promise<void>;
  /** The run id. Available only after `begin()`. */
  readonly id: string;
}

export function createRunSession(deps: {
  article_id: string;
  org_id: string;
}): RunSession {
  let runId: string | null = null;
  let totalCost = 0;

  const ensureRunId = (): string => {
    if (!runId) throw new Error('RunSession: begin() not called yet');
    return runId;
  };

  return {
    async begin() {
      runId = await createRun(deps.article_id, deps.org_id);
      return runId;
    },
    get id() {
      return ensureRunId();
    },
    get totalCost() {
      return totalCost;
    },
    addCost(cents) {
      totalCost += cents;
      return totalCost;
    },
    async run(name, position, fn, format) {
      const id = await beginStep(ensureRunId(), deps.org_id, name, position);
      try {
        const result = await fn();
        const f = format?.(result);
        if (f?.cost) totalCost += f.cost;
        await endStep(id, f?.detail ?? null, f?.cost ?? 0);
        return result;
      } catch (e) {
        await failStepRow(id, (e as Error).message);
        throw e;
      }
    },
    async complete() {
      await finalizeRun(ensureRunId(), deps.article_id, 'succeeded', totalCost);
    },
    async fail(error) {
      await finalizeRun(ensureRunId(), deps.article_id, 'failed', totalCost, error);
    },
  };
}
