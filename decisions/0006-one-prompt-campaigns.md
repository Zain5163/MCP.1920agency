# 0006 — One-prompt campaigns: the AI writes, the server knows and enforces

**Date:** 2026-09-30
**Status:** accepted
**Context:** the owner's goal, in their words: *"the user no need to do anything —
he just says run my lead generation ads, and through our MCP, using our skills,
any AI tool can launch everything, the best way possible."*

---

## The division of labour

Three things have to happen for "run my lead generation ads" to become a
working campaign. They belong in different places:

| Job | Who does it | Why there |
|---|---|---|
| **Writing** — copy, headlines, angles, variants | The AI client (Claude, ChatGPT, whichever) | It is already a language model. Adding our own model call would mean paying for it, holding a key for it, and choosing one vendor for every customer. |
| **Knowing** — what works on Meta in 2026 | The MCP server, as **prompts and resources** | MCP prompts and resources are how a server ships expertise to *any* client. This is the portable form of a "skill". |
| **Enforcing** — limits, approvals, validity | The MCP server, **in code** | Unchanged from R11. The AI proposes; code authorises. |

The consequence worth stating: **the playbook is advice to the AI, and nothing in
it is a control.** Anything that must hold — the spend ceiling, paused creation,
the approval token, the variant limits — is enforced in code regardless of what
the playbook says or what the AI decides.

## Skills: written by us, informed by others

Researched 2026-09-30. The strongest sources:

| Source | Licence | Used for |
|---|---|---|
| `coreyhaines31/marketingskills` (52k stars) | MIT | The Andromeda-era Meta playbook, scaling discipline, audit guardrails |
| `mathiaschu/meta-ads-analyzer` | MIT | Learning-phase and delivery diagnostics |
| `itallstartedwithaidea/google-ads-skills` | Apache-2.0 | Google Ads, when that platform is built |
| `Varnan-Tech/meta-ads-skill` | **none** | **Not used.** No licence means no permission. |

**Decision: we write our own playbook**, informed by these and credited, rather
than bundling copies. Three reasons:

1. **Prompt injection.** A bundled skill is text every customer's AI reads as
   instructions. Third-party text we did not write, updated upstream by someone
   else, is not something to feed to an AI holding a spending token.
2. **Fit.** Their skills describe tools they do not have and we do not have
   either. Ours can name *our* tools and *our* guardrails.
3. **Voice and currency.** One consistent source, maintained here, dated.

## Creative: what one ad can carry

Confirmed against Meta's own documentation (`asset_feed_spec`):

| Asset | Maximum |
|---|---|
| Primary texts | **5** |
| Headlines | **5** |
| Descriptions | **5** |
| Images | 10 |
| Videos | 10 |
| Calls to action | 5 |

These become **code limits**, not suggestions. Meta shows different combinations
to different people and learns which work — delivery optimisation, not an A/B
test.

**Placement asset customisation** assigns a different file per placement inside
one ad: 1:1 or 4:5 for Feed, 9:16 for Stories and Reels, 1.91:1 for landscape.
One ad, each placement served the right shape. This is how "vertical,
horizontal, square and 4:5" becomes one ad rather than four.

**Meta's AI enhancements** (automatic touch-ups, text variations, music) are
**off by default** here, with an explicit opt-in. The owner asked for it, and the
reasoning holds generally: an agency is paid for the creative it approved, and a
client who sees Meta-rewritten copy under their name did not approve it. The
exact field names were not confirmable from documentation and will be verified
against the live API, the same way the four earlier rules were.

## Lead generation, two ways

- **Website leads** — pixel plus a `Lead` event. Needs a pixel.
- **Instant forms** — the form opens inside Facebook. Needs a lead form on the
  Page. Phase 1 accepts an existing form id; creating forms from a prompt is
  phase 2, and needs the owner to accept Meta's lead ads terms once.

The playbook steers toward **Higher Intent** forms and a required work email for
B2B, because frictionless forms produce leads who do not remember converting.

## Budgets

User-specific, set by the owner, never defaulted by software:

- Owner's range, 2026-09-30: **PKR 1,000–10,000/day**, **PKR 50,000–100,000/month**.
- The **minimum** is new: below PKR 1,000/day a campaign cannot learn anything,
  so it is refused rather than allowed to waste its budget slowly.
- Limits are in the ad account's currency. A USD account sets USD limits. No
  conversion is ever applied (decision 0003).

## Phases

1. **Now:** multi-variant creatives, placement customisation, video, the
   enhancement opt-out, website and instant-form leads, the daily minimum, and
   the playbook shipped as MCP prompts and resources.
2. **Next:** creating instant forms from a prompt; reading performance so the
   playbook's kill/scale rules have data; the approval summary showing every
   variant.
3. **Later:** AI-generated creative *images*, which needs an image model and is a
   cost decision; Google Ads, which needs a developer token and Google's own
   approval.

## Rejected

- **Our own LLM call to write copy.** A cost, a key, and a vendor choice imposed
  on every customer, to do a job the client's AI already does.
- **Bundling third-party skills verbatim.** See above.
- **Letting the playbook enforce anything.** A playbook is advice to the AI.
  Controls are code.
