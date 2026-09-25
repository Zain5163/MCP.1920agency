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
5. Under **App Settings → Basic**, set the OAuth redirect URI to
   `http://localhost:3000/api/auth/callback/facebook` for local development.
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

## Status

| Step | Blocks | Status |
|---|---|---|
| 1. Business Verification | Serving anyone but yourself | ✅ 2026-09-21 (1920 Agency) |
| 2. Meta App | Facebook + Instagram | ✅ app `SMMM-Agent`, connected and publishing |
| 3. Supabase | All persistence | ✅ migrated, keep-alive running |
| 4. Media storage | Instagram, Threads | ✅ Supabase Storage, public bucket `media` |
| 5. Env file | Running anything | ✅ at `%USERPROFILE%\.social-publisher\.env` |
| 6. Threads | Posting to Threads | ☐ needs its own Meta app use case and credentials |
| 7. Other platforms | Nothing yet | ☐ optional |

**Live as of 2026-09-25:** Facebook Page and Instagram both publishing, six real
posts sent, scheduler and monitor running as Windows scheduled tasks.
