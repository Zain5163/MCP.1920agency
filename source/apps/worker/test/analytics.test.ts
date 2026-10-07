import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { safeProperties } from '@social-publisher/telemetry'

import { attachmentsRefusedEvent, publishFailedEvent } from '../src/analytics.ts'

/**
 * publish_failed from the worker. worker.ts starts polling when it is loaded,
 * so the event is built in analytics.ts and its shape is checked here.
 */

const TENANT = 'cm1tenant000000000000'

describe('publish_failed from a scheduled target', () => {
  test('the adapter\'s catalogue code, the platform, and whether it will retry', () => {
    const event = publishFailedEvent({
      tenantId: TENANT,
      platform: 'linkedin',
      error: { failureClass: 'transient', code: 'QUOTA_EXHAUSTED' },
      willRetry: true,
    })
    assert.deepEqual(event, {
      event: 'publish_failed',
      tenantId: TENANT,
      properties: { platform: 'linkedin', resolution_code: 'QUOTA_EXHAUSTED', source: 'scheduled', will_retry: true },
    })
  })

  test('without an adapter code, the class decides, as the MCP reply does', () => {
    const event = publishFailedEvent({ tenantId: TENANT, platform: 'linkedin', error: { failureClass: 'credential' }, willRetry: false })
    assert.equal(event.properties!.resolution_code, 'TOKEN_EXPIRED')
    assert.equal(event.properties!.will_retry, false)
  })

  test('the attachments refusal carries its stored code', () => {
    const event = attachmentsRefusedEvent({ tenantId: TENANT, platform: 'youtube', code: 'adspilot:attachments_not_stored' })
    assert.equal(event.properties!.resolution_code, 'adspilot:attachments_not_stored')
  })

  test('every property it sets survives the allow-list', () => {
    // A name the allow-list does not know would be dropped silently on the way out.
    const event = publishFailedEvent({ tenantId: TENANT, platform: 'facebook_page', error: { failureClass: 'permanent' }, willRetry: false })
    assert.deepEqual(safeProperties(event.properties as Record<string, unknown>), event.properties)
  })
})
