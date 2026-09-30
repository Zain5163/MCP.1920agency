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
