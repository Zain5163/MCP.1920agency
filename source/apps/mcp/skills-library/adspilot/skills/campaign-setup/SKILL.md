---
name: campaign-setup
description: "Set up any paid campaign correctly on any platform (Meta, Google, TikTok, LinkedIn, Snapchat, Pinterest, X, Reddit, Microsoft, Amazon): understand the business, turn what the user wants (sales, leads, WhatsApp or Messenger chats, calls, website visits, views, followers, app installs, store visits) into the right objective, optimisation goal, conversion event and destination, then run three quality assessments before anything is created, launched or reported as done. Use before planning, building, changing or launching any campaign, and whenever a user names the result they want from ads."
---

# Campaign setup: the right objective, checked three times

Two failures waste more ad money than any weak creative: optimising for the wrong
result, and launching something that was not built the way it was asked. This
skill prevents both. It applies to every platform and every user.

## Step 1: Understand the business before choosing anything

Answer these, from the user or from their site. Ask when they are missing; never invent:

1. **What do they sell, to whom, where?** Product, price range, countries/cities.
2. **What result do they want to pay for?** In their words. Then restate it as one
   measurable event: "a website purchase", "a filled lead form", "a WhatsApp chat
   started", "a phone call", "a landing page view".
3. **Where does that result happen?** Their website (needs the pixel/tag and the
   event firing), a form inside the platform, a messaging app, a call, an app, a shop.
4. **What happens next?** Who answers chats and calls, and how fast. A cheap lead nobody
   answers is worth nothing.
5. **What is a result worth?** Target cost per result, or target return on ad spend,
   and the margin.

Write the answer as one line before building:
**"<Business> wants <result> from <people, place>, happening on <destination>, at about <cost> each."**
If you cannot write that line, you are not ready to choose an objective.

## Step 2: Turn the result into the objective (and never optimise for a proxy)

The objective is what the business pays for; the optimisation goal is what the
platform hunts for. They must agree. Ask for clicks and the platform finds people
who click, not people who buy. The commonest expensive mistake is a sales or
leads campaign optimising for link clicks or landing-page views.

### Meta (Facebook and Instagram)

| The user wants | Objective | Conversion location | Optimise for (goal) | Event |
|---|---|---|---|---|
| Online sales | Sales (`OUTCOME_SALES`) | Website | Conversions (`OFFSITE_CONVERSIONS`), or value (`VALUE`) once ~50 purchases/week | Purchase |
| Leads on their site | Leads (`OUTCOME_LEADS`) | Website | Conversions | Lead (or CompleteRegistration) |
| Leads without a site | Leads | Instant form | Leads (`LEAD_GENERATION`), or conversion leads when CRM events flow back | — |
| WhatsApp chats | Engagement (or Leads/Sales when chats are where orders or leads close) | Messaging apps → WhatsApp | Conversations (`CONVERSATIONS`) | — |
| Messenger / Instagram DMs | Engagement (or Leads/Sales) | Messaging apps → Messenger / Instagram | Conversations | — |
| Phone calls | Leads (or Engagement) | Calls | Calls | — |
| Website visitors | Traffic (`OUTCOME_TRAFFIC`) | Website | Landing page views (`LANDING_PAGE_VIEWS`), never link clicks when a pixel exists | — |
| Video views | Engagement or Awareness | Ad | ThruPlay / video views | — |
| Page likes / follows | Engagement | Page / profile | Page likes / follows | — |
| Post engagement | Engagement | Ad | Post engagement | — |
| Reach / awareness | Awareness (`OUTCOME_AWARENESS`) | — | Reach, with a frequency cap (~2 per 7 days) | — |
| App installs | App promotion | App | Installs, then an in-app event | — |

AdsPilot today builds website Sales, website Leads, instant-form Leads, Traffic and
Awareness on Meta. **Messaging (WhatsApp/Messenger/Instagram chats) and calls are not
built yet:** say so plainly; never fake a WhatsApp campaign as Traffic to a wa.me link
without telling the user that is what it is and that it will not optimise for chats.

### Other platforms (confirm current names in get_playbook <platform>)

| The user wants | Google Ads / Microsoft Ads | TikTok | LinkedIn | Pinterest | Snapchat |
|---|---|---|---|---|---|
| Online sales | Sales goal; Search / Performance Max / Shopping; Maximise conversion value or target ROAS on a Purchase conversion action | Sales → website conversions on Complete Payment (or catalog / Shop) | Website conversions | Conversions (checkout) or Catalog sales | Sales → pixel Purchase |
| Leads | Leads goal; Maximise conversions or target CPA on a lead conversion action | Lead generation (instant form or website) | Lead generation (Lead Gen Form) | Conversions (lead) | Leads |
| Calls | Leads goal with call conversions / call assets | — | — | — | — |
| Visits | Website traffic (only until conversion tracking exists) | Traffic → landing page views | Website visits | Consideration | Traffic → landing page views |
| Views | Video views (YouTube) | Video views | Video views | Video views | Awareness & engagement |
| Reach | Awareness & consideration | Reach | Brand awareness | Awareness | Awareness & engagement |
| Installs | App campaign | App promotion | — | App install | App promotion |

X, Reddit and Amazon follow the same principle: choose the objective that names the
result being paid for, and optimise for its event, never a proxy.

## Step 3: Build only what was asked

- The user's words decide the objective. If they say "sales", it is a Sales
  objective optimising for purchases, whatever is easier to set up.
- Everything in the ad must be true today: live prices, stock, delivery and
  return terms, offers the business really gives. Check the live site.
- Supply the creative shapes each placement needs. Keep claims the business can stand behind.

## Step 4: Three assessments before anything goes live (and before saying "done")

Each assessment compares the result with **what the user asked**, setting by
setting. Any mismatch is fixed before moving on. Never report something as set up,
launched or working without having read it back.

**Assessment 1: the plan, before building.** Write the one-line brief from Step 1
beside the plan and tick each row: objective, optimisation goal, conversion event,
conversion location/destination, pixel or tag, budget and schedule, countries/cities,
ages, audience, placements, every ad's text, headline, image or video, landing URL,
call to action, prices and claims checked on the live site. Then run the platform's
review (AdsPilot: `review_ad_plan`) and resolve every error.

**Assessment 2: the built campaign, read back.** Creation succeeding is not proof.
Read the campaign back from the platform (AdsPilot: `verify_campaign`, which also
runs automatically after `create_ad_plan`) and compare every setting with the brief:
goal matches objective, right pixel and event, right Page and Instagram account,
budget, countries, every ad present, every landing page loading. Look at the
previews. Real example: a Sales campaign was created optimising for link clicks
while the plan, the review and the approval summary all said "Sales"; only reading
it back showed the truth.

**Assessment 3: immediately before activation.** Read it back again (AdsPilot's
`activate_campaign` verifies and refuses on any failure), confirm the platform's ad
review has passed, payment is working, the budget fits the ceiling, and show the
user the exact approval summary. After launch, check delivery within a few hours
and the next day: spending, impressions, no new rejections.

Report each assessment in a line: what was checked, what passed, what was fixed.

## Never

- Optimise a sales or leads campaign for clicks, page views, reach or engagement.
- Pick an objective because it is easier to build than the one the user asked for.
- Call a campaign live, approved or correct without reading it back.
- Invent prices, offers, reviews, results or URLs.
