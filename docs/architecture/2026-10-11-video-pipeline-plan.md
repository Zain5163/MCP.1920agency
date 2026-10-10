# Plan: the automatic video pipeline (own video in → edited, packaged, approved, posted everywhere)

**Date:** 2026-10-11. **Status:** PLAN ONLY. Nothing here is built, deployed, posted or
edited. No product code was written; no real video was edited; no After Effects job was run.
Owner's idea (voice notes, 2026-10-11) is paraphrased in §1. Research behind every platform
number and every policy statement: `docs/research/2026-10-11-video-platform-specs-and-rights.md`
(cited, dated). Product text says `{{PRODUCT_NAME}}` (working name AdsPilot, decision 0011).

Read with: `RULES.md` (R1 every error has a fix, R4 verified means real, R7 research before
asserting, R10 platform names only in adapters/core, R11 AI proposes, a validator authorises),
`docs/decisions/0010-portable-database-and-one-click-setup.md` (media off Supabase),
`docs/architecture/2026-10-02-youtube-build-spec.md`, `docs/product/ideas.md` §J (transcode per
platform), `D:\My AI Works\Video Editing\PLAYBOOK.md` §6 (how the owner drives After Effects
through Prism today).

---

## 0. The answer in one screen

1. **Yes, build it — but in this order:** (1) the business's *own* video → per-platform cuts,
   captions, thumbnails and metadata → one approval → scheduled posts on the platforms we
   already have adapters for; (2) an After Effects + Prism **edit station** for heavier edits;
   (3) "what is working" research and rights-cleared intake. The first slice is useful on its own
   and needs no After Effects.
2. **The everyday edit engine is FFmpeg, run by us.** Cropping to 9:16/1:1/4:5/16:9, trimming,
   burning captions, loudness, encoding and cover frames are deterministic FFmpeg work. It is free
   software run as a separate process. After Effects is for motion-graphics edits a template
   cannot do.
3. **After Effects cannot run on our server.** After Effects and the Prism panel run only on a
   Windows or Mac desktop with a signed-in Adobe and Prism account. Prism is a hosted MCP
   (`live.oneprism.io`) that relays to a panel inside the running After Effects; it has no
   headless or render mode (Prism docs; its own `diagnose` on this PC, 2026-10-11: "nothing can
   run in After Effects" while the panel is disconnected). So AE work runs on an **edit station**
   that polls our server for jobs.
4. **We cannot "embed Prism and resell it".** Prism's terms (2026-05-19) grant a "limited,
   personal, non-exclusive, non-transferable, non-sublicensable license … on machines you own or
   control, for your own creative work" and forbid to "resell, sublicense or transfer access to
   anyone else; run it as a service bureau, time-share or hosted offering; or make it available
   to people who have not bought their own license". Adobe's General Terms §6.4 likewise forbid
   use "as a part of a hosted service, or on behalf of any third party". What we *can* ship:
   (a) **bring-your-own-licence**: a customer with their own After Effects + Prism runs our
   station agent on their own machine; (b) the owner's station for the owner's own videos.
   Using the owner's station for agency clients' jobs that clients trigger automatically is not
   allowed; owner-operated client work is ambiguous — ask OnePrism (and Adobe, for automated
   rendering) in writing first (V2, V15). Customers who want After Effects templates rendered
   without a station can use a vendor that licenses it (Plainly).
5. **Downloading other creators' videos and re-posting edited versions is not a feature we can
   ship.** It breaks YouTube's Terms (no downloading without YouTube's and the rights holder's
   permission), meets Content ID and Meta Rights Manager matches, and fails the YouTube
   "inauthentic/reused content", Meta "unoriginal content" and TikTok originality rules that cut
   reach and monetisation. A tool that automates it for customers invites secondary-liability
   claims. **Viral videos are used as inspiration only** — their format, hook, pacing, title
   pattern — never their footage. Every input carries a rights record, and the publisher refuses
   footage without one (§6).
6. **Approvals stay mandatory** for every public post (R11): the owner approves the final cut and
   each platform's title/caption/tags/thumbnail; the HMAC token covers the exact file checksum
   and metadata, so any change needs a new approval.
7. **YouTube uploads stay private until our Google project passes the YouTube API audit** (already
   enforced, `YOUTUBE_UPLOADS_AUDITED`). Google's docs now conflict on this (the current
   `videos.insert` page says unverified projects are "not restricted to private"; the 2020 rule
   says they are): the first real private upload settles it before anything changes. Phase 1
   therefore *uploads* to YouTube privately and publishes publicly on Instagram, Facebook and
   LinkedIn. Start the YouTube audit and the TikTok audit now: both are long-lead, owner-side
   steps, and TikTok's rules reject any app that "copies arbitrary contents from other platforms".

---

## 1. What the owner asked for (2026-10-11, paraphrased)

Use our YouTube skills (`yt-viral`, `yt-plan`, `yt-script`, `yt-package`, `yt-shorts`, `yt-edit`,
`yt-retention`…) to find what works; download source videos automatically; edit them
automatically in After Effects through Prism, embedded in our MCP so any user's AI can have
videos edited; export; design a thumbnail per platform; upload automatically to every connected
platform (YouTube incl. Shorts, Instagram Reels, Facebook, LinkedIn, TikTok, Pinterest, X…) in
each platform's format and metadata; keep every finished video and its metadata in a media
library for reuse (e.g. as ad creative) without re-exporting. Everything in the background.

What changes in this plan, and why:

