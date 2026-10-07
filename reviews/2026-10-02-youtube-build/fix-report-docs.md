Finding #9's docs part, the stale numbers and finding #10 are fixed, and the 10-07 PM title is shortened. All the worktree changes are in one commit, `97e25ab`, on `review-fixes`. No code was touched, no tests were added, `packages/db` was not changed, and nothing under `D:\My AI Works\AI-Automation\Social-Publisher` changed.

**Fixed (commit `97e25ab`, docs only):**
- **Finding #9, `SETUP.md:212`:** the quota bullet now separates the two cases. A scheduled post waits for the reset and retries on its own. A video published now (`--publish` without `--at`, or `publish_post`) is recorded as failed, nothing retries it, and the dashboard's Retry cannot resend it because its video was never stored. The channel's own daily limit is covered too.
- **`SETUP.md:225`:** uploads over about an hour are unproven until a real one is tried.
- **`SETUP.md:229`:** the AdsPilot-Worker task stops each run after 30 minutes (checked read-only on the task: `PT30M`). A scheduled upload still running is cut off and starts over 15–20 minutes later, so a video needing more than 30 minutes never goes out on a schedule. A cut-off upload makes no video unless its final chunk was sent.
- **`SETUP.md:237` and `:240`:** what `YOUTUBE_UPLOAD_UNCONFIRMED` means (check YouTube Studio first), and that only YouTube receives the AI declaration.
- **Stale numbers and statements, `CURRENT-STATE.md`:**
  - Tests at `:96`: 658 becomes 827 in the eight suites that need no database. The auth and db suites (89 more, last run 2026-10-02) are run only at quiet times.
  - LinkedIn at `:24-26`: scheduled text is now proven (`urn:li:share:7511734273188626432`, 2026-10-02 15:30:11 PKT). Scheduled image posts and document posts are marked built and unit-tested only, not proven live.
  - YouTube at `:29`: built and unit-tested only, with the review's fixes.
  - Worker row at `:102`: the 30-minute limit, and the task does not wake the PC.
  - Content and research list at `:111`; two new known gaps at `:132-139` (the worker limit, and Google client errors still marking channels for reconnection).
- **`FUTURE-PLANS.md`:**
  - Date updated at `:3`; the row 3 YouTube entry is now "prove it live" (`:25`).
  - New items at `:32-38`: prove the unproven paths, and resuming an interrupted upload, which needs a database change.
  - New section at `:93`: database tests need their own test database, because running them against the live database starved the live publisher's connection pool on 2026-10-02.
- **Finding #10, `LinkedIn-Content-System\PROJECT-CONTEXT.md` (not in git; rollback copy in the scratchpad as `LinkedIn-PROJECT-CONTEXT.before-2026-10-03.md`):**
  - It now records the 11 posts approved and queued on 2026-10-02 at 09:36–09:37, and the first published at 15:30:11 PKT.
  - The 10-02 PM image post was not approved and did not go out. The approval step only offers drafts dated today or later, so it will not come back.
  - The other six drafts and why each is waiting are listed. Drafting and scheduling now point to `LinkedIn-Content-Ops`.
  - The obsolete `schedule_post` and "build the daily job" next actions are gone.
  - It also notes three things I checked: the daily drafter is holding (7 drafts left, limit 6); the worker task does not wake the PC; and the campaign was paused on 2026-10-01, so the 10-09 "what PKR ~3,500 bought" post must follow the real spend.
- **10-07 PM title, `drafts\2026-10-07-pm.md:14`:** shortened to `Meta "code 10" errors: stop guessing, ask 3 questions` (53 characters). Only that line changed.

**Gate:** not run.
- I skipped the test step as told.
- I also skipped build and typecheck. The commit only changes three .md files, and `source/` is identical to `a7f123c`, whose gate passed with 827 tests.
- The apps agent's unfinished edits are now in this worktree (`apps/worker/package.json`, `worker.ts`, `credential.ts`, `test/`). A build here would test their unfinished work and could collide with their own builds.
- For the same reason I staged only my three docs instead of using `git add -A`. Their files are untouched and uncommitted.

**Left undone, or depends on the apps step:**
- **Two lines assume the apps step lands:** `SETUP.md:225` says a long upload renews its token (needs the apps to pass `renew`), and `CURRENT-STATE.md:29` says the review fixes are in. The 827 at `CURRENT-STATE.md:96` will need updating once the apps tests are added.
- **Still stale, but outside the files I was allowed to edit:**
  - `assets\2026-10-07-pm\spec.json` still has the old title, which affects only the PDF's metadata.
  - `LinkedIn-Content-Ops\PROJECT-CONTEXT.md:61-64` still says the title is 64 characters.
  - `CALENDAR.md:10-11` still says nothing is scheduled. The PROJECT-CONTEXT now says the drafts and posts log are the current record.
  - The carousel drafts still say "Posted by hand".
  - Social-Publisher `PROJECT-CONTEXT.md:202` still says about 6 uploads a day.
  - Social-Render `PROJECT-CONTEXT.md:163` still says document posting is being added separately.
  - `WAITING-LIST.md` #15 does not say the YouTube code is built.
  - The `PROJECT-LOG.md` verified-live table has no row for the first scheduled LinkedIn post.
  - `SETUP.md:233` says the app was "renamed from Mysmadspilot" to the same name; I could not find the original name.