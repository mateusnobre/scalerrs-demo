'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FileText, LayoutDashboard, Network, BookOpen, Sparkles } from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Articles', icon: LayoutDashboard, shortcut: '⌘1' },
  { href: '/sitemaps', label: 'Sitemaps', icon: Network, shortcut: '⌘2' },
  { href: '/architecture', label: 'Architecture', icon: BookOpen, shortcut: '⌘3' },
];

export function Sidebar({ orgName }: { orgName: string | null }) {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-1)] px-3 py-4">
      <div className="px-2 pb-4">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles className="size-4 text-[var(--accent)]" />
          Scalerrs · QA
        </p>
        {orgName && (
          <p className="mt-1 text-[11px] uppercase tracking-widest text-[var(--fg-3)]">{orgName}</p>
        )}
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = path === item.href || (item.href !== '/dashboard' && path.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-[var(--bg-3)] text-[var(--fg-0)]'
                  : 'text-[var(--fg-2)] hover:bg-[var(--bg-2)] hover:text-[var(--fg-0)]',
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4" />
                {item.label}
              </span>
              <span className="mono text-[10px] text-[var(--fg-3)]">{item.shortcut}</span>
            </Link>
          );
        })}
        <Link
          href="/articles/new"
          className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-sm text-[var(--fg-1)] hover:bg-[var(--bg-2)] hover:text-[var(--fg-0)]"
        >
          <FileText className="size-4" />
          + New article
        </Link>
      </nav>
      <div className="mt-auto px-2 text-[11px] text-[var(--fg-3)]">
        <p>Press <kbd className="mono rounded border border-[var(--border)] px-1">⌘K</kbd> for commands</p>
      </div>
    </aside>
  );
}
