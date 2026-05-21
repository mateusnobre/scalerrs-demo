'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function HtmlTab({ html }: { html: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>WordPress-ready HTML</CardTitle>
        <CardDescription>
          Copy into the WP block editor or POST to /wp-json/wp/v2/posts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="mono max-h-[60vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-0)] p-4 text-[11px] leading-relaxed text-[var(--fg-1)]">
          {html ?? '(none)'}
        </pre>
      </CardContent>
    </Card>
  );
}
