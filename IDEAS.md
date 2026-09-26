# AdsPilot — Ideas and future direction

Captured 2026-09-25 from the owner. This is the **idea backlog**, not a commitment
and not a schedule. `NEXT-STEPS.md` holds what is actually being worked on;
anything here moves there only when it is chosen.

Notes in _italics_ are mine — what already exists, what a thing depends on, and
where I think something is larger than it looks. The ideas themselves are recorded
as given.

---

## The guiding idea

> Give one MCP server to a person or a company and they no longer need to go
> anywhere else — and no longer need to hire a whole team.

The worked example, in the owner's own words: someone who needs to publish blogs to
WordPress *and* a custom site, post carousels, static images and video to social,
upload to YouTube, manage a LinkedIn personal profile *and* several company pages —
and who finds article writing and caption writing the hardest part.

**Everything should be shaped so platform algorithms pick it up.** Not as a
feature to switch on, but as the default behaviour of anything the system produces.

**Sequencing principle, stated explicitly:** build it for internal use first and get
the foundation solid. Everything else comes after that.

---

## A. Composing and preview

### A1. Platform preview — "see it before it posts"
Show exactly how a post will look on each platform before publishing, the way Ads
Manager previews an ad. Click a platform icon, see that platform's rendering.

_Probably the highest-value item here. It catches the mistakes that validation
cannot — a caption that reads badly after Instagram truncates it, a logo that sits
under the Facebook overlay, an image cropped wrongly by one platform. Each preview
is a faithful mock of that platform's layout, so it is real work per platform, but
it pays back on every single post._

### A2. Carousels
Multiple images and videos in one post.

- **Selection order is post order** — the first file picked is the first card
- Show each selected file separately, and how many are selected
- Applies to images and video

_The Instagram adapter already builds carousels and respects order; the gap is
entirely in the UI. Worth pairing with A1, because carousel order is exactly the
thing people get wrong and a preview makes obvious._

---

## B. Content generation

### B1. Caption from image
User uploads an image with no text. The system looks at the image and writes the
caption and description from what it sees.

### B2. Rewrite
A button to regenerate a caption or description that is not right, rather than
accepting the first attempt or writing it by hand.

### B3. Algorithm optimisation
Rework a caption for what each platform's algorithm rewards — length, hashtags,
hooks, formatting — per platform rather than one caption everywhere.

### B4. Trending topics
Suggest what to post about from what is trending (e.g. Google Trends), so the user
starts from a live topic rather than a blank box.

### B5. Article and blog writing
Long-form for websites, not just social captions.

_These are the pieces `decisions/0001` flagged as the most likely to disappoint.
Generic AI captions are why people switch these features off. The mitigation is
that everything here is **assistive and editable** — B2 exists precisely because
the first draft often will not be right. Worth building B1 and B2 together; B1 on
its own invites publishing whatever the model produced._

---

## C. Scheduling and management

### C1. Edit or delete a scheduled post
Right now a scheduled post cannot be changed or cancelled from the dashboard. If
something is queued by mistake, it goes out.

_Partly built: `cancel_scheduled_post` exists in the MCP server and `cancelTarget`
in the data layer. **The dashboard has no button for it.** Editing a queued post
does not exist at all. This is the smallest real gap on this whole list and should
probably be done first._

---

## D. Analytics and reporting

### D1. Cross-platform performance
Likes, comments, clicks, impressions, CTR — per post and per platform.

### D2. Ranking and charts
Bar charts and graphs showing which platform performs best, and which posts do.

_Needs read access to each platform's insights API, which is a different permission
set from publishing — Facebook and Instagram both require additional scopes and,
for other people's accounts, more App Review. Worth knowing before it is promised
to a customer._

---

## E. Accounts and connections

### E1. Connect more pages, easily
One Meta account often administers several Pages and businesses. Today only one
Page is connected, and connecting more means re-running a command.

Should be possible **from the dashboard, or by asking the AI** — reusing the
existing authorisation rather than starting a fresh OAuth flow each time.

_The `connect` flow already fetches every Page the user administers; it just needs
a UI to pick which ones to link. Genuinely small._

### E2. Personal profiles, not just Pages
LinkedIn especially — senior people post from their personal profile, and that is
often where the reach is. Also groups, channels and company pages as distinct
target types.

_Note: LinkedIn personal posting is the **easier** LinkedIn permission. Company
pages need Community Management API approval, which LinkedIn grants sparingly._

### E3. YouTube
Video upload as a first-class target.

---

## F. Beyond social

### F1. Publish to websites and CMS
One click posts to social **and** the user's own website: WordPress, Shopify, other
CMS, and custom sites (including ones deployed from GitHub).

### F2. Email marketing
Through the same MCP server. **Explicitly deferred** — noted so it is not forgotten,
not to be built now.

---

## G. Design system

Each client gets a design system, generated with AI from whatever brand material
they have. Templates to start from, which they can then extend themselves.

Shipped as **default skills in the MCP server**, so a customer's own AI can use the
design system — and users can write their own skills on top.

_The largest item on this list by a wide margin. "Generate on-brand images from a
design system" is a product in itself: brand extraction, templating, rendering,
and quality control. Deserves its own research gate before any code, the way
`Ads-Platform` was gated._

---

## H. Paid advertising

Publish and manage ads through the same MCP server — Meta, Google, TikTok, Amazon
and others. One prompt, ads live, same as posts.

_Recorded as tier 5b in `ROADMAP.md`. It is deliberately a tier of its own rather
than more adapters: ads spend real money, the object model is campaign → ad set →
creative → ad rather than content → targets, and approval is stricter everywhere.
`..\..\Meta-Ads-Publisher` already exists and publishes paused with a separate
activation step — connect it rather than rebuild it._

---

