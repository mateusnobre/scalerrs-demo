'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { DownloadHtmlButton } from '../download-html-button';

export function HtmlTab({
  html,
  articleTitle,
  metaTitle,
  metaDescription,
  filename,
}: {
  html: string | null;
  articleTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  filename: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>WordPress-ready HTML</CardTitle>
          <CardDescription>
            Copy into the WP block editor or POST to /wp-json/wp/v2/posts.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!html}
            onClick={async () => {
              if (!html) return;
              await navigator.clipboard.writeText(html);
              toast.success('HTML copied to clipboard');
            }}
          >
            <Copy className="size-3.5" /> Copy
          </Button>
          <DownloadHtmlButton
            filename={filename}
            metaTitle={metaTitle}
            metaDescription={metaDescription}
            articleTitle={articleTitle}
            html={html}
            label="Download .html"
          />
        </div>
      </CardHeader>
      <CardContent>
        <pre className="mono max-h-[60vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-4 text-[11px] leading-relaxed text-[var(--fg-1)]">
          {html ?? '(none)'}
        </pre>
      </CardContent>
    </Card>
  );
}
