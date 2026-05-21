// Probe a Google Drive URL to determine whether it's publicly shared.
//
// Drive doesn't return 4xx for private files — it returns 200 with an HTML
// "Sign in" / "Request access" interstitial. The generic link-health check
// can't catch this, so we have a focused probe that follows redirects and
// inspects content-type + body for the access-denied markers.

const PRIVATE_MARKERS = [
  /you need access/i,
  /request access/i,
  /sign in to continue/i,
  /sign in to your google account/i,
  /you don.{0,3}t have permission/i,
  /no preview available/i,
  /^Sign in - Google/m,
];

const DRIVE_HOSTS = /^(drive|docs)\.google\.com$/i;

export type GDriveVerdict = 'public' | 'private' | 'not_drive' | 'unreachable';

export interface GDriveProbe {
  url: string;
  verdict: GDriveVerdict;
  http_status: number;
  reason?: string;
}

export function isDriveUrl(url: string): boolean {
  try {
    return DRIVE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function probeGDriveAccess(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<GDriveProbe> {
  if (!isDriveUrl(url)) return { url, verdict: 'not_drive', http_status: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (scalerrs-demo/1.0 gdrive-access-probe; +https://scalerrs-demo.vercel.app)',
      },
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return { url, verdict: 'unreachable', http_status: res.status, reason: `${res.status} ${res.statusText}` };
    }
    if (ct.startsWith('image/')) {
      return { url, verdict: 'public', http_status: res.status };
    }
    // HTML response — could be a viewer page (public) or an access-denied
    // interstitial (private). Sniff body for the documented markers.
    const text = await res.text();
    const hit = PRIVATE_MARKERS.find((re) => re.test(text));
    if (hit) {
      return { url, verdict: 'private', http_status: res.status, reason: hit.source };
    }
    return { url, verdict: 'public', http_status: res.status };
  } catch (err) {
    return {
      url,
      verdict: 'unreachable',
      http_status: 0,
      reason: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
