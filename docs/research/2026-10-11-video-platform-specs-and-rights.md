# Video pipeline research: Prism and editing engines, platform video specs, rights and policy

**Date:** 2026-10-11. Pages accessed 2026-10-11 unless another date is given. Written for
`docs/architecture/2026-10-11-video-pipeline-plan.md`.

Labels follow `docs/research/README.md`:
- **Verified**: an official page (platform docs, vendor terms, statute), accessed on the date.
  Quotes came through a web-fetch summariser, so they are near-verbatim: re-read the page itself
  before anything legal or contractual relies on the wording.
- **Reported**: a secondary source, plausible, not confirmed. Never acted on as if verified.
- **Unverified / conflicting**: said so plainly.

One live check was made: Prism's read-only `prism_support { action: "diagnose" }` on this PC
(no script run, no project touched). Nothing was uploaded, posted, downloaded or edited.

---

## 1. Prism (oneprism.io) and the editing engines

### 1.1 What Prism is and where it runs

- **Verified** (https://oneprism.io/docs/overview/connector): "It is an MCP server: your AI client
  talks to it, it talks to a panel inside the creative app, and what comes back is native,
  editable work." Writes "execute inside the app" through the panel; "Text and layout boxes
  still need real measurement in After Effects"; only a scene **dry run** works without After
  Effects. "There is no licence key and no device limit."
- **Verified** (https://oneprism.io/docs/after-effects/quickstart): install a `.zxp` panel,
  open Window ▸ Extensions ▸ After Effects MCP, sign in, and add the hosted address
  `https://live.oneprism.io/after-effects` to the AI client. "Prism is reached at an address,
  not launched from disk." Requires After Effects 2024/2025/2026 on **macOS or Windows** and a
  remote-MCP client (Claude, ChatGPT, Gemini via Antigravity, Cursor, VS Code…).
- **Verified** (https://oneprism.io/security): the panel sends the open composition's structure;
  ".aep files, footage and comps are never uploaded, never copied, never stored"; audio is sent
  only for transcription/beat detection and then discarded.
- **No headless, cloud or render mode is documented.** Rendering is After Effects' own
  (`aerender`), on the same desktop.
- **Live check on this PC (2026-10-11, `prism_support diagnose`)**: server version 1.5.1; tier
  `pro`; MCP calls "Unlimited"; AI balance $2.15 (spent $7.85); panel **not connected** ("nothing
  can run in After Effects"). The tool notes that on "a shared or multi-seat account another
  agent's calls are listed" — multi-agent use of one account is anticipated technically, which
  says nothing about licensing.
- **Pricing, verified** (https://oneprism.io/pricing): Free $0 (100 MCP actions/month, no AI);
  **Pro $6/month or $60/year** + tax (unlimited MCP actions); **Prism AI** pay-as-you-go packs
  ($5–$100, no expiry; transcription, BPM, SFX, music, images, video). No team, seat or
  commercial tiers listed.

### 1.2 Prism's terms — what they allow (verified, https://oneprism.io/terms, last updated 2026-05-19)

Operator: "Kamran Akbar … trading as OnePrism", Pakistan; governed by Pakistani law. No separate
EULA or FAQ.

- **Grant:** "we grant you a limited, personal, non-exclusive, non-transferable,
  non-sublicensable license to install and use the Software on machines you own or control, for
  your own creative work, for as long as your subscription is active."
- **Restrictions:** "You may not copy, distribute or redistribute the Software; resell,
  sublicense or transfer access to anyone else; run it as a service bureau, time-share or hosted
  offering; or make it available to people who have not bought their own license."
- **Also:** no reverse engineering; no getting around "licensing, authentication or access
  control"; no using it "to build or help build a competing product"; no scraping Prism services.
- **Plain-words summary on the page (not binding):** "Do not resell it, share your key, or take
  the software apart."
- **Silent on:** seats, embedding, automated/programmatic use, output ownership, agency work for
  clients.

**Reading for this product:**
1. Owner using his own Prism on his own machines for his own videos: allowed.
2. The product letting *its customers'* AIs send jobs that run on the owner's Prism account:
   **prohibited** ("hosted offering", "service bureau", "make it available to people who have not
   bought their own license", "transfer access").
3. A customer with their own Prism licence running our station agent on their own machine
   (bring-your-own-licence): consistent with the grant ("machines you own or control", their own
   creative work) — our agent does not redistribute Prism, it calls the customer's own Prism.
4. Owner's agency editing client videos with his Prism: "your own creative work" is ambiguous for
   client work; a human operator doing the creative work is the ordinary case, an automated queue
   fed by clients is not. **Ask oneprism.io in writing** (support@oneprism.io) before relying on it.
5. "Embedding Prism and its skills into our MCP" for any user: **not allowed without a written
   agreement** with OnePrism.

### 1.3 Adobe's terms for After Effects run for others

- **Verified** (Adobe General Terms, effective 2025-10-03, https://www.adobe.com/legal/terms.html):
  §3.1 "Each license is to be used by only one (1) person and cannot be shared." §6.2 no "host,
  stream, sublicense, or resell the Services and Software"; §6.3 no enabling "others to use the
  Services and Software using your account information"; §6.4 no use "on a service bureau basis,
  on a time-sharing basis, as a part of a hosted service, or on behalf of any third party".
- **Reported** (enterprise PSLT Desktop Software WW 2025v1, PDF encrypted; quotes from search
  snippets): render engines may be installed "on Computers within its intranet if at least one
  Computer has the full version of the Adobe After Effects software installed", **but** the
  customer "must not install or access … the On-premise Software for operations not initiated by
  an individual User (e.g., automated server processing…". How these fit together is not stated.
- **Reported**: Adobe describes `aerender` as automating rendering "as part of a render farm"
  (helpx page returned 403; snippet). Render-only nodes via `ae_render_only_node.txt` are from 2017
  community threads; a 2024 thread on background aerender licensing ended "ask Adobe".
- **Conclusion:** an After Effects render farm that renders *customers'* jobs automatically is a
  licensing question for Adobe as well as Prism. Owner-initiated renders of the owner's work on
  his own machine are ordinary use. Customers wanting AE templates rendered in the cloud can use a
  vendor that licenses this (Plainly, §1.5).

### 1.4 FFmpeg and nexrender

- **Verified** (https://www.ffmpeg.org/legal.html): FFmpeg is LGPL 2.1+; with GPL parts enabled
  (e.g. libx264) "the GPL applies to all of FFmpeg".
- **Verified** (https://www.gnu.org/licenses/gpl-faq.html): running modified GPL software
  without distributing it creates no obligation to release source; programs communicating "at
  arms length" (a separate process) are separate works. **So running an FFmpeg build with libx264
  as a separate process on our server is fine**; shipping the binary inside a desktop installer
  (e.g. the station agent) brings GPL/LGPL distribution duties — prefer the user's own FFmpeg or
  an LGPL build there.
- **Verified** (https://github.com/inlife/nexrender): MIT; drives `aerender` and "never launches
  After Effects GUI application"; worker needs an "Installed licensed/trial version of Adobe After
  Effects" on Windows/macOS; it auto-creates `ae_render_only_node.txt` and claims no licence is
  needed on workers — **this claim conflicts with Adobe's terms above; do not rely on it.**
  Nexrender Cloud: no published price.

### 1.5 Hosted editing / rendering alternatives (prices verified on the vendor pages unless marked)

| Option | What | Price | Licence notes |
|---|---|---|---|
| Remotion (React video) | Programmatic video, self-host or Lambda | Free for individuals and companies ≤3 employees; otherwise Company Licence: Creator $25/seat/month; **Automators $0.01 per render, $100/month minimum**; Enterprise from $500/month (https://www.remotion.pro/license, licence file in the repo). Lambda compute ≈ $0.017 per 1-min video (https://www.remotion.dev/docs/lambda/cost-example) | Our company would need the paid licence once past 3 employees or for automation |
| Shotstack | JSON timeline Edit API, Ingest (resize/crop/renditions), templates | PAYG $10/50 min; $39/month 250 min (1080p); $99/750 min (4K); $199/2,000; $499/10,000 (https://shotstack.io/pricing/) | API service |
| Creatomate | Templates + API | Essential $54/month (2,000 credits; 1 min 720p ≈ 14 credits); Growth 10K $129 (https://creatomate.com/pricing) | API service; files kept 30 days |
| Plainly | **After Effects templates rendered in their cloud**, REST API | Starter $69/month (50 render min) … Pro $649 (600) (https://www.plainlyvideos.com/pricing) | Their AE infrastructure, not ours |
| JSON2Video | Templates, subtitles, voice | $16.63–$99.95/month (50–500 min) (https://json2video.com/pricing/) | API |
| Bannerbear | Images/video, has MCP | $49–$299/month (https://www.bannerbear.com/pricing/) | API |
| Rendi | Hosted FFmpeg | Free tier; Pro $25/month (https://www.rendi.dev/pricing) | API |
| Editframe | Programmatic video | $0.02/min 1080p cloud render; Team $49/month (https://www.editframe.com/pricing) | Free ≤3 employees |
| OpusClip | Auto-clipping, API on Pro ($29/month, limited beta) (https://opus.pro/pricing) | | |
| Submagic, Descript | Captions/editing APIs | **Reported only** (third-party pages) | |

### 1.6 Hosting facts used by the plan

- **Hetzner CX23 (our server):** 2 vCPU / 4 GB / 40 GB (`deploy/README.md`). **Reported**: Hetzner
  raised cloud prices on 2026-04-01 and 2026-06-15; a dedicated CCX13 is ≈ €42.99/month and a
  CPX32 ≈ €35.49/month for new orders after June 2026; cost-optimised CX lines showed "currently
  not available" in August 2026 (privatedevops.com, northflank.com, findstack.com). Check Hetzner's
  own page before ordering.
- **FFmpeg speed on 2 vCPU: no benchmark found.** One forum report: 10–15 min 1080p encoded in
  5–8 min with libx264 (likely dedicated cores) — **reported**. Estimate ≈ 1–2× real time for
  `-preset veryfast` on 2 shared vCPU; **measure on the box** (`ffmpeg -i in.mp4 -c:v libx264
  -preset veryfast -crf 23 -f null -`) before relying on it.
- **Hetzner Object Storage:** **verified** (https://www.hetzner.com/storage/object-storage/): base
  price includes 1 TB storage and 1 TB egress per month; ingress, S3 calls and internal eu-central
  traffic free; locations Falkenstein, Helsinki, Nuremberg. The base amount was not on the
  fetched page; **reported** launch price €4.99/month (Dec 2024; heise.de, datacentrenews.uk),
  overage €1.00/TB egress.
- **Cloudflare R2:** **verified** (https://developers.cloudflare.com/r2/pricing/): $0.015/GB-month,
  egress free, 10 GB-month free.
- **Supabase Storage file cap:** **verified** (https://supabase.com/docs/guides/storage/uploads/file-limits):
  Free plan 50 MB per file (Pro up to 500 GB). Our media bucket is on the free plan.

---

## 2. Platform video specs and metadata (API publishing)

Sources per platform below the table. "n/s" = not stated in the official docs.

| Platform | Surface | Aspect | Duration (API) | Max size | Container / codec | Title | Description / caption | Tags / hashtags | Cover / thumbnail | Native scheduling | Gate | Rate limit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| YouTube | Long | any (16:9 typical) | ≤15 min unverified account; ≤12 h verified | 256 GB | `video/*` (H.264 advised) | 100 chars, no `<` `>` | 5,000 **bytes**, no `<` `>` | tags 500 chars total (commas and quotes count) | `thumbnails.set` JPG/PNG, max **50 MB** since 2026-09-14; needs a verified account; ~50 units | yes: `private` + `publishAt` | unaudited-project private lock: **conflicting** (below) | uploads: own bucket, 100/day, 1 unit each (since 2026-06-01); other calls 10,000 units/day |
| YouTube | Shorts | vertical or square | ≤3 min (uploads from 2024-10-15) | same | same | 100 | 5,000 bytes | 500 | API thumbnail for Shorts: **unverified** (Help mentions desktop Studio) | same | same | same |
| Instagram | Reels | 0.01:1–10:1, 9:16 recommended | 3 s–15 min | **300 MB** | MOV/MP4, moov first; H.264/HEVC, closed GOP, 4:2:0; AAC ≤48 kHz; 23–60 fps; ≤1920 px wide; ≤25 Mbps | none | 2,200 chars | ≤30 hashtags, ≤20 @ | `cover_url` (JPEG ≤8 MB) or `thumb_offset` ms (cover_url wins) | **no** | Professional account; App Review Advanced Access; Page Publishing Authorization | 100 posts/24 h in the guide, 50 elsewhere — read `content_publishing_limit` at run time; 400 containers/24 h |
| Facebook | Page Reels | 9:16, min 540×960 (1080×1920 rec.) | **3–90 s** | n/s | MP4; H.264/H.265 (VP9/AV1 accepted); AAC 48 kHz ≥128 kbps; 24–60 fps | optional `title` | `description` (hashtags inside) | in description | thumbnail via a separate call | yes: `SCHEDULED`, 10 min–29 days | `pages_manage_posts` etc. | **30 Reels/Page/24 h** |
| Facebook | Page video | any | n/s | n/s (10 GB / 240 min in Help: unverified) | MP4 | `title` | `description` | — | `thumb` | yes: 10 min–6 months | same | n/s |
| LinkedIn | Feed video | 16:9, 1:1, 4:5, 9:16 (ads spec) | 3 s–30 min | **500 MB** (schema also says 5 GB — conflicting) | MP4; H.264/VP8; <30 fps (ads spec) | `content.media.title` (limit n/s) | commentary 3,000 chars (Help; not in the API reference) — "little text" escaping | inline `#` | `uploadThumbnail` JPG/PNG ≤2 MB, same ratio; **one English SRT** caption file | **no** (`lifecycleState` PUBLISHED only) | `w_member_social` (member) / Community Management API (org) | n/s (429) |
| TikTok | Direct Post | 9:16 typical; 360–4096 px per side | ≤10 min, and ≤ `max_video_post_duration_sec` from `creator_info` | 4 GB | MP4/WebM/MOV; H.264/H.265/VP8/VP9; 23–60 fps | — | `title` = caption, 2,200 UTF-16 | in caption | `video_cover_timestamp_ms` only | **no** | **audit**: unaudited = `SELF_ONLY`, private accounts, 5 users/24 h | 6 requests/min/token; ~15 posts/day/creator across apps |
| Pinterest | Video pin | 1:2 to 1.91:1 (1:1, 2:3, 4:5, 9:16 rec.) | 4 s–15 min | 2 GB | MP4/MOV/M4V; H.264/H.265 | 100 | 800 (alt text 500; link 2,048) | — | `cover_image_url` / `cover_image_data` / `cover_image_key_frame_time` | not found | Trial: pins visible only to the creator; **sandbox does not support video pins**; Standard needs a demo video | per tier |
| X | Post video | 1:3–3:1; 32×32–1280×1024 | **≤20 min (8 GB) default; 125 min / 16 GB Premium** — the old 140 s / 512 MB now applies to DMs only | 8 GB | MP4; H.264 High; AAC-LC; ≤60 fps; no open GOP | — | 280 weighted chars (URL = 23) | inline | none (first frame) | no (unverified) | paid credits | pay-per-use: $0.015 per post, $0.20 with a URL |
| Threads | Video post | 0.01:1–10:1 | ≤5 min | 1 GB | MOV/MP4; H.264/HEVC; 23–60 fps; ≤1920 px wide | — | 500 chars (emoji by UTF-8 bytes), ≤5 links | one `topic_tag` | none documented | no (unverified) | `threads_content_publish` | 250 posts / 1,000 replies per 24 h |

**Safe zones on 1080×1920 (reported only; no official YouTube/Meta page found):** TikTok ≈ 240 px
top, 660 px bottom, 120 px sides plus the right action column (adkit.so, from TikTok's in-feed
template); Meta Reels ≈ 14% top, 35% bottom, 6% sides (houseofmarketers.com); Shorts ≈ 12–15%
top, 20–35% bottom, ≈190–200 px right column (adkit.so). One rule for all: keep text out of the
top ≈250 px, bottom ≈670 px and right ≈200 px. The brands' own `adCreatives.placements` safe zones
take precedence where set.

### 2.1 Sources and notes per platform

- **YouTube** (verified): https://developers.google.com/youtube/v3/docs/videos/insert,
  https://developers.google.com/youtube/v3/docs/videos, https://support.google.com/youtube/answer/71673
  (15 min / 12 h), https://support.google.com/youtube/answer/15424877 (Shorts ≤3 min; no Shorts
  flag — aspect and length decide), https://developers.google.com/youtube/v3/docs/thumbnails/set,
  https://support.google.com/youtube/answer/72431 (custom thumbnails need a verified account),
  https://developers.google.com/youtube/v3/revision_history and
  https://developers.google.com/youtube/v3/determine_quota_cost (Dec 2025 upload cost cut;
  2026-06-01 "Video Uploads" bucket, 100 calls/day). `privacyStatus` **defaults to public** on
  insert — always send it (our adapter does). `status.containsSyntheticMedia` and
  `selfDeclaredMadeForKids` exist.
  - **Conflicting — private lock for unaudited projects:** the 2020 rule (revision history) locks
    uploads from unaudited projects created after 2020-07-28 to private. The current
    `videos.insert` page reads: "Videos uploaded from unverified API projects are not restricted
    to private viewing mode." No revision entry announces the change; a July 2026 blog
    (reported) still describes the lock. **Keep our adapter's private-until-audit behaviour until
    a real upload proves otherwise** (R4); then decide.
  - Older figures superseded: thumbnail 2 MB (now 50 MB), upload 1,600 units (now its own
    bucket). Our `docs/research/2026-10-02-youtube-api-facts.md` already had the bucket; the
    thumbnail limit is new.
- **Instagram** (verified): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media,
  https://developers.facebook.com/docs/instagram-platform/content-publishing. Resumable upload
  (`upload_type=resumable` to `rupload.facebook.com`) avoids the public-URL requirement but needs
  Facebook Login for Business. `trial_params` (trial reels, non-followers only), `collaborators`
  (≤3), `share_to_feed` (not guaranteed). **Our `capabilities.ts` aspect range 0.8–1.91 is the
  feed-image range and is wrong for Reels.**
- **Facebook** (verified): https://developers.facebook.com/docs/video-api/guides/reels-publishing,
  https://developers.facebook.com/docs/graph-api/reference/page/videos/,
  https://developers.facebook.com/docs/video-api/guides/publishing.
- **LinkedIn** (verified): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api,
  https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api,
  https://www.linkedin.com/help/lms/answer/a424737 (ads specs). 4 MB parts, ETags,
  `finalizeUpload`; upload URLs valid ≈30 days. Version `202510` sunsets 2026-10-15; our code
  pins `202601` (fine now; it retires about a year after release — watch it).
- **TikTok** (verified): https://developers.tiktok.com/doc/content-posting-api-reference-direct-post,
  https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide,
  https://developers.tiktok.com/doc/content-sharing-guidelines. `creator_info` must be queried and
  its privacy options shown with **no default**; `PULL_FROM_URL` needs a verified domain and no
  redirects; `FILE_UPLOAD` chunks 5–64 MB; `is_aigc` label; brand content toggles; a "Music Usage
  Confirmation" must be shown before the publish button; apps must not add their own watermark.
- **Pinterest** (verified): OpenAPI v5.28.0 (https://raw.githubusercontent.com/pinterest/api-description/main/v5/openapi.yaml),
  https://help.pinterest.com/en/business/article/pinterest-product-specs,
  https://developers.pinterest.com/docs/key-concepts/access-tiers/. Flow: `POST /v5/media`
  (`media_type: video`) → multipart upload to the returned URL → poll `GET /v5/media/{id}` →
  `POST /v5/pins` with `source_type: video_id`, `media_id` and a cover. `ai_disclosures` values
  exist. **Our adapter sends `source_type: video_id` with a `url` — that is not the documented
  flow.** Reported: a missing cover returns an error.
- **X** (verified): https://docs.x.com/x-api/media/quickstart/media-upload-chunked,
  https://docs.x.com/x-api/media/quickstart/best-practices, https://docs.x.com/fundamentals/counting-characters,
  https://docs.x.com/x-api/getting-started/pricing. **Our `capabilities.ts` 140 s limit is stale.**
- **Threads** (verified): https://developers.facebook.com/docs/threads/posts,
  https://developers.facebook.com/docs/threads/overview.

---

## 3. Rights and platform policy for downloading and re-posting others' videos

### 3.1 YouTube (verified)

- **Terms** (https://www.youtube.com/t/terms): users may not "access, reproduce, download,
  distribute, transmit, broadcast, display, sell, license, alter, modify" the Service or Content
  except as the Service expressly allows or "with prior written permission from YouTube and, if
  applicable, the respective rights holders"; nor "access the Service using any automated means
  (such as robots, botnets or scrapers)". Uploads "must not include third-party intellectual
  property … unless you have permission". Repeat infringers are terminated. **Downloading with a
  yt-dlp-style tool breaches the Terms before copyright is even considered — even for a video
  whose creator agreed, unless YouTube's own download feature is used.**
- **Monetisation, reused content** (https://support.google.com/youtube/answer/1311392): on
  2025-07-15 "repetitious content" was renamed "inauthentic content"; reused content means
  channels that "repurpose content that's already on YouTube or another online source" "without
  adding significant original commentary, substantive modifications, or educational or
  entertainment value". Allowed examples include "Edited footage from other creators where you add
  a storyline and commentary" and critical reviews; not allowed: "Content downloaded or copied from
  another online source without any substantive modifications", "Content uploaded many times by
  other creators", "Clips … edited together with little or no narrative". Automatic trims,
  captions and reframes are not substantive.
- **Content ID** (https://support.google.com/youtube/answer/2797370): every upload is matched
  against owners' reference files; owners block, monetise or track. **Claims vs strikes**
  (https://support.google.com/youtube/answer/2814000): a claim is not a strike, but a bad dispute
  can become a takedown; three strikes → termination of the account and associated channels.
- **Shorts remix** (https://support.google.com/youtube/answer/10623810) is the sanctioned remix
  route, inside the YouTube app, attributed to the original; an API cannot reproduce it.

### 3.2 Meta (verified)

- **2025-07-14 unoriginal-content crackdown** (https://creators.facebook.com/blog/combating-unoriginal-content):
  repeat reusers "will not only lose access to Facebook monetization programs for a period of
  time" but "will also receive reduced distribution on everything they share"; duplicate copies
  get reduced distribution; "Simply stitching together clips or adding your watermark does not
  qualify as meaningful enhancement."
- **Instagram original content guidelines** (https://creators.instagram.com/original-content-guidelines/):
  "Low-effort edits (e.g. borders, watermarks, speed changes, just crediting the original
  creator)" do not make content original; unoriginal content may be ineligible for recommendations
  to non-followers; eligibility returns when most posts over a rolling 30 days are original.
- **Rights Manager / repeat infringers** (https://transparency.meta.com/reports/intellectual-property/protecting-intellectual-property-rights):
  matching, block/claim/monitor; repeat infringers' accounts disabled.

### 3.3 TikTok (verified; some pages via search text)

- For You eligibility (https://www.tiktok.com/safety/en/policies-and-engagement/fyf-standards):
  ineligible: "Reproduced or unoriginal content that is imported or uploaded without any new or
  creative edits".
- Creator Rewards: videos must be "filmed, designed, and produced entirely by yourself"; excludes
  "Content reproduced from others with only slight modifications".
- **Content Posting API guidelines** (https://developers.tiktok.com/doc/content-sharing-guidelines):
  "API Clients should facilitate authentic creators to post original content to TikTok"; listed as
  **not acceptable: "An app that copies arbitrary contents from other platforms to TikTok."** A
  download-and-repost feature would fail the audit or get the app revoked.
- IP policy (https://www.tiktok.com/legal/page/global/copyright-policy/en): no infringing content;
  repeat infringers banned.

### 3.4 Law (verified statutes and cases; summary, not legal advice)

- **US fair use, 17 U.S.C. §107** (https://www.law.cornell.edu/uscode/text/17/107): four
  factors — purpose/commercial character, nature of the work, amount used, market effect. A
  business reposting a whole viral clip for engagement scores badly on all four.
- **Warhol v. Goldsmith (2023)** (https://www.law.cornell.edu/supremecourt/text/21-869): where the
  uses share "the same or highly similar purposes, and the secondary use is commercial", factor one
  "is likely to weigh against fair use"; new meaning "is not, without more, dispositive".
- **DMCA §512** (https://www.law.cornell.edu/uscode/text/17/512): safe harbour for hosts storing
  content at a user's direction, with notice-and-takedown, a designated agent and a repeat-infringer
  policy (§512(i)). A service that itself fetches, edits and uploads copies is arguably the one
  making them — the harbour is doubtful.
- **MGM v. Grokster (2005)** (https://www.law.cornell.edu/supremecourt/text/04-480): liability for
  "one who distributes a device with the object of promoting its use to infringe copyright".
  Marketing a feature as "repost viral videos" is inducement evidence.
- **EU** Directive 2019/790 Art. 17 (https://eur-lex.europa.eu/eli/dir/2019/790/oj; text did not
  load, cited from the official reference): platforms liable unless best efforts to license and
  block; users keep quotation, criticism, review, caricature, parody, pastiche (Art. 17(7);
  InfoSoc 2001/29 Art. 5(3)(d),(k)) — none covers wholesale reposting.
- **Pakistan**, Copyright Ordinance 1962 s.57 (https://www.wipo.int/wipolex/en/text/129350): fair
  dealing only for research/private study, criticism/review, reporting current events.
- Pinterest (https://policy.pinterest.com/en/copyright) and LinkedIn
  (https://www.linkedin.com/legal/copyright-policy) terminate repeat infringers; X's page returned
  403 (not confirmed).

### 3.5 What is safe

- **The business's own footage.**
- **Own published posts** fetched through the platform's official API for the connected account
  (e.g. Instagram `media_url`, Facebook video `source`) — the business owns them and the API is the
  sanctioned means. (Assumed reasonable; confirm per platform terms when built.)
- **Stock:** Pexels (https://www.pexels.com/license/): free, no attribution, but "Don't sell
  unaltered copies", "Don't imply endorsement". Pixabay (https://pixabay.com/service/license-summary/):
  no standalone redistribution; content showing a recognisable trademark/logo cannot be used
  commercially. Paid libraries (Storyblocks, Envato, Artlist): licence pages not fetched — check
  each.
- **Written creator licence** naming platforms, edit rights, term, territory and paid-ad use.
- **Creative Commons** (https://creativecommons.org/share-your-work/cclicenses/): BY needs credit;
  **NC** forbids commercial use; **ND** forbids adaptations. YouTube's CC option is CC BY; credit
  title, author, source URL and licence (https://support.google.com/youtube/answer/2797468).
- **Inspiration only:** 17 U.S.C. §102(b) (https://www.law.cornell.edu/uscode/text/17/102):
  copyright does not extend to "any idea, procedure, process, system, method of operation,
  concept". Hooks, formats, pacing, structure and trends are free; footage, voice-over and
  distinctive scripts are not.

### 3.6 AI disclosure (verified)

- YouTube (https://support.google.com/youtube/answer/14328491): disclose realistic altered or
  synthetic content; "primarily aesthetic" edits exempt.
- TikTok (https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content): label
  required "for realistic images, audio, and video"; API flag `is_aigc`.
- Meta (https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/):
  disclose "photorealistic video or realistic-sounding audio that was digitally created or
  altered"; label "AI info".
- Plain cuts and captions need no label; AI voices, avatars, face/voice changes and generated
  scenes do. (The owner's documentary shorts use an ElevenLabs voice — that is realistic synthetic
  audio.)

### 3.7 Music (verified)

- YouTube Audio Library (https://support.google.com/youtube/answer/3376882): copyright-safe on
  YouTube; CC tracks need credit.
- Meta Sound Collection (https://www.facebook.com/sound/collection/terms): commercial use on Meta
  products only.
- TikTok Commercial Music Library (https://ads.tiktok.com/help/article/how-to-use-the-commercial-music-library,
  https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en): business
  accounts see only these; licensed for TikTok only.
- One edit posted to seven platforms needs a track licensed for all of them (a paid library or an
  original/generated track whose terms allow commercial use everywhere). Prism AI music is
  ElevenLabs-generated: confirm the commercial terms of that plan before using it for clients (the
  owner's PLAYBOOK flags the same open question).

### 3.8 Plain-words conclusion

Downloading other people's viral videos, editing them automatically and re-posting them breaks
YouTube's Terms before anything is uploaded, fails TikTok's API rules outright, and triggers every
platform's originality penalties (lost monetisation, hidden from new viewers) plus Content ID and
Rights Manager blocks; repeated strikes end channels. Captions, reframes, speed changes and credit
lines do not change that, and since Warhol v. Goldsmith commercial reposting is a weak fair-use
case. A product that automates it for customers is exposed itself. The safe version keeps the
valuable part: learn what works from viral videos (hook, format, pacing, packaging) and rebuild
with the business's own footage, licensed stock and properly licensed music, with AI labelled and a
rights record on every asset.
