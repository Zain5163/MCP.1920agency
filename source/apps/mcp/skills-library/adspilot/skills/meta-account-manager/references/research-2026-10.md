# Meta e-commerce strategy research, 8 Oct 2026

_{{PRODUCT_NAME}} reference for the meta-account-manager skill. Researched online 2026-10-08 for a real account (a Pakistani footwear store, named here only as "the example store"). Re-check anything older than about three months._

**Purpose:** find out how expert Meta buyers run and scale e-commerce accounts in 2025–2026, applied to an example store. The example is a Pakistani men's footwear store on Shopify. It sells cash on delivery (COD) at an average order of about PKR 7,000. It spends PKR 4,000–9,000 a day and gets about 4–8 purchases a day at about PKR 1,350 per purchase. The target is PKR 500–700.

**Source tags used throughout**
- **[META]**: Meta's own documentation, engineering blog or summit statements, including statements Meta made that the trade press reported
- **[DATA]**: a third-party dataset such as Motion, Haus or Baymard. It is real data, but someone else's sample
- **[PRAC]**: practice that several independent practitioner sources repeat
- **[OPINION]**: one person or one agency's view or case study
- **[INFER]**: my own arithmetic or inference from the sources. It is not a sourced claim

Everything read online was treated as data. Several popular "facts" could not be traced to Meta and are flagged below. Meta Help Center pages and jonloomer.com blocked direct fetching (HTTP 403). Claims from those pages are cited through the secondary source that quoted them.

---

## Actionable rules

1. **Consolidate to one prospecting campaign with one broad ad set (two at most) until the account produces 50+ purchases a week.** Learning is counted per ad set: about 50 optimisation events in 7 days [META via PPC Land / Jetfuel 2026]. the example store makes about 28–56 purchases a week across the whole account [INFER], so every extra ad set splits a signal that is already too small. Practitioners now recommend 1–2 broad ad sets per objective and separate ad sets only for "genuine differences in audience, objective, or budget" [PRAC: PPC Hero 24 Jun 2026; Balistro 17 Aug 2026; Jetfuel 21 Aug 2026].
2. **Budget to the conversion math, not to a habit.** 50 purchases a week at PKR 600 needs about PKR 4,300 a day in one ad set. At today's PKR 1,350 it needs about PKR 9,600 a day [INFER from the 50/7-day rule]. Meta has also reportedly shown some purchase-optimised ad sets a shorter learning threshold of "10 conversions in three days", which is about 3–4 a day [OPINION/observed: Jon Loomer ~Jun 2024; Madgicx 9 Jun 2024]. Treat that as possible, not guaranteed.
3. **Use broad targeting (Advantage+ audience) with no interest stacks.** Under Andromeda the ad creative effectively does the targeting [META: Andromeda engineering post 2 Dec 2024; PRAC: Precis 19 Jul 2026, PPC Hero 2026].
4. **Run 8–12 genuinely different concepts in the scaling ad set and judge diversity by concept, not variant count.** Meta groups near-identical ads and counts them as one [META: Creative Similarity metric reported Oct 2025; Creative Diversity score launched 26 Aug 2026 per CTC 9 Sep 2026]. Concepts should differ on at least 3 of these 5: content style, message, hook, format and spokesperson [PRAC: CTC 2026]. Meta told SMBs to use "10–20 diverse, tested assets" going into Q4 [META via AppDeveloper Magazine 28 Oct 2025].
5. **Check the Creative Diversity column (ad set level) and Account Insights → Creative fatigue / similarity every week.** These are the only native signals for whether Meta treats your ads as distinct [META per CTC 2026; Admetrics 14 May 2026]. Meta calls the diversity score "estimated and in development".
6. **Test new creatives without disturbing winners.** Either use Meta's built-in Creative Testing (2–5 ads in the live ad set, equal split, results under Experiments, up to 30 days) [META feature, per EasyInsights 17 Oct 2025; SEJ 12 Nov 2025], or run a small separate ABO test campaign and move winners into the scaling campaign by post ID [PRAC: Top Growth Marketing 26 Jul 2026; Jetfuel 2026]. Budget roughly 10–20% of spend for testing [PRAC].
7. **Kill rule: about 2× target CPA spent with zero purchases means off. 2–3× CPA spent is the minimum before calling a winner** [PRAC: multiple 2026 sources]. For the example store that is about PKR 1,200–1,400 with no sale, or PKR 1,200–2,100 before judging [INFER]. Use the CPA you can actually afford per *delivered* order, not the aspirational target, or nothing will survive (see rule 12).
8. **Scale vertically in steps of about 20% every 2–4 days on the stable ad set.** For bigger moves, duplicate or scale horizontally with new concepts [PRAC, widely repeated]. Meta counts "large" budget changes as significant edits that can restart learning [META via PPC Land]. Jon Loomer argues the learning label matters less than results [OPINION: 15 Oct 2025], so do not freeze a working account out of fear.
9. **Start on Highest Volume with no cost cap or ROAS goal.** Add a cost-per-result goal only once you have a stable CPA history, and set it slightly above break-even. A goal set too low makes Meta under-spend and narrows learning [PRAC: Jon Loomer glossary; Segwise 2026; AdManage].
10. **Do not run a big separate retargeting campaign.** Advantage+ audiences already reach warm users. If you run retargeting, keep it to about 10–20% of budget with distinct offers (cart recovery, win-back), and exclude purchasers from the last 7–14 days [OPINION: Jetfuel 6 May 2026]. The old Advantage+ "existing customer budget cap" is gone. Replicate it with ad-set exclusions or a capped existing-customer ad set [META: developer blog 3 Jun 2025].
11. **Send purchases through Pixel + Conversions API with a shared event_id, and keep Event Match Quality high.** Server events can only be back-dated 7 days [META: CAPI server-event parameters].
12. **Measure CPA per delivered order, not per Shopify order.** COD return-to-origin rates in Pakistan are often quoted at 18–30%+, but "there is no audited national figure" [OPINION: Markaz 12 Sep 2026; Simpaisa 23 Jun 2026]. At 25% RTO, PKR 1,350 per order is about PKR 1,800 per delivered order [INFER].
13. **Confirm every order before dispatch (WhatsApp or call), and consider sending a server-side "ConfirmedOrder" event to Meta.** Optimise for it only if it reaches enough weekly volume, otherwise keep Purchase [PRAC: eGrow 2025/2026, Markaz 2026; INFER on the volume test].
14. **Fix the product page before blaming ads.** Put a size guide in cm and EU/UK/PK sizes next to the size selector, show the delivered price up front, and make the page fast on mobile [DATA: Baymard 2022; Deloitte/Google 2020; Markaz 2026].
15. **Plan around the Pakistani calendar.** Winter and wedding season runs Nov–Jan with December discounts of 20–50% [APP 2 Dec 2025]. 11.11 and 12.12 are key sale dates [ProPakistani 4 Dec 2025]. Ramadan is expected to start about 8 Feb 2027, Eid ul-Fitr about 9–10 Mar 2027 and Eid ul-Adha about 16–17 May 2027 [ProPakistani 22 Aug 2026, estimates]. Prepare creative 2–3 weeks early, because new ads need time to learn.

