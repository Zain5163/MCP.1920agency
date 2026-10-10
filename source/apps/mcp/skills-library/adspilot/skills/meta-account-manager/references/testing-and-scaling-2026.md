# Testing, scaling and multi-creative ads on Meta (research, October 2026)

Researched 2026-10-09 for a small-budget e-commerce account (about USD 18/day, cash on delivery).
Labels: **[Meta]** Meta's own docs or posts; **[Practice]** named practitioners; **[Vendor]** tool or
agency claims; **[Unverified]** could not be traced to a primary source. Re-check Ads Manager before
relying on a UI detail: Meta changed the flexible format in 2026.

## Andromeda: creative is the targeting

- Andromeda is Meta's retrieval engine: it picks the few thousand candidate ads that reach ranking
  [Meta, engineering.fb.com, Dec 2024]. Meta (Mar 2025): as advertisers upload more diverse creative,
  Andromeda "pick[s] the right creative to deliver more personalized ads" [Meta for Business].
- With broad audiences, the creative decides who sees the ad. Diversity means a different **format**
  (static, UGC video, carousel, demo), **persona**, **angle** (price, comfort, occasion), **setting** or
  **visual hook**. New headlines, colours or music on the same visual are variations, not new concepts
  [Practice: Motion; Loomer]. Make visually different hooks, not only text variations.
- Diverse creatives across formats and messages: up to 32% better CPA; 9:16 video with sound, an early
  hook, a person on screen and a text overlay: 16% lower CPA [Meta / AppsFlyer / Dentsu, 1.1M creatives,
  reported Jun 2025].
- Concepts per ad set: Meta no longer publishes a number. Vendors say 8–20 [Vendor]. Small budgets do not
  benefit from high ad volume [Practice: Loomer].

## Several creatives in one ad

- **Flexible format**: up to 10 images/videos, 5 primary texts, 5 headlines, 5 descriptions, one CTA;
  Meta picks per person and placement. Since March 2026 it is a "Flexible media" toggle inside
  Advantage+ creative, not a separate format [Practice/Vendor, secondary].
- **Reporting is limited**: the creative breakdown often shows only image vs carousel, not which asset
  won [Practice: Loomer]. So flexible ads are for **scaling and consolidating proven creative**, not for
  finding winners. To find a winner, use one asset per ad.
- **5 primary texts × 5 headlines** per ad is worth using everywhere: each a different angle or hook.
- Meta's **Creative Testing tool** (Ads Manager) splits budget evenly across up to 5 new ads for up to
  30 days, then they keep running [Practice/SEJ].
- API: `asset_feed_spec` (images, videos, bodies, titles, descriptions, `ad_formats`,
  `call_to_action_types`, `optimization_type`); `ad_formats: AUTOMATIC_FORMAT` mixes images and video
  [Meta docs].

## Structure on a small budget

- At ~5–8 purchases a day, a light split works: one **scaling** campaign (campaign budget, Advantage+
  audience and placements, the proven ads plus graduates, 6–10 ads at most) and one **test** campaign
  (ad-set budget, one new asset per ad, 3–4 new concepts per batch, a new batch every 3–4 days).
  Below ~USD 50/day some practitioners run a single ad set [Practice: Loomer].
- **Budget split**: about 70–80% proven, 20–30% testing [Practice, heuristic]. 70/20/10 (proven /
  adjacent / bold) is a variant. "80/20" in organic content is a different rule (value vs promotion).
- **Test in ad-set budgets**: added to a winning ad set, new ads get starved by the old one [Practice].
- **Graduate a winner by its post ID** ("use existing post") so likes and comments carry over.
- **Kill / keep rules** (set them before launch; multiples of target CPA) [Practice]:
  - no judgement before **2× target** spent;
  - **0 purchases at 2× target** → off (range quoted 1.5–3×);
  - **1 purchase** → hold to 2–3× target for 48–72 h;
  - **winner**: 3+ purchases at or under target (strict: 5 at 20% under);
  - video early signals: hook rate (3-s plays ÷ impressions) < 25% weak, > 35% strong [Practice: Motion].
- **Scale** +15–20% every 2–3 days; when a winner stalls, add creative rather than budget. The "20% resets
  learning" figure is not in Meta's docs [Unverified]. Adding one ad to a large ad set did not reset
  learning in one 2025 test [Practice, single test].

## Intraday checks

- The last 48 hours are provisional: purchases are credited to the click date and can arrive up to
  72 hours later [Practice: Loomer].
- Daily budget is really weekly: Meta may spend up to 75% over on a day, never more than 7× in a week.
- **Safe intraday**: fix delivery (rejections, payment, broken links, stock), pause an ad that passed a
  pre-set kill line, moderate comments. **Harmful intraday**: budget edits, switching things off and on,
  many scattered edits. Batch budget and structure changes once a day.

## Cash-on-delivery markets

- The pixel's Purchase fires when the order is placed, refused parcels included, so Meta learns from
  orders that never pay. Send **confirmed or delivered orders** as a custom event via the Conversions API
  and, once there is volume, optimise on it [Vendor sources; principle sound].
- Trust signals that matter to COD buyers: the couriers actually used, "orders confirmed on WhatsApp
  before dispatch", a short exchange policy, a WhatsApp number that answers, real photos of the item
  shipped [Vendor/Practice, Pakistan].
- Language: no published test compares English, Urdu and Roman Urdu ads; test it in the account.

Sources and links: the {{PRODUCT_NAME}} repository's research notes for the client account that prompted this
(2026-10-09), and the citations in the original report.

## When to switch an ad off (and when not to)

**Judge an ad only after Meta has given it a fair chance.** In one ad set Meta sends most spend to the
ad it predicts will do best, so a new ad can get almost nothing. Low impressions mean "Meta prefers a
sibling", not "this ad does not sell".

| Situation | Meaning | Action |
|---|---|---|
| Low spend (under ~1× target CPA) and under ~1,000 impressions | Untested | Do **not** switch off for cost; it costs little while idle. For a real test, move it to an ad-set-budget test campaign (or Meta's Creative Testing tool) |
| ≥ 2× target CPA spent, or several thousand impressions | Tested | Judge with the order below |

Order of evidence:
1. **Purchases and CPA**, only after 2× target spend (below that, one sale is luck).
2. **Early signals** after ~1,000–2,000 impressions: link CTR (< ~1%, or half its siblings, = the hook
   or image does not stop people); video hook rate (3-s plays ÷ impressions; < 25% weak, > 35% strong);
   CPC and CPM against siblings.
3. **Where the funnel breaks**: clicks but no add-to-cart = the product page or offer, not the ad;
   add-to-cart but no purchase = checkout, delivery terms or price. Do not kill the ad for a page problem.
4. **Meta's quality, engagement and conversion-rate rankings** (after ~500 impressions): below average
   on all three is a strong signal.
5. **Timing**: the last 48 hours are provisional (purchases credited to the click date, up to ~72 h late).

Switch off when: 0 purchases at 2× target (test ads); over break-even CPA after 3–4× target spend; weak
CTR after real spend; a wrong price, false discount or expired offer (immediately). Never the last ad in an
ad set; the account's proven ad only on 3-day numbers.
