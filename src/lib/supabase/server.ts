import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// MUST use getAll/setAll (≥0.6). The deprecated get/set/remove API silently
// drops session cookies through Server Action redirects on Vercel, producing
// an invisible login loop. See: feedback_supabase_ssr_cookie_api.
export function isSupabaseConfigured() {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll in a Server Component — safe to ignore, middleware refreshes.
          }
        },
      },
    },
  );
}
