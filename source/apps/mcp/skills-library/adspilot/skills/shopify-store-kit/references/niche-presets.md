# Design presets by kind of business

Starting points when the business has no brand system yet. Propose one to the owner and
get a yes before building. Fonts are Shopify font-library handles (check the current list
on shopify.dev: themes → settings → fonts); colours are hex for `color_palette`
(`background`, `foreground`, `color1` = secondary text, `color2` = lines) plus the kit
sections' accent setting. Contrast ratios are for text on the background (WCAG AA needs
4.5:1); verify any change with a contrast checker.

| Business | Heading / body fonts | Background · ink · secondary · line | Accent (labels, sale badge) | Corners |
|---|---|---|---|---|
| Sports, outdoor, action (used on the practice store) | `barlow_condensed_n7` / `barlow_n4` | #F5F4F0 · #111315 (16.9:1) · #5A5F66 · #E2E0DA | #FF5A1F with ink text only | 0–2 px |
| Sports, cooler | `barlow_condensed_n7` / `barlow_n4` | #F6F7F7 · #14202B (15.4:1) · #5B6770 · #E3E7EA | #2448FF (white text 6.1:1) | 0–2 px |
| Footwear and streetwear | `oswald_n6` / `archivo_n4` | #F4F3EF · #141414 · #5C5C5C · #DEDCD6 | #C8102E (white text passes) | 0–2 px |
| Fashion, premium apparel | `instrument_sans_n6` / `instrument_sans_n4` | #FAF9F7 · #1A1A1A · #6B6B6B · #E7E4DF | none, or one deep tone | 0 px |
| Beauty, skincare | `instrument_sans_n5` / `instrument_sans_n4` | #F7F3EF · #2B2522 · #6E625B · #E8DFD7 | #B5543C | 4–8 px |
| Electronics, gadgets | `space_grotesk_n6` / `inter_n4` | #F5F6F8 · #0F1115 · #5B616E · #E1E4EA | #0057FF | 4–8 px |
| Home and furniture | `archivo_n6` / `archivo_n4` | #F3F0EA · #2A2722 · #6A645A · #DDD7CC | #6B7F4E | 2–4 px |
| Food, coffee, tea | `archivo_narrow_n7` / `archivo_n4` | #F6F1E9 · #241D16 · #6D6153 · #E3D9CA | #C2410C | 2–6 px |

Rules that hold for all of them:

- Body text 16 px; headings set in the recipe's sizes; uppercase headings suit sports,
  footwear and streetwear, sentence case suits fashion, beauty and home.
- One accent colour, used sparingly. Buttons use the ink colour, not the accent.
- Photos decide most of the impression: consistent backgrounds on product shots, one
  strong lifestyle photo for the hero, real people using the product where possible.
- Not verified handles in this table (check before use): `oswald_n6`, `instrument_sans_n5`,
  `instrument_sans_n6`, `space_grotesk_n6`, `archivo_narrow_n7`. Verified on the practice
  store: `barlow_condensed_n7`, `barlow_condensed_n6`, `barlow_n4`, `barlow_n5`.
