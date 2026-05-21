import { createServiceClient } from '@/lib/supabase/service';
import type { PersistDeps } from '@/lib/qa/producer';

/**
 * Supabase-backed Adapter for the PersistDeps interface used by runProducer.
 *
 * Lives here (not inline in the workflow step) so:
 *   - the offline `pnpm dump-html` script can pass an in-memory persist
 *   - tests can pass a no-op persist and assert findings directly
 *   - the persistence shape is one place to change, not four
 */
export function supabasePersist(): PersistDeps {
  const db = createServiceClient();
  return {
    async delete({ article_id, check_type_like }) {
      await db
        .from('qa_checks')
        .delete()
        .eq('article_id', article_id)
        .like('check_type', check_type_like);
    },
    async insert(rows) {
      if (rows.length === 0) return;
      await db.from('qa_checks').insert(rows);
    },
  };
}
