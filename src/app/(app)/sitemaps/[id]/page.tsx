import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SitemapDetail } from '@/components/sitemap/sitemap-detail';

export default async function SitemapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: sitemap } = await supabase.from('sitemaps').select('*').eq('id', id).maybeSingle();
  if (!sitemap) notFound();
  const { data: urls } = await supabase
    .from('sitemap_urls')
    .select('*')
    .eq('sitemap_id', id)
    .order('index_state', { ascending: true })
    .order('url');
  return <SitemapDetail sitemap={sitemap} urls={urls ?? []} />;
}
