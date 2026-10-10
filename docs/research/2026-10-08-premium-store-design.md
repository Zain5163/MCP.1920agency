# Premium store design: what well-designed DTC stores do (research for store builds)

_2026-10-08. Why: the first practice-store redesign (default Horizon with text edits) was
rejected by the owner as looking amateur. This is the evidence base for doing it properly.
Method: live home-page markup of 9 stores read (Burton, CAPiTA, Jones, Arbor, evo, Ridge,
Allbirds, Gymshark, On; Shopify-hosted ones through a reader proxy). Patagonia blocked every
fetch. **Not screenshot-verified:** "above the fold" claims are inferred from markup order.
Horizon facts from github.com/Shopify/horizon (v4.2.0). Labels: [Source] cited, [Judgement]
design opinion, [Uncertain]._

## 1. Home pages of premium DTC stores

| Store | Section order | First screen |
|---|---|---|
| Burton | announcement → mega-menu → video hero "Find Your Graphic" / SHOP NOW → loyalty → 3 category tiles with one-line descriptors → product carousel → feature story (Step On) → youth → heritage story → team riders with their setups → editorial → newsletter "Don't Miss a Drop" → services row | video, 3-word headline, 1 uppercase CTA; black/white + one blue #032BBF; Helvetica Now Display |
| CAPiTA (Shopify) | hero carousel (video, season tagline) → two single-board features → proof strip (handcrafted in Austria, clean energy) | 4-item nav; 0px button radius; display font NFUltra |
| Jones (Shopify) | product-launch hero → quick tiles mixing shop + guides ("Find your snowboard size") → 3 promo cards → "Riders' favorites" → founder story → Gear 101 / Team cards | product cards carry a 3-part descriptor ("All-conditions freeride · Powerful · Stable & floaty"); 1px radius |
| Arbor (Shopify) | hero "Winter 2026-27" → video → 3 big category blocks → newsletter → footer | very short page; pill buttons |
| evo (retailer) | sale hero → promo tiles → deals → brands → arrivals → services → **value strip: Free Shipping / No Hassle Returns / Lowest Price Guarantee / Rewards** | dense, promotion-led |
| Ridge (Shopify) | 3-slide hero (2–4-word uppercase) → 4 category cards → **"When you shop with Ridge": lifetime warranty / 99-day trial / free shipping** → sale → collections → products → email | Apotek Extra Condensed + Area Normal |
| Allbirds (Shopify) | hero "Wildly Comfortable. Super Natural." + 2 CTAs → tiles → best sellers → seasonal → 3 value blocks → email | free-shipping progress in cart |
| Gymshark | rotating offers → hero "SHAPE" → second hero → "Popular Right Now" → shop by activity → guides | 1-word headline |
| On | collab hero → sport carousel → model carousel → stories (shoe finder) → mission → email | 3 top-level nav items |

**Common pattern** [Source: the stores above]: lifestyle/action photo or video hero, 1–4-word
headline (often uppercase), 1–2 verb CTAs → 3–4 category tiles with a one-line descriptor →
one curated product row → proof that is not a review widget (craft, riders, founder) → fit
help (size guide / finder) → a 3–4-item benefits strip stating real policies → email with a
reason → footer Shop / Help / Company. Restraint (Arbor ~6 blocks; CAPiTA 4 nav items). Short,
concrete copy; no abstract words.

Baymard: 42% of mobile home pages misrepresent the product range (show 30–40% of top
categories); never auto-rotate carousels on mobile (5–7 s per slide on desktop); 70% of sites
do not link products shown in inspirational images.
(baymard.com/blog/mobile-homepage-usability, /homepage-carousel, /ecommerce-navigation-best-practice)

## 2. A visual system that reads as premium

- **Type** [Source]: condensed/heavy grotesk display + plain sans body (Ridge, Burton,
  CAPiTA); uppercase headlines and CTAs, sentence-case body; two families at most.
  [Judgement] tight tracking (~-1%) on big condensed caps, +4–8% on small caps labels/buttons.
- **Shopify font library** (shopify.dev/docs/storefronts/themes/architecture/settings/fonts):
  Barlow Condensed (`barlow_condensed_n1–n9`), Barlow, Oswald, Archivo, Archivo Narrow, Bebas
  Neue, Anton, Saira Condensed, Roboto Condensed, IBM Plex Sans Condensed, Space Grotesk,
  Instrument Sans, Inter. Barlow (California highway-sign grotesk, Normal/Semi/Condensed)
  fits outdoor brands as one superfamily.
