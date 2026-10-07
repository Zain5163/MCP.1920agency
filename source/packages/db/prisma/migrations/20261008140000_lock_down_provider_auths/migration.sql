-- Gives provider_auths the same two layers every other table has
-- (20260925010000_lock_down_data_api). That migration enabled row level security
-- table by table, and provider_auths was created later (20260925101325), so it
-- never got it. It holds the encrypted Google sign-in grants, the most sensitive
-- rows in the database. Found in the Phase 1 review, 2026-10-08.
--
-- The default privileges set by the lockdown should already keep anon and
-- authenticated away from it; revoking explicitly does not depend on that.
-- Owner-approved 2026-10-08. Idempotent: both statements are no-ops if already
-- in effect.
--
-- The REVOKE runs only where the Supabase roles exist, so this migration also
-- applies on a plain Postgres (decision 0010: plain Postgres is the contract).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.provider_auths FROM anon, authenticated;
  END IF;
END
$$;

-- Deny by default if a grant ever returns. Without FORCE, so the application,
-- which connects as the owner, is unaffected; TenantScope stays the primary control.
ALTER TABLE public.provider_auths ENABLE ROW LEVEL SECURITY;
