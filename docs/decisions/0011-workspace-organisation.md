# 0011 — Workspace organisation: one entry point, one status, fixed shelves

**Date:** 2026-10-10
**Status:** Accepted (owner, 2026-10-10: "let's do our organisation plan"; D1–D10 as
recommended, D7 adjusted). Phases 0–4 done 2026-10-10; phases 5–6 wait for a quiet
window with the owner.
**Plan:** `docs/architecture/2026-10-10-workspace-organisation-plan.md`

## Context

The product was spread over nine folders under about ten names, with eleven root
documents that each held part of the status and partly contradicted each other (three
still said the PC posts; the server has since 2026-10-09). Two live pieces had no
backup off the PC, and merged branches were piling up.

## Decision

1. **Codename `adspilot`** is permanent (D2). The public name is a label added later;
   folders, server paths, containers, MCP keys and task names keep their names.
2. **One entry point**, `START-HERE.md`, with the whole ecosystem map (PC, server,
   scheduled tasks, neighbouring folders) and the names table.
3. **One status file**, `STATUS.md`: live now, in progress, next up (at most 5),
   waiting on others, recently done, known problems. `CURRENT-STATE.md`,
   `NEXT-STEPS.md` and the "next" part of `FUTURE-PLANS.md` are replaced by it.
   `WAITING-LIST.md` folds into it once the session editing it has committed.
4. **Fixed shelves** under `docs/`: product, decisions, architecture, runbooks,
   research, reviews, policies, reference, brand, archive (`docs/README.md`). Moved with
   `git mv`, so history follows.
   - `CURRENT-STATE.md` → `docs/product/capabilities.md`
   - `ROADMAP.md` + `FUTURE-PLANS.md` → `docs/product/roadmap.md` (both kept in full)
   - `IDEAS.md` → `docs/product/ideas.md`
   - `NEXT-STEPS.md` → `docs/archive/2026-09-24-next-steps.md`
   - `PROJECT-CONTEXT.md` → `docs/archive/2026-09-24-project-context.md`; a short
     pointer stays at the root because `AGENTS.md` expects one
5. **Stay at the root:** `SETUP.md` (error messages and a test name it),
   `PROJECT-LOG.md` (the daily LinkedIn prompt reads it), `RULES.md`, the `.cmd`
   launchers, `source/`, `deploy/`, `integrations/`, `media/`.
6. **Brand kits** live in the product repo under `source/packages/brands/brands/<slug>/`,
   because the server serves them (D7, adjusted); the workspace index of brands is
   `Marketing-and-Content\Brands\README.md`.
7. **Backups:** `Muzaree-Paid-Media` (without run transcripts), the Muzaree task XMLs
   and the missing memory notes join the ops mirror (D3). `Server-Gate` gets its own
   private repo once the owner creates it (D4).
8. **Predecessors** `Meta-Ads-Publisher` and `Ads-Platform` move to
   `AI-Automation\_archive\` (D6).
9. **Conventions** for new files: dated documents `YYYY-MM-DD-topic.md`; ADRs
   `NNNN-short-title.md`; folders inside repos lowercase-kebab; living root documents
   UPPERCASE; old versions in `archive/`, never `.bak` beside the original; branches
   `feat/`, `fix/`, `docs/`, `chore/`, deleted after merging; release tags
   `release-YYYY-MM-DD-<sha>`.

## Rejected options

- **A new top-level `Products\` folder** in the workspace: it would mean rewriting the
  workspace's organisation rules in `AGENTS.md` for one product.
- **Renaming everything to the public name now:** the name is not chosen, and the
  names are cited by running automation (Muzaree's allowed tools, task names, code).
- **Moving the product folder now** (D1, phase 6): accepted for later, in a quiet
  window with a dry-run and rollback script and a junction at the old path. Phases 1–4
  give most of the benefit without it.
- **Rewriting history** (`PROJECT-LOG.md`, `docs/reviews/`) to the new paths: history
  keeps the paths it had; `docs/README.md` explains the old layout.
- **Editing applied database migrations** to update path comments: Prisma checksums
  applied migrations, so their comments keep the old paths.
