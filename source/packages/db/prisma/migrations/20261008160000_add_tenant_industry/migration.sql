-- Per-tenant industry (Phase 2 of architecture/2026-10-08-plans-usage-analytics-hosting.md).
-- Owner-approved 2026-10-08.
--
-- ADDITIVE ONLY. One nullable column on tenants, with no default, so Postgres
-- adds it without rewriting the table and every existing tenant reads as "not
-- set". Code built before this migration never selects the column, so applying
-- it first and deploying the code after is safe; the reverse is not (the new
-- Prisma client selects tenants.industry and would fail on a database without it).
--
-- The column holds one fixed code from packages/core/src/domain/industries.ts
-- (INDUSTRIES), never a customer's own description of their business: a fixed
-- list can be counted per industry, and free text could carry personal details
-- into analytics. The CHECK below repeats that list, because Prisma does not
-- model CHECK constraints and the database is the last line if a code path
-- ever writes something else. A test in packages/core/test/industries.test.ts
-- reads this file and fails if the two lists differ, so a new industry means
-- a new migration that replaces this constraint, not a silent mismatch.
--
-- Validating the CHECK scans tenants once under a brief lock; the table is a
-- handful of rows and every one of them is NULL here.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "industry" TEXT;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_industry_known"
  CHECK ("industry" IS NULL OR "industry" IN ('dentist', 'education', 'real_estate', 'ecommerce', 'tool_website', 'agency', 'other'));
