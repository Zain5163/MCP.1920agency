All three package-side fixes in my scope are done and committed on `review-fixes`, and the final gate passes. Nothing under `D:\My AI Works\AI-Automation\Social-Publisher` was touched, and nothing called Google or YouTube: every test runs against a scripted Google.

The worktree had no earlier commits from this workflow, only the untracked findings file. I committed that file on its own first (`243bb4f`).

**Gate:** exit 0 every time. The baseline before my changes was 770 tests; it is now 799, all passing:

| Package | Before | After |
|---|---|---|
| core | 179 | 181 |
| adapters | 448 | 473 |
| publisher | 18 | 20 |
| config, vault, media, telemetry, mcp | 21, 40, 18, 22, 24 | unchanged |

I did not touch `packages/db` or `packages/auth`, so the db suite does not need a run for this work. The apps typecheck unchanged against the new contract.

Each set of new tests was also run against the code before its fix: 8, 11 and 5 of them fail there, as they should.

## Finding #0: lost reply after the last chunk (`085c5fe`)
- **Fix:** `adapters/src/youtube.ts:590` (`finalSent`). It is set when a request carrying the last byte goes out. Only a 308 showing the session still lacks bytes clears it. While it is set, every way out except the video itself throws the permanent `YOUTUBE_UPLOAD_UNCONFIRMED` (`unconfirmed()` at :1112), which tells the owner to check YouTube Studio before publishing again.
- **Long Retry-After:** after the last chunk, the adapter waits 60 s and asks the session for its status once (:714). Before the last chunk, no video can exist, so it still gives up as transient and hands the wait to the worker.
- **Cancel:** a cancel while the last chunk is in flight is also unconfirmed (:790). A 201 reply with no video id now carries the same code.
- **Catalogue:** `resolutions.ts:367`, not retryable, needs a person.
- **One judgement call:** I followed the agreed rule literally. Even a 404 or 401 in reply to the last chunk itself counts as "unconfirmed". So three old tests whose only chunk was also the last moved to two-chunk files, and "session that keeps giving back ground" now expects unconfirmed.
- **Tests:** a stateful fake channel plus a worker-style retry loop show exactly one video where there used to be two.

## Findings #1, #2, #8: token renewal during an upload (`6042e55`)
- **Contract:**
  - `core/src/domain/types.ts:159`: `PublishContext.renewAccessToken?: () => Promise<string>`.
  - `publisher/src/publish-service.ts:35`: `withCredential: <T>(fn: (accessToken: string, renew?: () => Promise<string>) => Promise<T>) => Promise<T>`. Line 184 passes `renew` on as `renewAccessToken`, and leaves the key out entirely when no `renew` is given.
- **Adapter:** each publish gets its own `PublishToken` (:1007).
  - On a mid-upload 401 it renews (a transient renewal failure is retried with backoff, :736), then asks the same session for its status and carries on from there.
  - A 401 straight after renewing is a credential failure with `GOOGLE_TOKEN_REVOKED`.
  - It also renews ahead of time once a token has been in use for 45 minutes (:118, :1048). This is best effort and tried once per token. The clock counts from when the publish received the token, because the adapter isn't told the real expiry; a nearly spent token is caught by the 401 path instead.
  - A failed renewal keeps its class and code (`renewalFailed`, :1069).
- **Without a way to renew:** the mid-upload 401 now gets its own code, `YOUTUBE_UPLOAD_TOKEN_EXPIRED` (permanent, `resolutions.ts:383`), and the message no longer promises that a retry will work.
- **Tests:** in a model where tokens last an hour, an 80-minute upload finishes in one session. A token with only 10 minutes left is renewed when refused. A failed early renewal is harmless. A publisher test builds `renew` exactly the way the apps must.

## Lower finding: Google's token endpoint (`4231c5f`)
- **Unreadable replies:** in `google-provider.ts`, `readBody()` (:489, used at :357 and :402) turns a reply that breaks off mid-body into a transient error. This covers token renewal, user info and channel discovery.
- **Classification:** in `google-errors.ts:177`, 429 and 5xx are transient whatever the body says, and a reply with no OAuth error in it (an empty body, a proxy's HTML page) is transient too. Network failures were already transient.

## What the apps step must do
This applies to `cli/src/post.ts:384`, `worker/src/worker.ts:189`, `mcp/src/context.ts:112` and `web/src/lib/engine.ts:168`. `page-tools.ts` needs no change.
```ts
const refresh = adapter?.refreshCredential?.bind(adapter)
withCredential: async <T,>(fn: (token: string, renew?: () => Promise<string>) => Promise<T>): Promise<T> =>
  await vault.withCredential(connection.id, connection.tenantId, async (cred) => {
    let current = cred
    const renew = refresh === undefined || cred.refreshToken === undefined ? undefined
      : async (): Promise<string> => {
          current = { ...current, ...(await refresh(current)) }   // merge, as the vault does
          try { await vault.store(connection.id, connection.tenantId, current) } catch (e) { /* log only */ }
          return current.accessToken
        }
    return await fn(cred.accessToken, renew)
  }, refresh),
```
- **Merge from `cred`:** that keeps the refresh token and `authorisationExpiresAt: null`, so the expiry column isn't overwritten with the one-hour expiry.
- **Pass `current`, not `cred`, to `refresh`,** so a second renewal uses the latest credential.
- **Let refresh errors through unchanged:** the adapter classifies them itself.
- **Don't let a failed `vault.store` reject `renew`:** the token is already valid, and a rejection would stop the upload.
- **Don't mark the connection `needs_reauth` inside `renew`.**
- **No other app change is needed:** the two new codes already have catalogue entries for MCP to show.

## Not done
- `invalid_client`, `unauthorized_client` and `deleted_client` errors still make the vault mark a channel dead (lower finding 2b). The agreed fixes didn't cover it.
- Polling for status longer after the last chunk, and saving the session address so a retry can resume the old upload. Both were optional suggestions, and saving the address would need a database change.
- The SETUP.md and worker-limit notes belong to the docs and apps steps.
- Whether YouTube really refuses an expired token on a chunk upload is still unverified against the live API. This code assumes it does, as the original did.