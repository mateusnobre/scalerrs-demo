// Re-export the service client under a name that's safe to import from
// Inngest worker code (no next/headers cookie access).
export { createServiceClient } from './service';
