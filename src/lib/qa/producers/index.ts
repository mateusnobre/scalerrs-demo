import { rulesProducer } from './rules';
import { readabilityProducer } from './readability';
import { criticProducer } from './critic';
import { linkHealthProducer } from './link-health';
import { gdriveAccessProducer } from './gdrive-access';
import type { QaProducer } from '@/lib/qa/producer';

/**
 * Canonical list of QA Producers, in execution order. Adding a new check
 * kind = one new file in this directory + one entry here.
 */
export const QA_PRODUCERS: QaProducer[] = [
  rulesProducer,
  readabilityProducer,
  linkHealthProducer,
  gdriveAccessProducer,
  criticProducer,
];

export {
  rulesProducer,
  readabilityProducer,
  criticProducer,
  linkHealthProducer,
  gdriveAccessProducer,
};
