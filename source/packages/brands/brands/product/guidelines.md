# The product's brand guidelines (proposed, name not final)

This is the AI marketing product itself. **"AdsPilot" is a working name only**: the name is taken
(`research/2026-10-01-product-name.md`) and is being replaced. The display name comes from the
central product settings (`productName()`); while that is the working name, this brand shows a
placeholder. Colours and
type are the dashboard's own; adopting them as the product's brand is **proposed**. There is
deliberately **no logo**.

## Overview

The product bet, in the owner's words: give one MCP server to a person or company and they no
longer need to go anywhere else, or hire a whole team. It posts to social platforms and runs paid
ads from any AI chat, and nothing public happens without the user's approval.

Until the owner chooses the name and a launch identity:

- nothing public carries a product logo or the working name;
- product ads and posts are drafts, never published;
- the placeholder wordmark below is a dashed text box, clearly not a logo.

## Colours

The dashboard's dark palette (`apps/web/src/app/globals.css`): background `#0B0D10`, surfaces
`#12151A` and `#171B21`, line `#232830`, ink `#E6E8EB`, muted `#9AA4B2`, violet `#7C5CFF` and
`#9D85FF`, and status colours OK `#5EE6A8`, Warn `#FFC95C`, Bad `#FF6B6B`.

**Finding:** the dashboard's buttons put 0.92rem white labels on `#7C5CFF`, which is **4.35:1**,
under the 4.5:1 AA minimum for normal text. Proposed fix: an Action violet `#6A4AF0` (5.45:1) for
button fills, keeping `#7C5CFF` for focus rings and large accents. The dashboard itself is not
changed by this file.

Status is always a word plus a colour, never colour alone.

## Typography

The system font stack, as the dashboard uses it: nothing to license and nothing to load. Body
16px, controls about 14.7px semibold, small text at least 13px. A brand typeface is a launch
decision, not part of this proposal.

## Logo

**None exists, on purpose.** The name is not final, so any logo now would be thrown away or, worse,
published under a name the product cannot keep.

- The viewer and any draft show a dashed **placeholder wordmark**: the product setting's name, or
  "Product name" when the setting is empty or holds the working name.
- Never put "AdsPilot" in a logo, on an ad or on any public image.
- Never invent a logo, icon mark or wordmark, and never borrow 1920 Agency's or a platform's logo.

## Layout and spacing

Tailwind's 4px steps, 12px card radius, 8px controls, 20px card padding. Single-column forms;
card grids that wrap. Every error message follows the project rule: what happened, why, and the
numbered steps to fix it.

## Components

Primary button (Action violet, white semibold label, 8px radius), ghost button (line border, ink
label), card (surface, line border, 12px radius), input (surface 2, line border, violet focus
border), status pill (a word in its status colour), link (violet soft, underlined). Visible focus
everywhere: a 2px violet outline.

## Imagery and icons

Real screens of the product working: the AI chat, the approval summary, the published result,
with real or clearly labelled demo data. No invented results, ROAS figures or customer logos; no
platform logos implying partnership; no mock-ups of features that are not built. Icons are simple
line icons with text labels.

## Voice and copy

Plain, exact, calm, helpful. Say what happened, why, and how to fix it. Never call anything
verified, live or done until it has been proven against the real platform. Plain words for
business owners, not marketing jargon.

## Ad creatives

Drafts only until the name and identity are final. When they are: show the real product, the
approval step and one plain benefit, inside the usual safe areas (stories: out of the top 250px
and bottom 340px), and claim only what `CURRENT-STATE.md` shows as verified live.

## Social templates

Two proposed layouts: a **how it works** carousel (connect, ask in plain words, approve, see what
happened) and a **feature card** (one proven feature, one real screen, what the user stays in
control of).

## Downloads

- `brand.json`: the tokens, with sources and "proposed" marks.
- No logo files and no font files exist for the product.
