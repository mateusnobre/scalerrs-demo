import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OrgBadge } from '@/components/article/org-badge';
import { SignOutButton } from '@/components/article/sign-out';

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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            Scalerrs · Article QA
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <OrgBadge orgs={orgs} />
            <span className="text-zinc-500">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
