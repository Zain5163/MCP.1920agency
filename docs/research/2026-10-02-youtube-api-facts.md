# YouTube Data API v3 and Google OAuth 2.0 for web-server apps: verified research report

I checked every page below on 2026-10-02. The YouTube pages were last updated between 2026-09-14 and 09-16. The YouTube revision history was last updated 2026-09-30, and the YouTube discovery document is revision 20261001. On the OAuth side, the web-server guide is from 2026-09-14, the OAuth overview and granular-permissions pages from 2026-05-26, the OpenID Connect guide from 2026-06-15, and the sensitive-scope page from 2026-08-19. Anything without an official source is marked UNVERIFIED. "DOC NOTE" marks a problem in Google's own docs. No project files were changed.

---

## A1. videos.insert: resumable upload protocol

**Starting the session**
- First request: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=PARTS`. The `part` value must be URL-encoded (e.g. `part=snippet,status,contentDetails`). It names the parts being set and the parts the response will return. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Optional query parameters:
  - `notifySubscribers` (default True).
  - `onBehalfOfContentOwner` and `onBehalfOfContentOwnerChannel` (content partners only).
  — https://developers.google.com/youtube/v3/docs/videos/insert
- Headers on the first request:
  - `Authorization: Bearer AUTH_TOKEN`
  - `Content-Length`: size of the metadata body in bytes. Not needed with chunked transfer encoding.
  - `Content-Type: application/json; charset=UTF-8`
  - `X-Upload-Content-Length`: total size of the video file in bytes.
  - `X-Upload-Content-Type`: `video/*` or `application/octet-stream`.
  — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Body of the first request: a JSON video resource (snippet, status, …). — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Response to the first request: `200 OK` with a `Location` header holding the session URI, e.g. `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xa298sd_f&part=snippet,status,contentDetails`, and `Content-Length: 0`. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

**Sending the file**
- Send the bytes with `PUT SESSION_URI`. Headers:
  - `Authorization`
  - `Content-Length`: the file size. It should equal `X-Upload-Content-Length`.
  - `Content-Type`: the same value as `X-Upload-Content-Type`.
  — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Success is `201 Created`, and the body is the new video resource. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Recommendation, not from the docs: treat both 200 and 201 as success. Whether YouTube ever returns 200 here is UNVERIFIED.
- An optional `Slug` header carries the file name. An invalid one returns 400 `invalidFilename`. — https://developers.google.com/youtube/v3/docs/videos/insert

**When an upload can be resumed, and when it can't**
- Resume after a lost connection (no response), or after a 500, 502, 503 or 504. Use exponential backoff. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Permanent failure is any 4xx, or a 5xx other than those four. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- A request on an expired session URI returns `404 Not Found`. You must then start a new resumable upload from byte 0. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- A session URI has "a finite lifetime and eventually expires". The exact lifetime is UNVERIFIED (not stated). Google advises starting the upload right away and resuming soon after any interruption. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

**Checking status and resuming**
- To check status, send an empty `PUT SESSION_URI` with `Content-Length: 0` and `Content-Range: bytes */TOTAL_SIZE`. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- If the upload already finished (success or failure), the API repeats the response it gave at that time. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- If it is incomplete, the API returns `308 Resume Incomplete` with a `Range` header:
  - `Range: bytes=0-999999` means the first 1,000,000 bytes arrived (counting from 0).
  - There is no `Range` header if nothing has arrived yet.
  — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- If the response has a `Retry-After` header, use it to decide when to resume. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- To resume, send a `PUT` with:
  - `Content-Length`: the number of bytes still to send.
  - `Content-Range: bytes FIRST-LAST/TOTAL`, where FIRST is the last byte in `Range` plus 1.
  - If the block overlaps, skips bytes or is not continuous, none of the remaining bytes are uploaded.
  — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

**Chunked uploads**
- Google calls chunking "rarely necessary and … actually discouraged".
- Every chunk must be a multiple of 256 KB (262,144 bytes), except the last one.
- All chunks must be the same size, except the last one.
- Example header: `Content-Range: bytes 0-524287/2000000`.
— https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Each chunk except the last returns 308 with `Range`; start the next chunk at the upper bound plus 1. The last chunk returns 201. Never assume the server got all or none of the previous chunk; check status. You can check status between chunks. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

**Limits**
- API limits: maximum file size 256GB; accepted types `video/*` and `application/octet-stream`. — https://developers.google.com/youtube/v3/docs/videos/insert
- The discovery document also lists the path `/resumable/upload/youtube/v3/videos` and `maxSize` 274877906944. — https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
- YouTube's own limit is 256 GB or 12 hours, whichever is less. Videos over 15 minutes need a verified account. — https://support.google.com/youtube/answer/71673
- A channel's `status.longUploadsStatus` is `allowed`, `disallowed` or `eligible`. "Eligible" means phone verification is still needed. — https://developers.google.com/youtube/v3/docs/channels

**Errors in Google's upload guide**
- DOC NOTE: the chunk example shows `Content-Length: 524888` next to `Content-Range: bytes 0-524287`, which is 524,288 bytes. This is a typo; send 524288. — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- DOC NOTE: the example metadata uses Python-style `True` and a numeric `"categoryId": 22`. Send JSON `true`, and send categoryId as a string, `"22"` (the property type is string). — https://developers.google.com/youtube/v3/docs/videos

## A2. Snippet fields and limits

- `snippet.title`: at most 100 characters. Any valid UTF-8 is allowed except `<` and `>`. — https://developers.google.com/youtube/v3/docs/videos
- An empty or invalid title returns 400 `invalidTitle` ("invalid or empty video title"). — https://developers.google.com/youtube/v3/docs/videos/insert
- `snippet.description`: at most **5000 bytes**, no `<` or `>`. The limit is in bytes, so non-Latin scripts fit fewer characters. That last point is my inference. — https://developers.google.com/youtube/v3/docs/videos
- Clickable links in a description need channel verification or Advanced Features. Timestamps such as `00:00` create chapters. — https://developers.google.com/youtube/v3/docs/videos
- `snippet.tags[]`: 500 characters in total. The commas between tags count. A tag containing a space counts as if it were in quotation marks, so `Foo-Baz` is 7 characters and `Foo Baz` is 9. — https://developers.google.com/youtube/v3/docs/videos
- A limit per individual tag is not documented: UNVERIFIED.
- `snippet.categoryId` is a string. It is mandatory only on videos.update when updating snippet; there, missing title or categoryId returns 400 `invalidVideoMetadata`. — https://developers.google.com/youtube/v3/docs/videos, https://developers.google.com/youtube/v3/docs/errors
- An invalid category returns 400 `invalidCategoryId`. Get valid values from videoCategories.list. — https://developers.google.com/youtube/v3/docs/videos/insert
- videoCategories.list: `part=snippet` plus either `regionCode` or `id`; `hl` defaults to en_US; costs 1 unit. — https://developers.google.com/youtube/v3/docs/videoCategories/list
- Only use categories with `snippet.assignable` set to true. — https://developers.google.com/youtube/v3/docs/videoCategories
- The API's default category when categoryId is omitted: UNVERIFIED (not documented).
- Google's sample upload script defaults to `22`, "which refers to the People & Blogs category". — https://developers.google.com/youtube/v3/guides/uploading_a_video
- `27` = Education and `28` = Science & Technology: UNVERIFIED on any official page. They match third-party lists. Confirm at runtime with `videoCategories.list?part=snippet&regionCode=US`.
- `snippet.defaultLanguage` is the language of the title and description. Localization keys are BCP-47 language codes. — https://developers.google.com/youtube/v3/docs/videos
- Adding localizations without a defaultLanguage returns 400 `defaultLanguageNotSet`. — https://developers.google.com/youtube/v3/docs/videos/insert
- Fields you can set on insert:
  - snippet: title, description, tags[], categoryId, defaultLanguage
  - localizations
  - status: embeddable, license, privacyStatus, publicStatsViewable, publishAt, selfDeclaredMadeForKids, containsSyntheticMedia
  - recordingDetails.recordingDate

  `defaultAudioLanguage` is not on this list. — https://developers.google.com/youtube/v3/docs/videos/insert

## A3. Status fields

**Privacy and scheduling**
- `status.privacyStatus` is `private`, `public` or `unlisted`. — https://developers.google.com/youtube/v3/docs/videos
- The API default when privacyStatus is omitted: UNVERIFIED. The sample script's notes say "The default behavior is for an uploaded video to be publicly visible (public)". Always set it. — https://developers.google.com/youtube/v3/guides/uploading_a_video
- `status.publishAt`:
  - ISO 8601 format (date-time in the discovery document).
  - Only allowed while privacy is `private` and the video has never been published.
  - On videos.update you must also send `privacyStatus=private`.
  - A time in the past publishes the video immediately.
  — https://developers.google.com/youtube/v3/docs/videos
- An invalid scheduled time returns 400 `invalidPublishAt`. — https://developers.google.com/youtube/v3/docs/videos/insert
- Whether publishAt can make a video public when the project has not been audited: UNVERIFIED. Expect not, because those uploads are locked private (see A4).

**Made for kids**
- `status.selfDeclaredMadeForKids` is a boolean, set on insert or update. It is returned only when the channel owner authorised the request. `status.madeForKids` is the status that actually applies. — https://developers.google.com/youtube/v3/docs/videos
- These fields were added on January 10, 2020. — https://developers.google.com/youtube/v3/revision_history
- Is it required? The API reference does not mark it as required.
- YouTube policy: "you are required to set future and existing videos as made for kids or not." A channel-level setting applies to existing and future videos, and a per-video setting overrides it. — https://support.google.com/youtube/answer/9527654
- What happens when an API upload omits it: UNVERIFIED (not documented). Presumably the channel default applies. Always send `false` for general-audience content.
- DOC NOTE: the audience help page still says the tool will reach the API "in the near future". This is out of date; the API has had the field since 2020. — https://support.google.com/youtube/answer/9527654

**Altered or synthetic content**
- The exact field name is `status.containsSyntheticMedia` (boolean). It is set on insert or update and declares "realistic Altered or Synthetic (A/S) content". — https://developers.google.com/youtube/v3/docs/videos
- It was added on October 30, 2024, and is returned in the video resource when set. — https://developers.google.com/youtube/v3/revision_history
- Disclosure is required for content that:
  - makes a real person appear to say or do something they didn't,
  - alters footage of a real event or place, or
  - generates a realistic scene that didn't occur.
  — https://support.google.com/youtube/answer/14328491
- No disclosure needed for:
  - content that isn't realistic
  - minor edits (beauty or colour filters)
  - AI help with script, thumbnail, title or infographic
  - captions
  - "Cloning one's own voice to create voice overs or dubs"
  - idea generation
  — https://support.google.com/youtube/answer/14328491
- Disclosure needed, for example, for:
  - "AI generated music"
  - AI-generated realistic footage of a real place
  - making it look as if someone gave advice they didn't give
  — https://support.google.com/youtube/answer/14328491
- YouTube may add an AI label itself (its own AI tools, C2PA metadata, its detection systems). Repeated failure to disclose can lead to labels, removal or YPP suspension. — https://support.google.com/youtube/answer/14328491

**Other status fields**
- `status.embeddable` (boolean), `status.publicStatsViewable` (boolean), and `status.license` (`youtube` or `creativeCommon`). — https://developers.google.com/youtube/v3/docs/videos
- Invalid values return 403 `forbiddenLicenseSetting` or 403 `forbiddenPrivacySetting`. — https://developers.google.com/youtube/v3/docs/videos/insert

## A4. Uploads from unaudited API projects are restricted to private

- Exact banner on videos.insert: "All videos uploaded via the videos.insert endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode. To lift this restriction, each API project must undergo an audit to verify compliance with the Terms of Service." — https://developers.google.com/youtube/v3/docs/videos/insert
- The revision history entry dated **July 28, 2020** has the same rule. It adds: "Creators who use an unverified API client to upload video will receive an email explaining that their video is locked as private, and that they can avoid the restriction by using an official or audited client." It also says projects created before 28 July 2020 are "not currently affected". — https://developers.google.com/youtube/v3/revision_history
- The audit is the YouTube API Services Audit and Quota Extension Form (https://support.google.com/youtube/contact/yt_api_form). This is separate from Google OAuth app verification. — https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- Can a locked video be changed later? The help page says: "For videos that have been locked as private due to upload via an unverified API service, you will not be able to appeal. You'll need to re-upload the video via a verified API service or via the YouTube app/site. The unverified API service can also apply for an API audit." — https://support.google.com/youtube/answer/7300965
- The same page: "Unlike user-selected private videos, you will not be able to change the video's state until after you have successfully submitted the video for re-review." — https://support.google.com/youtube/answer/7300965
- Whether passing the audit unlocks videos uploaded before it: UNVERIFIED. The help page points to re-uploading.
- How the API response shows the lock: UNVERIFIED. No lock flag is documented. My suggestion: after upload, call `videos.list?part=status` and compare `status.privacyStatus` with what you requested.

## A5. Quota

- Current cost on videos.insert: "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket." — https://developers.google.com/youtube/v3/docs/videos/insert
- Default allocation: "Projects that enable the YouTube Data API have a default quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints." — https://developers.google.com/youtube/v3/getting-started, https://developers.google.com/youtube/v3/determine_quota_cost
- Quotas reset at midnight Pacific Time. Every request costs at least 1 point, even an invalid one. — https://developers.google.com/youtube/v3/determine_quota_cost
- Unit costs:

| Method | Cost |
|---|---|
| videos.list | 1 |
| channels.list | 1 |
| videoCategories.list | 1 |
| thumbnails.set | 50 (the method page says "approximately 50") |
| videos.update | 50 |
| videos.delete | 50 |

  — https://developers.google.com/youtube/v3/determine_quota_cost, https://developers.google.com/youtube/v3/docs/thumbnails/set
- Revision history, **December 4, 2025** (verbatim): "The YouTube Data API documentation and Quota Calculator have been updated to reflect a change in the quota cost of a video upload from approximately 1600 units to approximately 100 units." — https://developers.google.com/youtube/v3/revision_history
- Revision history, **June 1, 2026** (verbatim):
  - "The YouTube Data API is transitioning to a granular quota system covering smaller sets of methods, starting with videos.insert and search.list."
  - "This update simplifies the path to quota increases by allowing YouTube to more easily verify and approve requests based on specific method usage. This transition is also a key part of our commitment to platform stability and security, ensuring that every developer can operate within a protected ecosystem while maintaining the access levels necessary for their approved use cases."
  - "API calls to the videos.insert and search.list methods will be charged to their own respective quota buckets. API calls to all other methods will be charged to the existing quota bucket. Developers can view quota limits in the Google Cloud Console, and they can request additional quota through the Quota Extension Form."
  — https://developers.google.com/youtube/v3/revision_history
- The separate upload bucket of 100 per day dates from June 1, 2026. December 4, 2025 was only the cost change from about 1600 to about 100 units. — https://developers.google.com/youtube/v3/revision_history
- Also from June 3, 2026: `videos.batchGetStats` costs 1 unit in its own bucket, with a default of 10,000 per day. — https://developers.google.com/youtube/v3/revision_history
- Going over quota returns 403 `quotaExceeded`. Quota above the default requires a compliance audit. — https://developers.google.com/youtube/v3/docs/errors, https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- DOC NOTE: the quota page's auto-generated "Page Summary" still says videos.insert costs 1600. That is stale; the table and body text say 100 calls per day at 1 unit each. — https://developers.google.com/youtube/v3/determine_quota_cost

## A6. thumbnails.set

- Request: `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=VIDEO_ID`. The body is the image bytes. — https://developers.google.com/youtube/v3/docs/thumbnails/set
- Maximum 50MB. Accepted types: `image/jpeg`, `image/png`, `application/octet-stream`. — https://developers.google.com/youtube/v3/docs/thumbnails/set
- The limit was raised from 2MB on September 14, 2026. — https://developers.google.com/youtube/v3/revision_history
- Accepted scopes: youtube.upload, youtube, youtube.force-ssl, youtubepartner. — https://developers.google.com/youtube/v3/docs/thumbnails/set
- Response: `youtube#thumbnailSetResponse` with `items[]`. — https://developers.google.com/youtube/v3/docs/thumbnails/set
- Errors:

| HTTP code | Reason | Meaning |
|---|---|---|
| 400 | `invalidImage` | invalid image content |
| 400 | `mediaBodyRequired` | no image in the request |
| 403 | `forbidden` | thumbnail can't be set, or the user isn't allowed custom thumbnails |
| 404 | `videoNotFound` | bad videoId |
| 429 | `uploadRateLimitExceeded` | too many thumbnails recently |

  — https://developers.google.com/youtube/v3/docs/thumbnails/set
- Account requirement: you can upload your own thumbnails "if your account is verified". — https://support.google.com/youtube/answer/72431
- On YouTube's Feature eligibility page, custom thumbnails are an Intermediate feature:
  - with phone verification: "Limited daily limit"
  - with channel history or ID verification: "Higher daily limit"
  — https://support.google.com/youtube/answer/9890437
- Verify at https://www.youtube.com/verify by SMS or voice call. — https://support.google.com/youtube/answer/71673
- Recommended image:

| | Videos | Shorts |
|---|---|---|
| Resolution | 3840x2160 | 2160x3840 |
| Minimum | width 640 | height 640 |
| Aspect ratio | 16:9 | 9:16 |

  Format JPG or PNG; up to 50MB on desktop and 2MB on mobile. — https://support.google.com/youtube/answer/72431
- On vertical videos, a 16:9 custom thumbnail is replaced by an auto-generated 4:5 one on the home, explore and subscription pages. — https://support.google.com/youtube/answer/72431
- Custom thumbnails for Shorts are "currently only available to add in YouTube Studio on a computer". Whether thumbnails.set works on Shorts: UNVERIFIED. — https://support.google.com/youtube/answer/72431
- Channels have a daily custom-thumbnail limit. The message "Daily custom thumbnail limit reached" means retry after 24 hours. — https://support.google.com/youtube/answer/72431

## A7. Shorts

- On standard channels, videos uploaded on or after October 15, 2024 that are square or vertical and up to three minutes long "will be categorized as Shorts". — https://support.google.com/youtube/answer/15424877
- The upload rule is "Up to 3 minutes. With a square or vertical aspect ratio." — https://support.google.com/youtube/answer/12779649
- "If your video is 3 minutes or less and has a square or vertical aspect ratio, it will be uploaded as a Short." — https://support.google.com/youtube/answer/57407
- To avoid being classed as a Short, use a wider ratio such as 16:9. — https://support.google.com/youtube/answer/15424877
- Nothing special is needed in the API. videos.insert has no Shorts-specific property, so classification is automatic. This is inferred from the list of settable fields. — https://developers.google.com/youtube/v3/docs/videos/insert
- Whether a `#Shorts` hashtag has any effect: UNVERIFIED. It is not part of the current criteria.
- Content ID: a Short longer than one minute with any active Content ID claim "will be blocked globally". It can't be played or recommended and earns nothing. — https://support.google.com/youtube/answer/15424877
- Music:
  - Most Shorts Audio Library songs can be used for up to 90 seconds in a 3-minute Short.
  - YouTube Audio Library royalty-free music "won't receive a Content ID claim".
  — https://support.google.com/youtube/answer/15424877
- Choosing a Shorts Audio Library track through the API: UNVERIFIED. No API field exists, so music has to be in the video file itself.

## A8. Checking processing after upload

- A new video shows in the owner's uploads at once, but is "not visible on YouTube until it has been processed". — https://developers.google.com/youtube/v3/guides/implementation/videos
- Poll with `videos.list?part=processingDetails` (or `snippet,processingDetails`, plus `status`) and `id=VIDEO_ID`. Each call costs 1 unit. — https://developers.google.com/youtube/v3/guides/implementation/videos, https://developers.google.com/youtube/v3/docs/videos/list
- `processingDetails.processingStatus`:
  - `failed`
  - `processing`
  - `succeeded`
  - `terminated` (processing information no longer available)
  — https://developers.google.com/youtube/v3/docs/videos
- `processingDetails.processingFailureReason`: `other`, `streamingFailed`, `transcodeFailed`, `uploadFailed`. — https://developers.google.com/youtube/v3/docs/videos
- `processingProgress` has `partsTotal`, `partsProcessed` and `timeLeftMs`. Percent done is 100 × partsProcessed / partsTotal, and can go down. — https://developers.google.com/youtube/v3/docs/videos
- `status.uploadStatus`: `deleted`, `failed`, `processed`, `rejected`, `uploaded`. — https://developers.google.com/youtube/v3/docs/videos
- `status.failureReason`, present only when the upload failed: `codec`, `conversion`, `emptyFile`, `invalidFile`, `tooSmall`, `uploadAborted`. — https://developers.google.com/youtube/v3/docs/videos
- `status.rejectionReason`, present only when rejected:
  - `claim`, `copyright`, `duplicate`, `inappropriate`, `legal`
  - `length`, `termsOfUse`, `trademark`
  - `uploaderAccountClosed`, `uploaderAccountSuspended`
  — https://developers.google.com/youtube/v3/docs/videos
- `processingDetails`, `fileDetails` and `suggestions` are visible only to the video's owner. Anyone else gets 403 `forbidden`. — https://developers.google.com/youtube/v3/docs/errors
- videos.list accepts youtube, youtube.force-ssl, youtube.readonly or youtubepartner. It does **not** accept youtube.upload. — https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest

## A9. Errors to handle

| HTTP code | Reason | Meaning | Source |
|---|---|---|---|
| 400 | `invalidTitle` | Title is invalid or empty | https://developers.google.com/youtube/v3/docs/videos/insert |
| 400 | `invalidDescription`, `invalidTags`, `invalidCategoryId`, `invalidPublishAt`, `invalidFilename`, `invalidRecordingDetails`, `invalidVideoGameRating`, `invalidVideoMetadata`, `defaultLanguageNotSet` | Field-specific validation failures | https://developers.google.com/youtube/v3/docs/videos/insert |
| 400 | `mediaBodyRequired` | No video content in the request | https://developers.google.com/youtube/v3/docs/videos/insert |
| 400 | `uploadLimitExceeded` | "The channel's daily video upload limit has been reached. This is a YouTube platform restriction and is entirely separate from your Google Cloud project's API quota." | https://developers.google.com/youtube/v3/docs/errors |
| 403 | `quotaExceeded` | "exceeded your quota" | https://developers.google.com/youtube/v3/docs/errors |
| 403 | `forbidden` (no description on insert), `forbiddenPrivacySetting`, `forbiddenLicenseSetting` | Permission or invalid setting | https://developers.google.com/youtube/v3/docs/videos/insert |
| 403 | `insufficientPermissions` | Token's scopes are insufficient | https://developers.google.com/youtube/v3/docs/errors |
| 403 | `authenticatedUserNotChannel` | Request must resolve to a channel but doesn't | https://developers.google.com/youtube/v3/docs/errors |
| 403 | `authenticatedUserAccountClosed` / `authenticatedUserAccountSuspended` | Account closed or suspended | https://developers.google.com/youtube/v3/docs/errors |
| 401 | `youtubeSignupRequired` | Google Account without a YouTube channel. Also returned when using a Service Account, which YouTube does not support. | https://developers.google.com/youtube/v3/docs/errors |
| 401 | `authorizationRequired` | `mine` used without proper auth | https://developers.google.com/youtube/v3/docs/errors |
| 401 | `authError` / `expired` | Invalid or expired credentials | https://developers.google.com/youtube/v3/docs/core_errors |
| 403 | `rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded` | Rate or daily limits | https://developers.google.com/youtube/v3/docs/core_errors |
| 429 | `rateLimitExceeded` | Rate limit | https://developers.google.com/youtube/v3/docs/core_errors |
| 429 | `uploadRateLimitExceeded` | thumbnails.set: too many thumbnails recently | https://developers.google.com/youtube/v3/docs/thumbnails/set |
| 500 | `internalError` | Internal error | https://developers.google.com/youtube/v3/docs/core_errors |
| 503 | `backendError` | Backend error | https://developers.google.com/youtube/v3/docs/core_errors |
| 308 / 404 | — | Resumable upload: incomplete / session expired | https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol |

- DOC NOTE: the videos.insert page describes `uploadLimitExceeded` differently ("The user has exceeded the number of videos they may upload."). — https://developers.google.com/youtube/v3/docs/videos/insert
- Uploading has a "Limited daily limit" without verification and a "Higher daily limit" with channel history or ID verification. — https://support.google.com/youtube/answer/9890437

## A10. channels.list with mine=true

- Request: `GET https://www.googleapis.com/youtube/v3/channels?part=id,snippet,contentDetails,status&mine=true`. Costs 1 unit. — https://developers.google.com/youtube/v3/docs/channels/list
- Specify exactly one filter (`id`, `mine`, `forHandle`, `forUsername`, `managedByMe`, …). Otherwise you get 400 `invalidCriteria`. — https://developers.google.com/youtube/v3/docs/channels/list
- Useful fields:
  - `id` is the channel ID.
  - `snippet.title` is the channel name.
  - `snippet.customUrl` is the channel's custom URL.
  - `snippet.thumbnails.default` (88x88), `.medium` (240x240) and `.high` (800x800) each have a `url`.
  - `contentDetails.relatedPlaylists.uploads` is the uploads playlist.
  — https://developers.google.com/youtube/v3/docs/channels
- Thumbnail images "might be empty for newly created channels and might take up to one day to populate". — https://developers.google.com/youtube/v3/docs/channels
- channels.list accepts youtube, youtube.force-ssl, youtube.readonly, youtubepartner or youtubepartner-channel-audit. It does **not** accept youtube.upload. — https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
- With no channel, Google documents 401 `youtubeSignupRequired`: "a Google Account but does not have a YouTube channel … the user would need a YouTube channel to be able to upload a video". — https://developers.google.com/youtube/v3/docs/errors
- What channels.list?mine=true itself returns for an account with no channel (empty `items` or an error): UNVERIFIED. Handle both an empty or missing `items` and 401 `youtubeSignupRequired`.

---

## B1. Authorization endpoint and parameters

- The endpoint is `https://accounts.google.com/o/oauth2/v2/auth`, HTTPS only. — https://developers.google.com/identity/protocols/oauth2/web-server
- Required parameters:
  - `client_id`
  - `redirect_uri`: must exactly match a registered URI, including scheme, case and trailing slash. Otherwise `redirect_uri_mismatch`.
  - `response_type=code`
  - `scope`: space-delimited.
  — https://developers.google.com/identity/protocols/oauth2/web-server
- `access_type` is `online` (the default) or `offline`. `offline` "instructs the Google authorization server to return a refresh token and an access token the first time that your application exchanges an authorization code for tokens." — https://developers.google.com/identity/protocols/oauth2/web-server
- `state` is recommended. It comes back unchanged and must be checked to prevent CSRF. — https://developers.google.com/identity/protocols/oauth2/web-server
- `include_granted_scopes=true` makes the new token also cover scopes the user granted earlier (incremental authorization). — https://developers.google.com/identity/protocols/oauth2/web-server
- `enable_granular_consent` defaults to true and only affects clients created before 2019. — https://developers.google.com/identity/protocols/oauth2/web-server
- `login_hint` takes an email or `sub`. — https://developers.google.com/identity/protocols/oauth2/web-server
- `prompt` is `none`, `consent` or `select_account`. If omitted, the user is "prompted only the first time your project requests access". — https://developers.google.com/identity/protocols/oauth2/web-server
- PKCE:
  - It is documented for installed apps: `code_challenge` and `code_challenge_method` (`S256` recommended, or `plain`), with a verifier of 43–128 characters.
  - The web-server guide's parameter table does not list it. Whether it applies to a confidential Web client is UNVERIFIED in the docs.
  — https://developers.google.com/identity/protocols/oauth2/native-app, https://developers.google.com/identity/protocols/oauth2/web-server
- DPoP is optional but recommended. A `DPoP` proof header at the token endpoint binds the refresh token to a key; access tokens stay Bearer. — https://developers.google.com/identity/protocols/oauth2/web-server
- YouTube scopes:

| Scope | Consent-screen text |
|---|---|
| `https://www.googleapis.com/auth/youtube` | "Manage your YouTube account" |
| `youtube.upload` | "Manage your YouTube videos" |
| `youtube.readonly` | "View your YouTube account" |
| `youtube.force-ssl` | "See, edit, and permanently delete your YouTube videos, ratings, comments and captions" |
| `yt-analytics.readonly` | "View YouTube Analytics reports for your YouTube content" |

  — https://developers.google.com/identity/protocols/oauth2/scopes
- Identity scopes are `openid`, `email` and `profile`. The equivalents are `userinfo.email` and `userinfo.profile`. — https://developers.google.com/identity/protocols/oauth2/scopes
- What each scope can call:
  - videos.insert and thumbnails.set accept youtube.upload.
  - videos.list and channels.list do not.
  - videos.update needs youtube, youtube.force-ssl or youtubepartner.
  — https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest, https://developers.google.com/youtube/v3/docs/videos/update

## B2. Token endpoint, refresh tokens and expiry

**Exchanging the code**
- Request: `POST https://oauth2.googleapis.com/token` (form-encoded) with `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`. — https://developers.google.com/identity/protocols/oauth2/web-server
- The web-server guide now labels `client_secret` "Optional". Web server apps are private clients that "can securely store the client secret", and a wrong secret returns `invalid_client`. Send it anyway. — https://developers.google.com/identity/protocols/oauth2/web-server, https://support.google.com/cloud/answer/15549257
- Response fields:
  - `access_token`
  - `expires_in`
  - `refresh_token`: only when `access_type=offline`.
  - `refresh_token_expires_in`: only for time-based access.
  - `scope`: granted scopes, space-delimited.
  - `token_type`: always Bearer.
  - `id_token`: when `openid` was requested.
  — https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/openid-connect/openid-connect

**When you get a refresh token**
- Refresh tokens "are valid until the user revokes access or the refresh token expires". — https://developers.google.com/identity/protocols/oauth2/web-server
- "you can only obtain a refresh token the first time that you perform the code exchange flow." — https://developers.google.com/identity/openid-connect/openid-connect
- The web-server guide says "The refresh_token is only returned on the first authorization". — https://developers.google.com/identity/protocols/oauth2/web-server
- To get a new one, "the user must revoke the existing grant or you must use the prompt=consent parameter". — https://developers.google.com/identity/protocols/oauth2/web-server
- `prompt=consent` shows the consent screen every time; "include prompt=consent only when necessary". — https://developers.google.com/identity/openid-connect/openid-connect

**Refreshing and revoking**
- Refresh request: `POST https://oauth2.googleapis.com/token` with `client_id`, `client_secret` ("Optional"), `grant_type=refresh_token`, `refresh_token`. The response has `access_token`, `expires_in`, `scope` and `token_type`. — https://developers.google.com/identity/protocols/oauth2/web-server
- Revoke with `POST https://oauth2.googleapis.com/revoke`. This "removes all OAuth 2.0 scopes previously granted to a project" across all its clients. — https://developers.google.com/identity/protocols/oauth2/web-server

**Causes of invalid_grant**
- At code exchange: the code is invalid or malformed; restart the flow. At refresh: the token "may have expired or has been invalidated"; re-authenticate. It can also mean the account was deleted or disabled. — https://developers.google.com/identity/protocols/oauth2/web-server
- A refresh token stops working when:
  - the user revoked access,
  - it went unused for six months,
  - the user changed password and the token has Gmail scopes,
  - the account exceeded the maximum number of live refresh tokens,
  - time-based access expired,
  - an admin restricted the service (`admin_policy_enforced`), or
  - a GCP session-control policy expired it (`error_subtype: invalid_rapt`).
  — https://developers.google.com/identity/protocols/oauth2

**Limits on refresh tokens**
- The 7-day rule (verbatim): "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of "Testing" is issued a refresh token expiring in 7 days, unless the only OAuth scopes requested are a subset of name, email address, and user profile". This applies to **any** non-basic scope, not only sensitive ones. — https://developers.google.com/identity/protocols/oauth2
- "Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an offline access type and receives a refresh token, that token will also expire." — https://support.google.com/cloud/answer/15549945
- The 100-token limit (verbatim): "There is currently a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID. If the limit is reached, creating a new refresh token automatically invalidates the oldest refresh token without warning." A larger limit also applies per user across all clients. — https://developers.google.com/identity/protocols/oauth2
- OAuth clients unused for six months are deleted automatically. Google emails 30 days beforehand, a deleted client can be restored within 30 days, and requests fail with `deleted_client`. — https://support.google.com/cloud/answer/15549257

## B3. Granular consent

- The granular consent screen (where users tick or untick permissions) appears when an app asks for two or more non-sign-in scopes, or sign-in scopes plus at least one other. It does not appear for sign-in scopes only, or for exactly one non-sign-in scope. — https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
- Users choose which permissions to grant. The app "must verify which scopes were actually granted" and turn off features whose scopes were denied. — https://developers.google.com/identity/protocols/oauth2/web-server
- The grant is shown in the `scope` field of the token response: "The scopes of access granted by the access_token expressed as a list of space-delimited, case-sensitive strings." — https://developers.google.com/identity/protocols/oauth2/web-server
- Returned scope strings can differ from the ones requested, because an API may map several strings to one. — https://developers.google.com/identity/protocols/oauth2
- Policy: ask again for a denied scope only after the user "clearly indicates an intent to use the feature", and request scopes in context. — https://developers.google.com/identity/protocols/oauth2/policies
- Workspace domain-wide delegation and admin-"Trusted" apps skip the granular screen; they get all scopes or none. — https://developers.google.com/identity/protocols/oauth2/web-server

## B4. Redirect URIs and localhost

- Redirect URIs must be HTTPS. "Localhost URIs (including localhost IP address URIs) are exempt from this rule." — https://developers.google.com/identity/protocols/oauth2/web-server, https://support.google.com/cloud/answer/15549257
- Raw IP addresses are not allowed as hosts; "Localhost IP addresses are exempted from this rule." — https://developers.google.com/identity/protocols/oauth2/web-server
- Other rules:
  - the TLD must be on the public suffix list,
  - no googleusercontent.com,
  - no URL shorteners unless you own them,
  - no userinfo, path traversal, open redirects, fragments or wildcards.
  — https://developers.google.com/identity/protocols/oauth2/web-server
- For a Web application client: "For testing, you can specify URIs that refer to the local machine, such as http://localhost:8080." — https://developers.google.com/identity/protocols/oauth2/web-server
- Production: "Google OAuth clients used in production must not contain test environments, redirect URIs, or JavaScript origins available to only you or your development team." Use separate Cloud projects for testing and production. — https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance, https://developers.google.com/identity/protocols/oauth2/policies
- "OAuth 2.0 clients for web apps must secure their data using HTTPS redirect URIs … Google can reject OAuth requests that don't originate from or resolve to a secure context." — https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- "Certain scopes might be unavailable because usage of these scopes is restricted to projects using HTTPS URLs only. To enable the scopes, edit your OAuth clients and remove non-HTTPS URLs." — https://support.google.com/cloud/answer/15549135
- Whether the Console actually blocks `http://localhost` on a Web client once the app is In production: UNVERIFIED.
- Loopback IP versus localhost (Desktop app clients):
  - Use `http://127.0.0.1:port` or `http://[::1]:port`.
  - "localhost in place of the loopback IP" works "but this configuration may cause issues with client firewalls".
  - The loopback option is deprecated for Android, Chrome app and iOS clients.
  — https://developers.google.com/identity/protocols/oauth2/native-app
- For Web clients, `localhost` and `127.0.0.1` are different strings. The one used must exactly match a registered URI. — https://developers.google.com/identity/protocols/oauth2/web-server
- Adding new redirect URIs or changing the product name after verification means verifying again. — https://support.google.com/cloud/answer/7454865

## B5. Sensitive vs restricted scopes, verification, and unverified use

**Scope classification**
- No YouTube Data API v3 or YouTube Analytics scope is on Google's restricted list. Only the data-portability scopes (`dataportability.youtube.*`, `dataportability.myactivity.youtube`) are restricted. — https://support.google.com/cloud/answer/13464325
- The Cloud Console shows each scope's classification. Google's docs give "deleting a YouTube video" as an example of a sensitive scope, which means youtube and youtube.force-ssl are sensitive. — https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- That youtube.upload, youtube.readonly and yt-analytics.readonly are "sensitive": UNVERIFIED in the doc text. Only the Console shows it, though it is widely reported.

**Verification for production**
- Production apps that use sensitive or restricted scopes "must submit your use of those scopes for verification". — https://developers.google.com/identity/protocols/oauth2/policies
- Requirements:
  - homepage on a verified domain,
  - privacy policy,
  - domain ownership proven in Search Console,
  - Google branding,
  - a justification for each scope,
  - a demo video on YouTube showing the full OAuth flow and the consent screen in English.
  — https://support.google.com/cloud/answer/13464321, https://support.google.com/cloud/answer/15549135
- Sensitive-scope verification "typically takes 3-5 business days". — https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- The YouTube API compliance audit is separate from OAuth verification. It is needed to lift the private-only restriction and to get more than the default quota. — https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

**Using an unverified app**
- In Testing status:
  - up to 100 listed test users,
  - a warning screen before consent,
  - authorizations expire after 7 days,
  - a Brand Account can authorize if a test user manages it.
  — https://support.google.com/cloud/answer/15549945
- In production but unverified:
  - an "unverified app" screen,
  - a lifetime cap of 100 new users once that screen has been shown.
  — https://support.google.com/cloud/answer/15549945, https://support.google.com/cloud/answer/7454865
- Personal-use apps (fewer than 100 users) don't have to be verified; users click through the "unverified app" warning. Dev and test projects aren't verified either, but still show the warning and the 100-user cap. — https://support.google.com/cloud/answer/13464323
- The warning also appears when the scopes in your code differ from those configured on the consent screen. — https://support.google.com/cloud/answer/7454865

---

## Design implications (my inferences, not documented facts)

- Minimum scopes: `openid email profile` + `youtube.upload` + `youtube.readonly`. youtube.readonly is needed for channels.list mine=true and for polling videos.list. Add `youtube.force-ssl` only if videos are edited after upload (videos.update), and `yt-analytics.readonly` only if analytics are needed.
- With four or more scopes requested, users can untick some. Check the granted `scope` string and handle partial grants.
- Until the YouTube API audit passes, upload as `private`. Public uploads would be locked private and need re-uploading. Plan for 100 uploads per day per project.
- Always send `selfDeclaredMadeForKids` and `containsSyntheticMedia` explicitly.
- Use `access_type=offline`, and use `prompt=consent` only on first connect or reconnect. Overuse burns through the 100-refresh-token limit.
- Keep localhost redirect URIs in a separate dev project. The production client should use HTTPS only.

Copies of every page I checked are in `C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\yt\` (`*.html` raw, `*.txt` text, `yt_discovery.json`).