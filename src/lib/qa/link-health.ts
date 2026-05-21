import type { ParsedLink } from '@/lib/db/types';

// Probes every unique outbound link in the article and returns its HTTP
// status. Backed by a HEAD request with a GET fallback (some servers return
// 405/501/403 on HEAD). Concurrency-limited so one slow domain can't pin
// the whole step.
//
// Tradeoffs:
//   - We honour redirects (publishers want 301 chains shortened, but for the
//     QA gate "does the URL serve content" is what matters; flag long
//     redirect chains as a separate warning).
//   - Cloudflare-protected sites often return a JS challenge with status 200
//     + an HTML body containing "Verifying your connection...". We detect
//     the literal challenge marker and surface it as a soft warning rather
//     than a hard fail — it's not broken, just inaccessible to our crawler.

export type LinkStatus = 'ok' | 'broken' | 'rate_limited' | 'redirect_chain' | 'cf_challenge' | 'network_error';

export interface LinkProbe {
  url: string;
  http_status: number;
  status: LinkStatus;
  ms: number;
  final_url?: string;
  error?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (scalerrs-link-health/1.0; +https://scalerrs-demo.vercel.app)';

const CF_CHALLENGE_MARKERS = [
  'Verifying your connection',
  '__cf_chl_opt',
  'cf-browser-verification',
];

export async function checkLinkHealth(
  links: ParsedLink[],
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<LinkProbe[]> {
  const timeoutMs = opts.timeoutMs ?? 7000;
  const concurrency = opts.concurrency ?? 6;
  const unique = [
    ...new Set(
      links
        .map((l) => l.href.trim())
        .filter((h) => /^https?:\/\//i.test(h)),
    ),
  ];
  const out: LinkProbe[] = [];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map((u) => probe(u, timeoutMs)));
    out.push(...settled);
  }
  return out;
}

async function probe(url: string, timeoutMs: number): Promise<LinkProbe> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HEAD first — cheap, no body. Fall back to GET on server hostility.
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    }).catch((e) => {
      throw e;
    });
    const needGet =
      res.status === 405 ||
      res.status === 501 ||
      res.status === 403 ||
      res.status === 400;
    if (needGet) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      });
    }
    let status: LinkStatus = 'ok';
    if (res.status === 429) status = 'rate_limited';
    else if (res.status >= 400 || res.status === 0) status = 'broken';

    // Cloudflare JS challenge detection (only on GET that returned HTML)
    if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
      try {
        const text = await res.text();
        if (CF_CHALLENGE_MARKERS.some((m) => text.includes(m))) {
          status = 'cf_challenge';
        }
      } catch {
        /* body read failed; ignore */
      }
    }

    return {
      url,
      http_status: res.status,
      status,
      ms: Date.now() - start,
      final_url: res.url,
    };
  } catch (err) {
    return {
      url,
      http_status: 0,
      status: 'network_error',
      ms: Date.now() - start,
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function summarise(probes: LinkProbe[]) {
  const broken = probes.filter((p) => p.status === 'broken').map((p) => p);
  const rateLimited = probes.filter((p) => p.status === 'rate_limited').map((p) => p);
  const cfChallenge = probes.filter((p) => p.status === 'cf_challenge').map((p) => p);
  const networkError = probes.filter((p) => p.status === 'network_error').map((p) => p);
  const ok = probes.filter((p) => p.status === 'ok').map((p) => p);
  return { broken, rateLimited, cfChallenge, networkError, ok };
}
