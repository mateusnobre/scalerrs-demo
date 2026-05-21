import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'scalerrs-demo',
  // Inngest dev server picks this up locally; prod uses INNGEST_SIGNING_KEY.
});

// Strongly typed event map keeps the worker honest.
export type Events = {
  'article/process.requested': {
    data: {
      article_id: string;
      org_id: string;
      gdoc_url: string;
    };
  };
  'article/fix.alt-tags': {
    data: { article_id: string; org_id: string };
  };
  'article/fix.meta': {
    data: { article_id: string; org_id: string; field: 'meta_title' | 'meta_description' };
  };
  'article/rehost.images': {
    data: { article_id: string; org_id: string };
  };
  'article/publish.wordpress': {
    data: { article_id: string; org_id: string };
  };
  'article/suggest.links': {
    data: { article_id: string; org_id: string };
  };
  'sitemap/ingest.requested': {
    data: { sitemap_id: string; org_id: string; url: string };
  };
};
