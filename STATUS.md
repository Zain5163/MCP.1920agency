# AdsPilot — status

**Updated 2026-10-10.** The one status file (decision 0011). It replaces the root
`CURRENT-STATE.md`, `NEXT-STEPS.md` and the "next" part of `FUTURE-PLANS.md`; their
full text now lives on the shelves (`docs/product/capabilities.md`,
`docs/product/roadmap.md`, `docs/archive/`). Every "live" line carries the date it
was proven; the evidence is in `PROJECT-LOG.md`, the commit named, or the
architecture doc named.

**Update rule:** a session that changes anything adds a `PROJECT-LOG.md` entry and
updates the affected lines here. Keep this file to about two screens.

---

## 1. Live now (verified)

| Since | What | Evidence |
|---|---|---|
| 2026-09-26 | LinkedIn personal profile: text, image and video posts | PROJECT-LOG 2026-09-26 |
| 2026-10-02 | Scheduled LinkedIn posts sent unattended by the worker | `urn:li:share:7511734273188626432` |
| 2026-10-08 | Facebook, Instagram and YouTube connections renewed through https OAuth on `mcp.1920agency.com` (no YouTube upload yet) | `0b0afef` |
| 2026-09-30 | Meta ads end to end: plan → check → preview → create paused → approve → activate → read results | PROJECT-LOG 2026-09-30 |
| 2026-10-07 | Several ad accounts chosen by name (1920 Agency, Muzaree, GradCollective) | `2e0d45b`, PROJECT-LOG 2026-10-07 |
| 2026-10-02 | Meta performance team (analyst, auditor, activity log) read live; change tools tested, not yet used on a real ad | PROJECT-LOG 2026-10-02 |
| 2026-10-08 | Free and Premium plans, usage metering on every MCP tool, call log, industry column | `docs/architecture/2026-10-08-plans-usage-analytics-hosting.md` |
| 2026-10-08 | Product analytics in PostHog Cloud EU (`mcp_call` and PostHog MCP Analytics) | `b828d1e`, `2d075c7` |
| 2026-10-08 | Shopify connector, hosted: users connect their own store from their AI chat; read, audit, change with approval | `1e03a09`, `ca185a0` |
| 2026-10-08 | Nightly encrypted backups, proven restorable on plain Postgres | `ca185a0` |
| 2026-10-09 | **Server runs everything scheduled** (Phase 3 Stage A): hosted MCP, worker loop, monitor/refresh/backup/keep-alive timers; PC tasks disabled | `2c571fc` |
| 2026-10-10 | Central configuration (name, company, domain, server each written once), released | `142423d` |
| 2026-10-10 | Brand design systems on the server: `list_brands`, `get_brand`, `brand_viewer_link`, private viewer at `/brands` | `ecb5973` |

The full matrix (every platform and feature, built vs proven): `docs/product/capabilities.md`.

## 2. In progress

| What | Who / where | Started |
|---|---|---|
| Workspace organisation: phases 0–4 done 2026-10-10 (docs shelves, this file, backups, branches); phases 5–6 wait for a quiet window with the owner | `docs/architecture/2026-10-10-workspace-organisation-plan.md` | 2026-10-10 |
| `prospect-research` skill (from `AI-Automation\Prospect-Engine`) | another session; uncommitted in `source/apps/mcp/skills-library/adspilot/skills/` | 2026-10-10 |
| GradCollective and Muzaree client work; the Muzaree automation's `field-notes.md` lines | other sessions and the Muzaree tasks; uncommitted `PROJECT-LOG.md`, `WAITING-LIST.md`, `field-notes.md` | 2026-10-08 |
| WordPress connector: deployed 2026-10-08, live test on a real site pending | `docs/architecture/2026-10-08-wordpress-connector-plan.md` | 2026-10-08 |

## 3. Next up (at most 5; the full ranked list is `docs/product/roadmap.md`)

1. **Accounts, checkout and the website** (foundations Phase 4): signup, plan and
   billing state, checkout through Polar, the website and docs. Needs the product name
   for the final domain.