---

## 1. Campaign structure after Andromeda

**What Andromeda is [META].** It is Meta's retrieval engine, which picks a few thousand candidate ads from tens of millions per impression. Meta claimed "+6% recall" and "+8% ads quality" on selected segments, and said it was built for "exponential ad creatives growth" from generative AI tools ([Meta Engineering, 2 Dec 2024](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/)). Practitioners date the broad rollout to mid/late 2025.

**Advantage+ sales vs manual sales.**
- [META] Since the 2025 "Advantage+ campaign experience", a sales campaign shows as Advantage+ when Advantage+ campaign budget, Advantage+ audience and Advantage+ placements are all on. The separate Advantage+ Shopping API was deprecated by v25.0 (Q1 2026) ([Meta for Developers, 3 Jun 2025](https://developers.facebook.com/blog/post/2025/06/03/advantage-plus-campaign-experience-for-sales-and-app/)). In practice the "ASC vs manual" choice is now a set of toggles inside one sales campaign.
- [DATA] Haus analysed 640 incrementality tests (Jan 2024 to Jun 2025). Advantage+ was 9% better than manual at the midpoint but 12% worse by the end, and beat manual only 42% of the time. 58% of brands got higher incremental ROAS from manual ([Haus via MediaCat, 30 Jul 2025](https://mediacat.uk/marketers-best-metas-black-box-report-shows/); [Haus report](https://www.haus.io/blog/the-meta-report-lessons-from-640-haus-incrementality-experiments)). Haus's conclusion is that there is no universal winner, so test both.
- [META claim] Meta and its partners report Advantage+ sales ROAS gains of about 22–32%. These are Meta's own averages, not independent results (Jetfuel citing Meta, 21 Aug 2026).

**CBO vs ABO.** The consensus is ABO (ad set budget) for testing, because spend is forced evenly, and CBO (Advantage+ campaign budget) for scaling [PRAC: [Jetfuel, 21 Aug 2026](https://jetfuel.agency/meta-ads-campaign-structure-in-2026-abo-vs-cbo-and-budget-architecture-for-dtc-brands/); [Top Growth Marketing, 26 Jul 2026](https://topgrowthmarketing.com/meta-ads-creative-testing-framework/)]. The most common error is testing new ad sets inside CBO, where they get starved of spend. At the example store's budget a CBO with only one ad set is effectively the same as ABO [INFER].

**How many ad sets and ads.**
- [PRAC] Use 1–2 broad ad sets per objective with 6–12 distinct creatives each, and stop running 10–20 ad sets ([PPC Hero, 24 Jun 2026](https://ppchero.com/?p=31064); [Balistro, 17 Aug 2026](https://www.balistro.com/blog/meta-andromeda-budget-strategy-2026)). Balistro's case study cut 18 interest ad sets to 4 and reported 19% lower CAC [OPINION/one case]. It expects a 1–2 week dip after consolidating.
- [META] There is a hard limit of 50 ads per ad set (several secondary sources). "Use 20–50 creatives" circulates as advice but is not traceable to Meta [unverified].

**Broad vs interests.** Broad (Advantage+ audience) is the default recommendation, because creative now drives who sees the ad: "The audience is ... something the algorithm derives from what you make" [OPINION: [Precis, 19 Jul 2026](https://www.precis.com/resources/meta-andromeda-and-creative-strategy-what-actually-changed-and-what-didnt)].

**Retargeting and existing customers.**
- [META] The existing customer budget cap was removed. Meta's suggested replacement is to exclude customer custom audiences at ad set level, or run a separate existing-customer ad set with a spending limit ([Meta for Developers, 3 Jun 2025](https://developers.facebook.com/blog/post/2025/06/03/advantage-plus-campaign-experience-for-sales-and-app/)).
- [META] Audience segments (existing customers, engaged audience, new audience) can be defined and used as a reporting breakdown in all sales campaigns, rolled out June 2024 (Jon Loomer, via search excerpt). Use the breakdown to see how much spend is going to past buyers.
- [OPINION] Jetfuel suggests 70–80% to the main Advantage+ campaign, 10–20% to manual retargeting and 5–10% to testing. Its windows are ATC 30 days and checkout 14 days, with recent purchasers excluded for 7–14 days ([Jetfuel, 6 May 2026](https://jetfuel.agency/meta-retargeting-for-ecommerce-the-complete-2026-strategy-guide/)). Its figure of "UGC 41% lower CPA" is not sourced, so ignore it.

## 2. Creative strategy

**Similarity and entity grouping.**
- [META] Meta added Creative fatigue and Creative similarity metrics. Similarity groups ads whose "images or videos appear too visually identical to be treated as unique" as one data point ([DataAlly, 8 Oct 2025](https://www.dataally.ai/blog/metas-new-metrics-and-why-the-creative-similarity-score-matters)). They sit under Analyze & Report → Ads Reporting → Account Insights ([Admetrics, 14 May 2026](https://admetrics.io/en/post/meta-creative-fatigue-and-similarity-score-complete-guide)).
- [META] An ad-set-level **Creative diversity** rating (Low/Medium/High) launched 26 Aug 2026. Meta calls it "estimated and in development". It scores variety across content style, messaging theme, hook type, format and spokesperson ([Common Thread Collective, 9 Sep 2026](https://commonthreadco.com/blogs/coachs-corner/metas-new-creative-diversity-score-is-live-in-ads-manager-what-ecommerce-brands-must-act-on-now)).
- **Not from Meta:** "Entity ID" fingerprints, "similarity >60% triggers suppression" and "keep similarity <40%" come from vendor blogs (Segwise, Spectre, Medium) with no Meta source. Precis notes its own Entity ID description is "based on practical observation rather than Meta documentation".

**How many concepts.**
- [META] Use "10–20 diverse, tested assets" for Q4 rather than 3 hero ads ([AppDeveloper Magazine on Meta's SMB summit, 28 Oct 2025](https://appdevelopermagazine.com/meta-unveils-holiday-ecommerce-playbook-at-playa-vista-summit/amp/)).
- [META] Build "a broad portfolio of assets" across personas ([Social Media Today, 17 Dec 2025](https://socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182)).
- [PRAC] Run 8–12 distinct concepts per campaign (Segwise 2026; widely repeated). CTC recommends at least 4 distinct creative families, plus 3 different formats if an ad set rates Low.
- [OPINION] Alex Neiman suggests 5–8 genuinely new concepts a month, with at least 3 visual formats per batch. In his own account data, concept-first testing had a 6.8% winner rate against 3.9% for volume-first ([Neiman, 17 Mar 2026](https://alexneiman.com/meta-ads-creative-testing-5-percent-winners/)).

**Hit rate.** [DATA] Motion analysed $1.29B of spend and 578,750 creatives (Sep 2025 to Jan 2026). About 5% of creatives became winners (≥10× the account's median ad spend), and winners took 55% of spend. Small accounts concentrate less spend on winners (23%) than enterprise accounts (64%). Enterprise accounts test about 18.8 creatives a week. Best format "is not universal" across verticals ([Motion Creative Benchmarks 2026, 17 Apr 2026](https://motionapp.com/library/research/creative-benchmarks-2026/)). The implication for the example store is to expect roughly 1 winner in 20 ads [INFER].

**Formats and hooks.**
- [META] Use 9:16 Reels. Three hook types work: value promise, statement of intent, and question/invitation. Music or voiceover gives "up to 13% higher incremental conversions" ([Social Media Today, 17 Dec 2025](https://socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182)).
- [META] Meta's AI image generation shows "11% higher CTR and 7.6% higher CVR" (same source).
- No reliable source gave a universal ranking of static vs video vs UGC vs carousel for footwear. Motion explicitly says it varies by vertical.

**Fatigue and refresh.**
- [PRAC] Watch the signals rather than a calendar. Fatigue shows as three things moving together: 7-day frequency of about 2.5+ on cold audiences, CTR down 20–30% from the ad's own baseline over 3–7 days, and CPM up 15–20% ([Superads, 28 Jul 2026](https://www.superads.ai/blog/creative-refresh-cadence)).
- [PRAC] Meta ads typically need refreshing every 2–4 weeks at lower spend and every 1–2 weeks at high spend (Superads). The common rule of thumb is a refresh every 2–3 weeks.
- The claim "conversion likelihood drops ~45% after 4 exposures" is attributed to Meta research by Superads but could not be verified [unverified].

## 3. Budget and scaling

- **Learning phase.** [META] About 50 optimisation events per ad set within 7 days of the last significant edit. Significant edits include targeting, optimisation event, bid strategy, adding a new ad, a pause of more than 7 days and large budget changes ([PPC Land summarising the Help Center](https://ppc.land/learning-phase/); [Jetfuel, 21 Aug 2026](https://jetfuel.agency/meta-ads-campaign-structure-in-2026-abo-vs-cbo-and-budget-architecture-for-dtc-brands/)).
- [META at the SMB summit] Advertisers exiting learning with 50+ weekly conversions saw "19% lower CPA and 28% lower cost per purchase" ([AppDeveloper Magazine, 28 Oct 2025](https://appdevelopermagazine.com/meta-unveils-holiday-ecommerce-playbook-at-playa-vista-summit/amp/)).
- **Reported lower thresholds.** "10 conversions in 3 days" for purchase-optimised ad sets was observed by advertisers in 2024 (Jon Loomer, ~Jun 2024; [Madgicx, 9 Jun 2024](https://madgicx.com/blog/meta-lowers-learning-phase-requirement-for-select-campaigns), "rolling out"). A claim that Meta cut the Advantage+ threshold to 25/week in April 2026 ([1ClickReport, 6 Apr 2026](https://www.1clickreport.com/blog/advantage-plus-shopping-25-conversions-2026-guide)) gives **no Meta source**, so treat it as unverified.
- **Budget formula.** Weekly budget is about 50 × CPA [INFER from META rule]. Stackmatix offers a looser minimum of 15 × CPA per week, and suggests optimising for a higher-funnel event if purchases cannot reach that ([Stackmatix](https://www.stackmatix.com/blog/ad-learning-phase-small-budgets), undated, OPINION). the example store's 28–56 purchases a week means **purchase optimisation is viable only if consolidated** [INFER].
- **Scaling.** [PRAC] Increase budgets by about 20% at a time, every 2–4 days. Scale horizontally (new concepts or duplicated ad sets) for bigger jumps ([Stackmatix scaling guide](https://stackmatix.com/blog/meta-ads-scaling-framework); [Top Growth Marketing, 26 Jul 2026](https://topgrowthmarketing.com/meta-ads-creative-testing-framework/)). Meta now flags "high performing" ad sets that can take larger increases without re-entering learning (Jon Loomer budgeting update, via search excerpt). [OPINION] Jon Loomer: "Don't fear making a change that might restart learning" ([Pubcast, 15 Oct 2025](https://pubcast.jonloomer.com/the-learning-phase-is-just-a-label/)).
- **Bid strategies.** [PRAC/OPINION] Jon Loomer uses Highest Volume "roughly 90% of the time" (glossary, via excerpt). A cost-per-result goal is a target average, not a hard cap, and suits accounts with known profitable CPAs. Set too low, Meta "won't spend your budget" ([Segwise 2026](https://segwise.ai/blog/cost-cap-vs-auto-bid-meta-ads)). Bid caps limit each auction bid and are for advanced use only.
- **ROAS goal / value optimisation.** Commonly cited eligibility is about 30 attributed click-through purchases with value in 7 days. This is widely repeated but not verified against Meta's own page. With a narrow AOV band (~PKR 7,000), value optimisation has little to differentiate [INFER].

## 4. Testing methodology

- **Two accepted designs.** (a) Meta's native Creative Testing: 2–5 ads, equal budget split, each person sees one variant, up to 30 days, results under Experiments. Winners can stay in the same ad set with their learnings ([EasyInsights, 17 Oct 2025](https://easyinsights.ai/blog/metas-update-a-new-way-to-test-creatives-from-a-b-to-ai-led-optimization/); [SEJ, 12 Nov 2025](https://www.searchenginejournal.com/how-to-evaluate-creative-performance-in-meta-ads/558741/)) [META feature]. (b) A permanent ABO "sandbox" test campaign plus a CBO "scaler", with winners moved over by post ID to keep their social proof [PRAC: Jetfuel 2026; Top Growth Marketing 2026].
- **Budget per test.** 2–3× target CPA per variant before reading results. Test 3–5 concepts per round over 5–7 days. Keep concept tests separate from small-variation tests [OPINION but widely repeated: Top Growth Marketing 26 Jul 2026].
- **Kill rules.** About 2× target CPA spent with no purchase means kill [PRAC]. Neiman cuts the bottom 60% of concepts after at least 72 hours and 1,000+ impressions [OPINION]. Segwise suggests retiring an ad when its CPA exceeds 1.3× its trailing 30-day average [OPINION].
- **Patience.** With only 4–8 purchases a day, a single creative rarely reaches statistical significance. Judge on leading indicators (hook rate, CTR, cost per add-to-cart) plus the 2× CPA guard, and confirm winners over at least 7 days [INFER; consistent with Motion's point that low hit rates are "a statistical feature"].

## 5. Measurement

- **Pixel + CAPI.** [META] Browser and server events deduplicate on matching `event_name` + `event_id`. `event_time` can be at most 7 days before sending, and a batch containing an older event is rejected ([Meta CAPI server-event parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/)). [PRAC] Push Event Match Quality up by sending hashed email, phone and name with every event, not only Purchase ([WeltPixel 2026](https://www.weltpixel.com/blogs/news/meta-event-match-quality-emq-guide)).
- **Attribution change, March 2026.** [META] Click-through now counts **link clicks only**. Likes, shares, saves and 5-second video views moved to a new 1-day "engage-through" bucket. The default is now 7-day click, 1-day engage-through, 1-day view ([Leafsignal, 1 Oct 2026](https://www.leafsignal.com/blog/meta-march-2026-attribution-update); [Jon Loomer 2026](https://www.jonloomer.com/meta-ads-attribution-2026/)). Accounts reporting on click-only lost engagement-attributed conversions from their reports.
- **Why Meta's numbers differ from Shopify's.** Each platform counts a different set of orders, and each count is consistent with its own rules: attribution windows, view-through, modelled conversions, time zones, consent and match rates, dedup and refunds. "Shopify's order count is the ruler" ([WeltPixel, 17 Sep 2026](https://weltpixel.com/blogs/news/meta-google-ads-and-ga4-show-three-different-purchase-counts-the-discrepancy-hub)) [PRAC]. Track blended cost per *delivered* order (total Meta spend ÷ delivered orders) as the business KPI [PRAC: MER/blended CAC; INFER for COD].
- **COD-specific.**
  - [PRAC/vendor] Send custom server events (`OrderConfirmed`, `OrderDelivered`, `OrderCancelled`) and optimise for Delivered so Meta learns from paying customers ([eGrow, 6 Nov 2025, updated 7 Oct 2026](https://help.egrow.com/en/article/optimize-facebook-ads-for-cash-on-delivery-cod-using-delivered-events-not-purchase)). eGrow does **not** address timing or volume.
  - Caveats [INFER]: (1) delivery often lands days after the click, so many Delivered events may fall outside the 7-day click window and drop out of optimisation. (2) Delivered volume is lower than orders, which makes learning harder. A **ConfirmedOrder event fired at the same time as the confirmation call (same day)** is the practical middle ground. Test it in a separate ad set or campaign, with Purchase kept as the baseline, and switch only if it reaches about 25–50 events a week.
  - The CAPI `event_time` is when the confirmation or delivery happened, so it can be sent fresh. The 7-day back-dating limit only bites if events are batched late [META rule + INFER].

## 6. Landing page and CRO for footwear

- [DATA] Baymard found 83% of desktop and 87% of mobile apparel sites lack sufficient sizing information, and size uncertainty was a common reason for abandoning a product. Recommended: numeric sizes, measurements in cm/inches, international conversions, how-to-measure instructions, and a size-guide link next to the selector ([Baymard, 6 Jul 2022](https://baymard.com/blog/apparel-size-information)). This is older research, but it is the main empirical source.
- [DATA] The Deloitte/Google "Milliseconds Make Millions" study (2020) found a 0.1s mobile speed gain lifted retail conversion 8.4% and AOV 9.2% (as cited by [Shoplift, 4 Aug 2026](https://www.shoplift.ai/post/shopify-page-speed-conversion-rate) and others). The study is from 2020.
- [PRAC, Pakistan] Quote the full delivered total up front, use accurate photos and measurements, set realistic delivery times, and confirm orders before dispatch to cut junk orders ([Markaz, 12 Sep 2026](https://www.markaz.app/blog-post/cod-return-rates-in-pakistan-how-to-reduce-them)). Footwear is listed among the high-return categories.
- No 2025–26 controlled study was found isolating which PDP elements most move Meta CPA for footwear specifically.

## 7. Pakistan / South Asia specifics

- **COD reality.** COD is described as about 94% of Pakistani e-commerce transactions, and RTO is often quoted at 18–30%+ ([Simpaisa, 23 Jun 2026](https://www.simpaisa.com/blogs/why-cash-on-delivery-is-killing-your-e-commerce-business-and-what-to-do)). Markaz stresses "there is no audited national figure" [OPINION/vendor]. Simpaisa also reports the Finance Act 2025 placed a 2% withholding tax on COD vs 1% on digital payments [unverified against the Act].
- **Seasonality.**
  - Winter and wedding season ("Decemberistan") runs Nov–Jan. December discounts of 20–50%, with online stores seeing strong sales of leather boots, warm joggers and trekking shoes ([APP, 2 Dec 2025](https://www.app.com.pk/?p=1121732)).
  - 11.11 2025: DarazMall brands saw "50X growth", with men's fashion and "winter tracksuits" among top categories ([ProPakistani, 4 Dec 2025](https://propakistani.pk/2025/12/04/darazmall-brands-lead-daraz-pakistans-11-11-sale-with-record-growth-and-customer-engagement-2/amp/)).
  - Ramadan ~8 Feb 2027, Eid ul-Fitr ~9–10 Mar 2027, Eid ul-Adha ~16–17 May 2027. These are astronomical estimates ([ProPakistani, 22 Aug 2026](https://propakistani.pk/2026/08/22/uae-reveals-expected-dates-for-ramadan-and-eids-in-2027/)).
- **CPM.** One Pakistani agency blog quotes Facebook CPM of PKR 150–1,100 "depending on audience, season and industry", and says Urdu/Roman-Urdu creative reaches broader audiences, with WhatsApp as the "conversion layer" ([Digital Pakistan, 9 Apr 2026](https://digitalpakistan.pk/social-media-marketing-2026/)) [OPINION]. For South Asian festive peaks generally, plan for CPM/CPC about 30–50% above off-peak (India-focused, [Upgrowth, 3 Dec 2025](https://upgrowth.in/seasonal-facebook-ad-pricing-2026/)) [OPINION]. **No reliable Pakistan-specific Ramadan/Eid CPM data was found.**

## 8. Operating routine

The sources say what to check more than how often, so the cadence below is a synthesis [PRAC + INFER].
- **Daily (10 minutes, no big edits):**
  - spend pacing
  - CPA and purchases vs the 3- and 7-day average
  - CPM, CTR and frequency on the top 3 ads
  - disapprovals and delivery errors
  - CAPI/pixel health (Events Manager)
  - confirmation rate of yesterday's orders
  - Apply the kill rule to test ads only.
- **Every 2–4 days:** one budget step of about 20% on the stable ad set if CPA is at target.
- **Weekly:**
  - launch the new creative batch
  - review the Creative diversity column, fatigue/similarity insights and audience-segment breakdown (how much spend is going to existing customers)
  - reconcile Meta purchases against Shopify orders, confirmed orders and delivered orders
  - compute cost per delivered order and MER
  - keep a change log
  - Media-buyer job specs commonly describe "3–5 new creatives weekly" and weekly reconciliation of platform vs source-of-truth figures (job listings, 2026).
- **Monthly:** RTO by product, city and creative; a structure review (is any ad set Learning Limited?); the seasonal calendar 6–8 weeks ahead; an incrementality sanity check (spend-off periods or geo holdouts) given the Haus findings.

---

## Disagreements and uncertainty

- **Advantage+ vs manual.** Meta reports 22–32% ROAS gains for Advantage+. Haus's independent incrementality data shows manual won 58% of the time over the full window. Both can be true on different metrics (platform ROAS vs incremental lift).
- **Learning-phase threshold.** The official figure is 50 in 7 days. Advertisers observed "10 in 3 days" in 2024. A "25/week from April 2026" claim has no Meta source. Jon Loomer argues the label barely matters.
- **The 20% scaling rule** is folklore-grade. It is widely repeated but not a Meta number. Some sources call it "too conservative" for high-signal accounts.
- **Creative similarity thresholds** (40%, 60%) and "Entity ID" mechanics are vendor and practitioner claims. Meta's metrics give no published numeric threshold.
- **Separate retargeting.** PPC Hero says fold it in. Jetfuel keeps 10–20%. Neither has controlled data.
- **COD optimisation event.** Vendors recommend optimising for Delivered. No Meta document addresses COD, and the timing and volume trade-off is my inference, not a sourced finding.
- **Pakistan data is thin.** RTO rates, CPMs and seasonal cost swings come from vendor or agency blogs, and Markaz says no audited figure exists.
- **Pages not fetched directly.** Jon Loomer and Meta Help Center pages blocked direct fetching. Their claims here come via search excerpts or secondary summaries.

## Sources (with publication dates)

| Source | Date | Type |
|---|---|---|
| [Meta Engineering – Andromeda](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/) | 2 Dec 2024 | META |
| [Meta for Developers – Advantage+ campaign experience](https://developers.facebook.com/blog/post/2025/06/03/advantage-plus-campaign-experience-for-sales-and-app/) | 3 Jun 2025 | META |
| [Meta CAPI server-event parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/) | live doc, read 8 Oct 2026 | META |
| [AppDeveloper Magazine – Meta SMB summit](https://appdevelopermagazine.com/meta-unveils-holiday-ecommerce-playbook-at-playa-vista-summit/amp/) | 28 Oct 2025 | META (reported) |
| [Social Media Today – Meta Reels/diversification tips](https://socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182) | 17 Dec 2025 | META (reported) |
| [DataAlly – creative similarity metric](https://www.dataally.ai/blog/metas-new-metrics-and-why-the-creative-similarity-score-matters) | 8 Oct 2025 | META (reported) |
| [Admetrics – fatigue & similarity](https://admetrics.io/en/post/meta-creative-fatigue-and-similarity-score-complete-guide) | 14 May 2026 | META (reported) |
| [Common Thread Collective – Creative diversity score](https://commonthreadco.com/blogs/coachs-corner/metas-new-creative-diversity-score-is-live-in-ads-manager-what-ecommerce-brands-must-act-on-now) | 9 Sep 2026 | META (reported) + OPINION |
| [EasyInsights – Meta creative testing](https://easyinsights.ai/blog/metas-update-a-new-way-to-test-creatives-from-a-b-to-ai-led-optimization/) | 17 Oct 2025 | META (reported) |
| [Search Engine Journal – evaluating creative](https://www.searchenginejournal.com/how-to-evaluate-creative-performance-in-meta-ads/558741/) | 12 Nov 2025 | PRAC |
| [Leafsignal – March 2026 attribution](https://www.leafsignal.com/blog/meta-march-2026-attribution-update) | 1 Oct 2026 | META (reported) |
| [Jon Loomer – attribution 2026](https://www.jonloomer.com/meta-ads-attribution-2026/) | 2026 (not fetched) | PRAC |
| [Jon Loomer – learning phase is a label](https://pubcast.jonloomer.com/the-learning-phase-is-just-a-label/) | 15 Oct 2025 | OPINION |
| [Jon Loomer – 5 updates to sales campaigns](https://jonloomer.com/updates-to-meta-sales-campaigns) | ~Jun 2024 (not fetched) | OPINION/observed |
| [Madgicx – lower learning requirement](https://madgicx.com/blog/meta-lowers-learning-phase-requirement-for-select-campaigns) | 9 Jun 2024 | PRAC |
| [1ClickReport – "25 conversions"](https://www.1clickreport.com/blog/advantage-plus-shopping-25-conversions-2026-guide) | 6 Apr 2026 | unverified |
| [PPC Land – learning phase](https://ppc.land/learning-phase/) | undated | META (summary) |
| [Haus – Meta report](https://www.haus.io/blog/the-meta-report-lessons-from-640-haus-incrementality-experiments) / [MediaCat](https://mediacat.uk/marketers-best-metas-black-box-report-shows/) | 30 Jul 2025 | DATA |
| [Motion – Creative Benchmarks 2026](https://motionapp.com/library/research/creative-benchmarks-2026/) | 17 Apr 2026 | DATA |
| [Alex Neiman – 5% winners](https://alexneiman.com/meta-ads-creative-testing-5-percent-winners/) | 17 Mar 2026 | OPINION |
| [Precis – Andromeda myths](https://www.precis.com/resources/meta-andromeda-and-creative-strategy-what-actually-changed-and-what-didnt) | 19 Jul 2026 | OPINION |
| [PPC Hero – structure in Andromeda era](https://ppchero.com/?p=31064) | 24 Jun 2026 | PRAC |
| [Balistro – Andromeda budget strategy](https://www.balistro.com/blog/meta-andromeda-budget-strategy-2026) | 17 Aug 2026 | OPINION |
| [Jetfuel – ABO vs CBO 2026](https://jetfuel.agency/meta-ads-campaign-structure-in-2026-abo-vs-cbo-and-budget-architecture-for-dtc-brands/) | 21 Aug 2026 | PRAC |
| [Jetfuel – retargeting 2026](https://jetfuel.agency/meta-retargeting-for-ecommerce-the-complete-2026-strategy-guide/) | 6 May 2026 | OPINION |
| [Top Growth Marketing – testing framework](https://topgrowthmarketing.com/meta-ads-creative-testing-framework/) | 26 Jul 2026 | PRAC |
| [Superads – refresh cadence](https://www.superads.ai/blog/creative-refresh-cadence) | 28 Jul 2026 | PRAC |
| [Segwise – cost cap vs auto-bid](https://segwise.ai/blog/cost-cap-vs-auto-bid-meta-ads) | 2026 | PRAC |
| [Stackmatix – small-budget learning](https://www.stackmatix.com/blog/ad-learning-phase-small-budgets) | undated | OPINION |
| [WeltPixel – discrepancy hub](https://weltpixel.com/blogs/news/meta-google-ads-and-ga4-show-three-different-purchase-counts-the-discrepancy-hub) | 17 Sep 2026 | PRAC |
| [eGrow – COD delivered events](https://help.egrow.com/en/article/optimize-facebook-ads-for-cash-on-delivery-cod-using-delivered-events-not-purchase) | 6 Nov 2025, upd. 7 Oct 2026 | vendor |
| [Markaz – COD returns Pakistan](https://www.markaz.app/blog-post/cod-return-rates-in-pakistan-how-to-reduce-them) | 12 Sep 2026 | OPINION/vendor |
| [Simpaisa – COD in Pakistan](https://www.simpaisa.com/blogs/why-cash-on-delivery-is-killing-your-e-commerce-business-and-what-to-do) | 23 Jun 2026 | vendor |
| [Baymard – apparel size information](https://baymard.com/blog/apparel-size-information) | 6 Jul 2022 | DATA |
| [Shoplift – page speed (cites Deloitte 2020)](https://www.shoplift.ai/post/shopify-page-speed-conversion-rate) | 4 Aug 2026 | DATA (secondary) |
| [APP – winter footwear demand](https://www.app.com.pk/?p=1121732) | 2 Dec 2025 | news |
| [ProPakistani – Daraz 11.11 2025](https://propakistani.pk/2025/12/04/darazmall-brands-lead-daraz-pakistans-11-11-sale-with-record-growth-and-customer-engagement-2/amp/) | 4 Dec 2025 | news |
| [ProPakistani – 2027 Ramadan/Eid dates](https://propakistani.pk/2026/08/22/uae-reveals-expected-dates-for-ramadan-and-eids-in-2027/) | 22 Aug 2026 | news |
| [Digital Pakistan – social media marketing 2026](https://digitalpakistan.pk/social-media-marketing-2026/) | 9 Apr 2026 | OPINION |
| [Upgrowth – seasonal ad pricing](https://upgrowth.in/seasonal-facebook-ad-pricing-2026/) | 3 Dec 2025 | OPINION |