- **Colour**: neutral base + one accent (Burton, Jones). Contrast computed for WCAG 1.4.3:

  | Palette | Background | Text | Muted | Line/card | Accent |
  |---|---|---|---|---|---|
  | A Summit Ink | #F5F4F0 | #111315 (16.9:1) | #5A5F66 (5.9:1) | #E9E8E3 | #FF5A1F orange, **ink text only** (6.0:1; white on it 3.1:1 fails) |
  | B Glacier | #F6F7F7 | #14202B (15.4:1) | #5B6770 (5.4:1) | #E3E7EA | #2448FF (white text 6.1:1) |
  | C Alpine Pine | #EFEDE6 | #1C2A23 (12.8:1) | #55624F (5.5:1) | #D9D4C7 | #D4FF3A, on pine only |

- **Spacing** [Judgement]: 8 px base; 64–96 px between sections desktop, 48–64 mobile; 16–20
  px mobile gutter.
- **Images**: full-bleed hero; one aspect ratio for all cards (portrait for boards); one
  consistent studio background; at least one in-scale/in-use image per product (42% of users
  judge size from images; baymard.com/blog/in-scale-product-images).
- **Corners**: snowboard brands square (CAPiTA 0, Jones 1 px); pills are the soft lifestyle
  option. Horizon's defaults are rounded/pill, part of why it reads as "default Horizon".
  Add to cart gets a style no other button uses (baymard.com/blog/button-design).

**What makes template / AI stores look cheap**: Inter everywhere; indigo/purple gradients; rows
of 3 rounded cards with soft shadows and thin icons; weightless copy; emoji icons; cards in
cards (925studios.co/blog/ai-slop-design-tells; thefountaininstitute.com). Shopify-specific:
untouched default fonts (Horizon = Inter for every role), pill buttons, mixed product-photo
backgrounds, 14 px body, sample hero left in place, free shipping only in a banner (32% of
sites; 27% of users miss it; baymard.com/blog/avoid-banners-only-free-shipping), placeholder
reviews, more than two fonts or one accent.

## 3. Horizon (Shopify, 2025–2026)

- Launched at Summer '25 Editions with 9 siblings on one block-based codebase (Tinker, Fabric,
  Vessel, Ritual, Dwell, Pitch, Heritage, Savor, Atelier). None is a sports preset: restyle
  Horizon rather than switch. v4.2.0 (18 Sep 2026).
- **From 4.0.0 colour schemes became a `color_palette`** (shopify.dev/changelog/color-palettes).
- Sections: hero (heights to full-screen, image/video, separate mobile media, overlays;
  presets hero / hero_marquee / hero_bottom_aligned), slideshow, layered-slideshow, marquee,
  media-with-content, carousel, collection-list (grid/carousel/bento/editorial), product-list,
  featured-product, product-hotspots, recommendations, blog posts, logo, divider, custom-liquid,
  and the generic `section` with presets incl. rich text, FAQ, icons with text, split
  showcase, image with text, multicolumn, image compare. No testimonials section.
- Global settings: four font roles, per-heading size/spacing/case, button radius and case,
  pills/inputs/card/product radius, badges, product card options (quick add, second image on
  hover, card carousel, hover effect none/lift/scale/subtle-zoom), page width.

## 4. Product and collection pages

- Variant **buttons**, not dropdowns (57% of sites fail; baymard.com/blog/current-state-ecommerce-product-page-ux).
- **Size-guide link right beside the size selector** (Baymard apparel sizing).
- **Directly under Add to cart**: shipping cost / free-shipping rule and the return policy
  (67% of sites lack a cost estimate on the product page; 44% hide returns; 60% of users
  expect return info there). A delivery **date** beats a speed (baymard.com/blog/shipping-speed-vs-delivery-date).
- Vertical accordions; horizontal tabs tested worst (baymard.com/blog/avoid-horizontal-tabs).
- Sticky add to cart (Horizon default on); cross-sells via recommendations.
- Collection: 2 columns mobile; ≥3 images per product; hover image desktop; whole card is the
  click area; badges only for sale / sold out.

## 5. Mobile

- 390×844 is the #2 US mobile viewport (Statcounter, Sep 2026). 57% of viewing time is above the
  fold, 74% within two screens (NN/g).
- Hero ~70–75% of the phone screen so the next section peeks [Judgement]; CTAs in the lower half
  (thumb reach); targets ≥44 pt.
- Body 16 px; iOS zooms into inputs under 16 px. Horizon's default paragraph is 14 px.

## 6. Spec used for the practice store (snowboards)

Barlow Condensed Bold headings (uppercase H1/H2), Barlow body 16 px; palette A (Summit Ink);
buttons 2 px radius, uppercase, ≥48 px tall; cards 0 radius, subtle zoom, second image on hover.
Home: announcement (real policies only) → bottom-aligned hero "MADE FOR THE FIRST CHAIR." with
Shop boards / Find your size → category tiles → "THE LINEUP" product row → dark story block
(wax) → 4 real-policy benefits, no cards → size help → FAQ → email "FIRST TRACKS." → footer
Shop / Help. No testimonials until real reviews exist. Product page: 2-column portrait gallery,
variant buttons, size guide next to sizes, delivery/returns line under the button, accordions.
