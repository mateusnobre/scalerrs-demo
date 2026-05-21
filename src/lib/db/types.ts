export type ArticleStatus =
  | 'pending'
  | 'processing'
  | 'ready_for_review'
  | 'published'
  | 'failed';

export type QaSeverity = 'pass' | 'warning' | 'fail';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Article {
  id: string;
  org_id: string;
  created_by: string | null;
  gdoc_id: string;
  gdoc_url: string;
  status: ArticleStatus;
  meta_title: string | null;
  meta_description: string | null;
  article_title: string | null;
  article_html: string | null;
  raw_doc: ParsedDoc | null;
  cost_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ParsedImage {
  id: string;
  src: string;
  alt: string | null;
  host: 'gdrive' | 'gdrive-content' | 'other';
  is_public?: boolean;
  width?: number;
  height?: number;
}

export interface ParsedLink {
  href: string;
  text: string;
  is_product: boolean;
  is_external: boolean;
}

export interface ParsedDoc {
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  headings: { level: number; text: string }[];
  paragraphs: number;
  word_count: number;
  images: ParsedImage[];
  links: ParsedLink[];
  raw_html: string;
}

export interface QaCheck {
  id: string;
  article_id: string;
  org_id: string;
  check_type: string;
  severity: QaSeverity;
  title: string;
  detail: string | null;
  data: Record<string, unknown> | null;
  fix_available: boolean;
  fix_kind: string | null;
  fixed_at: string | null;
  created_at: string;
}

export interface RunStep {
  id: string;
  run_id: string;
  org_id: string;
  name: string;
  status: RunStatus;
  detail: string | null;
  started_at: string | null;
  completed_at: string | null;
  cost_cents: number;
  position: number;
}

export interface Run {
  id: string;
  article_id: string;
  org_id: string;
  // Workflow DevKit's external run id, captured at run-start for cross-referencing.
  external_run_id: string | null;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  cost_cents: number;
  error: string | null;
  created_at: string;
}