| Asked | Planned | Why |
|---|---|---|
| Download source videos automatically | Download only sources with a recorded right to use them (own uploads, own posts via the platforms' official APIs, licensed stock, written creator permission, CC BY/CC BY-SA with attribution). Never from YouTube via a downloader | Copyright and platform terms (§6, research §3) |
| Edit in After Effects through Prism, for any user | FFmpeg recipes for the common edits, on our side; AE + Prism on an edit station (owner's, or the customer's own licence) | AE is a desktop app; Prism's licence is per subscriber (§4.3, research §1) |
| Use viral videos | As inspiration: format, hook, structure, packaging, length — through `yt-viral` on public numbers | Ideas are free; footage is not |
| Upload everywhere automatically | Scheduled automatically **after** approval; YouTube private until audit; TikTok private until audit | R11; platform audits |

---

## 2. What exists today (checked in the code, 2026-10-11)

| Piece | State | Gap for video |
|---|---|---|
| YouTube adapter (`packages/adapters/src/youtube.ts`) | Built, unit-tested; resumable upload, title, tags (500-char check), category, `containsSyntheticMedia`, private until audit. Never uploaded for real | No `thumbnails.set` (limit now 50 MB, needs a verified channel); no `publishAt`; tags come from adapter options, not per post; no captions upload |
| Instagram (`instagram.ts`) | Live for images; a single video goes as `media_type=REELS` | No `cover_url`/`thumb_offset`/`share_to_feed`/resumable upload; **`capabilities.ts` gives Instagram aspect 0.8–1.91 for every media kind, so a 9:16 Reel with known dimensions would be refused by `validate.ts`** (today video dimensions are unknown, so it only warns). Reels via API: 3 s–15 min, 300 MB |
| Facebook Page (`facebook.ts`) | Live for posts; video goes to `/{page}/videos` with `description` | No Reels endpoint (`/video_reels`, 3–90 s, 30/Page/day), no title, no thumbnail, native scheduling unused |
| LinkedIn (`linkedin.ts`) | **Video posted live 2026-09-26** (personal profile, chunked upload); pins `LinkedIn-Version 202601` | No thumbnail (≤2 MB) or SRT captions upload; API cap 500 MB documented (schema also says 5 GB) — the 200 MB note in `capabilities.ts` is outdated |
| X (declared only) | `capabilities.ts` says 140 s | Stale: X API now allows 20 min / 8 GB by default (research §2) |
| Threads (`threads.ts`) | Built, no credentials | Video by URL, 500-char text |
| Pinterest (`pinterest.ts`) | Built, no credentials, Trial = sandbox | **Video path is wrong:** it sends `source_type: video_id` with a `url`; Pinterest needs `POST /media` → upload → `media_id` plus a cover. Must be rebuilt before any video pin |
| TikTok, X | Declared in `capabilities.ts`, no adapter | TikTok needs its audit for public posts; X needs a paid API |
| Media storage (`packages/media/src/storage.ts`) | Supabase Storage, public bucket `media`, content-hash keys | **Free plan caps every file at 50 MB** (Supabase docs), so scheduled video mostly cannot be stored; decision 0010 already says move media to storage we control |
| Media rows (`MediaAsset`) | key, public URL, mime, bytes, width, height, duration | No rights, no source, no lineage (source → render → variant), no checksum column |
| Posts (`Post`, `Target`, `Job`) | One body + per-platform text overrides; **media shared by every target**; worker with lease, heartbeat (`touchJob`), backoff, idempotency | A video needs a different file per platform → one `Post` per platform variant (no migration needed), grouped by a new video project id |
| Worker (`apps/worker`) | Server loop, one job at a time | Publishing only; no render queue |
| Brands (`packages/brands`) | Live: `get_brand` gives colours, type, logo files, `adCreatives.placements` with safe zones, voice | Thumbnails can follow it directly |
| Social-Render (`AI-Automation\Social-Render`) | JSON spec → PNG/PDF with headless Chrome, PC only, personal brand | Not a product package; needs brand input from `get_brand` and to run in a container |
| Skills | `yt-*` (11, MIT, served as text; `yt-viral` ranks by multiple of channel median; `yt-edit` prints an edit decision list; `yt-shorts` finds self-contained moments; `yt-package` lints title+thumbnail), marketingskills `video` and `social` | Their outputs (EDL, cut list, title/thumbnail text) become machine inputs here |
| Metering | Free 200 calls/month; Premium $9/month unlimited (decision 0009) | Rendering costs CPU, storage and egress per minute: a flat $9 cannot carry it (V9) |
| Server | Hetzner CX23, 2 vCPU / 4 GB, 40 GB disk, shared with Raptor (which also runs ffmpeg) | Not a render box; light FFmpeg only, capped (V3) |
| Raptor Downloader (`Websites\Raptor-Downloader`) | Live API on the same server: yt-dlp + ffmpeg; YouTube routed through a VPN egress | Technically able to fetch; legally only usable for rights-cleared, non-YouTube sources (V6) |
| Owner's AE workflow (`Video Editing\PLAYBOOK.md` §6) | Prism MCP (`live.oneprism.io`, OAuth) drives AE; `aerender` renders; hard-won rules: wrap mutations in `prism.bulk`, close AE before `aerender`, one render at a time, verify the `.aep` mtime on disk, never trust "success" without looking | The station must encode these rules in code |

---

## 3. Components and where each runs

```
                AI client (Claude, ChatGPT…) ──MCP──►  {{PRODUCT_NAME}} hosted MCP (server)
                                                         │  video_* tools: ingest, plan, variants,
                                                         │  metadata, thumbnails, approve, schedule,
                                                         │  library search
                                                         ▼
   ┌──────────────── Hetzner server (the brain) ──────────────────────────────────────┐
   │ Postgres: projects, assets+rights, edit jobs, renders, variants, metadata,       │
   │           thumbnails, approvals, publications, stations, usage                   │
   │ render queue (same claim/lease/heartbeat pattern as jobs)                        │
   │ adspilot-render container: ffprobe/ffmpeg recipes, capped (1 job, ~1 CPU)        │
   │   + headless Chromium for thumbnail PNGs (Social-Render ported)                  │
   │ existing worker: publishes approved variants through the adapters                │
   │ station API: /station/* (poll, lease, upload result, heartbeat) — token per      │
   │   station, tenant-scoped                                                          │
   └───────────────┬─────────────────────────────┬────────────────────────────────────┘
                   │ S3 API                       │ HTTPS poll (outbound from station)
                   ▼                              ▼
   Object storage (Hetzner, Helsinki)     Edit station (Windows/Mac with After Effects)
   masters, renders, variants,            station agent (Node, ours) → aerender / nexrender
   thumbnails, captions; signed URLs      templates; Prism via its MCP for AI-driven edits;
   for platforms that fetch               uploads renders back; never listens on a port
                   │
                   └─► nightly copy of the library index + approved finals to the PC
                       backup (outside git, like the DB backups)
```

| Component | Runs on | Does | Never does |
|---|---|---|---|
| Hosted MCP `video_*` tools | Server | Takes requests from any AI; creates projects, jobs, approvals; returns previews and links | Renders, publishes without a token |
| Rights gate (`core/domain/rights.ts`) | Server, in core | Classifies every asset's rights; blocks publish/export when missing (§6) | Trusts an AI's say-so |
| Variant planner (`core/video/variants.ts`) | Server, in core, pure | From master facts + platform video specs (data) → per-platform recipe (aspect, crop, trim, encode, captions, loudness) | Calls FFmpeg itself |
| Render runner | `adspilot-render` container on the server (phase 1), later a separate render host or the station | Runs recipes with FFmpeg, verifies output with ffprobe + black/freeze detection + loudness | Runs more than one job at a time on the CX23 |
| Thumbnail renderer | Same container (headless Chromium) | Brand-following PNG/JPG per platform from a spec + chosen frame | Invent a logo (memory rule: real logo file or plain text) |
| Metadata drafter | The calling AI, guided by skills (`yt-package`, `yt-seo`, `social`) | Writes titles, captions, tags, hashtags per platform | Decide limits — the validator does |
| Metadata validator (`core/video/metadata.ts`) | Server, in core, pure | Checks every field against the platform table (§5) and the brand's `neverOnCreative` words | Truncate silently (it reports, the AI rewrites) |
| Approval | Server (existing R11 token) + preview page `/v/<signed id>` (like `/brands`) | Owner watches each cut, reads each platform card, approves per platform | Accept a token for a changed file or text |
| Publisher | Existing worker + adapters | Posts each approved variant at its slot | Anything not approved |
| Edit station agent | Owner's PC (phase 2); a customer's machine (BYO licence) | Polls, leases a job, opens a template or runs Prism-driven steps, renders with `aerender`, verifies, uploads | Accept inbound connections; run two renders at once |
| Library | Object storage + `media_assets` rows | Keeps masters, approved finals, variants, thumbnails, captions and metadata for reuse (ads, re-posts) | Delete an asset still referenced by a scheduled target |

---

## 4. The design in detail

### 4.1 Data model (Prisma; one migration per phase; plain Postgres per decision 0010)

New and changed tables (names indicative):

- **`media_assets`** (existing) gains: `sha256`, `storage_backend` (`supabase` | `s3`),
  `role` (`source` | `master` | `variant` | `thumbnail` | `captions` | `audio`),
  `parent_asset_id` (lineage), `rights_record_id` (required for `source`), `retention`
  (`library` | `temp`), `video_codec`, `audio_codec`, `fps`, `loudness_lufs`.
- **`rights_records`**: `basis` (`own_footage` | `own_published_post` | `licensed_stock` |
  `creator_permission` | `creative_commons` | `public_domain` | `ai_generated` |
  `client_supplied`), `holder`, `licence_name`, `licence_url_or_doc` (an uploaded PDF or a URL),
  `cc_variant` (`BY` | `BY-SA` …; `NC` and `ND` are refused for commercial edited reuse),
  `attribution_text`, `allows_edit`, `allows_commercial`, `territories`, `expires_at`,
  `attested_by_user_id`, `attested_at`, `evidence_asset_id`. Append-only history (audit log).
- **`video_projects`**: tenant, brand slug, title, goal, brief, `inspiration_refs[]` (URLs and
  notes only — never files), script, status (`draft` → `editing` → `review` → `approved` →
  `scheduled` → `done`).
- **`edit_jobs`**: project, `engine` (`ffmpeg` | `ae_station` | `cloud_api`), `recipe` (JSON:
  EDL from `yt-edit`, cut list from `yt-shorts`, template id and fields), inputs, state
  (`queued` | `leased` | `running` | `verifying` | `done` | `failed` | `needs_human`), `station_id`,
  lease and heartbeat columns (same pattern as `jobs`), attempts, error code, cost (CPU seconds,
  AI dollars).
- **`renders`**: edit job, master asset, verification report (ffprobe facts, black/freeze
  ranges, loudness, true peak), `approved_cut_at/by`.
- **`video_variants`**: render, `platform`, `surface` (`yt_long`, `yt_short`, `ig_reel`,
  `fb_reel`, `fb_video`, `li_video`, `tt_video`, `pin_video`, `x_video`, `threads_video`),
  asset, `spec_version`, recipe used, captions mode (`burned` | `sidecar` | `none`).
- **`variant_metadata`**: variant, title, description/caption, tags[], hashtags[], category,
  privacy, made-for-kids, synthetic-media flag, branded-content flags, cover (asset or frame
  ms), first comment, link, validation report, `content_hash`.
- **`approvals`** (or reuse the policy token store): variant + metadata hash + file sha256 +
  connection + slot → token; who approved and when.
- **Publishing**: one `Post` per variant with a single `Target` (works with today's tables and
  worker: no change to how jobs are claimed), plus `posts.video_project_id` and
  `posts.variant_id`. Title/tags/cover travel in `Post.overrides` (the YouTube spec D8 pattern).
- **`stations`**: tenant, name, platform (win/mac), capabilities (`ae`, `prism`, `aerender`,
  `nexrender`, `ffmpeg`, `gpu`), AE version, token hash, `last_seen_at`, `paused`.
- **`usage_months`** (existing) gains `render_seconds`, `storage_gb_peak`, `ai_usd`.

### 4.2 Per-platform variant builder (data, not code paths)

The platform facts live in **one table in `core/src/adapters/capabilities.ts`** (the only place
R10 allows platform names besides adapters), as a `videoSurfaces` list per platform: aspect
targets and accepted range, min/max seconds via API, max bytes, codec/container, fps range,
caption/title/description/tag limits, cover method, scheduling, audit gate. Each entry carries
`verified: '<date>' | false` like today's records. The research note §2 table is the first fill.

The planner is a pure function:

```
planVariants(master: {w,h,seconds,hasSpeech,transcript?}, targets: Surface[], brand) →
  for each surface: { aspect, reframe: 'crop-center' | 'crop-subject' | 'blur-pad' | 'letterbox',
                      trim: {in,out} | 'needs-cut-list', captions: 'burn' | 'sidecar',
                      encode: {vcodec:'h264', profile:'high', pix:'yuv420p', fps, maxrate, gop,
                               acodec:'aac', ar:48000, faststart:true},
                      loudness: {I:-14, TP:-1.5}, safeZone: from brand placements + platform,
                      warnings[] }
```

Rules it encodes:
- **Never cut a story silently.** If the master is longer than a surface allows (e.g. X 140 s,
  Facebook Reels via API 90 s, Shorts 3 min), the planner returns `needs-cut-list`; the AI runs
  `yt-shorts` on the transcript to pick self-contained moments and the owner approves them.
- **Reframing:** 16:9 → 9:16 defaults to `blur-pad` for talking-head-plus-graphics and
  `crop-center` for single-subject footage; subject-tracking crop is a later improvement.
- **Captions:** burned into vertical surfaces (sound-off viewing), using the brand's caption
  style and box text (PLAYBOOK lesson: box text, never point text); a sidecar SRT where the
  platform accepts one (YouTube `captions.insert`, LinkedIn captions).
- **Loudness:** −14 LUFS integrated, true peak ≤ −1.5 dBTP (the owner's standard, PLAYBOOK §5).
- **One master, many variants, encoded once each and stored**: re-posting or using as an ad
  never re-exports (the owner's requirement).

### 4.3 Edit engines

| Engine | For | Where | Cost |
|---|---|---|---|
| **FFmpeg recipes** (default) | trims, cut lists (EDL), reframes, burned captions, logo bug, intro/outro cards rendered as PNG, music bed ducking, loudness, encode, cover frames | `adspilot-render` container; later a render host | CPU only; FFmpeg is LGPL/GPL software we run as a separate program (research §1.4) |
| **AE templates via `aerender` / nexrender** | branded motion intros, lower thirds, animated captions from a template with fields | Edit station (owner's PC first) | The station's AE licence; nexrender is open source (research §1.4) |
| **Prism-driven AE** | edits that need judgement: documentary-style builds, motion graphics from a scene document, transcription, music/SFX generation | Edit station, with a signed-in Prism panel, **only under the station owner's own Prism and Adobe licences** | Prism Pro $6/month + Prism AI packs (owner's account: Pro, unlimited MCP calls, AI balance $2.15 on 2026-10-11) |
| **Cloud render API** (optional) | customers with no station who need template motion graphics | Shotstack (from $39/month for 250 min) / Creatomate (from $54/month) / Plainly (AE templates in their cloud, from $69/month for 50 min) | research §1.5; decision V1 |

Not chosen: **Remotion** (needs a paid company licence for automation: $0.01 per render with a
$100/month minimum) — only worth it if we later want React-designed motion templates rendered
on our side.

**How a station uses Prism (phase 2):** the station agent does not reimplement or proxy Prism.
On a station whose owner holds the Prism and Adobe licences, it runs a headless AI session (the
same pattern as the Muzaree tasks: headless Claude with a fixed instruction file) that connects
to **that owner's own** Prism MCP, with our station tools, the job's recipe and the PLAYBOOK §6
rules. Our server never holds a Prism token and never connects to Prism; jobs reach a station only
from the station's own tenant. Deterministic steps (open project, import, render with `aerender`,
verify) are the agent's own code; Prism is used for the creative steps. Each step is idempotent and
verified on disk (`.aep` mtime, render file, ffprobe, blackdetect), because Prism and AE can report
success that never reached disk (PLAYBOOK §6). The agent ships without an FFmpeg binary (GPL
distribution duties); it uses the station's own FFmpeg.

### 4.4 Thumbnails and covers per platform

| Surface | What we can set | Our output |
|---|---|---|
| YouTube long | `thumbnails.set`, JPG/PNG, max 50 MB (since 2026-09-14), 16:9, min 640 px wide; the channel must be verified (else 403) | 1280×720 JPG under 2 MB (works everywhere, fast) from `yt-package`'s thumbnail text + a chosen frame |
| YouTube Shorts | API thumbnail for Shorts unverified; Help mentions desktop Studio only | Pick the cover frame inside the first seconds; burn the hook text |
| Instagram Reels | `cover_url` (JPEG ≤8 MB) or `thumb_offset` (ms); cover_url wins | 1080×1920 JPEG cover with the 1:1/4:5 grid crop kept inside the safe area |
| Facebook Reels / video | Page video `thumb`; Reels thumbnail through a separate call | Same 9:16 cover |
| LinkedIn | `uploadThumbnail`, JPG/PNG ≤2 MB, same ratio as the video | 16:9, 1:1, 4:5 or 9:16 per variant |
| TikTok | `video_cover_timestamp_ms` only | A frame time |
| Pinterest | `cover_image_url` / `cover_image_data` / `cover_image_key_frame_time` (send one; a missing cover is reported to fail) | 2:3 or 9:16 cover |
| X, Threads | none via API (first frame) | Make the first frame a designed card |

Generated by the ported **Social-Render** (`packages/render`, headless Chromium in the render
container): input = `get_brand` tokens + logo file (real file only) + frame PNG + text; output =
exact-size PNG/JPG, checked for size limits and contrast (the brands validator already computes
WCAG ratios). The thumbnail text comes from `yt-package` (title and thumbnail written as one
unit, linted for truncation).

### 4.5 Approval flow (R11, unchanged in spirit)

1. Edit finishes and verifies → status `review`. The owner (or the tenant's approver) gets a
   signed, expiring preview link `/v/<id>` (same signed-link mechanism as `/brands`), and a Slack
   message where Slack is connected (R2).
2. **Cut approval:** watch the master; approve or send notes (notes become a new edit job).
3. **Per-platform approval:** one card per variant: the video as that platform will show it
   (aspect, safe zones overlaid), title, caption, tags/hashtags, thumbnail/cover, account,
   slot, privacy, AI-disclosure flags, the rights summary with attribution. Approve per card or
   "approve all shown".
4. The token is an HMAC over {variant sha256, metadata content hash, connection id, slot,
   privacy}. Any edit invalidates it. Scheduled posts are created only from valid tokens.
5. Nothing is reported as "published" until the platform confirms; YouTube while unaudited is
   reported "uploaded, private" (existing D5).

### 4.6 The media library

- **Where:** object storage per decision 0010 §5 — recommend **Hetzner Object Storage, Helsinki**
  (same region as the server, S3 API, about €5/month base including 1 TB stored and 1 TB egress
  at launch pricing; research §1.6), behind the existing `MediaStore` interface so R2 or local
  disk can replace it. The CX23's 40 GB disk is not the library.
- **Layout:** `t/<tenant>/v/<project>/{source,master,variants,thumbs,captions}/<sha256>.<ext>`;
  rows in `media_assets` with lineage and rights. Public platforms that fetch (Instagram,
  Threads, Pinterest, TikTok pull) get **time-limited signed URLs**, not a public bucket.
- **PC copy:** the nightly backup job copies the library index and approved finals (not
  temporary renders) to `%USERPROFILE%\.social-publisher\backups\media\` — outside the workspace
  and git, like the database dumps (client media is client data).
- **Reuse:** `video_library_search` (by brand, project, platform, aspect, duration, tags,
  performance) returns assets; the Meta ads tools accept a library asset id directly (they
  already upload video up to 4 GB in chunks), so an approved 9:16 variant becomes a Reels ad
  without re-export. Rights travel with the asset: an asset whose licence forbids ads (or has
  expired) is refused for ads.
- **Retention:** sources and temp renders 30 days after the project is done; approved masters,
  variants, thumbnails and metadata kept while the tenant exists (V13).

### 4.7 Metering and analytics

- Metered per tenant per month: **render seconds** (output duration × engine factor), **storage
  GB**, **AI dollars** (Prism/OpenRouter), **publishes**. Free: no rendering (or a small trial);
  Premium includes a monthly allowance; beyond it, credits (V9). The existing wrapper already
  meters MCP calls; render jobs add their own counters.
- PostHog events: `video_project_created`, `edit_job_finished` (engine, seconds, ok/error code),
  `variant_built`, `approval_given`, `video_published` (platform, surface). Never content.
- Performance read-back (later): YouTube Analytics (retention curve → `yt-retention`),
  Instagram/Facebook insights (already read for Pages) — fed back into the next brief.

### 4.8 Failure handling (every error gets a resolution entry, R1)

| Failure | Behaviour | Resolution code (new) |
|---|---|---|
| Source has no rights record / NC / ND / expired | Refuse at ingest for edit; refuse at approval | `VIDEO_RIGHTS_MISSING`, `VIDEO_RIGHTS_FORBID_EDIT`, `VIDEO_RIGHTS_EXPIRED` |
| Longer than a surface allows | Planner asks for a cut list | `VIDEO_TOO_LONG_FOR_SURFACE` |
| Render fails / output black, frozen, silent, clipped | Retry once with the same recipe, then `needs_human` with the ffprobe/blackdetect evidence | `VIDEO_RENDER_FAILED`, `VIDEO_RENDER_INVALID` |
| Station offline / AE panel disconnected / Prism balance low | Job stays queued; owner told what to open (Prism's own `diagnose` fix text) | `VIDEO_STATION_OFFLINE`, `VIDEO_AE_NOT_CONNECTED`, `VIDEO_PRISM_BALANCE_LOW` |
| Render host busy | Queue with an estimate; never two renders at once on the CX23 | (notice, not error) |
| Platform processing failed after upload (IG container `ERROR`, LinkedIn `PROCESSING_FAILED`) | Mark that target failed with the platform's message; other platforms continue | existing publish codes + `VIDEO_PLATFORM_PROCESSING_FAILED` |
| Content ID / Rights Manager claim after posting | Read back where an API allows; record on the asset; block reuse | `VIDEO_CLAIM_RECEIVED` |
| Quota (YouTube 100 uploads/day bucket per project) | Spread uploads; transient retry next day | existing YouTube codes |

Lease + heartbeat on edit jobs (the worker's `touchJob` pattern) so a long render is never run
twice; outputs keyed by sha256 of (recipe + input hashes) so a retry reuses a finished render.

---

## 5. Platform table the code will encode (summary; full, cited table in the research note §2)

The authoritative, sourced table is research note §2; it is written to be copied into
`videoSurfaces`, each surface with its `verified` date. What the planner and validator use:

| Surface | Aspect we produce | Length rule (API) | File rule | Metadata fields and limits | Cover | Schedule | Gate |
|---|---|---|---|---|---|---|---|
| `yt_long` | 16:9 1920×1080 | ≤15 min unless the channel is verified (≤12 h) | ≤256 GB | title ≤100 chars, no `<>`; description ≤5,000 **bytes**, no `<>`; tags ≤500 chars total; category; privacy; made-for-kids; synthetic flag | thumbnail 1280×720 | our queue; `publishAt` later | private until audit (docs conflict; test) |
| `yt_short` | 9:16 1080×1920 (or 1:1) | ≤3 min | same | same as long | cover frame | same | same |
| `ig_reel` | 9:16 1080×1920 | 3 s–15 min | ≤300 MB, H.264, AAC 48 kHz, ≤25 Mbps, moov first | caption ≤2,200 chars, ≤30 hashtags, ≤20 mentions; no title | `cover_url` JPEG ≤8 MB or `thumb_offset` | our queue | App Review; publishing limit read at run time |
| `fb_reel` | 9:16 1080×1920 | **3–90 s** | H.264, AAC 48 kHz | description (hashtags inside), optional title | thumbnail call | native or our queue | 30 Reels/Page/day |
| `fb_video` | 16:9 or 1:1 | n/s | n/s | title, description | `thumb` | native or our queue | — |
| `li_video` | 16:9, 1:1, 4:5 or 9:16 | 3 s–30 min | ≤500 MB, MP4, <30 fps advised | commentary ≤3,000 (little-text escaped); media title | thumbnail ≤2 MB; one English SRT | our queue | personal profile now; company page needs approval |
| `tt_video` | 9:16 | ≤10 min and ≤ creator's `max_video_post_duration_sec` | ≤4 GB | caption ≤2,200 UTF-16; privacy chosen by the user from `creator_info` (no default); comment/duet/stitch toggles; branded-content toggles; `is_aigc` | cover frame time | our queue | audit (private-only until then) |
| `pin_video` | 2:3 or 9:16 (1:2–1.91:1) | 4 s–15 min | ≤2 GB | title ≤100, description ≤800, alt text ≤500, link | cover required | our queue | Standard access (sandbox has no video) |
| `x_video` | 16:9 or 1:1 (≤1280×1024) | ≤20 min (Premium 125) | ≤8 GB, H.264 High, AAC-LC | text ≤280 weighted chars; no title | first frame | our queue | paid: $0.015/post, $0.20 with a URL |
| `threads_video` | 9:16 | ≤5 min | ≤1 GB | text ≤500, ≤5 links, one topic tag | none | our queue | App Review |

Caption burn-in stays inside the common safe area (keep text out of the top ≈250 px, bottom
≈670 px and right ≈200 px on 1080×1920; the brand's placement safe zones win where stricter).

---

## 6. Copyright and platform policy: the guardrails the product enforces

Plain words first: **using someone else's video in your post needs their permission, a licence
that covers it, or a narrow legal exception that a court decides after the fact.** "I edited it"
or "I added commentary" does not make it yours. Platforms also punish re-posted content even when
nobody sues: YouTube demonetises "inauthentic/reused" channels, Meta cuts distribution and
monetisation for "unoriginal" accounts, TikTok keeps unoriginal posts out of For You, and Content
ID / Rights Manager matches can block or monetise the video for the original owner. A product that
downloads other people's videos and re-posts them for its customers turns each customer's risk
into ours as well. Research note §3 has the sources.

Guardrails (enforced in code, not in instructions):

1. **Every source asset has a rights record** (§4.1) before it can enter an edit job. Allowed
   bases: own footage, own published posts fetched through the platform's official API for the
   connected account, licensed stock (licence id stored), written creator permission (document
   stored), CC BY / CC BY-SA (attribution stored), public domain, AI-generated (with disclosure).
2. **No downloader intake from YouTube**, ever (YouTube Terms). Raptor (or any downloader) may
   fetch a URL only when the rights record names a permission that covers it, and only from a
   platform whose terms allow it; the downloaded file is tagged with that record.
3. **Inspiration is URL-only.** `inspiration_refs` stores links and notes; the pipeline has no
   code path that turns an inspiration URL into a source file.
4. **CC NC and ND are refused** for edited commercial posts; CC attribution is inserted into the
   description/caption automatically and checked by the metadata validator.
5. **Publish refuses** any variant whose lineage contains an asset without a valid record (the
   check runs at approval and again at publish time — a licence can expire in between).
6. **Attestation is per asset and logged**: the user states the basis; the audit log keeps who
   said what. Customers accept terms that make them responsible for their uploads; we keep a
   repeat-infringer policy and a takedown contact (DMCA-style).
7. **Music licensed per platform.** Each audio asset records the platforms its licence covers;
   a variant is refused for a platform its music is not licensed for (YouTube Audio Library →
   YouTube only; Meta Sound Collection → Facebook/Instagram only; TikTok Commercial Music
   Library → TikTok only; one edit for every platform needs a paid library or an original track
   whose terms cover commercial use everywhere — confirm Prism/ElevenLabs music terms first).
   No "trending sound" lifted from someone else's video.
8. **AI disclosure flags** set from the lineage: AI voice, AI video or realistic AI imagery →
   `containsSyntheticMedia` (YouTube), `is_aigc` (TikTok), Meta "AI info" where the API allows,
   Pinterest `ai_disclosures`. Plain cuts and captions need no label.
9. **Claims are recorded**: a Content ID or Rights Manager claim on a published variant marks the
   asset, blocks reuse (ads included), and tells the owner.
10. **Near-duplicate check** (later phase): a perceptual fingerprint of each outgoing variant is
    compared with fingerprints of sources the tenant has *referenced* as inspiration; a match is
    blocked unless a licence covers it.
11. **No watermark removal, and no {{PRODUCT_NAME}} branding on TikTok posts** (TikTok API rule);
    TikTok's music-usage confirmation and privacy choice are shown to the user before posting.
12. **Takedown readiness:** a published notice-and-takedown contact, a repeat-infringer policy,
    a registered DMCA agent before US customers are onboarded, and the ability to delete a
    published post on request.
13. **Words matter:** product copy never says "repost viral videos", "download any video" or
    similar (inducement evidence under Grokster); it says "learn what works, make your own".
14. **The owner's documentary-shorts channel (The Unsealed World) stays a manual, separate
    operation**, at the owner's own judgement; the product does not automate its "download a
    documentary and re-narrate" step (V7). Note for the owner: YouTube lists "edited footage from
    other creators where you add a storyline and commentary" as acceptable for monetisation, but
    that is a monetisation rule, not a copyright licence, and downloading from YouTube still
    breaks its Terms; Content ID can still block or monetise each video for the original owner.

---

## 7. Phases (smallest useful slice first)

Effort is focused build days for one engineer-agent session stream, including tests, excluding
waiting on platforms. Costs are monthly running costs at today's scale.

### Phase 0 — fix the foundations video depends on (≈3–4 days)
- Media off Supabase for video: `S3MediaStore` behind `MediaStore` (Hetzner Object Storage),
  signed URLs, sha256 keys (decision 0010 §5). Supabase free caps files at 50 MB.
- `ffprobe` on ingest (ideas.md J3): real duration, dimensions, codecs, fps, rotation — so
  validation uses facts.
- Capabilities per media kind: Instagram Reels 9:16 must pass (today 0.8–1.91 applies to video
  too); correct X (20 min) and LinkedIn (500 MB) video limits; add `videoSurfaces`.
- Pinterest video upload flow rebuilt (`/media` register → upload → `media_id` + cover).
- YouTube: `thumbnails.set`, per-post tags, `publishAt` (private + scheduled) behind the audit flag.
- **Prove the first private YouTube upload** (already STATUS "next up" #2).
- Rights model + `VIDEO_*` resolution entries.
- Cost: Object Storage ≈ €5/month. Owner: approve storage account creation; start the YouTube API
  audit and the TikTok app audit now (long lead).

### Phase 1 — own video → variants + metadata + thumbnails → approved, scheduled posts (≈10–12 days)
- `video_*` MCP tools: `video_ingest` (upload or library asset; rights record required),
  `video_plan_variants`, `video_build_variants` (FFmpeg recipes), `video_draft_metadata` (the AI
  writes; the validator checks), `video_thumbnails`, `video_preview_link`, `video_approve`,
  `video_schedule`, `video_library_search`.
- `adspilot-render` container: FFmpeg + headless Chromium, `cpus: 1.0`, memory ≈1.5 GB,
  concurrency 1, source ≤ 10 min and ≤ 1080p on the CX23; larger jobs go to the station.
- Targets: **YouTube (long + Shorts; private until audit), Instagram Reels, Facebook Page video
  (Reels next), LinkedIn personal video** — adapters we have.
- Burned captions from a transcript (Prism transcription on the station, or an STT API on the
  server — V11), brand thumbnails, the preview page, Slack approval message.
- Verification: a real end-to-end run on the owner's own clip to IG + LinkedIn (public, owner
  approved) and YouTube (private) recorded in PROJECT-LOG (R4).
- Cost: CPU on the existing server; storage as above; STT ≈ cents per minute if an API is used.

### Phase 2 — the edit station: After Effects + Prism (≈8–10 days)
- Station agent (Node, Windows first): pairing code → station token; outbound polling; lease +
  heartbeat; download inputs; run `aerender` for templates (or nexrender); Prism-driven steps via
  a headless AI session with the PLAYBOOK rules; verify on disk; upload render; report.
- Template library: brand intro/outro, lower third, animated captions (fields from `get_brand`).
- BYO-licence mode for customers with AE + Prism (their accounts, their machine); a station only
  ever receives jobs of its own tenant.
- Before building: OnePrism's written answer on owner-operated client work and automated
  (agent-driven) use, and Adobe's on unattended `aerender` (V2, V15).
- Cost: owner's existing Adobe + Prism Pro ($6/month); Prism AI packs per generation.

### Phase 3 — "what works" research and rights-cleared intake (≈6–8 days)
- `yt-viral` fed by the **official** YouTube Data API (`search.list` 100 units, `videos.list` 1
  unit, `channels.list`) — public numbers only, no downloading; outputs a swipe file of formats,
  hooks, lengths, title formulas → `yt-plan` / `yt-script` briefs for the owner or client to film.
- Intake of the business's **own** past posts through official APIs (Instagram `media_url`,
  Facebook video `source`) into the library with `own_published_post` rights; YouTube originals
  come from the owner's files or YouTube Studio download, not a downloader.
- Licensed stock intake (Pexels/Pixabay APIs; licence recorded) and creator-permission intake
  (permission document required); Raptor only for those, never YouTube.
- Long → Shorts automation: `yt-shorts` cut list → approval → variants.

### Phase 4 — more platforms and reuse (≈8–12 days, mostly waiting on audits)
- TikTok adapter (Content Posting API; private until audit), Pinterest Standard access, X (paid
  API, cost shown before posting), Threads credentials, Facebook Reels endpoint.
- Library → ads: pick an approved variant for a Meta ad without re-export; performance read-back.

### Costs summary

| Item | Monthly | Note |
|---|---|---|
| Object storage (Hetzner, 1 TB incl.) | ≈ €5 | launch price; check current |
| Render host if the CX23 is too small | ≈ €35–43 (Hetzner CPX32/CCX13 after the June 2026 price rises) | only when measured (V3); the owner's PC station is the free alternative |
| Cloud render API (optional) | Shotstack $39+/month, Creatomate $54+, Plainly $69+ (AE templates) | research §1.5 |
| Prism | owner's existing Pro plan ($6/month) + AI packs | not resellable; BYO for customers |
| X API | pay-per-use | phase 4 |
| STT for captions | cents per minute | V11 |

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Customers use the pipeline to re-post others' content | High if allowed | Rights gate in code (§6); no downloader for YouTube; terms + takedown process |
| YouTube audit refused or slow → uploads stay private | Medium | Start now; product says "uploaded, private" honestly |
| TikTok audit → private only | High until passed | Start the audit early; ship TikTok last |
| CX23 overloaded by renders (Raptor shares it) | Medium | One capped job; size limits; station or render host fallback (V3) |
| Prism changes terms/price, or forbids automated use | Medium | FFmpeg path does not depend on it; Prism used only on stations with their own licence |
| AE/Prism "success" that never reached disk | Seen before | Verify on disk, ffprobe, blackdetect (PLAYBOOK) |
| Large files: LinkedIn API cap documented as 500 MB (schema also says 5 GB); Instagram Reels 300 MB | Medium | Variant encoder targets well under each surface’s cap (bitrate from duration) |
| Platform specs change quietly | Certain over time | `verified` dates per surface; monitor re-checks quarterly |
| Storage costs grow with libraries | Low now | Retention policy (V13); metering |
| Supabase file cap (50 MB) blocks scheduled video before Phase 0 | Certain today | Phase 0 storage move |

---

## 9. Decisions for the owner (V1–V16), each with a recommendation

| # | Decision | Recommendation |
|---|---|---|
| V1 | Default automatic edit engine | **FFmpeg recipes on our side** for every routine edit; AE only on stations; no cloud render API until a customer needs template motion graphics without a station |
| V2 | Prism inside the product | **Not embedded, not resold, never proxied by our server.** BYO-licence stations for customers; the owner's station for the owner's own videos. Email OnePrism (support@oneprism.io) asking (a) whether owner-operated edits for agency clients count as "your own creative work", (b) whether agent-driven automated use is fine, (c) terms for a partner/reseller agreement. Decide "Prism edits for other businesses" only on a written yes |
| V3 | Where FFmpeg renders run | **Phase 1 on the CX23 in a capped container** (1 job, ~1 CPU, ≤10 min, ≤1080p); add a render host only when queue waits or Raptor slow-downs are measured |
| V4 | Library storage | **Hetzner Object Storage, Helsinki** (S3 API, same region); R2 as the alternative if egress grows |
| V5 | Rights gate strictness | **Hard block** on edit and publish without a rights record; no override switch, attestations logged |
| V6 | Raptor as the download engine | **Only for rights-cleared, non-YouTube sources**, through an authenticated internal call that carries the rights record id; never YouTube |
| V7 | The Unsealed World model in the product | **Keep it out of the product**; it stays the owner's manual operation and judgement |
| V8 | Approval granularity | **Per platform card**, with "approve all shown" as a convenience; token over file hash + metadata + slot |
| V9 | Pricing of video | **Render minutes as credits**: Premium includes a monthly allowance; extra minutes sold in packs; Free can preview, not render (numbers after Phase 1 measures real CPU cost) |
| V10 | Thumbnail renderer | **Port Social-Render into `packages/render`** (headless Chromium in the render container), driven by `get_brand` |
| V11 | Captions source | **Station: Prism transcription; server: an STT API** chosen after a price/accuracy check (Roman Hinglish matters for the owner); burned on vertical, SRT sidecar where supported |
| V12 | Platform order | **YouTube (private until audit) + Instagram Reels + LinkedIn + Facebook** in Phase 1; TikTok, Pinterest, X, Threads in Phase 4; start YouTube and TikTok audits now |
| V13 | Retention | Sources and temp renders 30 days after done; approved finals, variants, thumbnails, metadata kept while the tenant exists; PC backup copy of approved finals |
| V14 | AI disclosure default | **Set automatically from lineage** (AI voice/video/realistic imagery → disclosed); the owner can add, never remove, a disclosure |
| V15 | Unattended After Effects rendering | **Ask Adobe before any unattended render queue**, even on the owner's PC: General Terms §6.4 forbid use "as a part of a hosted service, or on behalf of any third party", and the enterprise terms (reported) forbid operations "not initiated by an individual User (e.g., automated server processing…". Until answered, AE jobs start only when the station's licensed user starts or approves them |
| V16 | YouTube privacy after the first real upload | **Keep private-until-audit** until a real upload from our project shows the platform's actual behaviour (Google's pages conflict); then decide whether `YOUTUBE_UPLOADS_AUDITED` can change before the audit |

---

## 10. What this plan does not do

No code, no migration, no deployment, no posting, no editing of real videos, no After Effects
job, no downloads. The one call made to Prism was its read-only `diagnose` (no script, no project
touched): bridge not connected, server 1.5.1, Pro tier, unlimited MCP calls.
