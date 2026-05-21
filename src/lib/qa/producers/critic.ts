import type { ParsedDoc } from '@/lib/db/types';
import { aiCritic } from '@/lib/qa/critic';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';

export const criticProducer: QaProducer = {
  namespace: 'ai',
  async produceChecks(doc: ParsedDoc): Promise<QaCheckInput[]> {
    const report = await aiCritic(doc);
    return report.issues.map((i) => ({
      check_type: i.check_type,
      severity: i.severity,
      title: i.title,
      detail: i.detail,
      fix_available: !!i.fix_kind,
      fix_kind: i.fix_kind,
    }));
  },
  // No annotate(): AI editorial findings span paragraphs and don't map to
  // discrete text spans. They surface in the QA tab + the Visualizer's
  // count chips, but we deliberately don't inject inline marks.
};
