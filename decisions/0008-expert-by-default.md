# 0008 — Expert by default: the server teaches the AI, unasked

**Date:** 2026-09-30
**Status:** accepted (owner's direction)

---

## Context

A customer connects their own AI (Claude, ChatGPT or another) to AdsPilot. That
AI knows a little about advertising and guesses the rest. The owner does not want
customers to feel their "ads are not running": the expertise has to come from
the server, and it has to be used without the customer asking for it.

Until now the playbooks and the 50-skill library were served, but only an AI
that went looking would find them.

## Decision

1. **The server tells every AI how to work when it connects**, through the MCP
   `instructions` field: read the platform's playbook before any ad work, choose
   the objective from what the business wants to pay for, and apply the rules for
   that goal unprompted. Text in `apps/mcp/src/playbooks.ts`
   (`SERVER_INSTRUCTIONS`); a test keeps it in step with the tools it names.
2. **Each playbook has a section per goal.** For Meta: leads, sales and
   e-commerce, traffic, awareness, messaging, local. Other platforms follow the
   same shape.
3. **No platform launches without its playbook.** It is written with the
   adapter, not afterwards.
4. **Playbooks are dated and re-checked.** Platforms change their ranking and
   their APIs often. Each playbook states when it was last verified and against
   what, and is re-checked about every three months.
5. **Advice, never control** (unchanged from 0006). The spend ceiling, paused
   creation, approval tokens and variant limits are enforced in code whatever
   any playbook says.

## Consequences

- Clients that ignore `instructions` still reach the expertise through the
  `get_playbook` tool and the prompts.
- Playbooks say plainly what is **not built** (catalog ads, message
  destinations), so an AI does not fake a feature with a workaround the user did
  not choose.

## Can the playbooks be hidden from the user? (asked by the owner, 2026-09-30)

The owner asked that the skills be kept in TypeScript so that the AI can use
them but the end user cannot read them.

**Honest answer: not completely, and the file format does not change it.**
Whatever the server sends to the AI arrives in the user's own AI app, and the
user can ask their AI to show it. A `.md` file and a string inside a `.ts` file
reach the AI as the same text.

What does protect them:

1. **The hosted server.** Customers connect to our server; they never get the
   source, the files or the whole library. This is the real protection.
2. **Serve only what the task needs** — one goal's section, not every playbook
   at once — so nobody collects the library in a single call. (Possible next
   step.)
3. **Terms of service** forbidding copying or reselling the content.
4. **Keep them current.** A copied playbook goes stale within months; ours are
   re-checked. Being current is worth more than being secret.

The 50 marketingskills are MIT-licensed and public anyway; the value we add is
the platform playbooks, the enforcement in code, and keeping both current.
