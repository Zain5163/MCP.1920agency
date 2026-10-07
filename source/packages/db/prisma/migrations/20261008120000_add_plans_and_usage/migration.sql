-- Plans and usage metering (Phase 1 of architecture/2026-10-08-plans-usage-analytics-hosting.md,
-- decision 0009).
--
-- ADDITIVE ONLY. Two new columns on tenants (with a constant default, so Postgres
-- adds them without rewriting the table) and two new tables. Code built before
-- this migration never selects the new columns, so applying it first and
-- deploying the code after is safe; the reverse is not (the new Prisma client
-- selects tenants.plan and would fail on a database without it).
--
-- Every existing tenant starts on Free. The owner's own tenant is set to
-- Premium by a separate, explicit statement after this is applied (see
-- CURRENT-STATE.md), not here: which row is the owner's is a fact about the
-- live database, not about the schema.
--
-- tool_calls never holds a call's arguments, result, tokens or personal data.

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'premium');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'free',
ADD COLUMN     "plan_renews_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tool_calls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "client_name" TEXT,
    "client_version" TEXT,
    "transport" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_months" (
    "tenant_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "notices_shown" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_months_pkey" PRIMARY KEY ("tenant_id","month")
);

-- CreateIndex
CREATE INDEX "tool_calls_tenant_id_created_at_idx" ON "tool_calls"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data sanity the application relies on: a month is 'YYYY-MM' and a count is
-- never negative. Prisma does not model CHECK constraints, so they live here.
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_month_format"
  CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_calls_not_negative"
  CHECK ("calls" >= 0);

-- Same two layers as 20260925010000_lock_down_data_api, for the new tables.
--
-- 1. No Data API access. The default privileges set there should already keep
--    these grants away, but default privileges apply only to objects created by
--    the role that set them; revoking explicitly does not depend on which role
--    runs this migration.
REVOKE ALL ON TABLE public.tool_calls   FROM anon, authenticated;
REVOKE ALL ON TABLE public.usage_months FROM anon, authenticated;

-- 2. Deny by default if a grant ever returns. RLS without FORCE and without
--    policies: the application connects as the owner and bypasses it, and
--    TenantScope remains the primary control.
ALTER TABLE public.tool_calls   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_months ENABLE ROW LEVEL SECURITY;
