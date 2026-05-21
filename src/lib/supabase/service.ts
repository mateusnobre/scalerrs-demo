import { createClient } from '@supabase/supabase-js';

// Service-role client for Workflow steps. Bypasses RLS, so callers MUST
// pass org_id explicitly on every mutation.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
