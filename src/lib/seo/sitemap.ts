import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';

// Recursive sitemap parser. Handles:
//   - <urlset> (terminal: list of URLs)
//   - <sitemapindex> (recursive: list of child sitemap URLs)
// We bail at depth=3 to avoid pathological loops.

interface UrlEntry {
  loc: string;
  lastmod?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => name === 'url' || name === 'sitemap',
});

export async function fetchSitemap(url: string, depth = 0): Promise<UrlEntry[]> {
  if (depth > 3) return [];
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'scalerrs-demo/1.0 (+sitemap-ingest)' },
  });
  if (!res.ok) throw new Error(`Sitemap fetch ${res.status} for ${url}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as {
    urlset?: { url: { loc: string; lastmod?: string }[] };
    sitemapindex?: { sitemap: { loc: string }[] };
  };

  if (parsed.urlset?.url) {
    return parsed.urlset.url
      .filter((u) => !!u.loc)
      .map((u) => ({ loc: String(u.loc), lastmod: u.lastmod ? String(u.lastmod) : undefined }));
  }
  if (parsed.sitemapindex?.sitemap) {
    const children = parsed.sitemapindex.sitemap.map((s) => String(s.loc)).filter(Boolean);
    const results = await Promise.all(children.map((c) => fetchSitemap(c, depth + 1).catch(() => [])));
    return results.flat();
  }
  return [];
}

export interface UrlSignals {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  canonical: string | null;
  word_count: number;
  index_state: 'indexable' | 'noindex' | 'canonical_drift' | 'fetch_failed';
  http_status: number;
  fetch_error?: string;
}

// Fetch a single URL and extract on-page signals. Bounded by AbortController
// so a slow upstream doesn't pin an Inngest step indefinitely.
export async function extractUrlSignals(url: string, timeoutMs = 8000): Promise<UrlSignals> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'scalerrs-demo/1.0 (+seo-audit)' },
    });
    const status = res.status;
    if (!res.ok) {
      return {
        url,
        title: null,
        h1: null,
        meta_description: null,
        canonical: null,
        word_count: 0,
        index_state: 'fetch_failed',
        http_status: status,
        fetch_error: `${status} ${res.statusText}`,
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $('head title').first().text().trim() || null;
    const meta_description = $('meta[name="description"]').attr('content')?.trim() || null;
    const canonicalRaw = $('link[rel="canonical"]').attr('href')?.trim() || null;
    const canonical = canonicalRaw ? new URL(canonicalRaw, url).toString() : null;
    const h1 = $('h1').first().text().trim() || null;

    const robotsContent = ($('meta[name="robots"]').attr('content') ?? '').toLowerCase();
    const xRobotsTag = (res.headers.get('x-robots-tag') ?? '').toLowerCase();
    const isNoindex = robotsContent.includes('noindex') || xRobotsTag.includes('noindex');

    // Body word count (stripping nav/footer is good-enough heuristic).
    $('script, style, nav, footer, header').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const word_count = text ? text.split(/\s+/).length : 0;

    let index_state: UrlSignals['index_state'] = 'indexable';
    if (isNoindex) index_state = 'noindex';
    else if (canonical && stripFragment(canonical) !== stripFragment(url)) index_state = 'canonical_drift';

    return { url, title, h1, meta_description, canonical, word_count, index_state, http_status: status };
  } catch (err) {
    return {
      url,
      title: null,
      h1: null,
      meta_description: null,
      canonical: null,
      word_count: 0,
      index_state: 'fetch_failed',
      http_status: 0,
      fetch_error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function stripFragment(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}
