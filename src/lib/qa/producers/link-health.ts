import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';
import { checkLinkHealth, summarise } from '@/lib/qa/link-health';
import type { QaCheckInput, QaProducer } from '@/lib/qa/producer';

export const linkHealthProducer: QaProducer = {
  namespace: 'links',
  async produceChecks(doc: ParsedDoc): Promise<QaCheckInput[]> {
    const probes = await checkLinkHealth(doc.links, { timeoutMs: 7000, concurrency: 6 });
    const s = summarise(probes);
    const findings: QaCheckInput[] = [];
    if (s.broken.length)
      findings.push({
        check_type: 'broken',
        severity: 'fail',
        title: `${s.broken.length} broken link(s) (4xx / 5xx)`,
        detail: s.broken.map((p) => `${p.http_status} ${p.url}`).join(' · '),
        data: { probes: s.broken },
      });
    if (s.networkError.length)
      findings.push({
        check_type: 'network_error',
        severity: 'fail',
        title: `${s.networkError.length} link(s) failed to connect`,
        detail: s.networkError.map((p) => `${p.url} — ${p.error ?? 'timeout'}`).join(' · '),
        data: { probes: s.networkError },
      });
    if (s.rateLimited.length)
      findings.push({
        check_type: 'rate_limited',
        severity: 'warning',
        title: `${s.rateLimited.length} link(s) rate-limited (429)`,
        detail: 'Could not verify these targets; domain throttled our crawler.',
        data: { probes: s.rateLimited },
      });
    if (s.cfChallenge.length)
      findings.push({
        check_type: 'cf_challenge',
        severity: 'warning',
        title: `${s.cfChallenge.length} link(s) behind Cloudflare bot wall`,
        detail: 'Page returned the CF interstitial. Real users will reach the page; our crawler cannot.',
        data: { probes: s.cfChallenge },
      });
    if (s.ok.length > 0 && findings.length === 0)
      findings.push({
        check_type: 'ok',
        severity: 'pass',
        title: `All ${s.ok.length} links resolve`,
        detail: 'Every outbound link returned 2xx/3xx within the timeout.',
        data: { count: s.ok.length },
      });
    return findings;
  },
  annotate(html, findings): string {
    interface ProbeData {
      url: string;
      http_status: number;
      status: string;
      ms: number;
      error?: string;
    }
    const verdicts = new Map<string, { tone: 'fail' | 'warn'; tip: string }>();
    for (const f of findings) {
      const probes = ((f.data as { probes?: ProbeData[] } | null)?.probes ?? []) as ProbeData[];
      const tone: 'fail' | 'warn' = f.severity === 'fail' ? 'fail' : 'warn';
      for (const p of probes) verdicts.set(p.url, { tone, tip: describeLink(p) });
    }
    if (verdicts.size === 0) return html;
    const $ = cheerio.load(html, null, false);
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = ($a.attr('href') ?? '').trim();
      const v = verdicts.get(href);
      if (!v) return;
      const existing = ($a.attr('class') ?? '').trim();
      const klass = v.tone === 'fail' ? 'qa-mark-fail-link' : 'qa-mark-warn-link';
      $a.attr('class', `${existing} ${klass}`.trim());
      $a.attr('title', v.tip);
      $a.attr('data-tip', v.tip);
    });
    return $.html();
  },
};

function describeLink(p: {
  url: string;
  http_status: number;
  status: string;
  ms: number;
  error?: string;
}): string {
  const lines: string[] = [];
  switch (p.status) {
    case 'broken':
      lines.push('WHAT — Broken link (HTTP ' + p.http_status + ')');
      lines.push(
        'WHY — The link target returned a 4xx or 5xx. Readers who click it land on an error page; Google penalises pages with high broken-link density.',
      );
      lines.push('FIX — Update or remove the link. Re-run QA when fixed.');
      break;
    case 'network_error':
      lines.push('WHAT — Could not connect');
      lines.push(`WHY — ${p.error ?? 'No response'} after ${p.ms}ms. Domain may be dead.`);
      lines.push('FIX — Verify the URL or replace with a working source.');
      break;
    case 'rate_limited':
      lines.push('WHAT — Rate-limited (HTTP 429)');
      lines.push(
        'WHY — The target domain throttled our crawler. Real readers will reach the page; we just could not verify it from this run.',
      );
      lines.push('FIX — Re-run QA later, or accept as-is if you trust the domain.');
      break;
    case 'cf_challenge':
      lines.push('WHAT — Cloudflare bot wall');
      lines.push(
        'WHY — Page returned the "Verifying your connection" interstitial. Real browsers pass it; our crawler does not.',
      );
      lines.push('FIX — Treat as unverified, not broken.');
      break;
    default:
      lines.push(`HTTP ${p.http_status} · ${p.ms}ms`);
  }
  return lines.join('\n');
}
