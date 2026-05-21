import { cn } from '@/lib/utils';

const tones = {
  pass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  fail: 'bg-red-500/10 text-red-300 border-red-500/30',
  neutral: 'bg-[var(--bg-3)] text-[var(--fg-1)] border-[var(--border-strong)]',
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  accent: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
