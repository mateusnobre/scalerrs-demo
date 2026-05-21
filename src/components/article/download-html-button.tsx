'use client';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Download the rendered article HTML as a .html file. Client-side only —
 * we already have the full payload in memory.
 *
 * Includes a `<!doctype html>` wrapper + meta title/description tags so the
 * file is openable in a browser as-is (useful for handing to a reviewer
 * outside the app).
 */
export function DownloadHtmlButton({
  filename,
  metaTitle,
  metaDescription,
  articleTitle,
  html,
  variant = 'outline',
  size = 'sm',
  label = 'Download HTML',
}: {
  filename: string;
  metaTitle: string | null;
  metaDescription: string | null;
  articleTitle: string | null;
  html: string | null;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
}) {
  const disabled = !html;
  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      title={disabled ? 'No HTML rendered yet' : 'Download the WordPress-ready HTML as a .html file'}
      onClick={() => {
        if (!html) return;
        const wrapped = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(articleTitle ?? metaTitle ?? 'article')}</title>
<meta name="title" content="${escape(metaTitle ?? '')}" />
<meta name="description" content="${escape(metaDescription ?? '')}" />
</head>
<body>
${html}
</body>
</html>`;
        const blob = new Blob([wrapped], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitiseFilename(filename) + '.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(`Downloaded ${a.download}`);
      }}
    >
      <Download className="size-3.5" /> {label}
    </Button>
  );
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitiseFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
}
