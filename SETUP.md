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

## 4. Cloudflare R2 (media storage — free tier)

Needed because Instagram and TikTok *fetch* media from a public URL rather than
accepting an upload.

1. Sign up at **cloudflare.com**, go to **R2**.
2. Create a bucket, e.g. `social-publisher-media`.
3. Enable a **public access** custom domain for it (R2 → Settings → Public access).
   A subdomain of a domain you already own is ideal, e.g. `media.yourdomain.com`.
4. Create an **R2 API token** with read/write on that bucket. Note the access key ID,
   secret access key and account ID.

**Do you have a domain available for this?** If not, tell Claude — there is a fallback
using the `r2.dev` development URL, which works but is rate-limited and not suitable
beyond testing.

---

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

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=social-publisher-media
R2_PUBLIC_BASE_URL=https://media.yourdomain.com

# Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
VAULT_MASTER_KEY=...
```

Tell Claude when this file exists. **Do not paste its contents into chat.**

---

## 6. Optional, quick wins with no approval at all

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

## Status

| Step | Blocks | Done? |
|---|---|---|
| 1. Business Verification | Serving anyone but yourself | ✅ 2026-09-21 (1920 Agency) |
| 2. Meta App | Facebook + Instagram, even your own | ☐ |
| 3. Supabase | All persistence | ☐ |
| 4. Cloudflare R2 | Instagram, TikTok | ☐ |
| 5. Env file | Running anything locally | ☐ |
| 6. Bluesky/Telegram/Discord | Nothing — pure upside | ☐ |

**Also confirmed 2026-09-21:** a spare domain and subdomain are available for R2 media
hosting, and an Instagram Business/Creator account is already linked to a Facebook Page.
Both prerequisites are satisfied.
