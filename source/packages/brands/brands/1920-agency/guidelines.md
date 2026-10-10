# 1920 Agency brand guidelines

Imported from the approved website foundation v1.0 (locked by the owner on 28 September 2026):
`Websites/1920-agency/design-system/BRAND-DESIGN-SYSTEM.md` v1.3, `tokens.css`, the locked homepage
`prototypes/growth-modern-fusion/` and the original logo kit. Where those disagree, the rendered
homepage wins (FOUNDATION-LOCK.md). Rules marked **proposed** fill gaps for ads and social posts
and are not approved yet.

## Overview

**Positioning:** a full-service marketing team helping businesses with ads, search, social media,
video, websites and AI tools.

**Core expression:** "We help your business grow online." **Supporting line:** "One team to bring
it all together."

**Personality:** confident, thoughtful, precise, inventive, approachable.

**Visual direction:** editorial typography on near-black surfaces, controlled violet accents,
sculptural geometry, real project imagery and deliberate motion.

| Principle | How it appears |
|---|---|
| Clarity first | One clear focal point and primary action per section |
| Creativity with purpose | Graphics express connection, forward movement or transformation |
| Space creates emphasis | Generous margins and a quiet background around major statements |
| Evidence builds trust | Real work, accurate project names, supported claims |
| One connected system | Shared type, palette, spacing and interaction patterns |

**For an AI designing anything for 1920 Agency:** load this brand first (`get_brand`), use only
these colours, Manrope and the original logo files, follow the voice rules, and ask the owner
before using anything marked proposed in published work. Nothing here makes a design live: every
post and ad still goes through the normal approval step.

## Colours

Four authoritative colours: **Deep Onyx `#0D0C10`**, **Electric Violet `#7B2CBF`**, **Amethyst
Tint `#C77DFF`** and **Pure Stark White `#FFFFFF`**. Do not substitute similar blacks, purples or
off-whites. Surfaces and text greys are controlled derivatives and do not widen the palette.

Recommended balance: 75-85% Onyx, 8-15% White, 5-8% Violet, 2-5% Amethyst (an art-direction range,
not a pixel formula). The palette should feel sophisticated and inventive, never mystical,
theatrical or nightclub-like.

- Electric Violet on Onyx is **2.74:1**: decorative shapes only. Meaningful text and interaction
  cues use White or Amethyst.
- Display muted `#79757F` reaches only 4.33:1 on Onyx: large display text only.
- Status (success, error, warning) is said in words and icons; a purple border alone must never
  mean "error". No functional status palette is defined yet.
- Client colours stay inside their project frames; they never become UI colours.
- Gradient text on one short phrase in a major heading; paragraphs stay solid. Do not put a
  gradient heading on a gradient surface.

## Typography

