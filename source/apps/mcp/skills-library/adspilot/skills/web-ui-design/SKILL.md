---
name: web-ui-design
description: "Design the look and layout of a store, landing page or website so it sells and is easy to use: a small design system (type scale, spacing, colour roles, buttons and form styles), mobile-first layouts, visual hierarchy that leads to the buy or enquiry button, WCAG 2.2 AA accessibility with the numbers, e-commerce conventions shoppers expect, and the patterns that make a page look machine-generated. Use when asked to design or redesign a page, choose colours or fonts, make a site look professional or premium, fix a cluttered or confusing layout, review a design, or brief a theme change."
---

# Web UI design for pages that sell

**Updated 2026-10-08.** Sources at the end. This skill decides how a page looks and is
laid out. What it says is `copywriting`; what makes it convert is `cro` and, for stores,
`store-builder`; how it is built on Shopify is `shopify-theme-developer`. For a distinctive
visual direction (type, palette, layout concept) read `get_skill frontend-design`; for
accessibility in depth, `get_skill accessibility`.

## 1. Start from the brand and the buyer, not from a template

Ask for, and use: the logo file, brand colours, fonts, product photos, and two or three
sites the owner likes (and why). The brand's own assets always win over a new idea. If
there is no brand yet, propose a small system (section 2) and get it approved before
designing pages.

Decide the page's single job first ("buy this product", "send an enquiry"). Every
design choice should make that job easier to see and do.

## 2. A small design system (write it down before designing pages)

**Type**
- One family is enough; two at most (one for headings, one for text), clearly different.
- Body text **16 px minimum** on mobile (16–18 px), line height about 1.5, lines no longer
  than about 70–80 characters.
- A scale with a fixed ratio (for example 1.25: 16, 20, 25, 31, 39 px). Use only sizes from it.
- Prefer system fonts or one self-hosted font: every web font file slows the first view.

**Spacing**
- A base unit of 4 or 8 px; every gap is a multiple (8, 16, 24, 32, 48, 64).
- More space between sections than inside them, so groups read as groups.

**Colour roles** (not just a palette)
- Background, surface, text, muted text, border, **one action colour** for primary buttons
  and links, and status colours (success, error, warning).
- The action colour is used only for actions, so the buy button is the most visible thing
  on the screen. Do not reuse it for decoration.
- Check contrast for every text and button pair (section 4).

**Components**
- Buttons: one primary style, one secondary, one text link. Primary at least 44–48 px tall
  on mobile with a clear label ("Add to cart", not "Submit").
- Form fields: visible label above the field, a border with at least 3:1 contrast, a clear
  focus state, errors in text next to the field (never colour alone).
- Cards, badges, price (with real "was" price struck through), rating stars only for real
  ratings.

Record the system in the theme settings (`config/settings_data.json` on Shopify, via a
theme draft) or the WordPress `theme.json`, so pages stay consistent.

## 3. Layout and hierarchy

- **Mobile first.** Design at 360–414 px wide, then widen. Most ad traffic is on phones.
- One column on mobile for the main path; product grids in 2 columns on mobile.
- Order on a product or landing page: what it is → why it matters → proof → details →
  objections → action again. The first screen holds the headline, image, price or offer,
  and the primary button.
- Hierarchy through size, weight and space before colour. Squint at the screen: the
  headline, the product and the button should still stand out.
- Left-align text blocks; centre only short headings.
- Keep the familiar places: logo top left or centre, cart top right, menu in a standard
  icon on mobile, price near the title, size selector above the buy button. Baymard's
  research on large stores keeps finding that shoppers rely on these conventions; a
  "creative" checkout or product page costs orders.
- Images: real product photos, consistent backgrounds and crop ratios, the product filling
  the frame. A photo showing scale (on a person, in a hand) helps buyers judge size.

**Design for the market's language and formats** (which markets: `get_skill selling-by-country`):

- Leave room for longer words: German and French labels often run much longer than
  English ones; buttons and menus must wrap or grow, not cut off.
- Arabic (the Gulf) reads right to left: set `dir="rtl"` and `lang="ar"`, use CSS logical
  properties (`margin-inline-start`, not `margin-left`), mirror arrows and progress steps,
  and pick a font with proper Arabic glyphs. Urdu is also right to left.
- Currency, decimals and dates follow the market (12,99 € in Germany and France, €12.99 in
  Ireland, £12.99, $12.99, ₹1,299 or ₹1,29,999 with Indian grouping). Let the platform
  format money; never hand-build price strings.
- Payment and trust badges are the ones that market's buyers recognise, and only for
  methods the store really offers.
