// Public-doc fetcher. Uses the Google Docs HTML export endpoint, which works
// for any doc with "Anyone with the link" sharing. No OAuth required.
//
// Trade-off vs. the official Docs API:
//   + Zero auth surface, deterministic for the demo, parses image refs.
//   - Requires public sharing. For private docs, swap to googleapis with a
//     service account (see lib/google/docs-private.ts.notes in README).
//
// Retry: 3x with jittered backoff. Bounded budget caller-side.

const HTML_EXPORT = (id: string) => `https://docs.google.com/document/d/${id}/export?format=html`;

export function extractDocId(input: string): string {
  const m = input.match(/\/document\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  throw new Error(`Could not extract Google Doc ID from: ${input}`);
}

export interface FetchResult {
  html: string;
  bytes: number;
}

export async function fetchDocHtml(docId: string, opts: { maxAttempts?: number } = {}): Promise<FetchResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(HTML_EXPORT(docId), {
        redirect: 'follow',
        headers: { 'User-Agent': 'scalerrs-demo/1.0 (+content-qa)' },
      });
      if (!res.ok) {
        throw new Error(`Google export ${res.status} ${res.statusText}`);
      }
      const html = await res.text();
      return { html, bytes: html.length };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoff = 250 * Math.pow(2, attempt - 1) + Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`Doc fetch failed after ${maxAttempts} attempts: ${(lastErr as Error)?.message ?? lastErr}`);
}
