import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { CommandPalette } from '@/components/shell/command-palette';
import { Badge } from '@/components/ui/badge';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
            Inngest dev: <a href="http://localhost:8288" target="_blank" rel="noreferrer" className="hover:text-[var(--fg-1)]">:8288</a>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
