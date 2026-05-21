'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { FindingsStrip } from '../findings-strip';
import type { QaCheck } from '@/lib/db/types';

/**
 * Preview tab — renders the article body with QA annotations overlaid by
 * default. Every red/amber mark has a rich hover tooltip explaining
 * WHAT the issue is, WHY it matters, and how to FIX it.
 *
 * A "Hide annotations" toggle drops back to the clean WordPress-ready
 * payload for visual review without the markup.
 */
export function PreviewTab({
  cleanHtml,
  annotatedHtml,
  checks,
}: {
  cleanHtml: string | null;
  annotatedHtml: string | null;
  checks: QaCheck[];
}) {
  const [showAnnotations, setShowAnnotations] = useState(true);
  const html = showAnnotations ? annotatedHtml : cleanHtml;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <CardDescription>
          {showAnnotations
            ? 'Findings strip above lists every issue. Body marks show the localized ones. Hover any pill or red/amber mark for WHAT / WHY / FIX.'
            : 'Clean preview — the exact HTML WordPress will publish.'}
        </CardDescription>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAnnotations((v) => !v)}
        >
          {showAnnotations ? (
            <>
              <EyeOff className="size-3.5" /> Hide annotations
            </>
          ) : (
            <>
              <Eye className="size-3.5" /> Show annotations
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className={`prose-article ${showAnnotations ? 'qa-annotated' : ''} p-6 pt-0`}>
        {showAnnotations && <FindingsStrip checks={checks} />}
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-[var(--fg-2)]">No HTML rendered yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
