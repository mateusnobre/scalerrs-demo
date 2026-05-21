import { generateObject, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { ParsedDoc, ParsedImage } from '@/lib/db/types';

// Model selection: route through AI Gateway when available, else direct
// Anthropic provider. Keeping this central so swapping models is one line.
function model() {
  if (process.env.AI_GATEWAY_API_KEY) {
    return 'anthropic/claude-opus-4-7' as const;
  }
  return anthropic('claude-opus-4-7');
}

const CriticSchema = z.object({
  overall_severity: z.enum(['pass', 'warning', 'fail']),
  summary: z.string(),
  issues: z.array(
    z.object({
      check_type: z.string(),
      severity: z.enum(['pass', 'warning', 'fail']),
      title: z.string(),
      detail: z.string(),
      fix_kind: z.string().nullable(),
    }),
  ),
});

export type CriticReport = z.infer<typeof CriticSchema>;

const CRITIC_SYSTEM = `You are a senior SEO editor for a content agency.
You review long-form ecommerce articles before they ship to WordPress.
You catch the things rule-checkers miss:
  - tonal inconsistency
  - over-reliance on filler phrases ("delve into", "in the realm of")
  - keyword stuffing or brand-name over-repetition
  - weak alt text (generic, repetitive, or non-descriptive)
  - shallow product mentions vs. genuine value
  - undefined or hand-wavy claims ("premium", "high quality")
You return concise, actionable feedback. No fluff.`;

export async function aiCritic(doc: ParsedDoc): Promise<CriticReport> {
  const prompt = buildCriticPrompt(doc);
  const { object } = await generateObject({
    model: model(),
    system: CRITIC_SYSTEM,
    schema: CriticSchema,
    prompt,
  });
  return object;
}

function buildCriticPrompt(doc: ParsedDoc): string {
  const headings = doc.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
  const altSummary = doc.images
    .map((i) => `- ${i.id}: alt="${i.alt ?? '(missing)'}" host=${i.host}`)
    .join('\n');
  // Truncate body to keep token usage bounded; the critic only needs structure
  // and a representative sample of prose.
  const bodySample = doc.raw_html.slice(0, 12000);

  return `ARTICLE TITLE: ${doc.title}
META TITLE: ${doc.meta_title ?? '(missing)'}
META DESCRIPTION: ${doc.meta_description ?? '(missing)'}
WORD COUNT: ${doc.word_count}

HEADINGS:
${headings}

IMAGES (${doc.images.length}):
${altSummary}

BODY (truncated to 12k chars):
${bodySample}

Return at most 6 issues. Skip anything a rule-checker already catches
(image count, link count, missing-alt, heading count). Focus on editorial
quality only.`;
}

export async function rewriteAltText(image: ParsedImage, articleTitle: string, surroundingText: string): Promise<string> {
  const { text } = await generateText({
    model: model(),
    system: 'You write concise, descriptive alt text for ecommerce article images. Max 12 words. No "image of" prefix. Plain language.',
    prompt: `Article: ${articleTitle}
Original alt: ${image.alt ?? '(none)'}
Image host: ${image.host}
Surrounding paragraph context:
${surroundingText.slice(0, 600)}

Return ONLY the new alt text, nothing else.`,
  });
  return text.trim().replace(/^["']|["']$/g, '');
}

export async function regenerateMetaTitle(doc: ParsedDoc): Promise<string> {
  const { text } = await generateText({
    model: model(),
    system: 'You write SEO meta titles. 30-65 characters. Front-load the primary keyword. No emojis. No quotes.',
    prompt: `Article title: ${doc.title}
First H1: ${doc.headings.find((h) => h.level === 1)?.text ?? doc.title}
Topic hint from intro: ${doc.raw_html.replace(/<[^>]+>/g, ' ').slice(0, 400)}

Return ONLY the meta title.`,
  });
  return text.trim().replace(/^["']|["']$/g, '');
}

export async function regenerateMetaDescription(doc: ParsedDoc): Promise<string> {
  const { text } = await generateText({
    model: model(),
    system: 'You write SEO meta descriptions. 120-160 characters. One sentence, active voice, includes the primary keyword and a soft CTA. No emojis. No quotes.',
    prompt: `Article title: ${doc.title}
First 400 chars of body:
${doc.raw_html.replace(/<[^>]+>/g, ' ').slice(0, 400)}

Return ONLY the meta description.`,
  });
  return text.trim().replace(/^["']|["']$/g, '');
}
