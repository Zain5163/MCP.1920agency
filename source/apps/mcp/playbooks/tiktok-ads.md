# TikTok ads playbook

**Status: this server cannot launch TikTok ads yet.** There are no TikTok ads
tools. You can plan a campaign and write its copy and creative brief for the user
to enter themselves. Say so before starting, and never describe a TikTok
campaign as created or running.

**Updated 2026-09-30.** Figures below come from practitioner sources, not from
TikTok's own documentation, and should be checked before they are relied on.

---

## The rule that decides everything: vertical, full screen, sound on

| Requirement | Value |
|---|---|
| Shape | **9:16 only**, 1080×1920. Horizontal and square are refused at upload. |
| Video | MP4 or MOV, H.264, **with an audio track** |
| Length | 5–60 seconds; **9–15 seconds** completes best |
| Ad text | **≤ 100 characters**, shown below the video |
| Display name | ≤ 25 characters |

A 4:5 or 1:1 file made for Meta **cannot be reused**. It needs a vertical cut.
If the user only has square or landscape creative, tell them before planning.

## The safe zone

TikTok's interface covers a lot of the frame. Everything that matters — faces,
product, text, logo — must sit inside:

> **x 40–940, y 150–1470** on a 1080×1920 frame (a 900×1320 box)

- The top 150 px is the status bar.
- The right-hand strip (x 940–1080) holds the like, comment and share buttons.
- The bottom 450 px holds the caption, music and call to action.

Put the main subject in the upper part of the safe zone. Text in the bottom third
will be covered.

## Creative that works

- **Native, not polished.** It should look like something a person posted.
- **Hook in the first 1–2 seconds.** People decide faster here than on Meta.
- **Sound on is the default.** A silent video underperforms badly; speech or
  trending audio is expected.
- **Spark Ads** promote an existing organic post, keeping its likes and comments.
  If the business already has a post that did well organically, promote that
  before making something new.

## Structure, budget and bidding

- **Lowest Cost** bidding to start. Move to **Cost Cap** once there is a known,
  acceptable cost per result.
- Reported minimums: about **USD 50/day per campaign** and **USD 20/day per ad
  group**. Check the current figures, and the PKR equivalent, in TikTok Ads
  Manager.
- Learning needs roughly **50 conversions in 7 days**, and a daily budget of
  around 50× the target cost per result gives it room.
- **Do not edit during learning** — it restarts the clock.

## Tracking

- The TikTok **pixel** on the site, plus the **Events API** server-side.
- **Capture `ttclid`** from the landing page URL on first load and send it back
  with every conversion. Without it attribution breaks and TikTok over-claims.
- Share one `event_id` between pixel and server so conversions are not counted
  twice.
- Default attribution: 7-day click, 1-day view. Keep view at 1 day.

## Writing for TikTok

Write the brief as a short script, not a caption:

1. **0–2 s:** the hook — a claim, a question, a visual surprise.
2. **2–8 s:** the problem the viewer recognises.
3. **8–13 s:** the fix, shown rather than described.
4. **Last 2 s:** the one thing to do next.

Plus the ad text (≤ 100 characters) and a note of where on screen any text goes,
inside the safe zone.

---

## Connecting TikTok later

Needs a **TikTok for Business** account, a developer app on
business-api.tiktok.com with advertiser scopes, and TikTok's approval of those
scopes. Until the app passes review, posts published through the API land
private. Recorded in the roadmap; not built.

**If TikTok for Business is not available in the user's country:** some people
sign up through a VPN set to a supported country, and the API then works from
anywhere. It is recorded here because the owner asked for it to be known. Be
straight with the user about the risk: TikTok's terms expect the real country,
and an account found to have misstated it can be restricted or closed — along
with its ad spend history. The safer route is a business entity or agency
partner in a supported country. Let the user decide; do not do it for them.

---

*Informed by, and re-expressed from: Hainrixz/claude-ads (MIT) and
coreyhaines31/marketingskills (MIT). Source copies in `reference/ad-skills/`.*
