import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'

import {
  FacebookPageAdapter,
  InstagramAdapter,
  ThreadsAdapter,
} from '@social-publisher/adapters'
import { mediaHostingReady, optional, required } from '@social-publisher/config'
import type { Connection, MediaRef, Platform, PostDraft } from '@social-publisher/core'
import { db, disconnect } from '@social-publisher/db'
import { MediaStore } from '@social-publisher/media'
import { PublishService } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'

/**
 * `post` — publish from the command line.
 *
 * Defaults to a dry run. Publishing is public and irreversible, so it takes an
 * explicit `--publish` flag rather than happening because someone pressed up-arrow
 * and enter.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      text: { type: 'string' },
      'text-file': { type: 'string' },
      image: { type: 'string', multiple: true },
      video: { type: 'string' },
      platform: { type: 'string', multiple: true },
      publish: { type: 'boolean', default: false },
      at: { type: 'string' },
    },
  })

  const scheduledFor = values.at !== undefined ? new Date(values.at) : undefined
  if (scheduledFor !== undefined && Number.isNaN(scheduledFor.getTime())) {
    console.error(`\n  Could not read --at "${values.at}". Use e.g. 2026-09-25T09:00 or an ISO timestamp.\n`)
    process.exit(1)
  }

  const body =
    values['text-file'] !== undefined
      ? readFileSync(values['text-file'], 'utf8').trimEnd()
      : (values.text ?? '')

  if (body.trim() === '' && values.image === undefined && values.video === undefined) {
    console.error('\n  Nothing to post. Pass --text "..." or --text-file <path>, and optionally --image <path>.\n')
    process.exit(1)
  }

  const media: MediaRef[] = []
  for (const path of values.image ?? []) media.push(toMedia(path, 'image'))
  if (values.video !== undefined) media.push(toMedia(values.video, 'video'))

  // Rebuilt after any upload step so publicUrl is present.
  let draft: PostDraft = { body, media }

  const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (tenant === null) {
    console.error('\n  No accounts connected. Run connect.ts first.\n')
    process.exit(1)
  }

  const rows = await db().connection.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
  })
  const connections: Connection[] = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    platform: r.platform,
    platformAccountId: r.platformAccountId,
    displayName: r.displayName,
    credentialSource: r.credentialSource,
    scopes: r.scopes,
    needsReauth: r.needsReauth,
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
  }))

  const wanted = (values.platform ?? []) as Platform[]
  const targets = connections.filter(
    (c) => !c.needsReauth && (wanted.length === 0 || wanted.includes(c.platform)),
  )
  if (targets.length === 0) {
    console.error('\n  No matching connected accounts.\n')
    process.exit(1)
  }

  const apiVersion = optional('META_API_VERSION', 'v25.0')!
  const appSecret = required('META_APP_SECRET')
  const service = new PublishService([
    new FacebookPageAdapter({ apiVersion, appSecret }),
    new InstagramAdapter({ apiVersion, appSecret }),
    new ThreadsAdapter(),
  ])

  const platforms = [...new Set(targets.map((t) => t.platform))]

  /**
   * Upload local files only when a target actually needs a public URL.
   *
   * Facebook posts bytes directly, so a Facebook-only post never touches storage
   * and never waits on an upload. Instagram has no upload path at all, so for it
   * this step is mandatory.
   */
  const needsPublicUrl =
    platforms.some((p) => service.adapterFor(p)?.capabilities.requiresPublicMediaUrl === true) ||
    // A scheduled post is published later by the worker, in a different process
    // that cannot see this machine's filesystem. Its media must be hosted even for
    // Facebook, which would otherwise have uploaded the local file directly.
    scheduledFor !== undefined

  const uploaded = new Map<string, { key: string; publicUrl: string; sha256: string }>()

  if (needsPublicUrl && media.length > 0) {
    if (!mediaHostingReady()) {
      console.error(
        '\n  Instagram needs media hosting, which is not configured.' +
          '\n  Set SUPABASE_SERVICE_ROLE_KEY and create a PUBLIC bucket. See SETUP.md.\n',
      )
      await disconnect()
      process.exit(1)
    }

    const store = new MediaStore({
      supabaseUrl: required('SUPABASE_URL'),
      serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
      bucket: optional('SUPABASE_STORAGE_BUCKET', 'media')!,
    })

    console.log('\n  Uploading media for platforms that fetch by URL…')
    for (let i = 0; i < media.length; i += 1) {
      const item = media[i]!
      if (item.publicUrl !== undefined || item.localPath === undefined) continue
      const result = await store.uploadFile(item.localPath, { tenantId: tenant.id })
      media[i] = { ...item, publicUrl: result.publicUrl }
      uploaded.set(item.id, { key: result.key, publicUrl: result.publicUrl, sha256: result.sha256 })
      console.log(`    ${result.reused ? 'reused' : 'uploaded'}  ${result.publicUrl}`)

      // A private bucket fails much later as a confusing Instagram error, so the
      // reachability check happens here where the cause is obvious.
      if (!(await store.isPubliclyReachable(result.publicUrl))) {
        console.error(
          '\n  That URL is not publicly reachable. The bucket is probably not public.' +
            '\n  Supabase Dashboard > Storage > media > make the bucket public.\n',
        )
        await disconnect()
        process.exit(1)
      }
    }
    // Explicit rebuild rather than relying on the array being mutated in place.
    draft = { body, media }
  }

  console.log('\n  Targets:')
  for (const t of targets) console.log(`    ${t.platform.padEnd(15)} ${t.displayName}`)
  console.log(`\n  Text (${body.length} chars):\n`)
  for (const line of body.split('\n')) console.log(`    ${line}`)
  if (media.length > 0) {
    console.log('\n  Media:')
    for (const m of media) console.log(`    ${m.kind}  ${m.localPath}  (${m.bytes} bytes)`)
  }

  const validation = service.validate(draft, platforms)
  console.log('\n  Validation:')
  for (const [platform, issues] of validation.byPlatform) {
    if (issues.length === 0) {
      console.log(`    ${platform.padEnd(15)} ok`)
      continue
    }
    for (const issue of issues) {
      console.log(`    ${platform.padEnd(15)} [${issue.severity}] ${issue.message}`)
    }
  }

  if (!validation.ok) {
    console.error('\n  Not valid. Nothing was published.\n')
    await disconnect()
    process.exit(1)
  }

  if (values.publish !== true) {
    console.log(
      scheduledFor !== undefined
        ? `\n  DRY RUN — nothing scheduled. Re-run with --publish to queue it for ${scheduledFor.toISOString()}.\n`
        : '\n  DRY RUN — nothing published. Re-run with --publish to post for real.\n',
    )
    await disconnect()
    return
  }

  /**
   * Scheduled path: persist the post, its media and one job per target, then stop.
   * The worker picks it up when it is due.
   *
   * Media rows are written here rather than at publish time because the worker
   * runs in another process and rebuilds the draft purely from the database.
   */
  if (scheduledFor !== undefined) {
    const post = await db().post.create({
      data: { tenantId: tenant.id, body, createdBy: 'cli' },
    })

    for (const [position, item] of media.entries()) {
      const up = uploaded.get(item.id)
      if (up === undefined || item.publicUrl === undefined) continue
      const asset = await db().mediaAsset.create({
        data: {
          tenantId: tenant.id,
          r2Key: up.key,
          publicUrl: item.publicUrl,
          mime: item.mime,
          bytes: item.bytes,
          ...(item.width !== undefined ? { width: item.width } : {}),
          ...(item.height !== undefined ? { height: item.height } : {}),
          ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
        },
      })
      await db().postMedia.create({
        data: { postId: post.id, mediaId: asset.id, position },
      })
    }

    console.log(`\n  Scheduled for ${scheduledFor.toISOString()}:`)
    for (const connection of targets) {
      const target = await db().target.create({
        data: {
          tenantId: tenant.id,
          postId: post.id,
          connectionId: connection.id,
          state: 'scheduled',
          scheduledFor,
          idempotencyKey: `${post.id}:${connection.id}`,
        },
      })
      await db().job.create({
        data: { tenantId: tenant.id, targetId: target.id, runAfter: scheduledFor },
      })
      console.log(`    queued  ${connection.platform.padEnd(15)} ${connection.displayName}`)
    }

    console.log('\n  Start the worker to run scheduled posts:')
    console.log('    node --experimental-strip-types ../worker/src/worker.ts\n')
    await disconnect()
    return
  }

  const vault = new TokenVault({
    kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
    keyVersion: 1,
    store: credentialStore(),
  })

  const post = await db().post.create({
    data: { tenantId: tenant.id, body, createdBy: 'cli' },
  })

  const report = await service.publish(
    draft,
    targets.map((connection) => ({
      connection,
      withCredential: async <T,>(fn: (token: string) => Promise<T>): Promise<T> =>
        await vault.withCredential(connection.id, connection.tenantId, async (cred) =>
          await fn(cred.accessToken),
        ),
    })),
    { idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}` },
  )

  console.log('\n  Results:')
  for (const outcome of [...report.succeeded, ...report.failed]) {
    await db().target.create({
      data: {
        tenantId: tenant.id,
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

    if (outcome.ok) {
      console.log(`    PUBLISHED  ${outcome.displayName}`)
      console.log(`               ${outcome.result!.url ?? outcome.result!.platformPostId}`)
    } else {
      console.log(`    FAILED     ${outcome.displayName}`)
      console.log(`               ${outcome.error!.message}${outcome.error!.retryable ? '  [retryable]' : ''}`)
    }
  }

  console.log('')
  await disconnect()
}

function toMedia(path: string, kind: 'image' | 'video'): MediaRef {
  if (!existsSync(path)) {
    console.error(`\n  File not found: ${path}\n`)
    process.exit(1)
  }
  const ext = extname(path).toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (mime === undefined) {
    console.error(`\n  Unsupported file type: ${ext}\n`)
    process.exit(1)
  }
  return { id: path, kind, mime, bytes: statSync(path).size, localPath: path }
}

function credentialStore() {
  return {
    async load(connectionId: string, tenantId: string) {
      const row = await db().connection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, secretCiphertext: true, expiresAt: true },
      })
      return row === null
        ? null
        : {
            connectionId: row.id,
            tenantId: row.tenantId,
            secretCiphertext: row.secretCiphertext,
            expiresAt: row.expiresAt,
          }
    },
    async save(record: {
      connectionId: string
      tenantId: string
      secretCiphertext: string
      keyVersion: number
      expiresAt: Date | null
    }) {
      await db().connection.update({
        where: { id: record.connectionId },
        data: {
          secretCiphertext: record.secretCiphertext,
          keyVersion: record.keyVersion,
          expiresAt: record.expiresAt,
        },
      })
    },
    async markNeedsReauth(connectionId: string, tenantId: string, reason: string) {
      await db().connection.updateMany({
        where: { id: connectionId, tenantId },
        data: { needsReauth: true, reauthReason: reason },
      })
    },
  }
}

main().catch(async (error: unknown) => {
  console.error(`\n  Failed: ${error instanceof Error ? error.message : String(error)}\n`)
  await disconnect().catch(() => {})
  process.exit(1)
})
