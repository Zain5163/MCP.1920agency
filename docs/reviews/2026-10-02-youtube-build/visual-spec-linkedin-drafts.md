# Visual spec for the six non-text LinkedIn drafts (read-only, 2026-10-02 09:50 PKT)

## Scope and status
- I checked `format:` in all 18 drafts in `D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\`. Exactly 6 are not plain `text`, which matches what you expected:
  - `text + image`: 10-02-pm, 10-05-am
  - document carousel: 10-03-pm (6 slides), 10-05-pm (7), 10-07-pm (6)
  - short video: 10-07-mid
- **None of the six is scheduled.** All six still have `status: draft`. The 11 entries already scheduled in POSTS-LOG.md are all text posts.
- `D:\My AI Works\AI-Automation\LinkedIn-Content-Ops\Approve-LinkedInPosts.ps1` skips any format that is not exactly `text` and prints "post this one by hand". No draft has a field for an image or video file path.
- **Urgent:** the 10-02-pm slot is today at 22:00 PKT, about 12 hours away.

## Rules for every visual
- **How slide notes are written:** each line is `N. **Headline.** body`. The bold part is the headline and the rest is the sub-line or body. The `**` marks are Markdown and do not go on the image.
- **Special characters:** quotes and apostrophes are plain straight ASCII everywhere. `→` (U+2192) appears in 10-05-pm slide 6 and in several post texts. `·` (U+00B7) appears in 10-03-pm slide 4. The en dash appears only in the video script's timestamps, which are not shown on screen. Files are UTF-8 with no BOM and LF line endings. The font must have the → and · characters.
- **Allowed punctuation changes only:** when a headline ending in ":" sits on its own line, you may drop the colon and capitalise the first letter of the body, which starts lowercase. Every word stays exactly as written.
- **Never on any image** (STRATEGY section 9):
  - the product name (rule 2)
  - client or account names (rule 4)
  - IDs or token fragments (rule 5)
  - invented numbers, logos or testimonials (rule 1)
  - competitor names (rule 9)
  - links (rule 7)
- **My recommendation (not in the drafts):** no Meta, Claude or ChatGPT logos, and no mock-ups of Ads Manager or Meta error screens. A designed card must never pass for a real screenshot.
- **No extra copy:** no "swipe" text and no CTA the draft does not have. Week 1 is CTA stage 1 (Follow).
  - The design system's LinkedIn cover sample has a "Book a call in my Featured section" chip. Do not use it here.
  - A page counter ("01 / 06") and a byline are optional. The owner decides the byline name: STRATEGY uses "Rana Zain Usman" and the design system shows "ZAIN USMAN".
- **No separate CTA slide:** none of the decks has one. The last slide is a content slide and uses the closing template. The slide counts (6, 7, 6) are fixed by `format` and `assets_needed`, so adding a slide needs the owner's OK.
- **Gradient:** one span per slide, normally the closing phrase of the headline, following the design-system pattern below.

## Visual guidance in STRATEGY.md
STRATEGY.md has no guidance on colour, fonts or layout. What it does say about visuals:
- **Section 5, Formats:**
  - Document/PDF carousel: "Checklists, '5 rules', playbook excerpts. 1–2 a week, PM slot". The publisher cannot post these: "Documents are posted by hand until that is built".
  - Text + single image: "Redacted screenshots of real errors and Ads Manager screens". The publisher can post these (image upload proven live 2026-09-26).
  - Short native video (30–90 s, vertical): "1 a week: him talking about one finding". The publisher can post these (video upload proven 2026-09-26).
  - Signals: "dwell time, saves… outrank likes. Write posts people stop and read: specific, structured, worth saving."
- **Section 4:** the PM slot is "P2 or P3, with document carousels here".
- **Section 9:**
  - rules 1–5 and 9 are listed above
  - rule 7: no links
  - rule 8: 0–2 emojis and 0–3 hashtags, at the end
  - rule 10: one detail only he could know
  - rule 11: nothing is posted without his approval
- **Section 6:** the hook must fit in 140 characters. All six post texts pass, with hooks of 33–64 characters.

**Brand system (outside STRATEGY.md).** PROJECT-CONTEXT.md line 51 points to `D:\My AI Works\Websites\Zain-Personal-Branding\PROJECT-CONTEXT.md` for "carousel and image design".
- **Locked direction** (that file, line 14): "dark teal/blue depth, aqua-led translucent glass, controlled lilac/pink atmosphere, large Geist typography, generous whitespace, fluid arcs/orbs, restrained motion, and outcome-led copy. Do not turn it into neon/cyberpunk or generic agency branding."
- **Tokens** (`source\src\lib\brand-tokens.ts`):
  - brand gradient: `linear-gradient(110deg, #14D1C8 0%, #44E0FA 28%, #60A5FA 50%, #C084FC 77%, #F472B6 100%)`
  - colours: navy #081B2D, slate #0B1D33, mist #AEB6C7, white
  - glass: `linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,.06))`, blur 22 or 40
  - radius 12/20/28/pill
  - shadow `0 18px 60px rgba(1,12,25,.22)`
- **Social template pattern** (`source\src\app\design-system\page.tsx`, "05 · Social templates"): a small-caps eyebrow (for example "GROWTH SYSTEMS / 01"), then a large headline whose closing phrase alone is in GradientText (for example "A campaign is an event. / **A system remembers.**").

---

## 1. 2026-10-02-pm.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-02-pm.md`
- **Slot:** 2026-10-02 (Fri), PM 22:00 PKT, P2.
- **Format:** `text + image`. The calendar says "Text + image (redacted error)".
- **Canvas:** 1 image, 1080x1350 (the draft gives no size, so the default applies).
- **Asset the draft asks for** (`assets_needed`, verbatim): "Optional: a screenshot of the error text only. Crop out account, campaign and ad set IDs. If no clean screenshot exists, post as text only."
  - The draft's first choice is a real redacted screenshot from the owner. A designed card replaces it, so it needs the owner's OK.
  - If a real screenshot is used, inset it in a 1080x1350 brand frame or post it at its own crop, with no IDs.
- **The draft has no on-image text.**
  - **Recommended: single quote card, text quoted word for word from the post.**
    - Eyebrow / sub-line: `Meta refused my first live campaign with one sentence:` (post line 16)
    - Quote headline, keeping the quote marks: `"Dynamic creative ads can only be created under dynamic creative ad sets."` (line 18)
    - Gradient: `dynamic creative ad sets.`
  - **Alternative: point card, condensed from post.**
    - Headline: `Two rules that are easy to miss` (condensed from line 24)
    - Point 1: `The ad set has to be marked for dynamic creative when it is created. You can't switch it on later. Meta will not convert an existing ad set.` (line 26, verbatim)
    - Point 2: `That ad set can hold only one ad.` (line 27, verbatim)
    - Gradient: `easy to miss`
- **Post text:** the body after the frontmatter is exactly the post. It has no headings or notes, so nothing is stripped.
  - Frontmatter is lines 1–14 and line 15 is blank.
  - The post is lines 16–40, from "Meta refused my first live campaign with one sentence:" to "#MetaAds #PaidSocial".
  - 1,254 characters, hook 54 characters, 3 "→" lines, 2 hashtags.
- **Owner must supply:**
  - his approval
  - either the real cropped screenshot or an OK for the designed card (otherwise it posts as text only)
  - a way to post it: the approval tool skips this format, and the draft has no image path
- No [OWNER] gap and no `check_before_posting`.

## 2. 2026-10-05-am.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-05-am.md`
- **Slot:** 2026-10-05 (Mon), AM 09:00 PKT, P2.
- **Format:** `text + image`. The calendar says "Text + image (redacted Ads Manager)".
- **Canvas:** 1 image, 1080x1350.
- **Asset the draft asks for** (verbatim): "Optional: a cropped Ads Manager screenshot of the "Website events" tracking box. Remove every ID. Text only is fine."
- **`check_before_posting`** (verbatim): "…confirm in Ads Manager whether it now shows ticked. The post says it was fixed in the API and read back, which is true either way. Do not claim the Ads Manager box is ticked unless the owner has seen it."
  - So the image must not show a ticked checkbox and must not mock up Ads Manager.
  - A real screenshot may only show the state the owner actually saw.
- **The draft has no on-image text.**
  - **Recommended: checklist / point card, condensed from post.**
    - Eyebrow: `The habit I'd suggest:` (line 35, verbatim)
    - Headline: `Before you call a campaign launched` (condensed from line 37)
    - Point 1: `Open the ad, scroll to Tracking.` (condensed from line 37)
    - Point 2: `Check that Website events is ticked with the right pixel.` (condensed from line 37)
    - Point 3: `Check that the pixel has fired recently.` (condensed from line 39)
    - Footer: `A pixel that's connected but silent is the same as no pixel.` (line 39, verbatim)
    - Gradient: `launched`
  - **Alternative: single quote card, verbatim.**
    - Quote: `On my first live Meta campaign, "Website events" was unticked.` (line 21)
    - Gradient: `was unticked.`
- **Post text:** the body after the frontmatter is exactly the post, with nothing to strip.
  - Frontmatter is lines 1–19.
  - The post is lines 21–41, from `On my first live Meta campaign, "Website events" was unticked.` to "#MetaAds #PaidSocial".
  - 1,132 characters, hook 62 characters, 2 "→" lines, 2 hashtags.
- **Owner must supply:**
  - the Ads Manager check in `check_before_posting`
  - optionally, a cropped screenshot with every ID removed
  - his approval
  - a way to post it: the same posting gap as #1

## 3. 2026-10-03-pm.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-03-pm.md`
- **Slot:** 2026-10-03 (Sat), PM 22:00 PKT, P2.
- **Format:** "document carousel (6 slides), post text below".
- **Canvas:** 6 slides at 1080x1350, exported as one 6-page PDF.
- **Asset the draft asks for** (verbatim): "A 6-slide PDF (1080x1350, 4:5) in the personal brand style. Must be posted by hand: the social-publisher LinkedIn path does not post documents."
- **Document title:** LinkedIn asks for one on upload and the draft gives none. Suggested: the calendar title "What one Meta ad can carry: the real limits", or slide 1's headline.
- **Slides** (exact text, lines 42–47):
  1. **Cover / title**
     - Headline: `What one Meta ad can actually carry.`
     - Sub-line: `The limits, and two catches.`
     - Gradient: `actually carry.`
  2. **Data card**
     - Headline: `Text:`
     - Body: `up to 5 primary texts, 5 headlines, 5 descriptions. Meta rotates them and learns.`
     - Gradient: the three "5"s.
     - A tile layout may split it as "up to" + [5 primary texts] [5 headlines] [5 descriptions] + "Meta rotates them and learns." No words are added, and "up to" must stay.
  3. **Data card**
     - Headline: `Media:`
     - Body: `up to 10 images and 10 videos, plus 5 calls to action.`
     - Gradient: "10", "10", "5".
     - The tile split is "up to" + [10 images] [10 videos] [5 calls to action]. Dropping "and" and "plus" in this split is a condensation for layout.
  4. **Point slide** (or a 3-row data card)
     - Headline: `Shapes, one ad:`
     - Body: `Feed 4:5 or 1:1 · Stories and Reels 9:16 · Landscape 1.91:1. Placement asset customisation serves each placement its own file.`
     - Gradient: `one ad`
     - Optionally add outline frames drawn at exactly 4:5, 1:1, 9:16 and 1.91:1. Plain shapes, not Meta's interface.
  5. **Point slide**
     - Headline: `Catch 1:`
     - Body: `multiple texts and placement-specific files can't share one creative. Meta refuses it ("Multiple bodies assets cannot be applied to rule no. 1"). Split it: one ad per text, each keeping every shape.`
     - Gradient: `can't share one creative.`
     - Set the Meta error string in monospace. This is the longest slide, at 207 characters.
  6. **Closing**
     - Headline: `Catch 2:`
     - Body: `I supplied a 1:1 next to a 4:5. It uploaded fine and was never served. I only found out by reading the creative back from Meta. Always read back what you built.`
     - Gradient: `Always read back what you built.`
- **Post text: not the whole body.**
  - Line 17 is `## Post text`. Strip it.
  - Lines 19–38 are the post, from "One Meta ad can carry a lot more than most people put in it." to "#MetaAds".
  - Line 40 is `## Slides`, followed by the slide notes on lines 42–47. Strip all of it.
  - The post is the text between the two headings, trimmed: 683 characters, hook 60 characters, 6 "→" lines, 1 hashtag.
- **Owner:** nothing to fill in. He approves it and posts it by hand as a LinkedIn document.

## 4. 2026-10-05-pm.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-05-pm.md`
- **Slot:** 2026-10-05 (Mon), PM 22:00 PKT, P3.
- **Format:** "document carousel (7 slides), post text below".
- **Canvas:** 7 slides at 1080x1350, exported as one 7-page PDF.
- **Asset the draft asks for** (verbatim): "7-slide PDF, 4:5. Posted by hand (the publisher does not post documents)."
- **Document title (suggested):** "An approval an AI cannot forge: how I gate ad spend" (from the calendar).
- **Slides** (exact text, lines 39–45):
  1. **Cover**
     - Headline: `An approval an AI cannot forge.`
     - Sub-line: `How I gate ad spend.`
     - Gradient: `cannot forge.`
  2. **Point**
     - Headline: `The problem:`
     - Body: `"confirm: true" is something the model can type itself. That's not a human decision.`
     - Gradient: `not a human decision.`
     - Set "confirm: true" as a monospace code chip.
  3. **Point**
     - Headline: `Gate 1, validation:`
     - Body: `refused before anything is built if Meta would reject it.`
     - Gradient: `validation`
  4. **Point**
     - Headline: `Gate 2, the ceiling:`
     - Body: `daily and monthly limits across the whole account. No limit set means nothing that spends will run.`
     - Gradient: `the ceiling`
  5. **Point**
     - Headline: `Gate 3, approval:`
     - Body: `a person sees the plan and the cost, and gets a token tied to exactly that plan. Change one thing and the token is void.`
     - Gradient: `approval`
  6. **Point, drawn as a flow**
     - Headline: `Lifecycle:`
     - Body: `created paused → approved → ads and ad sets switched on → campaign switched on last. Refused if Meta rejected any ad.`
     - This can be a 4-step flow using those same four labels, with the last sentence as a footnote.
     - Gradient: `campaign switched on last`
  7. **Closing**
     - Headline: `Stopping is free:`
     - Body: `pause has no gate. A wrong pause costs some delivery. A slow pause costs money.`
     - Gradient: `Stopping is free`
  - Slides 3–5 are a series of three gates, so give them one shared layout.
- **Post text:**
  - Line 15 is `## Post text`. Strip it.
  - Lines 17–35 are the post, from "If an AI can launch your ads, who approves the spend?" to "If you're letting AI anywhere near a client's budget, this is the question to ask any tool."
  - Line 37 is `## Slides`, followed by lines 39–45. Strip all of it.
  - 959 characters, hook 53 characters, 2 "→" lines, no hashtags.
- **Owner:** nothing to fill in. He approves it and posts it by hand. One of its sources is a competitor research file, and the frontmatter says competitors are NOT named, so the slides must not name or show any competitor.

## 5. 2026-10-07-pm.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-07-pm.md`
- **Slot:** 2026-10-07 (Wed), PM 22:00 PKT, P2.
- **Format:** "document carousel (6 slides), post text below".
- **Canvas:** 6 slides at 1080x1350, exported as one 6-page PDF.
- **Asset the draft asks for** (verbatim): "6-slide PDF, 4:5. Posted by hand. No real IDs on any slide."
- **Document title (suggested):** `Meta "code 10" permission errors: stop guessing, ask 3 questions` (from the calendar).
- **Slides** (exact text, lines 39–44):
  1. **Cover**
     - Headline: `Meta "code 10": stop guessing.`
     - Sub-line, set as a quoted error in monospace: `"You don't have the required permission to access this profile."`
     - Gradient: `stop guessing.`
  2. **Point**
     - Headline: `Why it's confusing:`
     - Body: `the error names the symptom. It never names the identity or the missing link.`
     - Gradient: `the symptom`
  3. **Point**
     - Headline: `Question 1, who is the token?`
     - Body: `Check which user or system user it really belongs to. Test tokens and real system users are different identities.`
     - Gradient: `who is the token?`
  4. **Point**
     - Headline: `Question 2, what can it reach?`
     - Body: `Which Pages, with which tasks (for example, advertise only, or full).`
     - Gradient: `what can it reach?`
  5. **Point**
     - Headline: `Question 3, what will the ad account promote?`
     - Body: `If that list is empty, a creative naming your Page will fail.`
     - Gradient: `what will the ad account promote?`
     - This is the longest headline (45 characters), so allow 2–3 lines.
  6. **Closing**
     - Headline: `The trap:`
     - Body: `a Page assigned in Business Manager is not the same as a Page linked to the ad account. You need both.`
     - Gradient: `You need both.`
  - Slides 3–5 are a series (Question 1/2/3), so give them one shared layout.
- **Post text:**
  - Line 15 is `## Post text`. Strip it.
  - Lines 17–35 are the post, from `"You don't have the required permission to access this profile."` to "Slides below. Save it for the next time code 10 shows up."
  - Line 37 is `## Slides`, followed by lines 39–44. Strip all of it.
  - 1,013 characters, hook 64 characters, no hashtags.
- **Owner:** nothing to fill in. He approves it and posts it by hand. No screenshots or IDs on any slide.

## 6. 2026-10-07-mid.md
`D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\drafts\2026-10-07-mid.md`
- **Slot:** 2026-10-07 (Wed), MID 15:30 PKT, P1.
- **Format:** "short video (about 60 s, vertical 9:16, him on camera), caption below".
- **Canvas:** 1080x1920 (9:16), about 60 seconds. The main asset is the owner on camera, so this cannot be fully rendered.
- **Asset the draft asks for** (verbatim): "The owner records the video. Add captions burned in (most people watch muted). No product name, no screen showing IDs or tokens. Can be posted via social-publisher publish_post / schedule_post with a local video file once approved."
- **What a renderer can make:**
  - **(a) Burned-in captions.** Build them from the actual recording. Use the script only as a reference. Strip the timings, "to camera" and the quote marks. The script is 128 spoken words, against the heading's "about 140". Script lines, verbatim:
    - [0–5 s] `Your AI can write an ad. It can't run one. I'm building the piece that lets it, safely.`
    - [5–20 s] `I run 1920 Agency. We do social, SEO, ads and websites. What I'm building connects the AI you already use, Claude, ChatGPT, to your social accounts and ad accounts.`
    - [20–40 s] `It brings the expertise. Before it touches Meta, it reads a playbook for your goal, whether that's leads, sales or traffic. And it can't spend a rupee on its own. Everything is built paused. You see the real cost. You approve. Then it goes live.`
    - [40–55 s] `It launched its first real campaign on our own account last week. Small budget, on purpose. Meta still taught me two things I hadn't seen in testing.`
    - [55–60 s] `I'm sharing it all as I build. Follow along.`
  - **(b) Optional cover or thumbnail frame,** cover template at 1080x1920:
    - Text: `What I'm building, in one minute.` (caption line 21, verbatim)
    - Gradient: `in one minute.`
  - **Never:** the product name, IDs or tokens on screen, or screen recordings of account data. My recommendation is no Claude or ChatGPT logos either.
- **Post text (the caption):**
  - Line 19 is `## Caption (post text)`. Strip it.
  - Lines 21–27 are the caption, from "What I'm building, in one minute." to "Social posting first. Meta ads are live on our own account. Google is next."
  - Line 29 is `## Script (about 140 words)`, followed by lines 31–44. Strip all of it; the script is never posted.
  - 352 characters, hook 33 characters, no hashtags.
- **Owner must supply:**
  - the on-camera recording
  - his approval
  - a way to post it. The approval tool skips video. The draft suggests publish_post, but AUTOMATION-SPEC section 8 says publish_post posts at once and must not be used to schedule. Use schedule_post in a session where the owner is present, or post it by hand.
- **Wording to check when posting:**
  - "last week" is only true around 2026-10-07. The first live campaign started 2026-09-30, according to the source cited in 10-02-pm.
  - "Meta ads are live on our own account." The campaign ends 2026-10-07 (STRATEGY P5), the same day as this post.
  - The script does not name the "two things" Meta taught him. Do not add them.

---

## Also noted (outside scope, format `text`)
- **2026-10-04-mid.md** is a text post, but its `assets_needed` says "optional photo of him at work (real, not stock)". Only the owner can supply that, so it cannot be rendered or generated. It also has `[OWNER: one real example from 1920 Agency in a sentence or two. No client names.]` at line 24, and the approval tool refuses it until that is filled in.
- None of the six visual drafts has an [OWNER: ...] gap.