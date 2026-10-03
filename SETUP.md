# Setup — what only you can do

Claude cannot log into your accounts or click through developer consoles. These are the
steps that need you. Everything else is being built alongside them.

**Nothing here costs money.** Every service listed has a free tier sufficient for Wave 1.

---

## 1. Meta Business Verification — ✅ ALREADY DONE

Confirmed by the owner on 2026-09-21: the **1920 Agency** Business Portfolio is already
verified in Business Manager.

**This was the long pole and it is gone.** Business Verification normally takes weeks and
gates App Review, which gates serving anyone but yourself. Because it is already
complete, the path to App Review is open as soon as there is a working app to demo — and
Wave 1 on your own accounts needs no review at all.

When creating the Meta App in step 2, make sure it is **linked to the verified 1920
Agency portfolio**, not created as a standalone personal app. An app created outside the
verified portfolio does not inherit the verification, and this is the most common way
people accidentally discard work they have already done.

---

## 2. Meta App (for Facebook Pages + Instagram)

1. **developers.facebook.com → My Apps → Create App.**
2. Type: **Business**. Link it to the Business Portfolio from step 1.
3. Add products: **Facebook Login** and **Instagram**.
4. Note down the **App ID** and **App Secret**.
   - ⚠️ The App Secret is a credential. Do **not** paste it into this workspace, into
     chat, or into any file under `D:\My AI Works`. It goes only in the env file in
     step 5.