## I. Safety rails for actions that cost money or cannot be undone

_Added 2026-09-26, from an outside architecture review the owner brought in.
Most of that review described things already built — the normalised draft, the
adapter layer, OAuth with encrypted tokens, the MCP surface, not depending on one
AI vendor. **This is the part it was right about that we do not have.**_

### I1. A policy and validation layer between the AI and execution

Today an MCP client calls `publish_post` and it publishes. The only thing standing
between a model's mistake and a public post is **a sentence in the tool
description** asking it to confirm first. That is a prompt, not a control, and a
prompt is not a safety mechanism.

Nothing has gone wrong because the only user is the owner and the posts are the
owner's own. It stops being adequate the moment either of those changes — and it
is completely inadequate for ads, where the same shape of mistake spends money.

The proposal is a deterministic layer every tool call passes through, which
classifies the action and decides whether it may execute:

| Risk | Example | Behaviour |
|---|---|---|
| Low | read status, list accounts, fetch metrics | execute |
| Medium | pause an ad, cancel a scheduled post | execute, always audited |
| High | publish publicly, create a campaign, raise a budget | **prepare, return a summary, require explicit confirmation** |

The important property: the classification and the ceiling are **code**, not
instructions to a model. An AI can propose anything; what it is allowed to execute
is decided deterministically. This is the same "AI proposes, a deterministic
validator authorises" rule already written into tier 5b — the change is that it
should be a **general layer built now**, not an ads-only prerequisite written down
for later, because the irreversible action already exists.

### I2. Spend ceilings as a stored limit, not a convention

Tier 5b says ads must be created paused with an explicit activation step. That is
right and should hold. Add to it a per-tenant maximum — daily and monthly — stored
in the database and checked by the validator, so "increase every budget by 500%"
fails on arithmetic rather than on good judgement.

### I3. Lead capture and CRM handoff

Not previously considered anywhere in this backlog. Lead-generation ads produce
leads, and a lead that sits in a platform's dashboard for three days is worth much
less than one that reaches a salesperson in three minutes: retrieve leads, qualify
them, push to a CRM, assign an owner. For a marketing agency this is arguably
worth more than the campaign creation it depends on.

### I4. Cross-account anomaly queries

"Show me every campaign that spent over $100 yesterday with a cost per lead above
$30" — one question, every platform, one answer. Read-only, so it carries none of
the risk above, and it is the most convincing demonstration of why one MCP across
all platforms beats a tab per platform. Depends on D1/D2 analytics.

---

## J. Media processing — transcode before upload

_Added 2026-09-26, after the LinkedIn video adapter was built and the owner asked
whether the MCP could shrink files itself._

### ~~J1. The whole file is read into memory~~ **FIXED 2026-09-27**

`#readMedia` returned the entire file as one `Uint8Array` and sliced it. Harmless
for a 1.6 MB image; 400 MB of RAM in a single buffer for a large video, and an
out-of-memory crash rather than a slow upload with several running at once.

Replaced by a `MediaSource` that reads one byte range at a time from disk. A URL
is downloaded to a temporary file first — trading disk for RAM deliberately,
because disk is the resource we have — and that file is deleted when the source
closes, including when a part fails partway through.

Two things the rewrite made strict that were previously silent:

- **A short read now fails.** It means the file changed mid-upload, and sending
  the padding would upload silent corruption.
- That strictness **immediately caught unrealistic byte ranges in the project's
  own tests**, which had passed only because the in-memory version returned empty
  slices without complaint.

### J2. Transcode and compress per platform

The case for it is stronger than "make files smaller":

- **LinkedIn's API file limit is reported at 200 MB**, far below the 5 GB the app
  accepts by hand. A normal 1080p export can exceed that.
- **Every platform wants something different.** X caps video at 140 seconds.
  Instagram enforces aspect ratios between 4:5 and 1.91:1 and rejects anything
  outside with an error that reads like a permissions problem. TikTok has its own
  encoding expectations.
- Today the answer to all of that is "re-export it yourself, per platform", which
  is exactly the manual work this project exists to remove.

One source video in, one correctly-encoded file per platform out. For a video
editing agency this is arguably the single most valuable feature in this backlog.

**The cost is real and should not be hidden:** it means a dependency on `ffmpeg`,
a binary that must exist on whatever machine runs the worker. That is the first
thing in this project that cannot be solved in TypeScript alone, and it changes
deployment. Worth it, but it is a decision, not a detail.

### J3. Validate before uploading, not after

Cheaper than J2 and worth doing first: read duration, dimensions and size from the
file, and check them against `capabilities.ts` **before** spending several minutes
uploading something the platform will reject. `validateAgainstCapabilities`
already has the limits; nothing currently reads the actual file to compare.

---

## Rough order I would suggest

Not a decision — a starting point for one.

| | Why |
|---|---|
| 1. **C1** edit/cancel scheduled posts | Smallest real gap. A mistake is currently unrecoverable. |
| 2. **E1** connect more pages | Small, and immediately useful — several businesses are waiting on it. |
| 3. **A2 + A1** carousels and preview | The adapters already support carousels; preview is what makes them safe. |
| 4. **B1 + B2** caption from image, with rewrite | Test whether AI content is good enough *before* committing to more of it. |
| 5. **D1/D2** analytics | Needs new permissions; worth starting the access work early even if built later. |
| 6. **E2/E3** LinkedIn, YouTube | New adapters, engine already supports them. |
| 7. **F1** WordPress and CMS | A new category, not just another adapter. |
| 8. **G** design system | Largest. Gate it before building. |

The consistent theme: **the engine already supports most of this.** Carousels,
scheduling, multi-platform and cancellation all exist underneath. A surprising
amount of this list is interface work over machinery that is already written and
tested — which is the payoff from keeping one engine behind several doors.
