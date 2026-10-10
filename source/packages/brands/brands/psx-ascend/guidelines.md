# PSX Ascend brand guidelines

Imported from the approved **v2.0** design system (`Websites/PSX-Ascend/docs/PSX_DESIGN_SYSTEM.md`)
and its implementation (`app/globals.css`). Rules from the **v3 candidate**, the brand handbook and
the social playbook are included because they are useful, but their own sources call them
candidates or proposals, so they are marked **proposed** here too. v2 stays the baseline until
PSX adopts v3.

## Overview

PSX Ascend is a connected powersports dealership growth platform: customer intelligence, CRM,
inventory, websites, marketing automation and multi-location execution in one operating system.

**Promise:** help dealership teams recognize customer intent, respond with context, move inventory
with purpose, and keep leadership in control.

**Audiences:** dealer principals, owners, general managers, sales and BDC leaders, marketing and
inventory teams, dealer-group leadership, existing customers.

**Personality:** premium, capable, focused, calm, powersports-specific, human, operational,
intelligent without hype, confident without unsupported superlatives.

**Review before anything is published.** Every post, ad, email, page or graphic made with this
brand goes to **Jeff, Dan and Rick** for review, by email from rana@psxascend.ai, before it goes
live. An AI prepares the review email for Rana to send; it never sends or publishes on its own.

## Colours

Forest and Paper are the structural colours; **Green directs attention** and never fills a whole
page or feed.

- Paper is the default reading canvas; Cream separates supporting sections; White raises a card.
- Forest is for the opening, proof emphasis and the footer. Avoid stacking dark sections that look
  the same.
- Green marks the primary action or selection: **Forest text on Green, never White**.
- Green text belongs on dark surfaces only. On light surfaces, links are Ink and underlined.
- Line is decorative. A boundary needed to find a control uses Muted.
- Status is said in words plus an icon, shape or border; green alone never means success. A
  red/amber palette needs its own contrast review first.

The current site sets 12px eyebrows in `#3A9C2A`, which measures 3.41:1 on Paper, under the 4.5:1
AA minimum. New work uses Ink or Muted for eyebrows on light surfaces (recorded as a finding, not
changed on the site).

## Typography

