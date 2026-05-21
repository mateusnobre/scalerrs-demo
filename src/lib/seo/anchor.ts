// Pick a natural anchor text for an internal-link suggestion.
// Prefers H1, falls back to title, falls back to URL slug humanised.
export function pickAnchor(opts: { title: string | null; h1: string | null; url: string }): string {
  const candidate = (opts.h1 ?? opts.title ?? '').trim();
  if (candidate && candidate.length <= 70) return candidate;
  if (candidate) return candidate.slice(0, 67).trimEnd() + '…';
  try {
    const slug = new URL(opts.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return opts.url;
  }
}
