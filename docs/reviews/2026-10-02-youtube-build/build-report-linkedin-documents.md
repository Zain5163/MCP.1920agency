I've built LinkedIn document posts (PDF carousels) on top of the YouTube changes, and the approval script now schedules carousels. The gate passes: `pnpm -r build` exit 0, `pnpm -r typecheck` 13 of 13, `pnpm -r test` 859 of 859 on the rerun. The first test run failed only the known flaky auth test "records last use without failing the request", and pnpm stopped there before running mcp. One full rerun was green. Nothing was uploaded, posted, scheduled or signed in, no LinkedIn API was called, no migration was made, `CORE_KEYS` is unchanged, the `.env` was not read and nothing was committed. All of it is unit-tested against mocks only.

## LinkedIn Documents API, checked against official docs
Sources:
- Microsoft Learn: [Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api) (2026-06-19), [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) (2026-05-07), [Post schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema), [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api), [Versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning), [Error responses](https://learn.microsoft.com/en-us/linkedin/marketing/error-responses).
- LinkedIn Help [a493903](https://www.linkedin.com/help/lms/answer/a493903) (document ads).
- Secondary: SocialPilot's help page, Postiz `linkedin.provider.ts`, a ServiceNow article. All recorded in `research\2026-10-02-linkedin-documents.md`.

What the docs say:
- **Register:** `POST /rest/documents?action=initializeUpload` with `{initializeUploadRequest:{owner}}`. It returns `value.uploadUrl` and `value.document` (`urn:li:document:…`).
- **Upload:** one PUT of the whole file to `uploadUrl`, with the Bearer token, answered 201. There are no parts and no finalize call.
- **Status:** `GET /rest/documents/{urn}` returns PROCESSING, AVAILABLE, PROCESSING_FAILED or WAITING_UPLOAD.
- **Post:** `content.media {id, title}`. The title is "Required field for Documents API".
- **Limits:** 100 MB and 300 pages; PDF, PPT, PPTX, DOC or DOCX.
- **Headers and version:** `LinkedIn-Version` and `X-Restli-Protocol-Version` on every call. The adapter's `202601` is still supported; versions last at least a year, so it needs moving forward before about January 2027.
- **Member tokens:** the docs say a `w_member_social` token is write-only for `GET /rest/images`. They don't say whether that applies to documents.

## Files created
- `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\src\domain\media.ts`: `mediaKindForMime`.
- `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\adapters\test\documents.test.ts` (6 tests).
- `D:\My AI Works\AI-Automation\Social-Publisher\research\2026-10-02-linkedin-documents.md`
- `D:\My AI Works\AI-Automation\LinkedIn-Content-Ops\archive\Approve-LinkedInPosts.2026-10-02-before-document-support.ps1`: rollback copy, byte-identical to the script before my edits.

## Files changed
Under `D:\My AI Works\AI-Automation\Social-Publisher\source\`:
- **`packages\core\src\domain\types.ts`:** `MediaKind` gains `'document'`.
- **`packages\core\src\adapters\adapter.ts`:** new `maxDocumentBytes` and `maxDocumentCount`.
- **`packages\core\src\adapters\capabilities.ts`, LinkedIn only:** `titleMaxLength: 200`, `'document'` added to `mediaKinds`, `maxDocumentCount: 1`, `maxDocumentBytes: 100_000_000`, notes. Every other platform is unchanged.
- **`packages\core\src\domain\validate.ts`:** `mixed_media` now covers any two kinds. It behaves exactly as before for images with video. Adds `too_many_documents` and `document_too_large`.
- **`packages\core\src\domain\resolutions.ts`:** the `MEDIA_PROCESSING_FAILED` and `MEDIA_PROCESSING_TIMEOUT` texts now cover documents.
- **`packages\core\src\index.ts`:** exports `media.ts`.
- **`packages\core\test\validate.test.ts`:** +14 tests.
- **`packages\adapters\src\linkedin.ts`:**
  - Document upload, processing wait and title.
  - The error helper `#send` now treats `MEDIA_ASSET_WAITING_UPLOAD` as worth retrying, and `MEDIA_ASSET_PROCESSING_FAILED` as permanent with the `MEDIA_PROCESSING_FAILED` diagnosis.
  - New options: `sleep`, `documentStatusChecks`, `documentPollIntervalMs`, `documentUnreadableWaitMs`.
- **`packages\adapters\test\linkedin.test.ts`:** +29 tests; the mock gains a `raw` reply.
- **`apps\worker\src\worker.ts`:** the media kind now comes from `mediaKindForMime`, so `application/pdf` becomes a document.
- **`apps\cli\src\post.ts`:**
  - Adds `--document <pdf>`, `--title-file <path>` and `.pdf`.
  - Refuses a file passed under the wrong flag.
  - Passes the mime type to the bucket upload, whose own table has no `.pdf`.

Docs:
- `D:\My AI Works\AI-Automation\Social-Publisher\CURRENT-STATE.md`: one row.
- `D:\My AI Works\AI-Automation\Social-Publisher\SETUP.md`: a §4 note that the bucket must accept PDFs.
- `D:\My AI Works\AI-Automation\Social-Publisher\research\README.md`: one index row.

Approval script and contexts:
- `D:\My AI Works\AI-Automation\LinkedIn-Content-Ops\Approve-LinkedInPosts.ps1`
  - A `format: document*` draft with an existing `.pdf` becomes kind `document` and is sent with `--document` and `--title-file`.
  - The review screen shows the PDF, its size, the title and its length, with a yellow warning over 58 characters.
  - `o` opens the PDF before answering.
  - The CLI call moved into an `Invoke-PostCli` function so it could be tested. Its behaviour is unchanged.
  - The file is still ASCII-only.
- `D:\My AI Works\AI-Automation\LinkedIn-Content-Ops\PROJECT-CONTEXT.md`
- `D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\PROJECT-CONTEXT.md`: two lines that said carousels are posted by hand.

## Decisions where the spec was silent
1. **`--title-file` instead of `--title` in the approval script.** I tested this in Windows PowerShell 5.1: it splits an argument containing double quotes. The 10-07 title `Meta "code 10" permission errors: …` reached node as `Meta code` plus a stray argument, which the CLI refuses. Escaping can't fix every case, so the title goes through a temp file, the same way the post text already does. `--title` still works for direct CLI use.
2. **Title limits.**
   - **Hard limit:** 200 characters, LinkedIn's stated maximum for a document ad headline.
   - **Warning:** over 58, the reported limit in LinkedIn's own composer.
   - **10-07:** its title is 64 characters, so it gets a warning but is not refused.
3. **Title when none is given.**
   - The order is the LinkedIn override, then the draft title, then the first line of the text cut to 58 at a word with "…", then the local file name, then "Document".
   - Validation warns whichever is used.
   - Files hosted in the bucket are named by hash, so that name is never used.
4. **Processing wait.**
   - The status is read up to 20 times, 3 s apart.
   - AVAILABLE goes on to the post.
   - PROCESSING_FAILED stops with nothing posted.
   - Still processing at the end is a retryable failure, so the worker re-uploads later.
   - If the status can't be read (a member token is expected to get 403), there is one 15 s pause, then the post. That is the owner's profile path.
   - There is no notice on the result, matching how images and video already behave.
5. **Checks before anything goes to LinkedIn:** an empty file, a real size over 100,000,000 bytes, or a "PDF" without `%PDF-` in its first kilobyte is refused.
6. **One read, no parts.** The whole file (at most 100 MB) is read into memory once, because LinkedIn wants a single PUT. As with images and video, the token is sent to whatever upload URL LinkedIn returns, with no host check.
7. **Generic capability fields:** `maxDocumentCount` and `maxDocumentBytes` are data, not LinkedIn branches. `mediaKindForMime` also treats the Word and PowerPoint types as documents; anything unrecognised is still an image.
8. **Formats.** The adapter accepts all five types LinkedIn documents, but the CLI and the approval script take only `.pdf`.
9. **Wrong-flag check.** The CLI now refuses a file under the wrong flag. That also refuses `--image x.mp4`, which used to be accepted and mislabelled.
10. **No title on other LinkedIn posts.** Image and video posts still send no title, although the Posts API would accept one on video.

## Not done
- MCP still accepts only `image` or `video` media, so documents can't be posted through it. The web composer can't attach documents either.
- The 300-page limit is not checked.
- These still say documents are posted by hand: the draft writer's prompt (`Run-LinkedInDrafts.ps1`), `STRATEGY.md`, `AUTOMATION-SPEC.md`, and the drafts' `assets_needed:` text.
- `PROJECT-LOG.md` is not updated.

## Unverified
- Nothing has been run against LinkedIn.
- Whether a member token can read the document status, or gets 403.
- Whether LinkedIn accepts a post whose document is still processing. Postiz says it is rejected; the live video posts of 2026-09-26 suggest it is accepted.
- The real title limit for an ordinary (non-ad) post.
- Whether document posts get the `MEDIA_ASSET_*` errors, which are documented only for video.
- Which URN a document post returns.
- Whether the Supabase bucket accepts `application/pdf`. A scheduled document needs it.
- The interactive y/o flow, and a real scheduling run through the CLI. Only the CLI's refusal paths were run, because they exit before any database access.

## Verification beyond the unit tests
- **Approval-script harness:** 82 of 82 checks passed in Windows PowerShell 5.1. It loaded only the script's functions from its parsed form.
  - 15 of the 18 drafts plan exactly as before.
  - The 3 carousels move from "by hand" to document, with the right PDF, title and unchanged post text (683, 959 and 1013 characters).
  - `Invoke-PostCli`, run against a stand-in `src/post.ts` that only echoes, delivered the exact arguments, text and title (quotes included, checked by SHA-256). Exit codes came back, a stderr line did not end the run, and the temp files were removed.
  - No draft, `POSTS-LOG.md` or log file changed.
- **Real PDFs, offline:** all 3 carousels went through the real adapter with a mocked fetch: 1,672,687, 1,795,973 and 1,620,286 bytes, each sent whole in one PUT with the right title.

## Test counts
| Suite | Before | After |
|---|---|---|
| core | 165 | 179 |
| adapters | 413 | 448 |
| vault | 40 | 40 |
| publisher | 18 | 18 |
| db | 40 | 40 |
| auth | 49 | 49 |
| config | 21 | 21 |
| telemetry | 22 | 22 |
| media | 18 | 18 |
| mcp | 24 | 24 |
| **Total** | **810** | **859** |

The db and auth suites run against the live Supabase database, as they already did; I added no database tests.

The scratch harness, its outputs and the pre-change snapshot are in `C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\` (folders `d19-ps\` and `d19-before\`, plus `d19-real-pdfs.ts`).