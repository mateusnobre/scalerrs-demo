import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';
import { isDriveUrl, probeGDriveAccess, type GDriveProbe } from '@/lib/qa/gdrive-access';

const PLACEHOLDER_RE =
  /IMAGE\s*\d+\s*\.?\s*Alt tag:\s*[\u201C\u201D"']([^\u201C\u201D"']+)[\u201C\u201D"']/gi;

export const gdriveAccessProducer: QaProducer = {
  namespace: 'gdrive',
  async produceChecks(doc: ParsedDoc): Promise<QaCheckInput[]> {
    // Collect every Drive URL referenced from the article body — both the
    // anchor hrefs (placeholder "IMAGE N" links wrap the actual Drive URL)
    // and any img[src] that points at Drive.
    const candidates = new Set<string>();
    for (const link of doc.links) if (isDriveUrl(link.href)) candidates.add(link.href);
    for (const img of doc.images) if (isDriveUrl(img.src)) candidates.add(img.src);
    if (candidates.size === 0) return [];

    const probes: GDriveProbe[] = await Promise.all(
      [...candidates].map((u) => probeGDriveAccess(u)),
    );
    const privateUrls = probes.filter((p) => p.verdict === 'private');
    const unreachable = probes.filter((p) => p.verdict === 'unreachable');
    const findings: QaCheckInput[] = [];

    if (privateUrls.length > 0) {
      findings.push({
        check_type: 'private_drive_image',
        severity: 'fail',
        title: `${privateUrls.length} Drive image(s) not publicly shared`,
        detail: privateUrls
          .map((p) => `${p.url} — Drive returned a "Sign in" / "Request access" page (matched: ${p.reason})`)
          .join(' · '),
        data: { probes: privateUrls },
      });
    }
    if (unreachable.length > 0) {
      findings.push({
        check_type: 'unreachable_drive_image',
        severity: 'fail',
        title: `${unreachable.length} Drive image(s) unreachable`,
        detail: unreachable
          .map((p) => `${p.url} — ${p.reason ?? 'no response'}`)
          .join(' · '),
        data: { probes: unreachable },
      });
    }
    return findings;
  },
  annotate(html, findings): string {
    if (findings.length === 0) return html;
    const inaccessible = new Set<string>();
    for (const f of findings) {
      const probes = ((f.data as { probes?: GDriveProbe[] } | null)?.probes ?? []);
      for (const p of probes) inaccessible.add(p.url);
    }
    if (inaccessible.size === 0) return html;
    const $ = cheerio.load(html, null, false);

    // Mark every <a href> pointing at a private Drive URL.
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = ($a.attr('href') ?? '').trim();
      if (!inaccessible.has(href)) return;
      const tip = [
        'WHAT — Google Drive image not publicly shared',
        'WHY — The Drive URL returns a "Sign in" / "Request access" page instead of an image. Readers without Drive access will see a broken / empty image slot.',
        'FIX — Open the file in Drive → Share → set link access to "Anyone with the link" (Viewer).',
      ].join('\n');
      $a.attr('class', `${($a.attr('class') ?? '')} qa-mark-fail-link`.trim());
      $a.attr('title', tip);
      $a.attr('data-tip', tip);
    });

    // For placeholder paragraphs (Google Doc placeholders are "IMAGE N" with
    // the Drive URL on the anchor), also block-mark the paragraph so the
    // problem area is visually unmissable.
    $('p, li, div').each((_, el) => {
      const $el = $(el);
      const hasMarker = PLACEHOLDER_RE.test($el.text());
      PLACEHOLDER_RE.lastIndex = 0;
      if (!hasMarker) return;
      const links = $el.find('a[href]').toArray();
      const hasPrivate = links.some((a) => inaccessible.has(($(a).attr('href') ?? '').trim()));
      if (!hasPrivate) return;
      // Override the rules-producer's red block with a "private drive" tip;
      // both styles share the same .qa-mark-fail-block class but only the
      // newer tip wins (set last).
      const tip = [
        'WHAT — Placeholder image with a private Drive URL',
        'WHY — The "IMAGE N" link points at a Google Drive file that is not publicly shared. Readers will see neither the placeholder text nor the image.',
        'FIX — Set the Drive file to "Anyone with the link" AND embed it as an <img> with descriptive alt before publishing.',
      ].join('\n');
      $el.attr('title', tip);
      $el.attr('data-tip', tip);
    });

    return $.html();
  },
};
