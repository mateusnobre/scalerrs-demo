import mammoth from 'mammoth';
import { parseGoogleDocHtml } from '@/lib/google/parser';
import type { ParsedDoc } from '@/lib/db/types';

// .docx upload path.
//
// mammoth converts the Word XML to clean HTML. We then reuse the existing
// Google-Doc parser to extract title / meta / headings / images / links —
// because the agency's "Meta Title: …" / "Meta Description: …" conventions
// are the same regardless of source format.
//
// Trade-off vs. parsing the docx XML directly:
//   + One parser for both source kinds, one rule + readability QA pass.
//   + Robust to docx oddities (mammoth normalises styles, lists, tables).
//   - We lose some semantic info (footnotes, comments) — not used in QA.
export async function parseDocxBuffer(buffer: ArrayBuffer | Uint8Array): Promise<ParsedDoc> {
  const nodeBuf =
    buffer instanceof Uint8Array
      ? Buffer.from(buffer)
      : Buffer.from(new Uint8Array(buffer));
  const result = await mammoth.convertToHtml(
    { buffer: nodeBuf },
    {
      // Normalise heading styles so cheerio sees real <h1>…<h4>.
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Title'] => h1:fresh",
      ],
    },
  );
  // mammoth returns a bare body fragment — the GoogleDoc parser handles that.
  const { doc } = parseGoogleDocHtml(result.value);
  return doc;
}