- A cookie or consent banner, where required, is part of the design: it must not cover
  the buy button or the focused field, and "reject" must be as easy to find as "accept"
  where the market requires that (EU and UK regulators' guidance).

## 4. Accessibility: the numbers (WCAG 2.2 AA)

WCAG 2.2 became a W3C Recommendation on 5 October 2023. The criteria that matter most on
stores and landing pages:

| Rule | Requirement | Criterion |
|---|---|---|
| Text contrast | **4.5:1** for normal text, **3:1** for large text (24 px, or 18.66 px bold) | 1.4.3 |
| Interface contrast | **3:1** for field borders, icons, focus rings and button edges against their background | 1.4.11 |
| Tap targets | at least **24 × 24 CSS px** (or enough space around smaller ones); aim for 44–48 px on mobile | 2.5.8 |
| Focus visible and not hidden | keyboard focus always visible and never fully covered by a sticky header, cookie bar or chat button | 2.4.7, 2.4.11 |
| Dragging | sliders and carousels also work with taps or buttons | 2.5.7 |
| Consistent help | contact or help links in the same place on every page | 3.2.6 |
| Redundant entry | do not make people type the same information twice (offer "billing same as delivery") | 3.3.7 |
| Accessible sign-in | no puzzle-only login; allow paste and password managers | 3.3.8 |
| Text alternatives | every meaningful image has alt text describing it; decorative images have empty alt | 1.1.1 |
| Not colour alone | errors, sale prices and stock states also use text or an icon | 1.4.1 |

Also: never disable pinch-zoom; form inputs at 16 px or more (smaller text makes iPhones
zoom in on focus); respect "reduce motion" settings.

**Accessibility is law in several markets** (details and sources in each market's
reference in `get_skill selling-by-country`; confirm with a local adviser for anything
binding):

- **EU:** the European Accessibility Act applies to e-commerce from 28 June 2025
  (micro-enterprises providing services are exempt); treat these rules as legal
  requirements for EU buyers.
- **US:** the ADA has no web regulation for private businesses, but many lawsuits are
  filed each year over inaccessible store websites; WCAG 2.x AA is the usual yardstick.
- **UK and Australia:** the Equality Act 2010 and the Disability Discrimination Act 1992
  apply to services offered on websites, without a fixed WCAG level for private
  businesses.
- **Canada:** Ontario's AODA requires WCAG 2.0 AA on the public websites of
  organisations with 50 or more employees.
- **New Zealand:** the Human Rights Act bans disability discrimination in providing goods
  and services; the government's WCAG standard covers public agencies only.

Meeting WCAG 2.2 AA is the safe target everywhere.

## 5. Patterns that make a page look machine-generated

Owners and buyers now recognise template-made pages, and they read as low effort. Avoid
by default (the brief can override any of them):

- Every section in identical rounded cards with the same soft shadow and gradient wash.
- A small all-caps label above every heading; numbered "01 / 02 / 03" markers on content
  that is not a sequence.
- One word in the headline in a different colour or italic.
- Fade-and-slide animation on every section; hover effects on everything.
- Stock photos of people pointing at laptops; icons that say nothing.
- Copy with "unlock", "elevate", "seamless", "it's not X, it's Y" and three-adjective lists
  (see `copywriting`, "No AI Tells").
- A dark background with one neon accent, or a cream background with a serif and a
  terracotta accent, chosen because it is fashionable rather than because it fits the brand.

The full list with reasoning is in `get_skill frontend-design` ("Process" section).

## 6. Review checklist (before showing a design or approving a theme preview)

- [ ] The page's one job is obvious in 5 seconds on a phone.
- [ ] The primary button is the most visible element and appears in the first screen.
- [ ] Fonts, sizes, spacing and colours come only from the design system.
- [ ] Contrast checked for text, buttons, field borders and the focus ring.
- [ ] Works with keyboard only; focus visible; nothing hidden under sticky bars.
- [ ] No horizontal scroll at 360 px; images sized for mobile; nothing jumps while loading.
- [ ] Every price, claim, badge and review is real and confirmed by the owner.
- [ ] Prices, dates and numbers in the market's format; layout works in the market's
      language (longer words, right-to-left for Arabic and Urdu).
- [ ] Looks like this brand, not like a template.

## Sources (checked 2026-10-08)

- W3C, WCAG 2.2 (Recommendation 5 Oct 2023, current edition 12 Dec 2024): https://www.w3.org/TR/WCAG22/
- EU Directive 2019/882 (European Accessibility Act): https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng
- Shopify Theme Store accessibility requirements: https://shopify.dev/docs/storefronts/themes/store/requirements
- Baymard Institute, e-commerce UX benchmarks (cited, not copied): https://baymard.com/research
- Vercel Labs, Web Interface Guidelines (MIT; input size, zoom, focus and form rules informed this skill): https://github.com/vercel-labs/web-interface-guidelines
- Anthropic, frontend-design skill (Apache-2.0; served as `frontend-design`): https://github.com/anthropics/skills
