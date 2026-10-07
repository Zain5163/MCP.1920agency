# 0010 — Portable database and one-command setup anywhere

**Date:** 2026-10-08
**Status:** accepted direction (owner's request); build is part of Phase 3 in
`architecture/2026-10-08-plans-usage-analytics-hosting.md`.

## The owner's requirement

Never depend on one provider. The whole product (code, database structure,
data) must exist locally as well as on the server. If the server, Supabase or
the MCP breaks, or we rebuild from zero, one command brings the database and the
MCP up on any machine: this PC, the Hetzner server, or a new host.

## Where we stand (checked 2026-10-08)

| Piece | Today | Portable? |
|---|---|---|
| Code | git, pushed to the private GitHub repo `Zain5163/MCP.1920agency` | Yes |
| Database structure | Prisma migrations in `source/packages/db/prisma/migrations` rebuild every table from zero with `migrate deploy` | Almost: `20260925010000_lock_down_data_api` revokes from Supabase's `anon` / `authenticated` roles, which do not exist on plain Postgres, so it fails there. Fix: run those statements only when the roles exist |
| Data | Supabase Postgres, **Singapore** (`ap-southeast-1`), free tier | **No copy anywhere.** The free tier offers no downloadable backups and pauses after 7 days idle (the keepalive exists because of this) |
| Media files | Supabase Storage (`packages/media/src/storage.ts`) | No: Supabase-only API |
| Secrets | `~/.social-publisher/.env` on this PC | Only on this PC |

A practical point for Phase 3: the server is in **Helsinki** and the database in
**Singapore**. Every query would cross the world (a few hundred ms each), and a
tool call makes several. A database next to the MCP on the server removes that.

## Decision

1. **Plain Postgres is the contract.** No feature that only Supabase has. Supabase
   stays usable as "a Postgres host", never as a dependency.
2. **Make the migrations run on any Postgres:** the Supabase role statements are
   guarded (`IF EXISTS` on the role), so `migrate deploy` builds the full schema
   on an empty Postgres 16/17.
3. **Daily backup with a local copy:** a `pg_dump` every night, compressed and
   **encrypted**, kept on the server for 14 days and copied to this PC under
   `%USERPROFILE%\.social-publisher\backups\`. That folder is outside the workspace
   and outside git, because a dump holds customer data and encrypted credentials
   (AGENTS.md: no tokens in the workspace, nothing secret on GitHub). A restore
   is tested monthly, because an untested backup does not count.
4. **One-command setup, in the repo (`deploy/`):**
   - `docker-compose.yml`: Postgres, the hosted MCP, the worker, behind the
     existing Caddy on the server; the same file runs on this PC with Docker.
   - `setup` script: creates the database, runs `migrate deploy`, optionally
     restores the latest backup, and starts everything. Same script for this PC,
     the Hetzner server, or a new host.
   - `.env.example` lists every variable; real values are never in git.
5. **Media files** move to storage we control: a folder on the server served by
   Caddy, or an S3-compatible bucket (Hetzner Object Storage or Cloudflare R2),
   behind the existing storage interface so either can be switched.
6. **Move the data off Supabase when Phase 3 deploys:** database on the Hetzner
   server, next to the MCP. Supabase stays until the move is verified, as the
   fallback.

## What needs the owner

- Approval before the data move and before anything is deployed on the server
  (AGENTS.md).
- Docker Desktop on this PC if the local copy should run as containers (it can
  also run against a plain local Postgres).
- The server disk: CX23 has 40 GB; the database is small today, but the backup
  folder is watched.

## Not decided yet

- Hetzner Object Storage vs Cloudflare R2 vs local disk for media (cost and
  egress; research during Phase 3).
- Whether to keep Supabase as a hot standby after the move.
