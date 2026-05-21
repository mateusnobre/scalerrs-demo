import type { ParsedDoc, QaSeverity } from '@/lib/db/types';

export interface RuleResult {
  check_type: string;
  severity: QaSeverity;
  title: string;
  detail: string;
  data?: Record<string, unknown>;
  fix_available?: boolean;
  fix_kind?: string;
}

const IMAGE_MIN = 3;
const IMAGE_MAX = 8;
const PRODUCT_LINK_MIN = 1;
const PRODUCT_LINK_MAX = 5;

export function runRuleChecks(doc: ParsedDoc): RuleResult[] {
  const results: RuleResult[] = [];

  // Image count
  const imgCount = doc.images.length;
  results.push({
    check_type: 'image_count',
    severity: imgCount < IMAGE_MIN || imgCount > IMAGE_MAX ? 'fail' : 'pass',
    title: `Image count: ${imgCount}`,
    detail: `Target range ${IMAGE_MIN}-${IMAGE_MAX}. Found ${imgCount}.`,
    data: { count: imgCount, min: IMAGE_MIN, max: IMAGE_MAX },
  });

  // Image hosting — GDrive only, and must be publicly shared (heuristic: gdrive-content URLs are pre-resolved by Google, treat as public).
  const nonGdrive = doc.images.filter((i) => i.host === 'other');
  results.push({
    check_type: 'image_hosting',
    severity: nonGdrive.length > 0 ? 'warning' : 'pass',
    title: nonGdrive.length === 0
      ? 'All images hosted on Google Drive'
      : `${nonGdrive.length} image(s) hosted outside Google Drive`,
    detail: nonGdrive.length === 0
      ? 'Every image is served from googleusercontent.com or drive.google.com.'
      : `Non-GDrive image hosts: ${[...new Set(nonGdrive.map((i) => safeHost(i.src)))].join(', ')}`,
    data: { non_gdrive: nonGdrive.map((i) => ({ id: i.id, src: i.src })) },
    fix_available: nonGdrive.length > 0,
    fix_kind: 'rehost_images',
  });

  // Image alt tags
  const missingAlt = doc.images.filter((i) => !i.alt || i.alt.length < 3);
  results.push({
    check_type: 'image_alt_tags',
    severity: missingAlt.length > 0 ? 'fail' : 'pass',
    title: missingAlt.length === 0
      ? 'All images have alt tags'
      : `${missingAlt.length} image(s) missing alt tags`,
    detail: missingAlt.length === 0
      ? 'Every image has descriptive alt text.'
      : `Missing/short alts on images: ${missingAlt.map((i) => i.id).join(', ')}`,
    data: { missing: missingAlt.map((i) => i.id) },
    fix_available: missingAlt.length > 0,
    fix_kind: 'rewrite_alt_tags',
  });

  // Product links
  const productLinks = doc.links.filter((l) => l.is_product);
  results.push({
    check_type: 'product_links',
    severity:
      productLinks.length < PRODUCT_LINK_MIN || productLinks.length > PRODUCT_LINK_MAX ? 'fail' : 'pass',
    title: `Product links: ${productLinks.length}`,
    detail: `Target range ${PRODUCT_LINK_MIN}-${PRODUCT_LINK_MAX}. Found ${productLinks.length}.`,
    data: {
      count: productLinks.length,
      min: PRODUCT_LINK_MIN,
      max: PRODUCT_LINK_MAX,
      links: productLinks.slice(0, 10).map((l) => l.href),
    },
  });

  // Formatting: exactly one H1
  const h1Count = doc.headings.filter((h) => h.level === 1).length;
  results.push({
    check_type: 'heading_h1',
    severity: h1Count === 1 ? 'pass' : 'fail',
    title: `H1 count: ${h1Count}`,
    detail: h1Count === 1 ? 'Exactly one H1 (good).' : 'Article should have exactly one H1.',
    data: { count: h1Count },
  });

  // Formatting: no orphan H3/H4 without an H2 above
  const orphanSubheadings = countOrphanSubheadings(doc.headings);
  results.push({
    check_type: 'heading_hierarchy',
    severity: orphanSubheadings === 0 ? 'pass' : 'warning',
    title:
      orphanSubheadings === 0
        ? 'Heading hierarchy clean'
        : `${orphanSubheadings} heading(s) skip a level`,
    detail:
      orphanSubheadings === 0
        ? 'No H3/H4 without a matching H2 ancestor.'
        : 'Some H3/H4 appear without an H2 ancestor — screen readers and crawlers will flag this.',
    data: { orphans: orphanSubheadings },
  });

  // Meta title / description present + length
  results.push(checkLength('meta_title', 'Meta title', doc.meta_title, 30, 65, 'regenerate_meta_title'));
  results.push(checkLength('meta_description', 'Meta description', doc.meta_description, 120, 160, 'regenerate_meta_description'));

  // Placeholder image markers (writer left "IMAGE N. Alt tag: ..." in body
  // text instead of embedding a real image). Strip tags first because the
  // marker often spans <span>/<a> elements.
  const flat = doc.raw_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const placeholderMatches = [
    ...flat.matchAll(/IMAGE\s*\d+\s*\.?\s*Alt tag:\s*[\u201C\u201D"']([^\u201C\u201D"']+)[\u201C\u201D"']/gi),
  ];
  if (placeholderMatches.length > 0) {
    results.push({
      check_type: 'image_placeholders',
      severity: 'fail',
      title: `${placeholderMatches.length} placeholder image marker(s) in body`,
      detail:
        'The writer left "IMAGE N. Alt tag: ..." text in the doc instead of embedding real images. ' +
        'These need to be replaced with actual <img> elements before publishing.',
      data: { placeholders: placeholderMatches.map((m) => ({ marker: m[0], alt: m[1] })) },
    });
  }

  // Word count
  results.push({
    check_type: 'word_count',
    severity: doc.word_count >= 600 ? 'pass' : 'warning',
    title: `Word count: ${doc.word_count}`,
    detail: doc.word_count >= 600 ? 'Adequate length for SEO.' : 'Under 600 words may underrank.',
    data: { word_count: doc.word_count },
  });

  return results;
}

function safeHost(src: string): string {
  try {
    return new URL(src).hostname;
  } catch {
    return 'unknown';
  }
}

function countOrphanSubheadings(headings: { level: number; text: string }[]): number {
  let lastH2 = -1;
  let orphans = 0;
  headings.forEach((h, idx) => {
    if (h.level === 2) lastH2 = idx;
    if ((h.level === 3 || h.level === 4) && lastH2 === -1) orphans++;
  });
  return orphans;
}

function checkLength(
  check_type: string,
  label: string,
  value: string | null,
  min: number,
  max: number,
  fix_kind: string,
): RuleResult {
  if (!value) {
    return {
      check_type,
      severity: 'fail',
      title: `${label} missing`,
      detail: `${label} is required for WordPress publish.`,
      fix_available: true,
      fix_kind,
    };
  }
  const len = value.length;
  if (len < min || len > max) {
    return {
      check_type,
      severity: 'warning',
      title: `${label} length: ${len}`,
      detail: `${label} should be ${min}-${max} chars; current is ${len}.`,
      data: { length: len, min, max, value },
      fix_available: true,
      fix_kind,
    };
  }
  return {
    check_type,
    severity: 'pass',
    title: `${label}: ${len} chars`,
    detail: 'In recommended range.',
    data: { length: len, value },
  };
}
