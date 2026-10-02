# LinkedIn document posts (PDF carousels): API facts

**Date:** 2026-10-02
**Why:** before building D19 of `architecture/2026-10-02-youtube-build-spec.md`
(LinkedIn document posts), per `RULES.md` R7.
**Code:** `source/packages/adapters/src/linkedin.ts` (`#uploadDocument`,
`#awaitDocument`, `#documentTitle`), the LinkedIn record in
`source/packages/core/src/adapters/capabilities.ts`.

**Sources (Microsoft Learn, LinkedIn Marketing docs, default version 202609):**
- [Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api), ms.date 2026-06-19
- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), ms.date 2026-05-07
- [Post API schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema), ms.date 2026-02-13
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), ms.date 2026-06-19
- [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api), ms.date 2026-02-12
- [Versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning), ms.date 2026-09-16
- [Error responses](https://learn.microsoft.com/en-us/linkedin/marketing/error-responses), ms.date 2025-03-19
- [LinkedIn Help a493903, Document ads specifications](https://www.linkedin.com/help/lms/answer/a493903) (official, but for ads)

---

## VERIFIED from official documentation

### The upload

| Step | Detail |
|---|---|
| Register | `POST https://api.linkedin.com/rest/documents?action=initializeUpload`, body `{"initializeUploadRequest": {"owner": "urn:li:person:…" or "urn:li:organization:…"}}` |
| Reply | `{"value": {"uploadUrlExpiresAt": …, "uploadUrl": "https://www.linkedin.com/dms-uploads/…", "document": "urn:li:document:…"}}` |
| Bytes | One upload of the whole file to `uploadUrl`, shown as `curl --upload-file Mydoc.pdf -H 'Authorization: Bearer …'` (a PUT). Answer `201 Created`, empty body |
| Parts | None. No ETags and no finalize call, unlike video. `SYNCHRONOUS_UPLOAD` is not supported |
| Read back | `GET /rest/documents/{urn}` and a batch `GET /rest/documents?ids=List(…)`; `status` is `PROCESSING`, `AVAILABLE`, `PROCESSING_FAILED` ("file size too large, unsupported file format, internal error…") or `WAITING_UPLOAD` |
| Headers | Every call: `LinkedIn-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`. The upload sample sends only `Authorization` |
| Limits | "The file size can't exceed 100MB and 300 pages." Types: PPT, PPTX, DOC, DOCX and PDF |
| Permission | `w_member_social` for a member's own documents ("the caller must match the document owner"); `w_organization_social` for a page |

### The post

- `POST /rest/posts` with `"content": {"media": {"title": "Example.pdf", "id": "urn:li:document:…"}}`,
  the same body as an image or video post otherwise. `201` with the id in `x-restli-id`.
- The schema's `Media.title` is a String: "The media title (Required field for
  Documents API)". No length limit is given for it.
- `lifecycleState` `PUBLISH_REQUESTED`: "submitted for publishing but is not yet
  ready for rendering. The content will be published asynchronously once the
  processing has successfully completed."
- URNs in a URL must be encoded (`urn%3Ali%3A…`).

### Around it

- **Images API:** "`w_member_social` permission are write-only and tokens with
  only `w_member_social` permissions would be unable to perform a GET call for
  rest/images." The Documents API page says nothing either way for documents.
- **Videos API error table:** `400 MEDIA_ASSET_PROCESSING_FAILED` ("Media asset
  failed processing") and `400 MEDIA_ASSET_WAITING_UPLOAD` ("Media asset is
  waiting upload").
- **Errors** may carry a string `code` beside `message` and `serviceErrorCode`
  (the newer shape).
- **Versions** are supported at least a year. 202510 is sunset on 2026-10-15; the
  latest is 202609. The adapter's `202601` is still documented for these APIs and
  should be moved forward before January 2027.
- **Document ads (Help a493903):** headline "up to 70 characters to avoid
  shortening (200 character maximum)", "pre-filled with the file name"; PDFs with
  layers must be flattened and all pages must be one size.

## REPORTED (secondary sources, not confirmed)

- **58-character title** in LinkedIn's own composer for a document post
  ([SocialPilot help](https://help.socialpilot.co/article/864-how-to-publish-document-posts-on-linkedin-with-socialpilot-in-the-new-create-post-experience),
  also several 2026 guides). Password-protected files cannot be uploaded (same source).
- **Postiz** ([linkedin.provider.ts](https://github.com/gitroomhq/postiz-app/blob/main/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts),
  read 2026-10-02): uploads a PDF in one PUT with `Content-Type: application/pdf`;
  says every media must reach `AVAILABLE` before it is attached "otherwise
  LinkedIn rejects the post with a processing error"; says a personal token is
  write-only for images and documents, so it waits a grace period instead of
  polling; uses `title: carousel_name || 'slides'`.
- A [ServiceNow community article](https://www.servicenow.com/community/developer-articles/extending-a-scripted-linkedin-posts-api-with-the-documents-api/ta-p/3474481)
  posts straight after the upload with no status check.

## ASSUMED (reasoning, weakest)

- The Videos API's `MEDIA_ASSET_*` errors are what a document post gets too.
- LinkedIn accepts a post whose document is still processing and publishes it
  later, as the live video posts of 2026-09-26 suggest (created straight after
  upload, published fine). Postiz's claim above says otherwise; nobody here has
  seen either happen with a document.
- "100MB" means 100,000,000 bytes (the stricter reading).

## NOT checked

- Anything live. No document has been uploaded or posted.
- Whether `GET /rest/documents/{urn}` answers a member token or returns 403.
- The API's real title limit for an organic post.
- What URN a document post returns (`share` or `ugcPost`).
- Whether the Supabase `media` bucket accepts `application/pdf` (needed for a
  *scheduled* document post; an immediate one reads the file from disk).
- The 300-page limit: pages are not counted before upload.

## What the code does with this

- Opens the file first: refuses an empty file, one over 100,000,000 bytes by its
  real size, and a "PDF" without `%PDF-` in its first kilobyte, before anything
  is registered with LinkedIn.
- Registers, PUTs the whole file (`Authorization` and the file's own
  `content-type`), then reads the status: `AVAILABLE` posts; `PROCESSING_FAILED`
  stops with `MEDIA_PROCESSING_FAILED`, nothing posted; still processing after 20
  reads 3 s apart is transient `MEDIA_PROCESSING_TIMEOUT`, nothing posted. A status
  it cannot read (403 and the like) means one 15-second pause, then the post.
- Title: the draft's (LinkedIn override first), else the first line of the text
  shortened to 58 at a word, else the local file name, else "Document". Over 58
  is a warning, over 200 an error (`titleMaxLength`, from the ads maximum). Plain
  text, not escaped like `commentary`.
- A post refused with `MEDIA_ASSET_WAITING_UPLOAD` is transient; with
  `MEDIA_ASSET_PROCESSING_FAILED`, permanent with its own diagnosis.
