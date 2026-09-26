# AdsPilot — standing rules

Rules the owner has set for how this project is built. They are not preferences to
weigh against convenience; they are constraints, and work that breaks one is wrong
even if it is otherwise good.

Each entry says **what** the rule is, **why** it exists, and where possible quotes
the owner so the intent survives a retelling.

Workspace-wide rules in `D:\My AI Works\AGENTS.md` also apply and are not repeated
here — most importantly: no credentials anywhere in the workspace, explicit
approval before anything published or irreversible, and never inferring that a
local build is live.

---

## R1. Every error says why it happened and how to fix it

> "every error must say why it happened and how to fix it"

Called the **Apple rule** by the owner. An error that only says what failed makes
the reader guess. Implemented as the resolution catalogue in
`source/packages/core/src/domain/resolutions.ts`: every error code carries `what`,
`why`, `fix[]`, `retryable` and `needsHuman`. Adding an error code without a
resolution is incomplete work, not a shortcut.

## R2. Backend logging goes to Slack, and users never see it

Operational detail — stack traces, retries, queue depth — is for running the
system, not for the customer. Customers get the resolution from R1. Slack is the
preferred command, approval, logging and artifact surface across all of
`AI-Automation`.

## R3. Build and verify locally first; deploy later

Nothing is considered working because it deployed. It is working when it has been
run and seen to work.

## R4. "Verified" means exercised against the real thing

The strongest rule in the project, and the one broken most often. A passing test
is not verification. `PROJECT-LOG.md` keeps a separate **"Verified live, not just
tested"** table for things proven against the real platform, and prose elsewhere
must say plainly when something was only compiled or only unit-tested.

This has been broken twice and recorded both times: a hydration fix reported as
verified before it was, because `pkill` fails silently on Windows; and tier 1.2
committed before its tests were run.

## R5. Everything is documented in the workspace, not in a chat

> "make sure everything is documenting in your back end… if we lost any chat or
> something like that everything is locally available… every test every new
> feature every future post every future task"

A fresh session, or a different account, must be able to resume from the files
alone. Chat transcripts are not a record. Applies to research, decisions, rules,
shared material and rejected options — **including things we decided not to do**,
because a recorded rejection stops it being re-proposed forever.

## R6. Nothing is judged done by its label

> "1.2 Multiple accounts this is not yet done because still a lot of social media
> account need to be added, like youtube, Tiktok, Pinterest, X, and someothers"

A roadmap item is done when the thing a reader would expect from its name is true.
"Multiple accounts" was renamed to "Connect several accounts from one
authorisation" and a separate **Platform track** table added, because the original
label could be read as "all platforms are connected".

## R7. Research before asserting how a platform works

Added after a real mistake: Threads was described as "almost free, the same Meta
app" on the assumption that Meta owns it. It is not — `graph.threads.net`, its own
OAuth, its own scopes, its own token lifecycle. The correction was made publicly
and in the roadmap.

Platform behaviour is checked against current documentation and recorded in
`research/` with its source and date. An unverified claim is labelled unverified
rather than stated plainly.

## R8. Preserve what works; a rollback copy before replacing it

From the workspace rules, and applied concretely: `pnpm connect` was left in place
when `pnpm connect:provider` was added, because the Meta path is verified working
and replacing a verified path is a separate decision from adding one.

## R9. The foundation comes before the features

> "our basis foundation should be so strong"

> "I want you to rank all these ideas and start from that is the most
> foundational idea"

Architecture, data model, credentials and scopes, safety boundaries, and phases
come before building integrations. This is why tier 0 exists — nothing new is
built on top of a known defect.

## R10. No platform name outside the adapters and core

Enforced by a test, not by discipline:
`source/packages/core/test/architecture.test.ts` scans the source and fails if a
platform name leaks into the UI, queue, vault or publisher. It has already caught
production code once, and the fix was to build the `Provider` abstraction rather
than to add an exception.

## R11. AI proposes; a deterministic validator authorises

Nothing an AI decides may execute an irreversible or money-spending action on its
own. The classification and the limits live in code, not in instructions to a
model.

**Status: built 2026-09-26** for publishing, in
`source/packages/core/src/domain/policy.ts`. Actions are classified low, medium or
high risk; high risk returns a summary and a token and executes only when that
token comes back. The token is an HMAC over the exact payload, so it cannot be
invented and does not survive an edit to the content — which is what a `confirm:
true` boolean could never give, since the model setting the flag is the one that
composed the post.

Unclassified actions default to **high**, so forgetting to classify a new action
fails closed.

Spend ceilings are written and tested but used by nothing, because no ads code
exists yet.

---

## Adding to this file

A rule belongs here when the owner states how work should be done, rather than
what to build. Requests to build something go to `ROADMAP.md` or `IDEAS.md`.
Reasoning about a specific choice goes to `decisions/`.
