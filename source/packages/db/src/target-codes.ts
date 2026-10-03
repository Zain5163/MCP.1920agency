/**
 * Codes this system writes into `targets.error_code` itself.
 *
 * The column otherwise holds a platform's own error code, and nothing reads it
 * back. These codes say what the schema has no column for, without a
 * migration. Each is prefixed so no platform's code can be taken for one.
 */

/**
 * On a published target: its `platform_message` is a notice to show. The
 * platform took the post, but not as "published" implies: a video uploaded
 * private until the API audit passes, or a LinkedIn document whose processing
 * could not be confirmed.
 *
 * A message on a published target is not otherwise a notice. Before notices
 * existed, a retry that succeeded kept the error of the attempt before it, so
 * older published rows can still hold a stale error. Only a row written with
 * this code is shown as "uploaded" with its notice; the others stay as they
 * were shown before.
 */
export const NOTICE_CODE = 'adspilot:notice'

/** What a target row needs for `carriesNotice`. */
export interface TargetCodeFields {
  readonly state: string
  readonly errorCode: string | null
  readonly platformMessage: string | null
}

/** A published target that went out with a notice: show it as "uploaded", with the notice. */
export function carriesNotice(target: TargetCodeFields): boolean {
  return target.state === 'published' && target.errorCode === NOTICE_CODE && target.platformMessage !== null
}

/**
 * The columns a successful publish writes to its target.
 *
 * One definition for every recorder (worker, CLI, MCP, web), so a notice is
 * always stored with its code. The message is cleared when there is no
 * notice, so a stale error from an earlier attempt never outlives a success.
 */
export function publishedColumns(
  result: { readonly platformPostId: string; readonly url?: string | undefined; readonly notice?: string | undefined },
  now: Date = new Date(),
) {
  return {
    state: 'published' as const,
    publishedAt: now,
    platformPostId: result.platformPostId,
    platformUrl: result.url ?? null,
    platformMessage: result.notice ?? null,
    errorCode: result.notice !== undefined ? NOTICE_CODE : null,
  }
}