**Manrope**, self-hosted (the site's own `manrope.woff2`, weights 200-800), fallback Arial. No
second display font.

Sentence case for headings and buttons; uppercase only for short labels, tags and decorative
bands. Display tracking about -0.055em, section headings -0.035em, eyebrows +0.14em to +0.20em.

The homepage uses very small editorial microtype; keep its hierarchy but use 16px for substantive
body copy and 14-16px for meaningful labels and controls on new work. Reading width 45-70
characters. One H1 per page; no em dashes in website headings.

Manrope is under the SIL Open Font License 1.1 with no Reserved Font Name: self-hosting and
subsetting are allowed, and the licence text travels with every copy (`fonts/OFL-Manrope.txt`).

## Logo

The owner's **original logo files**, chosen again on 28 September 2026 after other concepts were
explored. The copies here are byte-for-byte the originals (SHA-256 recorded and checked).

| File | Use |
|---|---|
| `primary-white.png` (200×80, transparent) | Website primary and the default on every creative |
| `alternate-purple.png` (200×80) | Alternate for dark backgrounds |
| `compact-square.png` (500×500) | Avatars, icons and favicons |

- Header 156px wide on desktop, 128px on mobile; footer 180px / 156px.
- Clear space: at least 25% of the displayed logo height on every side.
- On a light layout, place the original on a dark brand panel; never a recoloured substitute.
- The display SVGs in the website kit only wrap the PNGs; they are not vector masters. No vector
  master has been supplied.
- Never trace, recolour, redraw, stretch, rotate, outline or add effects; never type "1920 Agency"
  in a font as a logo. The website's 2.15-second reveal is the only approved motion.

## Layout and spacing

Content max 1320px (outer wrapper 1600px); gutters 5% desktop and 6% mobile, never under 20px;
breakpoints 760px, 1100px and 1700px. Section spacing 105px / 80px / 65px.

Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 104, 120px. Corners (v1.3): pill actions
and filters, 18-22px cards, 28px major panels, 4px chips.

Hero: half copy, half art, heading clear of the sculpture; stack on mobile. Projects: one featured
full-width project, then two half-width. Services: art panel beside an accordion. Never overlay
essential copy on artwork; never fix the height of a text container.

## Components

- **Primary button:** violet gradient, White text, pill, semibold, optional north-east arrow; at
  least 44px tall. Hover lifts up to 3px with a brighter glow; focus is a 2px light-purple outline
  with a 4-5px offset.
- **Quiet button:** transparent with a visible neutral border.
- **Card:** Surface `#151319`, subtle border, 20px radius. Glass only for small floating notes.
- **Informational tag:** 4px radius, quiet border, never interactive-looking. Selection chips are
  real checkboxes with a visible selected mark.
- **Form fields:** persistent labels above, 16px text, specific inline errors. A draft that is not
  sent says "Your enquiry is ready", never "Message sent".
- **Navigation:** logo left, four links, one CTA right; mobile menu button at least 44×44px.

Motion: hover 200-300ms, reveal 750ms once per element, one dominant moving element per viewport,
reduced motion respected from the first frame.

## Imagery and icons

Real portfolio screenshots in dark browser frames over lavender, charcoal or pearl stages; real
team and process photos with natural skin tones; one dominant signature graphic (orbit, signal
star, flow ribbon, portal) per composition, with any secondary shapes faint and at the edges.

Avoid stock portraits as clients or staff, generic business illustrations, rainbow iridescence,
cyan, metallic gold or bright green decoration, and glass on every card.

Tool and platform marks keep their original geometry, shown monochrome white at 14-18px inside
illustrations (Adobe marks keep their colours). They never imply a partnership. Icons supplement
labels; they never replace one without an accessible name.

## Voice and copy

Write like an informed creative partner: clear, energetic, specific and human. "We" for the
agency, "you" for the reader. Plain language a grade 7-8 reader can follow.

- Explain what a service does before naming tools; explain AI with practical examples.
- Headings 3-8 words; CTAs 2-5 words ("Talk to us").
- Claims, reach, response times, ratings and outcomes must be evidence-led. Never invent
  testimonials, scores, metrics or dates.
- Markets served: Pakistan, Bahrain, the UK and the USA, from an Islamabad base.
- The product's working name never appears on a creative.

## Ad creatives

The guide's social recipe: **logo with clear space → one short message → one signature graphic or
genuine project image → restrained CTA.** Rebuild the hierarchy for every format; never crop a web
page into a post.

**Proposed** for ads (the guide has no ad section): Onyx canvas with one soft violet glow; the
white primary logo at the top; one gradient phrase in the headline; Amethyst for the eyebrow; a
violet pill CTA. Feed 4:5 is the default; 1:1 and 9:16 are rebuilt, not cropped.

Text sizes and words follow Social-Render's checks: body at least 34px and nothing under 24px at
1080px wide; never links, long digit runs (IDs), tokens, "swipe" or the product's working name on
an image. Story copy stays out of the top 250px and bottom 340px.

Social-Render itself renders the owner's **personal** brand (Zain Usman: navy, teal, Geist), not
1920 Agency. Only its formats and checks are reused here; do not use its colours for 1920.

## Social templates

Four layouts from the design system's social examples (`design-system/social-examples/`): a square
brand statement, a portrait service post, a vertical creative story and a landscape agency card,
plus a **proposed** carousel recipe (one idea per slide, dark slides, one gradient phrase each).

Every template: logo with clear space, one message, one graphic or real project image. Never
invent results, reviews or client logos; show a client's logo only with permission.

## Downloads

- `brand.json`: every token with its role and source.
- The three original logo PNGs, unchanged.
- `OFL-Manrope.txt`: keep it with any copy of the font.

The logo files are the agency's own trademark artwork, for 1920 Agency work only.
