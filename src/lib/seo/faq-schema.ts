import * as cheerio from 'cheerio';

// Detect an FAQ section in the article and emit schema.org FAQPage JSON-LD.
// Heuristics:
//   - Find a heading whose text matches /faq|frequently asked questions/i.
//   - For each H2/H3 below it (until the next H1/H2 of equal level), treat
//     the heading as a Question and the prose until the next heading as the
//     Answer.
//
// Returns the JSON-LD object and the HTML with a <script type="application/ld+json">
// block injected right after the FAQ section heading.
export interface FaqResult {
  inserted: boolean;
  questions: number;
  jsonld: Record<string, unknown> | null;
  html: string;
}

export function detectAndEmitFaqSchema(html: string): FaqResult {
  const $ = cheerio.load(html, null, false);
  const allHeadings = $('h1, h2, h3, h4').toArray();
  const faqIdx = allHeadings.findIndex((el) => /faq|frequently asked questions/i.test($(el).text()));
  if (faqIdx === -1) return { inserted: false, questions: 0, jsonld: null, html };

  const faqHeading = allHeadings[faqIdx];
  const faqLevel = Number((faqHeading as { tagName: string }).tagName.replace('h', ''));

  const qa: { question: string; answer: string }[] = [];
  for (let i = faqIdx + 1; i < allHeadings.length; i++) {
    const h = allHeadings[i];
    const lvl = Number((h as { tagName: string }).tagName.replace('h', ''));
    if (lvl <= faqLevel) break;
    if (lvl !== faqLevel + 1) continue;
    const question = $(h).text().trim();
    // Collect prose between this heading and the next sibling heading.
    const answerParts: string[] = [];
    let cur = $(h).next();
    while (cur.length && !/^h[1-6]$/i.test((cur[0] as { tagName: string }).tagName)) {
      const t = cur.text().trim();
      if (t) answerParts.push(t);
      cur = cur.next();
    }
    const answer = answerParts.join(' ').replace(/\s+/g, ' ').trim();
    if (question && answer) qa.push({ question, answer });
  }

  if (qa.length === 0) return { inserted: false, questions: 0, jsonld: null, html };

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };

  const script = `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`;
  $(faqHeading).before(script);
  return { inserted: true, questions: qa.length, jsonld, html: $.html() };
}
