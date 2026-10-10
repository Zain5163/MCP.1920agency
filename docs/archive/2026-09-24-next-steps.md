> **Archived 2026-10-10. Superseded; kept as history, never deleted.** Paths in this file
> are the old layout (`decisions/` is now `docs/decisions/`, and so on). What is true now:
> `STATUS.md` and `START-HERE.md` at the repo root. Items still open here were carried into
> `STATUS.md`.

# AdsPilot — what is built, what is next, what to improve
> **Flaky test (2026-10-02):** `packages/auth` "records last use without failing
> the request" waits a fixed 300 ms for a background write and fails when the
> machine is busy (twice on 2026-10-02, both passed on rerun). Replace the
> sleep with polling for the write.

Updated 2026-09-24. Read `PROJECT-CONTEXT.md` for purpose and decisions, the files in
`decisions/` for why choices were made, and this file for where the work stands.

---

## Built and verified

| Piece | State |
|---|---|
| Facebook Pages | Publishing. Text, photo, multi-photo, video. |
| Instagram | Publishing. Feed, Reels, carousel. |
| Media hosting | Supabase Storage, content-addressed, public URLs verified before use. |
| Token vault | Envelope encryption, tenant bound into the AEAD, no `getToken()` escape hatch. |
| Database | Supabase Postgres, 8 tables, `tenant_id` throughout, UUIDv7 keys. |
| Job queue | Postgres, `FOR UPDATE SKIP LOCKED`, stale-lock reclaim. |
| Scheduler worker | Runs every 5 min via Task Scheduler. Proven: published unattended. |
| Error catalogue | Every failure has code, cause and numbered fix. Enforced by tests. |
| Telemetry | JSONL + Slack, redaction on everything, sink failures cannot break callers. |
| CLI | `connect`, `status`, `post`, `set-db-password`. |
| MCP server | 5 tools, stdio transport, local only. |
| Web dashboard | Next.js 15 + React 19 + Tailwind v4, HMAC session auth. |

**205 tests, 12 workspaces, strict typecheck clean.**

Live proof: 3 posts published to the 1920 Agency Page and Instagram, one of them by the
scheduler with nobody present.

---

## Next — in order

### 1. Tenant isolation, with tests written first
The single most important piece before anyone else touches this. Hosted MCP means many
users on one endpoint; a scoping mistake means one customer's AI posting to another
customer's Page.

Write the failing tests *before* the code:
- user A's token cannot read user B's connections
- user A cannot publish to user B's page even with a valid connection id
- a session for a deleted tenant resolves to nothing
- Postgres RLS holds even if application scoping is bypassed

### 2. HTTP MCP transport
Replace stdio with HTTP so any AI client can connect to one shared URL. Needs
per-request auth, a token per user, and every call resolved to exactly one tenant.

### 3. Real user accounts
Email + password, replacing the single `APP_PASSWORD`. Users see their own usage,
subscription and activity log. The session cookie already carries a tenant id, so this
is additive.

### 4. User-facing activity log
Distinct from internal telemetry. Users see what *they* did; operators see diagnostics.
Never mix the two — an internal log in front of a customer is an information leak.

---

## On hold, deliberately

- **Ads creation** (Meta, Google, TikTok). `..\Meta-Ads-Publisher` already exists and is
  account-agnostic — connect it rather than rebuilding.
- **AI content generation and design system.** Still the piece most likely to disappoint:
  generic output is why these features get switched off. Worth its own research gate.
- **Other platforms** (X, LinkedIn, TikTok, YouTube). Adapters only; the engine is ready.
- **Fumadocs** for documentation. Good fit, but docs written against a moving target get
  rewritten.

---

## Idea backlog

`IDEAS.md` holds the owner's future direction, captured 2026-09-25: platform
previews, carousels in the UI, AI captions from images, cross-platform analytics,
connecting multiple Pages, LinkedIn personal profiles, YouTube, WordPress/CMS
publishing, and a per-client design system.

Nothing there is committed. Items move into this file when chosen.

The one item from that list that is a **current defect rather than a future
feature**: a scheduled post cannot be edited or cancelled from the dashboard. The
capability exists in the MCP server and the data layer; the UI has no button for
it. Until it does, a mistakenly scheduled post will publish.

---

## Improvements worth making

**Correctness**
- Capability limits are all `verified: false` — set from knowledge, not checked against
  live docs. Confirm before anyone relies on them.
- `..\Meta-Ads-Publisher` still pins Graph API v23.0; current is v25.0.

**Reliability**
- The transaction pooler (6543) is intermittently unreachable. Retries handle it, but
  the reconnect path is not yet tested under a real outage.
- Nothing alerts when the scheduler stops running. A silent worker looks identical to an
  empty queue.

**Security**
- The database password was exposed in a chat transcript on 2026-09-24 and **still needs
  rotating**.
- RLS policies are designed but not yet written as migrations.

**Product**
- No way to edit or cancel a scheduled post once queued.
- No retry-by-hand for a failed target.
- The web UI cannot connect accounts; that is still CLI-only.
