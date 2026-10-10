# Workspace organisation plan: AdsPilot and the folders around it

**Date:** 2026-10-10 · **Status:** PROPOSAL. Nothing has been moved, renamed or deleted.
Every step below waits for the owner's approval. (AGENTS.md: preserve active source; destructive
and production changes need explicit approval.)

---

## Summary

**The problem.** AdsPilot works, but it is spread across **9 folders in 3 parts of the
workspace**, plus a home folder on the PC and a server. It goes by **about ten different names**
(Social-Publisher, AdsPilot, MCP.1920agency, MCP-Tooling, social-publisher, adspilot-hosted, …).
At the root of the repo, **11 documents** each describe part of the current status. Several of them
contradict each other: three still say the PC runs the posting, but the server has done that since
9 October. Two live pieces have **no backup off this PC**: the Muzaree ad automation folder and
the Server-Gate repo.

**What large companies do, and what this plan copies:**

1. **One product home with one front door.** Start at `START-HERE.md`. It shows where every part
   of the product lives, on the PC and on the server.
2. **One status file** (`STATUS.md`) for what is true now, what is next and what is waiting.
   Everything else is either history (`PROJECT-LOG.md`) or reference (`docs/`).
3. **A fixed shelf for every kind of document:** decisions, architecture, runbooks, research,
   reviews, policies, brand, archive. The shelf names do not change.
4. **A permanent internal codename that never changes.** Apple and Microsoft name projects
   internally and choose the public name later. Here the codename is `adspilot`, which the server,
   Docker, systemd and the skills library already use. The final public name goes on top as a
   label, so choosing it later does not mean moving folders again.
