import * as cheerio from 'cheerio';
import type { ParsedDoc, ParsedImage, ParsedLink } from '@/lib/db/types';

// Google's HTML export wraps the doc in inline styles and redirects every
// outbound link through /url?q=...&sa=...&ust=... Unwrap those before scoring.
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

function classifyHost(src: string): ParsedImage['host'] {
  try {
    const u = new URL(src);
    if (u.hostname.includes('googleusercontent.com')) return 'gdrive-content';
    if (u.hostname.includes('drive.google.com')) return 'gdrive';
    return 'other';
  } catch {
    return 'other';
  }
}

const PRODUCT_LINK_HINTS = [
  /andar\.com\//i,
  /\/product/i,
  /\/products?\//i,
  /\/shop\//i,
  /\/store\//i,
  /shopify\.com/i,
];

function isProductLink(href: string): boolean {
  return PRODUCT_LINK_HINTS.some((re) => re.test(href));
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export interface ParseResult {
  doc: ParsedDoc;
}

// Parse Google's exported HTML into structured ArticleDoc.
// Heuristics:
//   - Meta title:        first paragraph that starts with "Meta Title:" OR first H1.
//   - Meta description:  paragraph that starts with "Meta Description:".
//   - Article title:     first H1 after meta block (or first H1 overall).
//   - Body HTML:         everything else, stripped of GDocs' inline style cruft.
export function parseGoogleDocHtml(html: string): ParseResult {
  const $ = cheerio.load(html);

  // Strip Google's body-level wrapper styles but keep semantic structure.
  $('style, script, meta, link').remove();

  const docTitle = $('title').first().text().trim() || 'Untitled';

  let metaTitle: string | null = null;
  let metaDescription: string | null = null;
  let articleTitle: string | null = null;

  // Extract Meta Title / Meta Description from inline "Meta Title:" lines.
  $('p, h1, h2, h3, h4').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    if (!metaTitle && lower.startsWith('meta title:')) {
      metaTitle = text.replace(/^meta title:\s*/i, '').trim();
      $(el).remove();
    } else if (!metaDescription && lower.startsWith('meta description:')) {
      metaDescription = text.replace(/^meta description:\s*/i, '').trim();
      $(el).remove();
    }
  });

  // Article title: first h1, else first significant heading, else first paragraph.
  const h1 = $('h1').first();
  if (h1.length) {
    articleTitle = h1.text().trim();
  } else {
    const h2 = $('h2').first();
    if (h2.length) articleTitle = h2.text().trim();
  }

  // Headings inventory
  const headings: { level: number; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const level = Number(el.tagName.replace('h', ''));
    const text = $(el).text().trim();
    if (text) headings.push({ level, text });
  });

  // Images
  const images: ParsedImage[] = [];
  $('img').each((idx, el) => {
    const src = $(el).attr('src') ?? '';
    const alt = ($(el).attr('alt') ?? '').trim() || null;
    if (!src) return;
    images.push({
      id: `img-${idx}`,
      src,
      alt,
      host: classifyHost(src),
      width: Number($(el).attr('width')) || undefined,
      height: Number($(el).attr('height')) || undefined,
    });
  });

  // Links
  const links: ParsedLink[] = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    const href = unwrapGoogleRedirect(raw);
    const text = $(el).text().trim();
    if (!href || href.startsWith('#')) return;
    links.push({
      href,
      text,
      is_product: isProductLink(href),
      is_external: isExternal(href),
    });
  });

  // Body HTML — strip GDocs' style attributes for a clean publish.
  const body = $('body');
  body.find('*').each((_, el) => {
    if (el.type === 'tag') {
      // Drop noisy presentational attrs.
      delete el.attribs['style'];
      delete el.attribs['class'];
      delete el.attribs['id'];
    }
  });
  const rawHtml = body.html() ?? '';
  const text = body.text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const paragraphs = $('p').length;

  const doc: ParsedDoc = {
    title: docTitle,
    meta_title: metaTitle,
    meta_description: metaDescription,
    headings,
    paragraphs,
    word_count: wordCount,
    images,
    links,
    raw_html: rawHtml,
  };

  return { doc };
}
