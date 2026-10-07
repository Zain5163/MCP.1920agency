import { analyticsConfig } from '@social-publisher/config'
import { codeForFailure, type ErrorCode } from '@social-publisher/core'
import { createAnalytics, flushOnExit, type Analytics, type AnalyticsEvent } from '@social-publisher/telemetry'

/**
 * Product analytics for the worker: `publish_failed` when a scheduled target
 * fails (Phase 2). Kept out of worker.ts, which starts polling the moment it
 * is loaded, so the event's shape is tested on its own.
 */

/** The process's client: PostHog with POSTHOG_KEY, a silent no-op without. */
export function workerAnalytics(log: (message: string) => void): Analytics {
  const settings = analyticsConfig()
  const analytics = createAnalytics({
    apiKey: settings.posthogKey,
    host: settings.posthogHost,
    onError: (message) => log(`analytics: ${message}`),
  })
  // --once runs end by draining the event loop; signal and fatal exits call
  // shutdown() themselves.
  flushOnExit(analytics)
  return analytics
}

/**
 * The event for one failed attempt.
 *
 * Every failed attempt is sent, with `will_retry`, rather than only the last:
 * a platform that fails transiently and then succeeds is a reliability fact
 * worth counting, and filtering on will_retry=false gives the final failures.
 * Only the platform and the catalogue code: never the post, the account's
 * name or the platform's own message, which can quote the post.
 */
export function publishFailedEvent(input: {
  readonly tenantId: string
  readonly platform: string
  readonly error: { readonly failureClass: string; readonly code?: ErrorCode | undefined }
  readonly willRetry: boolean
}): AnalyticsEvent {
  return {
    event: 'publish_failed',
    tenantId: input.tenantId,
    properties: {
      platform: input.platform,
      resolution_code: codeForFailure(input.error),
      source: 'scheduled',
      will_retry: input.willRetry,
    },
  }
}

/** A target refused before publishing because its attachments were never stored. */
export function attachmentsRefusedEvent(input: { readonly tenantId: string; readonly platform: string; readonly code: string }): AnalyticsEvent {
  return {
    event: 'publish_failed',
    tenantId: input.tenantId,
    properties: { platform: input.platform, resolution_code: input.code, source: 'scheduled', will_retry: false },
  }
}