**Geist** (the site's own variable file), fallback Arial.

| Role | Size | Weight / leading |
|---|---|---|
| H1 / display | clamp(48px, 5.5vw, 82px) | 680 / 0.96-1 |
| Large H2 | clamp(42px, 5vw, 70px) | 400 / 1.01-1.05 |
| Card H3 | 22-38px by hierarchy | 500 |
| Lead | 17-20px | 400 |
| Body | at least 16px | 400 / 1.65 |
| Eyebrow | 10-12px uppercase, 0.10-0.13em | 650-800 |

One H1, logical H2/H3. Negative tracking for large headings only. No heavy bold headings across
body sections. Geist is under the SIL Open Font License 1.1; its licence text ships with the file.

## Logo

**Use only the original logo file, or write "PSX Ascend" in plain text.** This is the owner's
standing rule (2 October 2026), after an invented "PSX ASCEND" wordmark was rejected.

- The file is `psx-ascend-logo.webp`, the green "A" mark with "PSXASCEND" (323×121 raster, made
  for light backgrounds). No vector, reversed, stacked, symbol or monochrome master exists, and a
  missing variant is not permission to make one.
- On dark or busy imagery, put the full-colour logo on a **Paper field** with clear space.
- Clear space (candidate): at least the capital-letter height of the wordmark on every side.
- Minimum size (candidate): 154 CSS px on screen; at least 240px wide on a 1080px social export.
- Never draw, typeset or generate a wordmark; never set "PSX" and "ASCEND" in two colours; never
  reuse the archived old `og.png`; never stretch, rotate, recolour, outline, shadow or crop it; never
  extract an icon from it; never fuse a partner mark with it.
- Alt text "PSX Ascend"; a linked logo is named "PSX Ascend home".

## Layout and spacing

Container 1200px; side space at least 24px desktop, 17px tablet, 14px mobile. Grid for structure,
Flexbox for alignment; the standard split is about 1.1fr / .55fr. Card grids go from four or three
columns to two, then one.

8px rhythm: micro 4/8/12, component 16/20/24/32, content 40/48/56/64, sections 78-120px, hero
padding 88-110px. Radii: pill CTAs, 9-14px small UI, 18px cards, 22-26px dashboards.

Test 360, 390, 768, 1024, 1366 and 1440px. Never hide, crop or simplify meaningful dashboard
content on mobile: stack it.

## Components

- **Buttons:** at least 50px tall (46px compact header), pill label with a circular arrow. Up-right
  arrow = navigate or act; down-right = continue on the page. Green primary; dark (Ink) primary on
  light; light outline secondary on dark; inline link for detail. Focus: 3px solid `#96ED7C`, 3px
  offset. Labels stay stable: Request a demo, Visit support, Continue to secure login.
- **Cards** (`.premium-hover-card`): purpose, name, short description, meaningful visual; about
  720ms hover, 5-7px lift, gentle green border shift, soft forest shadow.
- **Dashboards and popups:** explain how the product works, with readable status, a real-world
  object, the next action and a human owner; two or three popups at most, never covering labels.
- **Forms:** visible labels, 16px inputs on mobile, clear errors, privacy context near submit.
- Shared components: SiteHeader, SiteFooter, FaqSection, MotionEnhancer, DemoForm.

## Imagery and icons

Powersports showrooms, machines, dealership teams, customer conversations, deliveries and
inventory workflows. Faces and vehicle context stay visible in every crop. Images must add context,
evidence or understanding; no generic corporate stock and no generic SaaS dashboards.

Existing images are references, not proof of named people or events. Caption illustrative or
generated imagery that could be mistaken for evidence. Demo data never impersonates real customer
data; real results are labelled dealer-reported.

Icons come from one existing licensed family with consistent weight, accompany their labels, and
decorative arrows are hidden from assistive technology. OEM and dealer marks are proof, not
decoration: accurate names, original artwork.

## Voice and copy

Lead with the dealership problem, decision or outcome. Use concrete nouns (customer, salesperson,
unit, inventory, rooftop, conversation, appointment, next action) and direct, human sentences.
Explain AI through what it does for the dealership, with people and managers in control.

Approved names: **PSX Ascend; CXMAi; ALMA, the Automated Lead Management Assistant; AI-Powered
CRM; Inventory Management; AI-Powered Websites; Marketing Automation; Multi-Location BDC.**

- Never invent metrics, results, integrations, awards, quotes or capabilities.
- Label customer results as dealer-reported and keep the verified wording.
- No em dashes in headings, no decorative hashes, no vague hype or generic AI language.
- Sequence: eyebrow, direct heading, practical description, action, then proof.
- US English.

## Ad creatives

From the social playbook (**proposed** in its source): one main point per creative, the caption
carries the detail. At 1080px wide: headline 76-104px, body 34-44px, essential metadata at least
28px; check legibility at about one-third size. Internal margins 72px; in vertical formats keep
copy out of the top 250px and bottom 320px, with extra room on the right for platform controls.

- The logo sits in a predictable place, on a Paper field over dark or photo backgrounds.
- Green for one word, one rule or one small area of emphasis.
- A drawn CTA on an image is not a button; the caption and the destination complete the action.
- Meta's placement specifications are **not certified** in the source: preview every placement
  before release.
- Proof, events, hiring and partner creatives need verified source material first.
- **Review with Jeff, Dan and Rick before anything is published.**

The sample ad uses the playbook's storyboard line "Before the next follow-up." and the approved
CTA "Request a demo". It shows the layout only.

## Social templates

Creative families from the playbook: brand statement, dealership question, practical checklist,
workflow explanation, resource promotion, verified dealer proof, people and expertise, product
introduction, support, events, hiring, partner announcements. Proof, events, hiring and
partnership use production briefs until verified material exists.

**Carousel recipe:** the cover asks a useful question; slides 2-4 each give one practical step;
the last slide summarises and offers a related next step. A small sequence indicator on every
page; each middle slide makes sense on its own.

**Captions:** first line the situation or question, then useful context, then one accurate next
step; a few relevant CamelCase hashtags at most. Never "link in bio" unless the profile link has
been checked.

## Downloads

- `brand.json`: every token with its role and source.
- `psx-ascend-logo.webp`: the original logo, the only one allowed.
- `OFL-Geist.txt`: keep it with any copy of the font.

The logo is PSX Ascend's trademark, used by the agency for PSX Ascend work only.
