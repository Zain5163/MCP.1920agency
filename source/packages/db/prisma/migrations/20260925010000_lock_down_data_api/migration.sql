-- Close the Supabase Data API against our tables.
--
-- WHY THIS EXISTS
--
-- Prisma creates tables in the `public` schema, and Supabase grants the `anon`
-- and `authenticated` roles full privileges on that schema by default. PostgREST
-- then serves those tables over HTTPS.
--
-- The `anon` key is PUBLIC by design — it is meant to be embedded in browser
-- JavaScript. Before this migration, anyone holding it could SELECT, INSERT,
-- UPDATE, DELETE and TRUNCATE:
--
--   connections  encrypted OAuth credentials for every customer
--   users        email addresses and password hashes
--   api_tokens   MCP bearer-token hashes
--   posts/targets  all customer content
--
-- Verified by querying information_schema.role_table_grants on 2026-09-25: both
-- roles held ALL privileges on every table.
--
-- The application does NOT use PostgREST. It connects directly as the database
-- owner over Postgres, so removing these grants costs nothing.
--
-- TWO LAYERS, DELIBERATELY
--
--   1. REVOKE removes the privileges. This alone closes the hole.
--   2. ENABLE ROW LEVEL SECURITY denies by default if a grant is ever restored —
--      by a future Supabase change, a dashboard click, or another migration.
--
-- RLS is enabled WITHOUT FORCE. The owner therefore still bypasses it, which is
-- what the application relies on. Application-layer tenant scoping (TenantScope)
-- remains the primary control and is tested; this is defence in depth behind it,
-- exactly as the inherited security research specifies.

-- 1. Take away the privileges PostgREST relies on.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;

-- 2. Stop future tables inheriting the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3. Deny by default even if a grant returns. No policies are created, and a
--    table with RLS enabled and no policy denies every non-owner role.
ALTER TABLE public.tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.targets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heartbeat           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_heartbeats  ENABLE ROW LEVEL SECURITY;
