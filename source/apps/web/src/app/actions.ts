'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { MediaRef, Platform, PostDraft } from '@social-publisher/core'
import { db } from '@social-publisher/db'

import { authenticate } from '@social-publisher/auth'

import { currentUser, endSession, startSession } from '@/lib/auth'
import { listConnections, mediaStore, publishService, scope, targetFor } from '@/lib/engine'

export interface ActionResult {
  readonly ok: boolean
  readonly message: string
  readonly details?: readonly string[]
}

export async function login(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  if (email === '' || password === '') {
    return { ok: false, message: 'Enter your email and password.' }
  }

  const user = await authenticate(email, password)
  if (user === null) {
    // One message for both a wrong email and a wrong password: naming which was
    // wrong tells an attacker which accounts exist.
    return { ok: false, message: 'Those details are not correct.' }
  }

  await startSession(user.id)
  redirect('/')
}

export async function logout(): Promise<void> {
  await endSession()
  redirect('/login')
}

/** Resolves the signed-in user's tenant, or sends them to sign in. */
async function requireSession(): Promise<string> {
  const user = await currentUser()
  if (user === null) redirect('/login')
  return user.tenantId
}

/**
 * Publish now, or schedule for later.
 *
 * Both paths share validation and media handling so a scheduled post cannot
 * behave differently from an immediate one.
 */
export async function createPost(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const tenantId = await requireSession()

  const body = String(formData.get('body') ?? '').trim()
  const platforms = formData.getAll('platforms').map(String) as Platform[]
  const scheduleAt = String(formData.get('scheduleAt') ?? '').trim()
  const files = formData.getAll('media').filter((f): f is File => f instanceof File && f.size > 0)

  if (platforms.length === 0) return { ok: false, message: 'Pick at least one account.' }
  if (body === '' && files.length === 0) return { ok: false, message: 'Add some text or an image.' }

  const scheduledFor = scheduleAt === '' ? undefined : new Date(scheduleAt)
  if (scheduledFor !== undefined) {
    if (Number.isNaN(scheduledFor.getTime())) return { ok: false, message: 'That date could not be read.' }
    if (scheduledFor.getTime() < Date.now()) return { ok: false, message: 'That time is in the past.' }
  }

  const connections = await listConnections(tenantId)
  const targets = connections.filter((c) => platforms.includes(c.platform) && !c.needsReauth)
  if (targets.length === 0) return { ok: false, message: 'None of those accounts are connected and ready.' }

  const service = publishService()

  /**
   * Upload when any target fetches media by URL, and always for scheduled posts —
   * the worker runs in another process and rebuilds the draft from the database,
   * so it cannot rely on anything held only in this request.
   */
  const needsHosting =
    scheduledFor !== undefined ||
    platforms.some((p) => service.adapterFor(p)?.capabilities.requiresPublicMediaUrl === true)

  const media: MediaRef[] = []
  const stored: Array<{ key: string; publicUrl: string; mime: string; bytes: number }> = []

  if (files.length > 0) {
    const store = mediaStore()
    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind: MediaRef['kind'] = file.type.startsWith('video/') ? 'video' : 'image'

      if (!needsHosting) {
        // Facebook-only immediate post: no need to host anything.
        media.push({ id: `m${index}`, kind, mime: file.type, bytes: bytes.length, localPath: undefined })
        continue
      }

      const uploaded = await store.upload(bytes, { mime: file.type, tenantId })
      if (!(await store.isPubliclyReachable(uploaded.publicUrl))) {
        return {
          ok: false,
          message: 'Uploaded media is not publicly reachable — check the storage bucket is public.',
        }
      }
      media.push({ id: `m${index}`, kind, mime: file.type, bytes: bytes.length, publicUrl: uploaded.publicUrl })
      stored.push({ key: uploaded.key, publicUrl: uploaded.publicUrl, mime: file.type, bytes: bytes.length })
    }
  }

  const draft: PostDraft = { body, media }

  const validation = service.validate(draft, platforms)
  if (!validation.ok) {
    const details = [...validation.byPlatform.entries()].flatMap(([platform, issues]) =>
      issues.filter((i) => i.severity === 'error').map((i) => `${platform}: ${i.message}`),
    )
    return { ok: false, message: 'Nothing was posted — fix these first:', details }
  }

  const tenant = scope(tenantId)

  // Proves every chosen connection belongs to this account. Throws rather than
  // silently publishing to the subset that happens to be ours.
  await tenant.requireConnections(targets.map((t) => t.id))

  const post = await tenant.createPost({ body, createdBy: 'web' })

  for (const [position, item] of stored.entries()) {
    const asset = await db().mediaAsset.create({
      data: {
        tenantId,
        r2Key: item.key,
        publicUrl: item.publicUrl,
        mime: item.mime,
        bytes: item.bytes,
      },
    })
    await db().postMedia.create({ data: { postId: post.id, mediaId: asset.id, position } })
  }

  if (scheduledFor !== undefined) {
    for (const connection of targets) {
      const target = await db().target.create({
        data: {
          tenantId,
          postId: post.id,
          connectionId: connection.id,
          state: 'scheduled',
          scheduledFor,
          idempotencyKey: `${post.id}:${connection.id}`,
        },
      })
      await db().job.create({ data: { tenantId, targetId: target.id, runAfter: scheduledFor } })
    }
    await tenant.record('web', 'post.scheduled', { postId: post.id, at: scheduledFor.toISOString() })
    revalidatePath('/')
    return {
      ok: true,
      message: `Scheduled for ${scheduledFor.toLocaleString()} across ${targets.length} account(s).`,
    }
  }

  const report = await service.publish(draft, targets.map(targetFor), {
    idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}`,
  })

  for (const outcome of [...report.succeeded, ...report.failed]) {
    await db().target.create({
      data: {
        tenantId,
        postId: post.id,
        connectionId: outcome.connectionId,
        state: outcome.ok ? 'published' : 'failed',
        idempotencyKey: `${post.id}:${outcome.connectionId}`,
        ...(outcome.ok
          ? {
              publishedAt: new Date(),
              platformPostId: outcome.result!.platformPostId,
              platformUrl: outcome.result!.url ?? null,
            }
          : {
              failureClass: outcome.error!.failureClass,
              platformMessage: outcome.error!.message,
              errorCode: outcome.error!.platformCode ?? null,
            }),
      },
    })
  }

  await tenant.record('web', 'post.published', {
    postId: post.id,
    succeeded: report.succeeded.length,
    failed: report.failed.length,
  })
  revalidatePath('/')

  const details = [
    ...report.succeeded.map((o) => `${o.displayName}: published`),
    ...report.failed.map((o) => `${o.displayName}: ${o.error!.message}`),
  ]

  return report.allSucceeded
    ? { ok: true, message: `Published to ${report.succeeded.length} account(s).`, details }
    : { ok: false, message: 'Some targets failed.', details }
}
