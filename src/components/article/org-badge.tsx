'use client';

import { Badge } from '@/components/ui/badge';

export function OrgBadge({ orgs }: { orgs: { id: string; name: string; slug: string }[] }) {
  if (!orgs.length) {
    return <Badge tone="warning">No org membership</Badge>;
  }
  const o = orgs[0];
  return <Badge tone="info">Org: {o.name}</Badge>;
}
