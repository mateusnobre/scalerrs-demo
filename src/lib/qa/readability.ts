import { unified } from 'unified';
import retextEnglish from 'retext-english';
import retextReadability from 'retext-readability';
import retextPassive from 'retext-passive';
import retextEquality from 'retext-equality';
import retextSentenceSpacing from 'retext-sentence-spacing';
import { VFile } from 'vfile';
import * as cheerio from 'cheerio';
import type { ParsedDoc } from '@/lib/db/types';

// Server-side Yoast-parity readability scoring via retext.
// Returns a structured set of QA findings that slot into the existing
// rule-engine output shape (RuleResult).
//
// What this catches that the rule-engine doesn't:
//   - reading-level outliers (sentences requiring >12yr education)
//   - passive-voice density
//   - inclusive-language flags (gendered terms, ableist phrasing)
//   - mis-spaced sentence boundaries

export interface ReadabilityFinding {
  check_type: string;
  severity: 'pass' | 'warning' | 'fail';
  title: string;
  detail: string;
  data: Record<string, unknown>;
}

const READABILITY_AGE_TARGET = 16; // grade-12 reading level cap

export async function runReadability(doc: ParsedDoc): Promise<ReadabilityFinding[]> {
  const text = extractPlainText(doc.raw_html);
  if (!text || text.length < 50) return [];

  const file = new VFile({ value: text });
  const processor = unified()
    .use(retextEnglish)
    .use(retextReadability, { age: READABILITY_AGE_TARGET })
    .use(retextPassive)
    .use(retextEquality)
    .use(retextSentenceSpacing);

  // .run (not .process) — we only care about file.messages, not a stringified
  // output, so we don't need a compiler attached.
  const tree = processor.parse(file);
  await processor.run(tree, file);

  const messages = file.messages ?? [];
  const grouped = {
    'retext-readability': messages.filter((m) => m.source === 'retext-readability'),
    'retext-passive': messages.filter((m) => m.source === 'retext-passive'),
    'retext-equality': messages.filter((m) => m.source === 'retext-equality'),
    'retext-sentence-spacing': messages.filter((m) => m.source === 'retext-sentence-spacing'),
  };

  const findings: ReadabilityFinding[] = [];

  // Reading-level findings carry sentence-level positions (start/end offsets
  // into the plain text). We slice each flagged sentence out of the source
  // text and ship it as data.sentences so the Visualizer's annotator can
  // mark whole paragraphs containing them.
  const readingSentences: string[] = [];
  for (const m of grouped['retext-readability']) {
    const start = (m as { place?: { start?: { offset?: number } } }).place?.start?.offset;
    const end = (m as { place?: { end?: { offset?: number } } }).place?.end?.offset;
    if (start != null && end != null && end > start) {
      const sentence = text.slice(start, end).trim();
      if (sentence.length >= 10) readingSentences.push(sentence);
    }
  }
  const readingFinding = summarise(
    'readability:reading_level',
    'Reading level',
    `Sentences requiring more than ${READABILITY_AGE_TARGET}yr education`,
    grouped['retext-readability'],
    { fail: 5, warn: 2 },
  );
  readingFinding.data = {
    ...(readingFinding.data ?? {}),
    sentences: readingSentences,
  };
  findings.push(readingFinding);

  findings.push(
    summarise(
      'readability:passive_voice',
      'Passive voice',
      'Passive constructions (target: under 10% of sentences)',
      grouped['retext-passive'],
      { fail: Math.ceil(estimateSentenceCount(text) * 0.15), warn: Math.ceil(estimateSentenceCount(text) * 0.1) },
    ),
  );

  findings.push(
    summarise(
      'readability:inclusive_language',
      'Inclusive language',
      'Gendered, ableist, or otherwise non-inclusive phrasing',
      grouped['retext-equality'],
      { fail: 3, warn: 1 },
    ),
  );

  findings.push(
    summarise(
      'readability:sentence_spacing',
      'Sentence spacing',
      'Inconsistent spacing between sentences',
      grouped['retext-sentence-spacing'],
      { fail: 5, warn: 1 },
    ),
  );

  // Flesch-Kincaid approximation (avg sentence length + avg syllables/word).
  const flesch = approximateFlesch(text);
  findings.push({
    check_type: 'readability:flesch_score',
    severity: flesch >= 60 ? 'pass' : flesch >= 50 ? 'warning' : 'fail',
    title: `Flesch reading ease ${flesch.toFixed(0)}`,
    detail:
      flesch >= 60
        ? 'Reading ease is in the recommended range (60+).'
        : flesch >= 50
        ? 'Reading ease is fairly difficult (50-59). Consider shorter sentences.'
        : 'Reading ease is too low (<50). Cut sentence length and syllable density.',
    data: { score: Number(flesch.toFixed(1)) },
  });

  return findings;
}

function summarise(
  check_type: string,
  title: string,
  detail: string,
  matches: { message?: string; reason?: string }[],
  thresholds: { fail: number; warn: number },
): ReadabilityFinding {
  const count = matches.length;
  const severity = count >= thresholds.fail ? 'fail' : count >= thresholds.warn ? 'warning' : 'pass';
  return {
    check_type,
    severity,
    title: `${title}: ${count}`,
    detail: count
      ? `${detail}. ${count} occurrence(s) flagged.`
      : `${detail}. No issues found.`,
    data: {
      count,
      examples: matches.slice(0, 5).map((m) => m.reason ?? m.message ?? '').filter(Boolean),
    },
  };
}

function extractPlainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function estimateSentenceCount(text: string): number {
  return Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
}

function approximateFlesch(text: string): number {
  const sentences = estimateSentenceCount(text);
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  return 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, '').replace(/^y/u, '');
  const groups = cleaned.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