2. **Prove what is built but not yet live:** a first private YouTube upload, a LinkedIn
   document post, a scheduled LinkedIn image post, the WordPress connector on a real site.
3. **Google Business Profile posting** (owner's social priority), waiting on Google's
   access form; then Search Console and Analytics reads (`docs/architecture/google-suite-plan.md`).
4. **Stage B:** the database onto the server (decision 0010), which also ends the
   Supabase keep-alive.
5. **A test database** for the `auth` and `db` suites, and the flaky `auth` test fix
   (Known problems).

## 4. Waiting on others

**Open items: `WAITING-LIST.md`** (who blocks each one, what unblocks it, what is
already built). It stays a separate file until the session editing it commits; then
its rows fold into this section (follow-up in the organisation plan). The largest
today: the product name (#14), the Google Cloud and access steps (#15), OpenRouter
credit (#13), LinkedIn company-page approval (#1).

Organisation follow-ups waiting on the owner: a private GitHub repo for
`AI-Automation\Server-Gate` (decision D4), and phases 5–6 of the organisation plan.

## 5. Recently done (14 days)

| Date | What | Where recorded |
|---|---|---|
| 2026-10-10 | YouTube skills: 11 MIT `yt-*` skills from Jakeschincariol/youtube-agent-skill vendored with a reading note; helpers served as text; server instructions point at them. On branch `youtube-skills`, not merged or released | `source/apps/mcp/skills-library/youtube-agent-skill/NOTICE.md` |
| 2026-10-10 | Workspace organisation phases 0–4: `docs/` shelves, `START-HERE.md` map, this file, backups, merged branches deleted | decision 0011 |
| 2026-10-10 | Brand design systems released with a private signed-link viewer | `ecb5973`, `docs/architecture/2026-10-10-brand-design-systems.md` |
| 2026-10-10 | Central configuration; Google sign-in always shows the account chooser | `b898666`…`db9ea93`, `5a25c11` |
| 2026-10-09 | Stage A complete; account turnaround tools and skill; sales judged on purchases | `2c571fc`, `af13a8d`, `7ff8e5c` |
| 2026-10-09 | Deploy points at the shared Server-Gate instead of Raptor's Caddyfile | `65abade` |
| 2026-10-08 | Plans and usage, analytics, Shopify (phases 0–2c and hosted), WordPress connector, website and store skills, server deployment, backups | architecture docs of 2026-10-08 |
| 2026-10-07 | Several ad accounts by name; 1920 Agency WhatsApp ad extended | PROJECT-LOG 2026-10-07 |
| 2026-10-06 | Skills library refresh; first client account (Muzaree) | PROJECT-LOG 2026-10-06 |
| 2026-10-02/03 | YouTube and LinkedIn documents built, reviewed and fixed; Facebook Page management; Meta performance team | PROJECT-LOG 2026-10-02 and 03 |
| 2026-09-30 | First real Meta campaign; playbooks for eleven ad platforms | PROJECT-LOG 2026-09-30 |

`PROJECT-LOG.md`'s last committed entry is 2026-10-07; the 2026-10-08 to 10-10 work is
recorded in the commits and the status sections of the architecture docs named above.

## 6. Known problems

- **Flaky test:** `packages/auth` "records last use without failing the request"
  (`source/packages/auth/test/api-tokens.test.ts`) waits a fixed 300 ms for a
  background write and fails when the machine is busy. Replace the sleep with polling.
  Still open 2026-10-10.
- The `auth` and `db` suites use the **live** database: run them only at quiet times,
  never in parallel with agents (they starved the pooler on 2026-10-02).
- OpenRouter has **$0 credit**, so `generate_ad_images` fails until the owner adds some.
- The Supabase transaction pooler is intermittently unreachable; retries handle it, but
  the reconnect path has not been tested under a real outage.
- If the Google OAuth client secret changes, every YouTube channel is marked for
  reconnection although fixing the two env values would be enough.
- Facebook and Instagram limits are verified live; other platforms' limits come from
  documentation only.