5. **Separate zones that can see each other:** the product, our own marketing (the "first
   customer"), clients run with the product (Muzaree), and shared server infrastructure (the gate).
6. **Small, reversible steps.** Changes to documents come first and carry no risk. Anything that
   touches running automation comes last, in a quiet window, with a script that can dry-run and
   roll back. That is how the Raptor folder rename was done on 2026-10-09.

**What the owner decides first** is in the "Decisions needed" section near the end. The plan
works even if the answer to the big move (D1) is "no". Phases 1 to 4 give most of the benefit
without moving the code.

---

## 1. The map today

### 1.1 The tree, one line per folder

Legend: **git** = its own repository, and where it is backed up · **LIVE** = something running
depends on it today · **mirror** = copied into the backup repo by `MCP-Tooling/sync.sh`.

```
D:\My AI Works\
├─ .mcp.json ............................ registers the LOCAL MCP "social-publisher" →
│                                          node ...\AI-Automation\Social-Publisher\source\apps\mcp\src\server.ts   LIVE
├─ WORKSPACE-INDEX.md, AGENTS.md ......... workspace entry points (cite Social-Publisher, LinkedIn-Content-Ops)
│
├─ AI-Automation\
│  ├─ Social-Publisher\ .................. THE PRODUCT (AdsPilot). git → GitHub Zain5163/MCP.1920agency, branch master.
│  │  │                                     LIVE: the server runs its code; the local MCP runs from source\
│  │  ├─ source\ ......................... pnpm monorepo: apps mcp, worker, web, cli; 9 packages; skills-library + playbooks served to AIs
│  │  ├─ deploy\ ......................... Dockerfile, compose, release.sh / backup / restore, systemd timers, the gate site file. LIVE (server)
│  │  ├─ integrations\shopify-app\ ....... Shopify app config (Shopify CLI, shopify.app.toml). LIVE app
│  │  ├─ media\ .......................... to-post / posted / generated (the image tool writes ../../../../media/generated)
│  │  ├─ architecture\ (8) decisions\ (10 ADRs) research\ (21) reviews\ (1 folder) policies\ (1)
│  │  ├─ reference\ad-skills\ ............ third-party ad playbooks, licensed and pinned (source material, not served)
│  │  ├─ checkpoints\ .................... EMPTY
│  │  ├─ 11 root documents ............... START-HERE, CURRENT-STATE, FUTURE-PLANS, ROADMAP, IDEAS, NEXT-STEPS,
│  │  │                                     WAITING-LIST, PROJECT-CONTEXT, PROJECT-LOG (98 KB), RULES, SETUP
│  │  └─ 5 .cmd launchers ................ start-dashboard(-dev), run-worker-now, check-status, connect-accounts (use %~dp0, relative)
│  │
│  ├─ MCP-Tooling\ ....................... git → Zain5163/MCP.1920agency-Tooling (main). The product's backup repo.
│  │                                        mirror\ = COPIES made by sync.sh (LinkedIn ops, Social-Render, LinkedIn content,
│  │                                        marketing handoffs, memory adspilot-*/muzaree-*, 5 task XMLs). Not live.
│  ├─ LinkedIn-Content-Ops\ .............. no git (mirror). LIVE: task LinkedIn-Content-Drafts 07:00 daily (headless Claude writes drafts);
│  │                                        approve-linkedin-posts.cmd → product CLI (config.json cliRoot = ...\Social-Publisher\source\apps\cli)
│  ├─ Social-Render\ ..................... no git (mirror). JSON spec → brand PNG/PDF (personal-brand style). On demand; never posts
│  ├─ Muzaree-Paid-Media\ ................ no git, NOT BACKED UP. LIVE: Muzaree-Ads-Daily 11:00 and Muzaree-Ads-Check at 01,03,05,07,09,
│  │                                        13,15,17,19,21,23 (headless Claude using the local MCP's tools); writes into the product
│  │                                        repo's meta-account-manager/references/field-notes.md
│  ├─ Server-Gate\ ....................... git, NO REMOTE (only on this PC). Source of /opt/gate, the server's front door. LIVE
│  ├─ Prospect-Engine\ ................... no git. Working; meant to become the AdsPilot skill "prospect-research"
│  ├─ PSX-Email-Outreach\ ................ no git (backed up in the PSX tooling repo). Design stage; "later inside the AdsPilot MCP"
│  ├─ Meta-Ads-Publisher\ ................ no git. AdsPilot's predecessor (Python CLI, Graph v23); superseded by AdsPilot's Meta ads
│  └─ Ads-Platform\ ...................... no git. Predecessor R&D; its research was inherited by AdsPilot on 2026-09-21
│
├─ Marketing-and-Content\
│  ├─ LinkedIn-Content-System\ ........... no git (mirror). The owner's LinkedIn content: strategy, calendar, drafts (written by the
│  │                                        07:00 task), posts log, newsletter, assets. LIVE (task writes here)
│  └─ HANDOFF-2026-10-02-video-and-trends.md (mirror)
│
└─ Websites\
   ├─ Muzaree-Shopify\ ................... no git. Client theme package (2026-09-05). Client store not touched
   ├─ 1920-agency\design-system\ ......... 1920 Agency brand system, LOCKED foundation v1.0 (FOUNDATION-LOCK.md)
   ├─ Zain-Personal-Branding\source\ ..... personal-brand coded design system (Social-Render copies its look)
   └─ Raptor-Downloader\site\ ............ Raptor's repo; before 2026-10-09 it carried AdsPilot's Caddy block (history)

Outside the workspace, on this PC
  C:\Users\Rana Zain Usman\.social-publisher\   SECRETS: .env + 20 timestamped backups/profiles, ad-accounts.json, shopify stores,
                                                 themes, store backups, DB backups. Never in git (by rule). Path is in code (CONFIG_DIR)
  C:\Users\Rana Zain Usman\.claude.json          user-level MCP "adspilot-hosted" → https://mcp.1920agency.com/mcp
  ~\.claude\projects\d--My-AI-Works\memory\      Claude's memory notes (keyed to the workspace ROOT path)
  %TEMP%\pa, %TEMP%\pb                           git worktrees of the product repo (branches central-config, brand-systems),
                                                 other sessions' work in progress
  ~\.ssh\raptor_hetzner                          the SSH key release.sh and backups use for the server

Server 37.27.148.217 (read-only listing, 2026-10-10)
  /opt/adspilot   app → releases/<commit>, releases, backups, data, env, logs, compose.env, setup-first.log   LIVE
                  containers adspilot-mcp-1, adspilot-worker-1; systemd adspilot-{monitor,refresh,backup,keepalive}.timer
  /opt/gate       Caddyfile, docker-compose.yml, sites/ (mcp.1920agency.com.caddy, raptordownloader.caddy)     LIVE
  /opt/raptor     Raptor Downloader (another project)

Windows scheduled tasks that touch the ecosystem
  AdsPilot-Worker / -Monitor / -Refresh, Social-Publisher-Keepalive   DISABLED on purpose (server does it; PC is the fallback)
                                                                       actions point at ...\Social-Publisher\source\...
  LinkedIn-Content-Drafts   READY  07:00 daily   -File ...\LinkedIn-Content-Ops\Run-LinkedInDrafts.ps1, WD = that folder
  Muzaree-Ads-Daily         READY  11:00 daily   -File ...\Muzaree-Paid-Media\Run-MuzareeDaily.ps1
  Muzaree-Ads-Check         READY  every 2 h, odd hours   same script -Check   (a run takes 2 to 4 minutes)
```

### 1.2 One product, about ten names

| Where | Name used |
|---|---|
| Product (working name; public name not chosen, WAITING-LIST #14) | AdsPilot |
| Folder on the PC | `Social-Publisher` |
| GitHub | `MCP.1920agency`, `MCP.1920agency-Tooling` |
| Backup folder | `MCP-Tooling` |
| Local MCP key and tool prefix | `social-publisher`, `mcp__social-publisher__*` |
| Hosted MCP key | `adspilot-hosted` |
| Secrets folder | `~/.social-publisher` |
| Server, containers, timers, network, backup key | `/opt/adspilot`, `adspilot-*`, `adspilot_edge`, gpg "AdsPilot backups" |
| Scheduled tasks | `AdsPilot-*` and `Social-Publisher-Keepalive` |
| Skills folder | `skills-library/adspilot` |
| Domain | `mcp.1920agency.com` |
| SSH key | `raptor_hetzner` |
| `PROJECT-CONTEXT.md` title | "Social Publisher" |

---

## 2. Problems found

**P1. Too many status files, overlapping and partly wrong.** Eleven root documents. Four of them
answer "what's next" (FUTURE-PLANS, ROADMAP, NEXT-STEPS, IDEAS). Three answer "where are we"
(CURRENT-STATE, PROJECT-CONTEXT, the "Built and verified" section of NEXT-STEPS). The memory
note `adspilot-project.md` keeps another status of its own. Out-of-date facts found today:
- `START-HERE.md` (2026-10-02) says the `AdsPilot-Worker` task runs every 5 minutes. It is
  disabled; the server publishes.
- `CURRENT-STATE.md` §6 and "Known gaps" say "Everything runs only while this PC is on". This has
  been false since Stage A on 2026-10-09.
- `NEXT-STEPS.md` is dated 2026-09-24 ("MCP server: 5 tools, stdio, local only", "205 tests").
- `PROJECT-CONTEXT.md` describes "CP-0, 2026-09-21".
- `WORKSPACE-INDEX.md` says 613 tests. `CURRENT-STATE.md` says 827.
- `WAITING-LIST.md` header says "Updated 2026-09-27", but the file was last changed on 8 October
  and has uncommitted edits today.
- `IDEAS.md` says NEXT-STEPS "holds what is actually being worked on". It has not since September.
- `LinkedIn-Content-Ops/PROJECT-CONTEXT.md` still shows "every 5 min AdsPilot-Worker".
- The header comment of `deploy/caddy/mcp.1920agency.com.caddy` still says "append this block to
  Raptor's Caddyfile". The gate replaced that on 2026-10-09.

**P2. Too many names** (table 1.2). A new session cannot tell that `Social-Publisher`,
`MCP.1920agency` and `adspilot` are the same product.

**P3. No single map.** `START-HERE.md` lists the repo's own files only. It never mentions
MCP-Tooling, LinkedIn-Content-Ops, Social-Render, Muzaree-Paid-Media, Server-Gate, the server
layout, the hosted MCP or the scheduled tasks.

**P4. Gaps in the backups.**
- `Muzaree-Paid-Media` has no git and no mirror. It holds a live automation script, client
  rules, reports and creatives.
- The `Server-Gate` repo has no remote, so the source of the live front door exists only on this
  PC.
- `sync.sh` exports only 5 of the tasks: it misses Muzaree-Ads-Daily and Muzaree-Ads-Check.
- It copies only the `adspilot-*` and `muzaree-*` memory notes, so it misses
  `server-front-gate.md` and `ads-objective-and-qa-rule.md`.
- The "mirror" holds copies, so the same files exist in two places. That works, but it invites
  the question "which one is real?".

**P5. One project writes into another.** The Muzaree check (12 runs a day) writes lines straight
into the product repo's `field-notes.md`. This has three effects:
- The product repo is nearly always "dirty". Today it holds 3 uncommitted files, one of them from
  this automation.
- It collides with other sessions' branches.
- It skips the skills-merge rule ("advice changes go to the owner for approval").

**P6. Unclear ownership between zones.** Product work, the owner's own marketing and client work
are mixed together. Muzaree's ad operations sit in AI-Automation and its store in Websites. The
LinkedIn automation depends on the product CLI through a hard-coded path.

**P7. Inconsistent naming inside the docs.**
- `architecture/` mixes `01-wave1-architecture.md`, an undated `google-suite-plan.md` and dated
  files.
- `reviews/` holds one dated folder, and `checkpoints/` is empty.
- In Muzaree-Paid-Media, `.bak` files sit at the root next to the originals, while other projects
  keep old versions in `archive/`.

**P8. Git housekeeping.**
- There are 12 local branches. 10 of them are merged into master and still exist; 2 merged
  branches also remain on GitHub (`phase1-usage`, `phase3-deploy`).
- `own-skills` (2026-10-08) is not merged, and nobody has said what happens to it.
- Two worktrees in `%TEMP%` belong to other sessions working right now (`central-config`,
  `brand-systems`).
- The memory note warns that another session can switch the shared checkout's branch at any
  moment.

**P9. Old predecessors look active.** `WORKSPACE-INDEX.md` lists Meta-Ads-Publisher and
Ads-Platform as current projects. AdsPilot replaced both.

**P10. Brand design systems are scattered and in different formats.**
- 1920 Agency: a locked HTML/CSS foundation.
- Zain personal brand: a coded system inside a Next.js site.
- Social-Render: its own copy of the personal-brand look in templates.
- PSX: its own system.
- The product skills (`web-ui-design`, `shopify-store-kit`) set design systems for stores.

No common format, no index, and no home for a client's brand. This matters because the owner's
next request is "a design system per brand/client".

**P11. Moves have hidden costs on Windows.**
- Deep paths break pnpm (memory note), so a new layout must not make paths longer.
- Build caches keep absolute paths. `source/apps/web/.next` contains
  `D:\My AI Works\AI-Automation\Social-Publisher\...`, and Raptor's Turbopack cache broke after
  its rename.
- pnpm's `node_modules` links are absolute junctions.
- Renames leave debris: `Websites\FreeVideoDownloaderOnline\site\docs\.source` still exists after
  the Raptor rename.

---

## 3. The target

### 3.1 In plain words

- **The product lives in one home**, under its permanent codename: `AI-Automation\AdsPilot\`.
  Inside are two repositories that already exist:
  - `app\` holds the code, the documents and the deploy files: today's `Social-Publisher`, with
    the same GitHub repo and the same history.
  - `ops\` holds the tools that run around the product: today's `MCP-Tooling`, again the same
    repo. It becomes the real home of the LinkedIn automation and the renderer, and keeps a
    mirror of what must live elsewhere.
- **One front door.** `app\START-HERE.md` holds the whole map from section 1, kept current.
- **One status file.** `app\STATUS.md`.
- **Documents on fixed shelves** under `app\docs\`.
- **Three neighbours stay where they are**, each with its own owner:
  - the owner's marketing content, in `Marketing-and-Content`;
  - client work, in `AI-Automation\Muzaree-Paid-Media` and `Websites\Muzaree-Shopify`;
  - the server's front gate, in `AI-Automation\Server-Gate`.

  START-HERE links to all three.
- **The server does not change.** `/opt/adspilot`, `/opt/gate`, the containers, timers, networks
  and domain all stay as they are.

### 3.2 The end state

```
D:\My AI Works\AI-Automation\AdsPilot\        PRODUCT HOME (codename; never renamed again; public name is a label)
├─ README.md                                  5 lines: "AdsPilot (working name). Start at app\START-HERE.md."
├─ app\                                       = repo Zain5163/MCP.1920agency (same history, same remote)
│  ├─ START-HERE.md                           the ONE entry point: what, where (full ecosystem map), how to run, read order
│  ├─ STATUS.md                               the ONE status file (sections in 3.4)
│  ├─ PROJECT-LOG.md                          dated journal, append-only (name kept: cited by the LinkedIn task prompt and memory)
│  ├─ RULES.md                                standing rules (unchanged)
│  ├─ SETUP.md                                stays at root: error messages and a test point to "SETUP.md"
│  ├─ PROJECT-CONTEXT.md                      10-line pointer to START-HERE + STATUS (AGENTS.md says every project has one)
│  ├─ source\  deploy\  integrations\  media\ UNCHANGED (code, server and tools depend on these exact places)
│  ├─ *.cmd                                   launchers stay at root (owner double-clicks them; they use %~dp0)
│  └─ docs\
│     ├─ README.md                            index + the shelf rules below
│     ├─ product\     capabilities.md (was CURRENT-STATE: the full built / verified-live matrix)
│     │               roadmap.md (ROADMAP + FUTURE-PLANS merged, ranked), ideas.md (was IDEAS), glossary.md (names, 1.2)
│     ├─ decisions\   0001-…0010 ADRs as today; 0011-workspace-organisation.md records this plan's outcome
│     ├─ architecture\ designs and plans (as today)
│     ├─ runbooks\    how to operate: release and rollback, backups and restore, connect accounts, add a site to the gate,
│     │               new-PC restore, quiet-window moves (links to deploy/README.md, which stays beside its scripts)
│     ├─ research\  reviews\  policies\        as today
│     ├─ reference\   ad-skills\ (third-party, licensed, pinned)
│     ├─ brand\       the PRODUCT's own brand: name research and shortlist, voice, later the product's design system
│     └─ archive\     superseded documents (PROJECT-CONTEXT 2026-09, NEXT-STEPS 2026-09-24), never deleted
└─ ops\                                       = repo Zain5163/MCP.1920agency-Tooling (same history, same remote)
   ├─ README.md, sync.sh
   ├─ linkedin-content-ops\                   REAL home (moved in; scheduled task points here)
   ├─ social-render\                          REAL home (moved in; may later become app\source\packages\render, decision D9)
   └─ mirror\                                 COPIES of what must live elsewhere: LinkedIn content, client folders (if D3 = yes),
                                              memory notes, task XMLs, Server-Gate (if D4 = no)

Neighbours (not moved; linked from START-HERE)
  Marketing-and-Content\LinkedIn-Content-System\   our own marketing (AGENTS.md: marketing content lives here)
  Marketing-and-Content\Brands\README.md           NEW index of every brand kit (3.6)
  AI-Automation\Muzaree-Paid-Media\                client: ads operated with AdsPilot
  Websites\Muzaree-Shopify\                         client: store
  AI-Automation\Server-Gate\                        shared server infrastructure (all domains), own private GitHub repo (D4)
  AI-Automation\Prospect-Engine\, PSX-Email-Outreach\   incubators; when merged into the product they get a "graduated" note
  AI-Automation\_archive\Meta-Ads-Publisher\, Ads-Platform\   predecessors (D6)
```

Path length check (P11): `AI-Automation\AdsPilot\app\source\…` is 4 characters **shorter** than
today's `AI-Automation\Social-Publisher\source\…`, because `AdsPilot\app` has 12 characters and
`Social-Publisher` has 16. pnpm on Windows therefore gets slightly more headroom, not less.

**Plan B, if the owner says no to the move (D1).** `Social-Publisher` stays where it is forever
as the codename folder. Everything inside `app\` above still applies to it. `MCP-Tooling` stays a
sibling. Phases 1 to 4 are identical.

### 3.3 The zones

| Zone | Folders | Owner's rule |
|---|---|---|
| Product | `AdsPilot\app`, `AdsPilot\ops` | Code, docs, deploy and ops tooling for the thing we sell |
| Shared infrastructure | `Server-Gate`, server `/opt/gate` | Serves every domain; no project edits another's file |
| Our own marketing ("customer zero") | `LinkedIn-Content-System`, `Brands\` index, 1920 Agency, Zain personal brand | Uses the product; each post approved by the owner |
| Clients operated with the product | `Muzaree-Paid-Media`, `Muzaree-Shopify`, future `<Client>-Paid-Media` | Client data stays in the client folder; lessons reach the product only as anonymous patterns |
| Incubators | `Prospect-Engine`, `PSX-Email-Outreach` | Become product features; then archived with a "graduated into <commit>" note |
| Predecessors | `Meta-Ads-Publisher`, `Ads-Platform` | Read-only history |

### 3.4 One status file: `STATUS.md`

The file is at most two screens long, with these sections in this order:

1. **Live now (verified)**: one line per capability that has been proven live, with the date.
   The full matrix lives in `docs/product/capabilities.md`.
2. **In progress**: what, which session or branch, when it started.
3. **Next up**: at most 5 items. The full ranked list lives in `docs/product/roadmap.md`.
4. **Waiting on others**: one row each, covering what it is, who it waits on, what unblocks it
   and what is already built. This replaces `WAITING-LIST.md`. Long background moves to the
   relevant plan in `docs/architecture/`.
5. **Recently done (14 days)**: one line each, linking to the `PROJECT-LOG.md` entry.
6. **Known problems**.

**Update rule:** a session that changes anything adds a `PROJECT-LOG.md` entry and updates the
affected lines in `STATUS.md`. Memory notes keep only rules and pointers ("resume from
STATUS.md"), never a second copy of the status. That keeps the two from drifting apart.

### 3.5 Naming conventions (new files and folders; old names are kept unless already being moved)

| Thing | Convention | Example |
|---|---|---|
| Project folders at workspace level | Title-Case-With-Hyphens, no spaces | `AdsPilot`, `Server-Gate` |
| Folders inside repos | lowercase-kebab | `docs/runbooks` |
| Living documents at a repo root | UPPERCASE (the workspace habit) | `START-HERE.md`, `STATUS.md` |
| Documents inside `docs/` | lowercase-kebab | `docs/product/roadmap.md` |
| Dated documents (plans, research, reviews, reports) | `YYYY-MM-DD-topic.md` | `2026-10-10-workspace-organisation-plan.md` |
| Decisions (ADR) | `NNNN-short-title.md`; header: Status (Proposed / Accepted / Superseded by NNNN), Date, Context, Decision, Rejected options | `0011-workspace-organisation.md` |
| Old versions | `archive/YYYY-MM-DD-<name>`, never `.bak` next to the original | `archive/2026-10-08-Run-MuzareeDaily.ps1` |
| Branches | `feat/…`, `fix/…`, `docs/…`, `chore/…`; deleted after merging; `master` stays the default | `feat/brand-kits` |
| Commits | `Area: what changed` (already the habit), a body that says why, the Co-Authored-By trailer | `Docs: one status file (STATUS.md)` |
| Releases | annotated tag per server release: `release-YYYY-MM-DD-<short sha>` | `release-2026-10-09-2c571fc` |
| Internal codename | `adspilot` (lowercase in code and infra, `AdsPilot` in folder names) | `/opt/adspilot` |
| Public name | only in public-facing text, after the owner chooses it (WAITING-LIST #14) | n/a |
| Dates and times | ISO dates; times in PKT, written out | `2026-10-10 13:10 PKT` |

### 3.6 Where brand design systems go (the owner's next request)

- **One standard "brand kit"** for every brand or client, in a folder called `design-system\`:
  - `BRAND.md`: plain rules, covering voice, do and don't, logo use and who approved it.
  - `tokens.json`: colours, type, spacing, radii and shadows, in the W3C design-tokens format.
  - `logo\`: original files only (the PSX rule: never an invented wordmark).
  - `templates\`: Social-Render templates for this brand.
  - `examples\`: approved renders and screenshots.
  - `CHANGELOG.md`.
- **Where each kit lives.** It sits in the brand's own project folder, which is the existing
  `_FOLDER-RULES.md` convention (`Websites\<brand>\design-system\`). Examples:
  `Websites\1920-agency\design-system\` (already there) and
  `Websites\Muzaree-Shopify\design-system\`. A brand with no project folder (for example
  GradCollective) gets `Marketing-and-Content\Brands\<Brand>\design-system\`.
- **One index:** `Marketing-and-Content\Brands\README.md`, one row per brand: kit location, status,
  approved by, date.
- **The product holds the machinery, not the brands.** `app\` holds the brand-kit schema, the
  skills that read it (`web-ui-design`, `shopify-store-kit`) and the renderer's support for
  `tokens.json`. Paying customers' kits are tenant data on the server, never workspace folders.
- **Locked systems are wrapped, not rewritten.** 1920 Agency's foundation is locked with exact
  values (`FOUNDATION-LOCK.md`), so its kit gets a `BRAND.md` that points to the lock and the
  snapshot. No approximate `tokens.json` replaces it.
- **Coordinate first:** another session is working right now on branch `brand-systems` (worktree
  `%TEMP%\pb`). Agree the schema with that work before creating any kits.

---

## 4. Migration plan

Each step says what changes, which dependencies must be updated, how to check it and how to undo
it.

| Risk | Meaning |
|---|---|
| **ZERO** | Documents only. Nothing that runs reads them. |
| **LOW** | A small script, configuration or backup change, with no move of running automation. |
| **MEDIUM** | Touches one running scheduled task. |
| **HIGH** | Touches the local MCP, several tasks and the repos. |

MEDIUM and HIGH steps run in a quiet window with the precautions below.

**Quiet window** (for MEDIUM and HIGH; times PKT):
- Muzaree-Ads-Check fires at odd hours, Muzaree-Ads-Daily at 11:00 and LinkedIn-Content-Drafts
  at 07:00. Each run takes 2 to 4 minutes.
- The best gaps are **13:10 to 14:50** and **15:10 to 16:50**. Alternatively, with the owner's
  approval, disable Muzaree-Ads-Check for the hour and re-enable it afterwards.
- Server posting slots (09:00, 15:30, 22:00) do not matter: the **server** publishes, and none of
  these moves touch it.
- Before starting:
  - close VS Code and every Claude Code session (each one runs the local MCP's `node` process
    from the folder, and an open file blocks a rename on Windows);
  - stop the dashboard;
  - check that no task is running:
    `Get-CimInstance Win32_Process | ? CommandLine -like '*Social-Publisher*'` must return
    nothing.

### Phase 0: prepare (ZERO)

| | |
|---|---|
| What | The owner approves this plan and answers D1 to D9. Wait until the other sessions have committed (today: uncommitted `PROJECT-LOG.md`, `WAITING-LIST.md`, `field-notes.md`; worktrees `central-config` and `brand-systems`). Tag both repos `pre-reorg-2026-10-xx`. Run `sync.sh` so the task XMLs and mirrors are fresh. |
| Verify | `git status` is clean in both repos; `git tag` shows the tag; `mirror/scheduled-tasks/*.xml` has today's date. |
| Rollback | Nothing to undo. |

### Phase 1: docs inside the repo (ZERO for automation; each step is one commit, so `git revert` undoes it)

**Step 1.1. Write `STATUS.md` and rewrite `START-HERE.md`.**
- Build `STATUS.md` from CURRENT-STATE, WAITING-LIST (only after the other chat has committed its
  edit), the "Next" part of FUTURE-PLANS and the live items of NEXT-STEPS:
  - the flaky `packages/auth` test;
  - the database password rotation, if it is still open: **check first**;
  - "nothing alerts when the scheduler stops", if it is still open.
- Correct the stale facts listed in P1.
- `START-HERE.md` gets:
  - the ecosystem map from section 1;
  - the names table from 1.2;
  - the read order: START-HERE → STATUS → RULES → docs/README.
- Dependencies: none run-time. Update `WORKSPACE-INDEX.md` line 28 ("resume from WAITING-LIST" →
  STATUS; 613 → the current test count). The memory index line in `MEMORY.md` ("resume from
  START-HERE + WAITING-LIST") and `adspilot-project.md` lines 11 to 13 change only with the
  owner's approval, because memory edits are the owner's call.
- Verify: read START-HERE and STATUS against `git log` and the server's `/health`. Every "live"
  claim needs a date and its evidence (R4).
- Rollback: `git revert`.

**Step 1.2. Create the `docs/` shelves with `git mv`, so history is kept.**
- Moves:
  - `decisions/ architecture/ research/ reviews/ policies/ reference/` → `docs/…`
  - `CURRENT-STATE.md` → `docs/product/capabilities.md`
  - `ROADMAP.md` + `FUTURE-PLANS.md` → `docs/product/roadmap.md` (merged; FUTURE-PLANS' "agreed
    2026-10-08" foundations section goes on top)
  - `IDEAS.md` → `docs/product/ideas.md`
  - `NEXT-STEPS.md` → `docs/archive/2026-09-24-next-steps.md`
  - `PROJECT-CONTEXT.md` → `docs/archive/2026-09-24-project-context.md`, with a new 10-line
    `PROJECT-CONTEXT.md` pointer at the root
  - the "Verified live, not just tested" table (PROJECT-LOG line ~1736) → `capabilities.md`
- Delete the empty `checkpoints/`. It is untracked and empty, but it is still a deletion, so it
  needs approval.
- Dependencies to update in the same commit:
  - `deploy/README.md` lines ~604, 605 and 647 (research and architecture paths).
  - `source/apps/mcp/skills-library/README.md` lines 6, 54, 67 and 88.
  - Skills **served to customers**: `adspilot/skills/wordpress-site-builder/SKILL.md:223` and
    `references/woocommerce.md:93` cite `research/2026-10-08-wordpress-connector.md`. Replace the
    internal path with plain text: it is a citation change only, with no change to the advice.
  - About 35 source files cite `decisions/`, `architecture/` or `research/` in **comments only**.
    Update them with one scripted replace, then run the typecheck.
  - Memory `adspilot-project.md` (`research/2026-10-01-product-name.md`,
    `architecture/2026-10-08-shopify-connector-plan.md`), with the owner's approval.
  - `WORKSPACE-INDEX.md` (`architecture/google-suite-plan.md`).
  - `Prospect-Engine`, `PSX-Email-Outreach` and `PSX-Growth-OS` docs, only where they cite a
    moved path. Run `grep` first.
  - `PROJECT-LOG.md` and `docs/reviews/` are history and are **not rewritten**. Add one line at
    the top of PROJECT-LOG: "paths before 2026-10-xx use the old layout: `architecture/` is now
    `docs/architecture/`, and so on".
- Not touched: `SETUP.md` stays at the root, because `resolutions.ts:94`, `local-server.ts:88`
  and `config/test/env.test.ts:94` point at it. `PROJECT-LOG.md` stays, because the 07:00
  LinkedIn prompt reads `…\Social-Publisher\PROJECT-LOG.md`. `media/`, `source/`, `deploy/` and
  `integrations/` stay.
- Unaffected by design: the server. `release.sh` ships `git archive HEAD source deploy` only, so
  docs never reach the server.
- Verify:
  - `git grep -nE "(^|[^/])(decisions|architecture|research|reviews|policies|reference)/"` finds
    only `docs/…` paths, PROJECT-LOG history and URLs.
  - A small link check (every backticked relative path in `*.md` must exist) reports 0 missing.
  - Typecheck the 13 workspaces.
  - Run the eight test suites that need no database (not the db or auth suites, which hit live
    Supabase).
- Rollback: `git revert <commit>`.

**Step 1.3. Write `docs/README.md` and ADR `0011-workspace-organisation.md`** (ZERO). Record the
shelves, the conventions in 3.5 and the options that were rejected (for example, a new top-level
`Products\` folder: it would mean rewriting AGENTS.md's organisation rules for one product).

### Phase 2: correct stale text outside the repo (ZERO)

| What | File |
|---|---|
| Header comment: "site file for the server's gate (/opt/gate/sites/)", not "append to Raptor's Caddyfile". A comment only; it reaches the server at the next gate upload | `deploy/caddy/mcp.1920agency.com.caddy` |
| "every 5 min the server's worker publishes" | `AI-Automation/LinkedIn-Content-Ops/PROJECT-CONTEXT.md` |
| Mark as superseded by AdsPilot (one status line) | `Meta-Ads-Publisher/PROJECT-CONTEXT.md`, `Ads-Platform/PROJECT-CONTEXT.md`, `AI-Automation/_WHAT-IS-THIS.md`, `WORKSPACE-INDEX.md` |
| Add Social-Render, LinkedIn-Content-Ops, MCP-Tooling, Server-Gate, Prospect-Engine | `AI-Automation/_WHAT-IS-THIS.md` (it lists 5 of 14 folders) |

Verify by reading the files. Undo by reverting the edit; each edit is one line.

### Phase 3: backups and git housekeeping (LOW; no moves)

**Step 3.1. Extend `MCP-Tooling/sync.sh`.**
- Add to the task loop: `Muzaree-Ads-Daily` and `Muzaree-Ads-Check`.
- Add to the memory copy: `server-front-gate.md`, `ads-objective-and-qa-rule.md`.
- If D3 = yes, add `copy_dir "$WS/AI-Automation/Muzaree-Paid-Media" clients/muzaree-paid-media`,
  excluding `logs/` (the transcripts), the same way `logs` is already excluded.
- Update the README table.
- Verify: `bash sync.sh --no-push`, then read `git show --stat`. The secret scan must pass. Push
  only after that.
- Rollback: `git revert` in the tooling repo.

**Step 3.2. Server-Gate.**
- If D4 = yes: create a private GitHub repo `Zain5163/Server-Gate` (an external action, so it
  needs approval), then `git remote add origin …` and `git push -u origin master`.
- If D4 = no: add it to the sync mirror.
- Verify: `git ls-remote origin`.
- Rollback: delete the remote, or the mirror line.

**Step 3.3. Branches.**
- With approval, delete the 10 local branches that are merged into master: brand-systems and
  central-config only after their sessions finish, plus global-markets, https-callbacks,
  industry-column, phase1-usage, phase2-analytics, phase3-deploy, posthog-mcp-analytics,
  web-store-skills and wordpress-tools.
- Delete the 2 merged remote branches.
- Decide on `own-skills` (D5).
- Tag past releases from the server's `releases/` folder names.
- Rollback: a deleted merged branch can be restored with `git branch <name> <sha>` (`git reflog`
  keeps the sha). Remote branches: push again.

### Phase 4: brand kits (ZERO; new files only)

1. With the `brand-systems` session, agree the brand-kit schema. Commit it in `app` as
   `docs/architecture/2026-10-xx-brand-kits.md`.
2. Create `Marketing-and-Content\Brands\README.md` (the index).
3. Build kits one brand at a time, each approved by the owner: Zain personal brand, 1920 Agency
   (wrapper only), Muzaree (when the client gives access), and so on.

Nothing existing is moved: 1920's locked foundation and Zain's site stay exactly as they are.

### Phase 5: running automation (MEDIUM, quiet window, one step per day)

**Step 5.1. Muzaree lessons through an inbox, not a direct write (D8).**
- Today `Run-MuzareeDaily.ps1` (prompt lines ~113 to 118) tells the run to append to
  `…\Social-Publisher\source\apps\mcp\skills-library\adspilot\skills\meta-account-manager\references\field-notes.md`.
- Change it to append to `Muzaree-Paid-Media\LEARNINGS-INBOX.md`. The skills-merge step (memory
  rule) then dedupes the inbox into the product, with the owner's approval.
- This also removes one hard-coded product path before the big move.
- Dependencies: the script (back it up first to `archive\YYYY-MM-DD-Run-MuzareeDaily.ps1`),
  memory `adspilot-skills-merge-rule.md` (one line, with the owner's approval), Muzaree
  `STATUS.md`.
- Verify: `Run-MuzareeDaily.ps1 -Check -DryRun`, then watch the next real run. The report is
  written, and `git status` in the product repo stays clean.
- Rollback: restore the archived script.

**Step 5.2. Social-Render → `MCP-Tooling\social-render`.**
- It uses Node built-ins only, has no `node_modules` and runs only on demand, so this is LOW in
  practice.
- Dependencies:
  - `sync.sh`: remove the `copy_dir … Social-Render` line and delete `mirror/social-render`.
  - The MCP-Tooling README table.
  - `Social-Render/PROJECT-CONTEXT.md` (`cd 'D:\My AI Works\AI-Automation\Social-Render'`).
  - `LinkedIn-Content-System/AUTOMATION-SPEC.md` and `PROJECT-CONTEXT.md`, the marketing HANDOFF
    file, `WORKSPACE-INDEX.md` and `docs/product/capabilities.md`.
  - `docs/reviews/…` is history: leave it.
- Verify: `node --test test/render.test.mjs` and `node render.mjs --check examples/all-types-portrait.json`
  in the new place. Then `grep -r "AI-Automation\\Social-Render"` over living files returns 0.
- Rollback: `Move-Item` it back and revert the doc and sync commits.

**Step 5.3. LinkedIn-Content-Ops → `MCP-Tooling\linkedin-content-ops`. This moves a LIVE task.**
- Window: any time except 06:50 to 07:30.
- Dependencies:
  - Task `LinkedIn-Content-Drafts`: the action `-File "…\LinkedIn-Content-Ops\Run-LinkedInDrafts.ps1"`
    and the WorkingDirectory. Re-point both with `Set-ScheduledTask`, keeping the triggers.
  - `approve-linkedin-posts.cmd` moves with the folder (it uses `%~dp0`). Tell the owner where to
    double-click from now on, or make a desktop shortcut.
  - `config.json` is unchanged (`contentRoot` and `cliRoot` are absolute and do not move in this
    step).
  - The `.gitignore` in the tooling repo gets `linkedin-content-ops/logs/`.
  - `sync.sh`: remove its `copy_dir` line.
  - Docs: memory `adspilot-project.md` line 36 (approval needed), `WORKSPACE-INDEX.md` line 29,
    `LinkedIn-Content-System/PROJECT-CONTEXT.md` and `AUTOMATION-SPEC.md`, and
    `docs/product/capabilities.md`.
- Verify:
  - `Run-LinkedInDrafts.ps1 -DryRun` from the new place.
  - `(Get-ScheduledTask LinkedIn-Content-Drafts).Actions` shows the new path.
  - The next 07:00 run returns `LastTaskResult 0` and drafts appear in LinkedIn-Content-System.
- Rollback: move the folder back and re-import
  `mirror/scheduled-tasks/LinkedIn-Content-Drafts.xml` (`schtasks /create /tn … /xml … /f`).

### Phase 6: the product home move (HIGH; last; quiet window; only if D1 = yes)

**What moves:**
- `AI-Automation\Social-Publisher` → `AI-Automation\AdsPilot\app`. It stays on the same drive,
  so this is a rename, not a copy.
- `AI-Automation\MCP-Tooling` → `AI-Automation\AdsPilot\ops`.
- A new `AI-Automation\AdsPilot\README.md`.

**How.** Use one PowerShell script, `ops\migrate\move-product-home.ps1`, written on the pattern of
`Server-Gate\rename-raptor-folder.ps1`. It has `-DryRun`, which lists every change.

Before it changes anything, it:
1. refuses to run if any process command line contains `Social-Publisher`, if either repo is
   dirty, or if a Muzaree or LinkedIn run is in progress;
2. saves a copy of every file it will edit, plus the task XMLs, to
   `%USERPROFILE%\reorg-backup-<date>\`. That folder is outside the workspace and holds no
   secrets: `.mcp.json` holds only paths.

**Every dependency to update (found on 2026-10-10):**

| # | Dependency | Change |
|---|---|---|
| 1 | `D:\My AI Works\.mcp.json` → `social-publisher.args[1]` | `…\AdsPilot\app\source\apps\mcp\src\server.ts` (the key `social-publisher` stays) |
| 2 | Tasks AdsPilot-Worker, AdsPilot-Monitor, AdsPilot-Refresh (disabled) | Execute args and WorkingDirectory → `…\AdsPilot\app\source\apps\worker\…`. They **stay disabled**; they are the fallback if the server goes down |
| 3 | Task Social-Publisher-Keepalive (disabled) | → `…\AdsPilot\app\source\packages\db\src\keepalive-cli.ts`. The name stays (it is cited in `resolutions.ts:126` and `monitor.ts:191`) |
| 4 | `ops\linkedin-content-ops\config.json` → `cliRoot` | `D:\My AI Works\AI-Automation\AdsPilot\app\source\apps\cli` |
| 5 | `Run-LinkedInDrafts.ps1` line 105 (prompt text) | `…\AdsPilot\app\PROJECT-LOG.md` |
| 6 | `Run-MuzareeDaily.ps1` line 116 | Only if Step 5.1 was not done: the new `field-notes.md` path |
| 7 | `ops\sync.sh` | `WS="$(cd "$HERE/../.." …)"` must become `../../..`, because `ops` is one level deeper. Otherwise the script copies from the wrong root, silently |
| 8 | `ops\README.md` | Repo paths, and the restore steps ("clone both repos into `AI-Automation\AdsPilot\{app,ops}`") |
| 9 | Git worktrees `%TEMP%\pa`, `%TEMP%\pb` (and any new ones) | `git -C AdsPilot\app worktree repair` (absolute paths are stored in `.git/worktrees/*/gitdir`) |
| 10 | pnpm `node_modules` (absolute junctions) | `pnpm install --frozen-lockfile --offline` in `app\source`, then build every package's `dist` (`npx tsc -p tsconfig.json` in each `source/packages/*`). `dist` is not in git (memory note, 2026-10-08) |
| 11 | `integrations\shopify-app\node_modules` | `npm ci` there if it is used before the next Shopify CLI run |
| 12 | `app\source\apps\web\.next` (contains absolute paths) | Delete it and rebuild (`next build`) before the next `start-dashboard.cmd` |
| 13 | Server-Gate `gate/Caddyfile` line 3 (comment), `PROJECT-CONTEXT.md`, `migrate.sh` line 12 (a one-time script, done; update for accuracy) | Path text |
| 14 | Memory: `adspilot-project.md` (lines 3, 11, 36, 55 to 57), `server-front-gate.md` (lines 3, 11), `MEMORY.md` index | Path text (the owner approves memory edits). The memory folder itself does **not** move: it belongs to the workspace root path |
| 15 | `WORKSPACE-INDEX.md` lines 28 and 29; `AI-Automation\_WHAT-IS-THIS.md` | Path text |
| 16 | Living docs in `app` (`START-HERE`, `STATUS`, `docs/product/*`, `deploy/README.md`, `docs/architecture/2026-10-08-plans-usage-analytics-hosting.md`, `2026-10-02-provider-adapter-map.md`) | Path text. `PROJECT-LOG` and `docs/reviews` are history: leave them |
| 17 | Other projects' docs: `Prospect-Engine/PROJECT-CONTEXT.md`, `PSX-Email-Outreach` (PROJECT-CONTEXT, DESIGN, a research file, 2 workflow .js), `PSX-Growth-OS` (7 docs + 1 workflow), `LinkedIn-Content-System` (PROJECT-CONTEXT, CALENDAR, AUTOMATION-SPEC), `Social-Render/PROJECT-CONTEXT.md`, Marketing HANDOFF | Path text. PSX's tooling repo copies refresh on its own sync. Old LinkedIn drafts are content: leave them |
| 18 | Claude Code per-folder session history (`~\.claude\projects\D--My-AI-Works-AI-Automation-Social-Publisher*`) | Nothing to do. Old sessions started inside the folder will not appear in "resume" from the new path. Sessions started at the workspace root (the normal case) are unaffected |

**Safety net.** After the move, create a directory junction at the old path:
`New-Item -ItemType Junction -Path …\AI-Automation\Social-Publisher -Target …\AdsPilot\app`.
Anything the search missed then keeps working.
- Keep it for 14 days, then remove it in a quiet window and watch the next runs of every task.
- Search tools may show files twice while the junction exists. That is expected.
- Do the same for `MCP-Tooling` → `AdsPilot\ops`.

**Verify, in order:**
1. `git -C AdsPilot\app status` is clean, HEAD is unchanged and `remote -v` is unchanged.
   `git worktree list` shows the worktrees at their paths with no "prunable" entries.
2. In `app\source`: install as in row 10, build the package `dist`s, typecheck, and run the eight
   suites that need no database. Run the db and auth suites only at a quiet time, never in
   parallel with agents.
3. Open Claude Code at `D:\My AI Works`. `/mcp` shows `social-publisher` connected. Call the
   read-only tools `check_status` and `list_ad_accounts`. `adspilot-hosted` is untouched; check
   it anyway with `check_status`.
4. `Run-MuzareeDaily.ps1 -Check -DryRun` and `Run-LinkedInDrafts.ps1 -DryRun` succeed. Run the
   CLI's read-only status (`check-status.cmd`) from the new place.
5. `bash ops/sync.sh --no-push`: the mirror diff shows only expected changes, and the secret scan
   passes.
6. `curl https://mcp.1920agency.com/health` gives the same answer before and after. The server is
   not touched. The next release runs `deploy/scripts/release.sh --upload-only` from the new
   place first; it finds the repo with `git rev-parse`, so no path is involved.
7. A search for `AI-Automation\Social-Publisher`, `AI-Automation/Social-Publisher` and
   `MCP-Tooling` across living files (excluding PROJECT-LOG, reviews, archives and
   `.claude\projects`) returns 0.
8. The next scheduled runs of Muzaree-Ads-Check, Muzaree-Ads-Daily and LinkedIn-Content-Drafts
   return `LastTaskResult 0`.
9. Check that no stub folder has reappeared at the old path (the Raptor lesson). The junction
   must be the only thing there.

**Rollback** (the script's `-Rollback`, which also works by hand):
1. Remove the junctions.
2. `Move-Item` both folders back.
3. Restore the saved files from `%USERPROFILE%\reorg-backup-<date>\`.
4. Re-import the task XMLs.
5. `git worktree repair`.
6. `pnpm install --offline`, rebuild the `dist`s, and delete `.next`.

Nothing on the server or GitHub changed, so nothing there needs undoing.

### Phase 7: after the public name is chosen (optional; not a reorganisation)

- **Optional:** rename the GitHub repos. GitHub redirects old URLs; afterwards update `origin`
  with `git remote set-url`.
- **Separate product work (WAITING-LIST #14):** rename only public-facing text, such as the MCP
  server's instructions and display name, the website and docs.
- **Keep the internal codename** in folders, `/opt/adspilot`, containers, timers, networks, the
  skills path, MCP keys and task names (section 5).

---

## 5. What NOT to move, and why

| Keep as is | Why |
|---|---|
| `D:\My AI Works` (the workspace root) | Claude's memory is keyed to it (`~\.claude\projects\d--My-AI-Works`); every absolute path starts with it |
| `~\.social-publisher\` (name and place) | Secrets must stay outside the workspace (AGENTS.md). The path is in code (`config/src/env.ts` `CONFIG_DIR`). `pc-backups.sh` refuses any backup folder inside the workspace |
| Server: `/opt/adspilot` (app → releases, backups, data, env, compose.env), `/opt/gate`, `/opt/raptor`, containers `adspilot-*`, systemd `adspilot-*`, networks `adspilot_edge` and `deploy_internal`, volume `deploy_caddy_data`, gpg key "AdsPilot backups" | Live and verified (Stage A, 2026-10-09). `release.sh`, `--rollback`, backups and the gate depend on these exact names. Moving them brings real downtime risk and no benefit |
| `mcp.1920agency.com` and the OAuth callback paths | Registered with Meta, Google, LinkedIn and Shopify |
| `app\source\` internal layout | pnpm workspace, Dockerfile, `release.sh` (`git archive HEAD source deploy`), the package `dist` builds |
| `app\deploy\` | The server runs `/opt/adspilot/app/deploy/scripts/dc.sh` from inside the release |
| `app\media\` | `image-tools.ts` writes to `../../../../media/generated` relative to its own file |
| `app\SETUP.md` | Error messages and `env.test.ts` name it |
| `app\PROJECT-LOG.md` | The daily LinkedIn prompt reads it; workspace convention |
| `skills-library\` and `playbooks\` | Served to every AI client; the skills-merge rule and the Muzaree automation point at them |
| `integrations\shopify-app\` | Linked Shopify app config (`shopify.app.toml`) |
| MCP keys `social-publisher`, `adspilot-hosted` | Tool names (`mcp__social-publisher__*`) are listed in `Run-MuzareeDaily.ps1`'s allowed tools and used in docs and skills. Renaming them breaks the Muzaree automation and every saved permission |
| Scheduled task names | Cited in code (`resolutions.ts`, `monitor.ts`) and docs; renaming a task means deleting and recreating it |
| `~\.ssh\raptor_hetzner` | `release.sh` and `pc-backups.sh` default to it (it can be overridden with `ADSPILOT_SSH_KEY`); Raptor uses it too |
| Git history and branches | Only `git mv` and folder renames; never re-initialise, copy a repo or rewrite history |
| `Marketing-and-Content\LinkedIn-Content-System` | AGENTS.md says marketing content lives in Marketing-and-Content; `config.json` `contentRoot` and the daily task write there |
| `Muzaree-Paid-Media`, `Websites\Muzaree-Shopify` | Client work, a separate zone. Back them up (D3); do not fold them into the product |
| `Server-Gate` | Serves every domain on the server, not only AdsPilot; it gets its own remote (D4) |
| `Websites\1920-agency\design-system`, `Zain-Personal-Branding` | Locked and approved foundations; brand kits wrap them |
| Old dated research, review and decision file names | They are cited in history and other docs; the conventions apply to new files only |
| `master` as the default branch | Other sessions, `origin/HEAD` and the habits all use it; renaming it gains nothing |

---

## 6. Decisions needed from the owner

| # | Question | Recommendation |
|---|---|---|
| D1 | Move the product home to `AI-Automation\AdsPilot\{app,ops}` (Phase 6), or keep `Social-Publisher` forever (Plan B)? | Move, but last, after Phases 1 to 5 have settled |
| D2 | Make `adspilot` the permanent internal codename, with the public name added later as a label only? | Yes (it is already the server's, Docker's and the skills' name) |
| D3 | Back up `Muzaree-Paid-Media` (client figures inside) to a private GitHub repo through the ops mirror? | Yes, without the run transcripts |
| D4 | Create a private GitHub repo for `Server-Gate`? | Yes |
| D5 | Delete the 10 merged local branches and 2 merged remote branches; what happens to unmerged `own-skills`? | Delete the merged ones; owner to say about `own-skills` |
| D6 | Move `Meta-Ads-Publisher` and `Ads-Platform` into `AI-Automation\_archive\`? | Yes, after Phase 2 marks them superseded |
| D7 | Brand kits in each brand's own folder, with one index in `Marketing-and-Content\Brands`? | Yes |
| D8 | Muzaree lessons go to an inbox, merged into the product after the owner's review? | Yes |
| D9 | Social-Render: an ops tool now, a product package (`source\packages\render`) once brand kits exist? | Yes |
| D10 | Amend AGENTS.md so `START-HERE.md` / `STATUS.md` count as the project context (the root `PROJECT-CONTEXT.md` becomes a pointer)? | Optional; the pointer works without the amendment |

---

## 7. Order and effort at a glance

| Phase | Risk | Touches | About |
|---|---|---|---|
| 0 Prepare | ZERO | tags, sync | 15 min |
| 1 Docs inside the repo | ZERO | documents, code comments | 2 to 3 h |
| 2 Stale text elsewhere | ZERO | 6 documents | 20 min |
| 3 Backups and branches | LOW | sync.sh, a new GitHub repo, branches | 45 min |
| 4 Brand kits | ZERO | new files | per brand |
| 5.1 Muzaree inbox | MEDIUM | one live prompt | 30 min + next run |
| 5.2 Social-Render | LOW | an on-demand tool | 30 min |
| 5.3 LinkedIn ops | MEDIUM | one live task | 45 min + next 07:00 run |
| 6 Product home move | HIGH | local MCP, 4 disabled tasks, 2 live scripts, 2 repos, worktrees, pnpm, memory | 2 h in a quiet window + 14 days with the junction |
| 7 Public name | n/a | product work | later |
