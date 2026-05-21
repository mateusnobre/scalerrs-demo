import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { CommandPalette } from '@/components/shell/command-palette';
import { Badge } from '@/components/ui/badge';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Graceful degradation: if env vars aren't wired (e.g. fresh Vercel deploy
  // hitting the demo URL), serve the shell with a configure-me notice instead
  // of 500ing.
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-xl rounded-lg border border-[var(--border-strong)] bg-[var(--bg-1)] p-8 text-sm">
          <Badge tone="warning">demo mode</Badge>
          <h1 className="mt-3 text-xl font-semibold">Supabase not configured</h1>
          <p className="mt-2 text-[var(--fg-1)]">
            This deployed instance has no Supabase project attached yet. Public pages render fine:
          </p>
          <ul className="mt-3 list-disc pl-5 text-[var(--fg-1)]">
            <li><Link className="text-[var(--accent)] hover:underline" href="/">Landing</Link></li>
            <li><Link className="text-[var(--accent)] hover:underline" href="/architecture">Architecture</Link></li>
          </ul>
          <p className="mt-4 text-[var(--fg-2)]">
            To run the full stack, clone the repo, follow the README, point a local Supabase at the migrations, and the dashboard wakes up.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberships } = await supabase
    .from('org_members')
    .select('role, orgs(id, name, slug)')
    .eq('user_id', user.id);
  const orgs = (memberships ?? [])
    .map((m) => m.orgs)
    .flat()
    .filter((o): o is { id: string; name: string; slug: string } => !!o);
  const org = orgs[0] ?? null;

  return (
    <div className="flex min-h-screen">
      <Sidebar orgName={org?.name ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-1)] px-5 text-xs">
          <div className="flex items-center gap-3">
            <Badge tone="accent">RLS scoped</Badge>
            <span className="text-[var(--fg-2)]">{user.email}</span>
          </div>
          <div className="text-[var(--fg-3)] mono">
            Workflow DevKit · <code className="text-[var(--fg-2)]">npx workflow web</code>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
