-- The runs table originally tracked an Inngest run id. We migrated to
-- Vercel Workflow DevKit, which has its own run id format. Rename the
-- column to be orchestrator-agnostic.
alter table public.runs rename column inngest_run_id to external_run_id;
