# 0002 — Supabase for Postgres, with an explicit keep-alive

- **Date:** 2026-09-23
- **Status:** accepted
- **Decided by:** owner

## Context

The owner raised a real concern: Supabase free-tier projects expire or pause if unused.

Verified: Supabase pauses Free Plan projects after **7 days of low activity**. Data is
retained (restorable for up to a year) but the project goes offline and must be resumed
manually, and the first request after a pause cold-starts in **10–30 seconds**.

Neon was offered as an alternative — it scales to zero but resumes in under 500ms with
no 7-day pause, and this project only needs Postgres, not Supabase's auth/storage/edge
functions.

## Decision

**Stay on Supabase.** The owner already has a working Supabase connection, and it keeps
this project consistent with the direction recorded in
`AI-Automation\_archive\Ads-Platform\research\03-security-architecture.md`.

## Mitigating the pause — this is mandatory, not optional

The pause is a genuine operational risk and the reason Neon was offered. Staying on
Supabase means the mitigation has to actually work:

1. **Normal operation already prevents it.** The scheduler polls the `jobs` table, which
   is database activity, so the inactivity timer never reaches zero while the worker runs.
2. **The gap is when the worker is not running** — the machine is off for a week, or the
   tool simply is not used. Under the MCP-first scope there is no always-on server, so
   this gap is realistic, not theoretical.
3. **Therefore: a weekly keep-alive task.** A `keepalive` command writes a row to a
   `heartbeat` table, registered in **Windows Task Scheduler** — the same mechanism that
   already runs the `SEO-Ops-Daily-simpleonlinecounter` task at 09:00. Weekly, well
   inside the 7-day window.

## Known residual risk

If the machine is off for more than 7 consecutive days, the project pauses regardless —
Task Scheduler cannot run while the machine is off. **No data is lost**, but the project
needs a manual resume from the Supabase dashboard and the first query is slow.

The owner's own objection to a keep-alive was that it is "one more thing that can
silently break." That is correct, so the keep-alive must be **visible when it fails**:
the MCP server reports database reachability and the age of the last heartbeat on
startup, rather than only discovering a paused project mid-publish.

**Revisit if** a pause actually happens more than once, or if the tool ever needs to run
unattended for other people. At that point, migrate to Neon — the schema is portable
Postgres and the migration is not significant work.
