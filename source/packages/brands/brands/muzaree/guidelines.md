# Muzaree brand guidelines (proposed)

Muzaree had no design system. This one is **proposed** from the brand's real assets, checked on
2026-10-10: the live store's two logo files and fonts (muzaree.com), the theme's colours and
button style (the 5 September theme export), and the account's best-performing Meta ads (the
February Chelsea posters and their October remakes). **Every value needs the owner's confirmation,
and the client's for the logo, colours and type.** Its first job is future ad creatives.

## Overview

Muzaree sells men's leather footwear in Pakistan (Chelsea boots, suede and leather loafers) on
muzaree.com, with free delivery and cash on delivery. The logo's own line is **"Timeless
Elegance"**, and the best ads look the part: dark, warm, classic serif type, a gold price and the
real shoes.

What the brand stands for, in the words that sold best: *"Some shoes just complete the outfit.
And then there are shoes that change how people see you."*

**For an AI making a Muzaree ad:** load this brand (`get_brand`), use the gold logo file on dark,
Playfair Display for the words, cream and gold on the studio backdrop, the real product photo, and
the true price from the live store. Footwear only, items at PKR 5,599 or more, and the owner's yes
on every new ad.

## Colours

Two families, one for ads and one for the store.

**Ads (sampled from the winning posters):** Night `#090807` canvas, Walnut `#3A2919` glow,
Charcoal `#232122` floor; **Cream `#EEE8DE`** for words and **Gold `#CDA65C`** for the price and
one emphasis. Gold on Night is 8.77:1, so it can carry text.

**Store (from the theme):** White canvas, Ink `#222222` headings, `#414141` body, `#282828` header
and footer, black buttons, and the theme gold `#C79A2B` as an accent.

- Theme gold on white is only **2.60:1**: lines and icons there, never text.
- The logo's own gold `#FEC748` belongs to the logo file only.
- The theme's mint sale label (`#84C8BB`) and hot-pink labels are off-palette; the proposed sale
  badge is Ink with white text.

## Typography

- **Playfair Display** for ads: headline, price and fact lines, centred. It is the serif the
  remade posters use and sits well with the logo's classic capitals. Shipped unmodified (its
  licence reserves the name, so no subset copies).
- **Jost** for store headings and **Poppins** for store text and buttons: the live theme's two
  fonts. Self-hosted Latin subsets; both under the SIL Open Font License with no reserved name.
- Store body text at 16px (the theme uses 14px). Buttons uppercase, 12px, 0.1em tracking.
- Capitalised product headlines ("Confidence Starts From The Shoes") are a habit of the brand's
  best ads; keep it for headlines only.

## Logo

Two original files from the live store, unchanged (SHA-256 recorded):

| File | Use |
|---|---|
| `muzaree-logo-gold.png` (300×78) | On dark: ads, the dark header |
| `muzaree-logo-black.png` (1024×286) | On white: the store header, light layouts |

Both carry the ring mark, MUZAREE in classic capitals and "TIMELESS ELEGANCE".

- Proposed clear space: one third of the logo's height on every side.
- Proposed minimum: 140px wide on screen; 260-300px wide on a 1080px ad. The gold file is only
  300px wide: ask the client for a larger gold master before using it bigger.
- Never retype "Muzaree" in a font as the logo. The February posters set the word in a serif;
  new work uses the real logo file.
- Never recolour, stretch, outline or separate the ring from the name; black on light, gold on
  dark, never the other way round.

## Layout and spacing

Store (proposed): 1280px max width, 8px steps, product grid of 2 / 3 / 4 columns, mobile first.
The first screen has one value proposition, one primary CTA and one secondary path. Size,
availability, delivery promise, exchange summary and payment options sit near the buy button.

Ads: about 64px margins on a 1080px canvas, generous air around the price, and the product in the
lower two-thirds.

## Components

Store components, proposed from the theme: black pill buttons with white uppercase labels, ink
outline buttons for secondary paths, white product cards with the name in Jost and the true price,
pill size chips for 39-44 (sold-out sizes say so in words), an Ink sale badge with the true
percentage, and 16px form fields with labels above.

No fake urgency anywhere: no recent-purchase pop-ups, no countdowns that restart, no invented
viewer counts (the September theme work removed these; keep them out).

## Imagery and icons

Low-key studio product photography: the real shoes in pairs, brown beside matt black, on a dark
textured floor in front of warm walnut wood, side-lit so the leather shines, with a few gold
props. The top third stays calm and dark for the headline.

- Real product photos only, in their true colours. No AI-generated shoes.
- Footwear only in ads: no watches (most carry replica-brand names and Meta has disapproved them).
- Recompose for each format; never stretch a portrait image into a story.

Icons: simple line icons for free delivery, cash on delivery and warranty, beside their words. No
"24/7" or "money-back" icons unless the promise is confirmed.

## Voice and copy

Confident, classic and honest about price. Start with how the shoes make him look and feel, then
the facts: premium cow leather, the colours, sizes 39-44, the price, free delivery, cash on
delivery. Name real occasions: office, dinner, a wedding, a mehndi. Roman Urdu versions are
welcome.

- Price: "Rs. 5,999 (was Rs. 10,999)". Only the true price and the true discount.
- Never "Up to 70% OFF" or "Flat 50% OFF" unless the store really shows it.
- No false urgency ("limited time", "selling fast", "only a few left") and no unconfirmed promise
  ("easy exchange", "24/7 support", "100% money-back").
- Never advertise items under PKR 5,599: after ad costs they lose money.

## Ad creatives

The layout of the account's best-ever ads (February 2026; 220 sales at PKR 601):

1. Serif headline centred at the top ("Winter Chelsea Sale", "Confidence Starts From The Shoes").
2. One large gold price ("Rs. 5,999").
3. One or two fact lines ("Free Delivery • Cash on Delivery", "Premium Cow Leather • Sizes 39-44").
4. The real shoes in the lower two-thirds on the studio floor.
5. The gold logo, bottom-centre.

Feed 4:5 is the default; 1:1 and 9:16 are rebuilt with text inside the safe area (stories: out of
the top 250px and bottom 340px). Link to the advertised shoe's product page, never to
`/collections/bags`. Check the price on the store the day the ad goes live, preview every
placement, and get the owner's yes on the summary before anything launches.

## Social templates

- **Price poster** (4:5): headline, "Every pair only", gold price, fact lines, shoes, logo. The
  remade February winner is the reference.
- **Sale poster** (4:5): a small line of what is included, one large word, the shoes, the true
  discount, the logo.
- **Product carousel** (1:1): one shoe per card with its own name, price and product link.
- **Story price card** (9:16): the price poster rebuilt inside the story safe area.

## Downloads

- `brand.json`: every token with its role, source and "proposed" mark.
- The two original logo files, unchanged.
- The three font licences (Playfair Display, Jost, Poppins): keep each with its font.

The logo files are Muzaree's trademark, used by the agency for Muzaree work only.
