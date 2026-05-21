'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { LayoutDashboard, Network, BookOpen, FilePlus2, LogOut, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (!open && (e.metaKey || e.ctrlKey) && /^[1-3]$/.test(e.key)) {
        e.preventDefault();
        const map = { '1': '/dashboard', '2': '/sitemaps', '3': '/architecture' } as const;
        router.push(map[e.key as '1' | '2' | '3']);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, router]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {open && <div cmdk-overlay="" onClick={() => setOpen(false)} />}
      {open && (
        <Command label="Command palette">
          <Command.Input placeholder="Type a command or jump to a page…" autoFocus />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            <Command.Group heading="Jump to">
              <Command.Item onSelect={() => go('/dashboard')}>
                <span className="flex items-center gap-2"><LayoutDashboard className="size-4" /> Articles</span>
                <span className="mono text-[10px] text-[var(--fg-3)]">⌘1</span>
              </Command.Item>
              <Command.Item onSelect={() => go('/sitemaps')}>
                <span className="flex items-center gap-2"><Network className="size-4" /> Sitemaps</span>
                <span className="mono text-[10px] text-[var(--fg-3)]">⌘2</span>
              </Command.Item>
              <Command.Item onSelect={() => go('/architecture')}>
                <span className="flex items-center gap-2"><BookOpen className="size-4" /> Architecture</span>
                <span className="mono text-[10px] text-[var(--fg-3)]">⌘3</span>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Create">
              <Command.Item onSelect={() => go('/articles/new')}>
                <span className="flex items-center gap-2"><FilePlus2 className="size-4" /> New article</span>
              </Command.Item>
              <Command.Item onSelect={() => go('/sitemaps')}>
                <span className="flex items-center gap-2"><Network className="size-4" /> Ingest sitemap</span>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Account">
              <Command.Item
                onSelect={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  window.location.href = '/login';
                }}
              >
                <span className="flex items-center gap-2"><LogOut className="size-4" /> Sign out</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  window.open('https://github.com/mateusnobre', '_blank');
                  setOpen(false);
                }}
              >
                <span className="flex items-center gap-2"><ExternalLink className="size-4" /> View code on GitHub</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      )}
    </>
  );
}