5. Under **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**, add
   `http://localhost:8787/callback` — the address the connect command listens on
   (`META_REDIRECT_URI` overrides it) — and add `localhost` under **App settings →
   Basic → App domains**. While the app is **Live**, Meta enforces HTTPS and refuses
   this localhost address: switch the app to Development to connect, then back to
   Live (WAITING-LIST #17). A public https callback is the lasting fix.
6. Permissions needed later, at Advanced Access (these require App Review — do not
   submit until we have a working demo to show):
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   - `instagram_basic`, `instagram_content_publish`
   - `business_management`

   **Standard Access works on your own Pages with no review**, which is exactly what
   Wave 1 needs. Review is only required to serve other people's accounts.

**Instagram prerequisite:** the Instagram account must be a **Business or Creator**
account and must be linked to a Facebook Page you own. A personal Instagram account
cannot publish via the API at all. Convert it in the Instagram app under
Settings → Account type.

---

## 3. Supabase (Postgres — free tier)

1. Sign up at **supabase.com**, create a project. Any region near you.
2. From **Project Settings → Database**, copy the **connection string** (URI form).
3. From **Project Settings → API**, copy the **project URL** and the **service_role** key.
4. **Important, from our security research:** under **Project Settings → API**, plan to
   **disable the Data API** for the token schema once it exists. The browser must never
   talk to Postgres directly. Claude will flag the exact step when the schema is created.

---

## 4. Media storage — ✅ DONE (Supabase Storage)

Needed because Instagram, Threads and TikTok *fetch* media from a public URL
rather than accepting an upload.

Using **Supabase Storage**, not Cloudflare R2 — the account already exists and R2
requires a payment card even on its free tier. A public bucket named `media` is
configured and verified working.

A *scheduled* LinkedIn document post (PDF carousel) is stored here too, so the
bucket must take `application/pdf`. If the bucket has an allowed-types list, add
it. Not checked yet (2026-10-02): if PDFs are refused, the CLI says so when the
post is scheduled and nothing is queued.

## 5. The env file — OUTSIDE this workspace

Workspace rule: no secrets inside `D:\My AI Works`. Create this file instead:

```
C:\Users\<you>\.social-publisher\.env
```

With this shape (fill in your own values):

```
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

META_APP_ID=...
META_APP_SECRET=...

SUPABASE_STORAGE_BUCKET=media

APP_PASSWORD=...          # dashboard sign-in, superseded by real accounts
SLACK_WEBHOOK_URL=...     # optional, for health alerts

# Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
VAULT_MASTER_KEY=...
```

Tell Claude when this file exists. **Do not paste its contents into chat.**

---

## 7. Optional, no approval needed

These work in minutes and are useful for testing the pipeline end to end before Meta
approves anything:

- **Bluesky** — create an App Password in Settings → Privacy and Security. No developer
  account, no review.
- **Telegram** — message `@BotFather`, `/newbot`, get a token. Add the bot to your
  channel as an admin.
- **Discord** — Server Settings → Integrations → Webhooks → New Webhook. Copy the URL.

Wiring one of these first proves the whole scheduling and publishing path works while
the Meta paperwork is still moving.

---

## 6. Threads — a SEPARATE authorisation (optional)

Threads is Meta, but it is **not** the same API as Facebook and Instagram. It has
its own host (`graph.threads.net`), its own OAuth, and needs a Meta app configured
with the **Threads use case**. An existing Facebook authorisation does not cover it.

1. **developers.facebook.com** → your app (or a new one) → **Add use case** →
   **Threads API**
2. Request the permissions `threads_basic` and `threads_content_publish`
3. Under the Threads use case settings, add this redirect URI:
   ```
   http://localhost:8787/threads/callback
   ```
4. Copy the **Threads App ID** and **Threads App Secret** — these are *not* the
   same as your Facebook app id and secret
5. Add to the env file:
   ```
   THREADS_APP_ID=
   THREADS_APP_SECRET=
   THREADS_REDIRECT_URI=http://localhost:8787/threads/callback
   ```

**One operational difference worth knowing:** a Threads token lasts 60 days and
**must be refreshed** between 24 hours and 60 days after issue. A Facebook Page
token does not expire while the app stays installed, so Threads is the first
platform here whose connections go stale on their own if nothing refreshes them.

---

## 8. Google — YouTube (optional)

The code is built and unit-tested; **nothing has been connected or uploaded for
real yet.** These steps are yours, in the Google Cloud project
`gen-lang-client-0046538567` (the owner's own/dev project; it already exists,
created by Google AI Studio). Its existing **service account** cannot upload to
YouTube — that needs an **OAuth client**, below.

1. **console.cloud.google.com → APIs & Services → Library → YouTube Data API v3 →
   Enable.** Without it every call fails with `accessNotConfigured`
   (`GOOGLE_API_NOT_ENABLED`).
2. **Google Auth Platform (OAuth consent screen)**: user type **External**. Then
   either add yourself under **Audience → Test users**, or **publish the app to
   production**:
   - **Testing**: Google ends the authorisation **7 days** after you consent, so you
     would reconnect weekly (`GOOGLE_TOKEN_REVOKED`).
   - **In production** (unverified): you see an "unverified app" warning when
     connecting, which is expected for personal use, and there is no 7-day limit.
     Unverified production apps are capped at 100 users in total.
3. **Clients → Create client → Application type: Web application.** Under
   **Authorized redirect URIs** add exactly:
   ```
   http://localhost:8787/google/callback
   ```
   It must match character for character: `localhost` (not `127.0.0.1`), port
   8787, no trailing slash.
4. Copy the **Client ID** and **Client secret** into
   `%USERPROFILE%\.social-publisher\.env` (never into this workspace or a chat —
   the secret starts `GOCSPX-`):
   ```
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ```
5. In `source/apps/cli` run:
   ```
   pnpm connect:provider google youtube
   ```
   On Google's screen, choose the account (or brand account) that owns the
   channel and **leave both YouTube permissions ticked**: "Manage your YouTube
   videos" (uploads) and "View your YouTube account" (finding the channel, and
   the check before every upload that the token belongs to that channel).

