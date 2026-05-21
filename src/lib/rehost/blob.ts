import { put } from '@vercel/blob';

// Re-host non-GDrive (or non-public-GDrive) images on Vercel Blob so the
// published article doesn't break when the source URL rotates or the doc
// owner revokes link sharing.
//
// If BLOB_READ_WRITE_TOKEN is not configured (e.g. local dev without Vercel),
// we mark the image as "would-rehost" instead of failing. The QA panel
// surfaces this as a warning, not an error.

export interface RehostResult {
  original: string;
  hosted: string;
  bytes: number;
  rehosted: boolean;
  skipped_reason?: string;
}

export async function rehostImage(src: string, namespace: string): Promise<RehostResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      original: src,
      hosted: src,
      bytes: 0,
      rehosted: false,
      skipped_reason: 'BLOB_READ_WRITE_TOKEN not configured',
    };
  }
  const res = await fetch(src, { headers: { 'User-Agent': 'scalerrs-demo/1.0 (+image-rehost)' } });
  if (!res.ok) throw new Error(`Image fetch ${res.status} for ${src}`);
  const blob = await res.blob();
  const ext = inferExt(res.headers.get('content-type') ?? '', src);
  const name = `${namespace}/${crypto.randomUUID()}${ext}`;
  const uploaded = await put(name, blob, { access: 'public', addRandomSuffix: false });
  return {
    original: src,
    hosted: uploaded.url,
    bytes: blob.size,
    rehosted: true,
  };
}

function inferExt(contentType: string, src: string): string {
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  const m = src.match(/\.(jpg|jpeg|png|webp|gif)(?:$|\?)/i);
  if (m) return `.${m[1].toLowerCase()}`;
  return '.bin';
}
