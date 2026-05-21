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
    const href = $(el).attr('href') ?? '';
    if (/andar\.com\/|\/product/i.test(href)) {
      const existing = ($(el).attr('rel') ?? '').split(/\s+/).filter(Boolean);
      const merged = new Set([...existing, 'sponsored', 'noopener']);
      $(el).attr('rel', [...merged].join(' '));
      $(el).attr('target', '_blank');
    }
  });

  return $.html();
}