**Uploads are private until the YouTube API audit passes.** Google restricts
every upload from an unaudited API project to private viewing, with no appeal.
AdsPilot therefore uploads as private and reports **"uploaded, private"** —
never "published" — while `YOUTUBE_UPLOADS_AUDITED=false`. The audit is the
YouTube API Services Audit and Quota Extension Form
(https://support.google.com/youtube/contact/yt_api_form), separate from Google's
OAuth app verification. Only after it passes, set `YOUTUBE_UPLOADS_AUDITED=true`
and choose `YOUTUBE_DEFAULT_PRIVACY` (`private`, `unlisted` or `public`).

Other things worth knowing:

- **Quota:** 100 uploads a day for the whole project, reset at midnight Pacific
  time; each channel also has its own daily upload limit. Neither error says
  "reconnect". What happens next depends on how the video was sent:
  - **Scheduled** (`--at`, or any post the worker publishes later): the worker
    waits for the reset and tries again on its own.
  - **Published now** (`pnpm post ... --publish` without `--at`, or
    `publish_post`): the post is recorded as failed and nothing retries it.
    Its video was never stored with the post, so the dashboard's Retry cannot
    resend it either. Publish it again from the file once the limit has reset.
- **Large videos:** publish them now, straight from disk
  (`pnpm post --video <file> --title "..." --platform youtube --publish`, or
  `publish_post` with a `localPath`). A *scheduled* post needs its file in the
  Supabase media bucket, which caps file size.
- **Uploads over about an hour are unproven.** A Google access token lasts an
  hour, so a longer upload renews it on the way and carries on where it was.
  That has only been tested against a scripted Google, not with a real upload
  that long.
- **The worker stops after 30 minutes.** Scheduled posts are published by the
  `AdsPilot-Worker` task, and Windows stops each of its runs after 30 minutes.
  A scheduled upload still going then is cut off, and 15 to 20 minutes later
  the job starts again from the beginning, so a video that needs more than 30
  minutes to upload keeps starting over and never goes out on a schedule:
  publish it now instead. A cut-off upload creates no video unless its final
  chunk had already been sent, and only then can the restart leave a second
  copy.
- **"Sent, but not confirmed"** (`YOUTUBE_UPLOAD_UNCONFIRMED`): the whole video
  reached YouTube but the reply was lost, so the video may already be on the
  channel. Nothing retries it: look in YouTube Studio before publishing again.
- **AI disclosure:** add `--synthetic` (or `syntheticMedia: true`) when the video
  contains realistic AI-generated or altered content. Every upload states it
  either way, along with "not made for kids". Only YouTube receives it through
  its API: on Facebook, Instagram and LinkedIn, label the post in their app.
- **Videos over 15 minutes** need a verified channel: https://www.youtube.com/verify.
- **Reconnect only when needed.** Google keeps at most 100 refresh tokens per
  account for one client; each connect issues a new one and the oldest silently
  stops working.

---

## Status

| Step | Blocks | Status |
|---|---|---|
| 1. Business Verification | Serving anyone but yourself | ✅ 2026-09-21 (1920 Agency) |
| 2. Meta App | Facebook + Instagram | ✅ app `Mysmadspilot` (renamed from Mysmadspilot 2026-10-02; same App ID), connected and publishing |
| 3. Supabase | All persistence | ✅ migrated, keep-alive running |
| 4. Media storage | Instagram, Threads | ✅ Supabase Storage, public bucket `media` |
| 5. Env file | Running anything | ✅ at `%USERPROFILE%\.social-publisher\.env` |
| 6. Threads | Posting to Threads | ☐ needs its own Meta app use case and credentials |
| 7. Other platforms | Nothing yet | ☐ optional |
| 8. Google (YouTube) | Uploading to YouTube | ☐ code built and unit-tested, not run live; needs the API enabled, a Web OAuth client and a connect. Uploads stay private until the YouTube audit |

**Live as of 2026-09-25:** Facebook Page and Instagram both publishing, six real
posts sent, scheduler and monitor running as Windows scheduled tasks.
