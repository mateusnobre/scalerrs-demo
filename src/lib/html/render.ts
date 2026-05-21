import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';

// Render a WordPress-ready article HTML from the parsed doc.
//
// - Strip presentational cruft (already done in parser).
// - Inject lazy-loading on images.
// - Unwrap GDocs' redirect on links if any leaked through.
// - Wrap product links with rel="sponsored noopener" per WP best-practice.
// - Optionally swap image src per the rehost map.
export interface RenderOptions {
  rehostMap?: Record<string, string>;
  altMap?: Record<string, string>;
}

export function renderArticleHtml(doc: ParsedDoc, opts: RenderOptions = {}): string {
  const $ = cheerio.load(doc.raw_html, null, false);

  $('img').each((idx, el) => {
    const src = $(el).attr('src') ?? '';
    const id = `img-${idx}`;
    if (opts.rehostMap?.[src]) {
      $(el).attr('src', opts.rehostMap[src]);
    }
    if (opts.altMap?.[id]) {
      $(el).attr('alt', opts.altMap[id]);
    }
    $(el).attr('loading', 'lazy');
    $(el).attr('decoding', 'async');
  });

  $('a[href]').each((_, el) => {
    // Unwrap Google's /url?q=… redirect so the published HTML has the real
    // target — required for WP/Shopify (Google strips the wrapper from
    // crawler view anyway) AND for downstream tools (link-health, Visualizer
    // annotator) to match against the same canonical URL.
    const rawHref = $(el).attr('href') ?? '';
    const href = unwrapGoogleRedirect(rawHref);
    if (href !== rawHref) $(el).attr('href', href);
    if (/andar\.com\/|\/product/i.test(href)) {
      const existing = ($(el).attr('rel') ?? '').split(/\s+/).filter(Boolean);
      const merged = new Set([...existing, 'sponsored', 'noopener']);
      $(el).attr('rel', [...merged].join(' '));
      $(el).attr('target', '_blank');
    }
  });

  return $.html();
}

function unwrapGoogleRedirect(href: string): string {
  try {
    const u = new URL(href, 'https://docs.google.com');
    if (u.hostname.endsWith('google.com') && u.pathname === '/url') {
      const q = u.searchParams.get('q');
      if (q) return q;
    }
    return href;
  } catch {
    return href;
  }
}
