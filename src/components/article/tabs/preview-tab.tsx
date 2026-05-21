'use client';

import { Card, CardContent } from '@/components/ui/card';

export function PreviewTab({ html }: { html: string | null }) {
  return (
    <Card>
      <CardContent className="prose-article p-6">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-[var(--fg-2)]">No HTML rendered yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
