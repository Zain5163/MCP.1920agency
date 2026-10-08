import { execFile, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { CONFIG_DIR, optional } from '@social-publisher/config'
import { decide, formatApprovalRequest } from '@social-publisher/core'

import { audit, guarded, type ToolResult } from './ads-tools.ts'
import { findShopifyStore, readShopifyStores, type ShopifyStoreEntry } from './shopify-tools.ts'

/**
 * Theme changes (phase 2b of architecture/2026-10-08-shopify-connector-plan.md).
 *
 * Why the Shopify CLI and not the Admin API: theme writes through an app need a
 * special exemption from Shopify, even for a private custom app (refused live on
 * 2026-10-08: "needs write_themes and an exemption from Shopify"). The CLI is
 * Shopify's own tool for theme developers and agencies; it authenticates as a
 * person (the owner's login, a collaborator account, or a Theme Access password).
 *
 * The safety design, enforced here:
 *   - The live theme is never edited. A draft is a local copy of the live theme.
 *   - Edits happen on local files; JSON files must still parse; paths cannot leave
 *     the theme.
 *   - Preview uploads the draft as a HIDDEN theme and returns its preview link.
 *   - Publishing needs the owner's approval, refuses if the draft changed since its
 *     preview or if the live theme changed since the draft was made, reads back
 *     which theme is live afterwards, and records the previous live theme.
 *   - Rollback republishes the previous live theme, with approval.
 *
 * Drafts live in ~/.social-publisher/shopify-themes/<shop>/<draft>/ with `live/`
 * (untouched download, the backup) and `draft/` (the editable copy).
 */

export const THEMES_DIR = join(CONFIG_DIR, 'shopify-themes')
const THEME_FOLDERS = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates']

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

export interface DraftState {
  shop: string
  draft: string
  liveThemeId: number
  liveThemeName: string
  createdAt: string
  previewThemeId?: number
  previewUrl?: string
  previewHash?: string
  publishedAt?: string
  previousLiveThemeId?: number
}

export type CliRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>

let cliPath: string | undefined
function shopifyCliScript(): string {
  if (cliPath !== undefined) return cliPath
  const fromEnv = optional('SHOPIFY_CLI_JS')
  if (fromEnv !== undefined) return (cliPath = fromEnv)
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
  const script = join(root, '@shopify', 'cli', 'bin', 'run.js')
  if (!existsSync(script)) throw new Error('The Shopify CLI is not installed. Run: npm install -g @shopify/cli')
  return (cliPath = script)
}

/** Runs the CLI with node directly: no shell, so paths with spaces are safe. */
export const runShopifyCli: CliRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [shopifyCliScript(), ...args, '--no-color'],
      { cwd, timeout: 600_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: '1' } },
      (error, stdout, stderr) => resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr }),
    )
  })

/** Store login for the CLI: a Theme Access password if one is set for this store, else the CLI's own login. */
function authArgs(store: ShopifyStoreEntry): string[] {
  const password = optional(`SHOPIFY_THEME_PASSWORD_${store.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
  return ['--store', store.shop, ...(password !== undefined ? ['--password', password] : [])]
}

const cliError = (r: { stdout: string; stderr: string }) =>
  (r.stderr + '\n' + r.stdout).replace(/[╭╮╰╯│─]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)

// ------------------------------------------------------------------ files

/** A theme-relative file path, or an error. Nothing outside the theme folders. */
export function safeThemePath(file: string): string | { error: string } {
  const f = file.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = f.split('/')
  if (parts.length < 2 || parts.some((p) => p === '' || p === '.' || p === '..')) return { error: `"${file}" is not a theme file path.` }
  if (!THEME_FOLDERS.includes(parts[0]!)) return { error: `"${file}" is outside the theme folders (${THEME_FOLDERS.join(', ')}).` }
  return f
}

/** Shopify's JSON templates may start with a comment block; strip it before parsing. */
export function themeJsonError(content: string): string | undefined {
  const body = content.replace(/^\s*\/\*[\s\S]*?\*\//, '')
  try {
    JSON.parse(body)
    return undefined
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Files added, removed or changed in the draft compared with the live download. */
export function draftChanges(root: string): { changed: string[]; added: string[]; removed: string[] } {
  const live = new Set(listFiles(join(root, 'live')))
  const draft = new Set(listFiles(join(root, 'draft')))
  const changed: string[] = []
  const added: string[] = []
  for (const f of draft) {
    if (!live.has(f)) added.push(f)
    else if (fileHash(join(root, 'live', f)) !== fileHash(join(root, 'draft', f))) changed.push(f)
  }
  const removed = [...live].filter((f) => !draft.has(f))
  return { changed, added, removed }
}

export function draftHash(root: string): string {
  const h = createHash('sha256')
  for (const f of listFiles(join(root, 'draft'))) h.update(f).update(fileHash(join(root, 'draft', f)))
  return h.digest('hex').slice(0, 20)
}

function readState(root: string): DraftState | undefined {
  const p = join(root, 'state.json')
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as DraftState) : undefined
}
function writeState(root: string, state: DraftState): void {
  writeFileSync(join(root, 'state.json'), JSON.stringify(state, null, 2))
}

/** Edits a draft file by exact find-and-replace (preferred) or by full content. */
export function editDraftFile(
  root: string,
  file: string,
  edit: { find?: string; replace?: string; content?: string },
): { ok: true; summary: string } | { error: string } {
  const rel = safeThemePath(file)
  if (typeof rel !== 'string') return rel
  const path = join(root, 'draft', ...rel.split('/'))
  const exists = existsSync(path)
  let next: string
  if (edit.content !== undefined) {
    next = edit.content
  } else if (edit.find !== undefined && edit.replace !== undefined) {
    if (!exists) return { error: `${rel} does not exist in the draft; give full content to create it.` }
    const current = readFileSync(path, 'utf8')
    const count = current.split(edit.find).length - 1
    if (count === 0) return { error: `The text to find was not found in ${rel}. Read the file with shopify_theme_read and copy the exact text.` }
    if (count > 1) return { error: `The text to find appears ${count} times in ${rel}; include more surrounding text so it is unique.` }
    next = current.replace(edit.find, edit.replace)
  } else {
    return { error: 'Give either find + replace, or content.' }
  }
  if (rel.endsWith('.json')) {
    const bad = themeJsonError(next)
    if (bad !== undefined) return { error: `Not saved: ${rel} would no longer be valid JSON (${bad}).` }
  }
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, next)
  return { ok: true, summary: `${exists ? 'Edited' : 'Created'} ${rel} in the draft (${next.length.toLocaleString('en-US')} characters).` }
}

// ------------------------------------------------------------------ tools

function storeFor(selector: string): ShopifyStoreEntry | { error: string } {
  const stores = readShopifyStores()
  if ('error' in stores) return stores
  return findShopifyStore(selector, stores)
}
const storeArg = z.string().describe('Which store: a name, key or myshopify.com address from list_shopify_stores.')
const draftArg = z.string().regex(/^[a-z0-9-]+$/).describe('The draft name returned by shopify_theme_start_draft.')
const draftRoot = (store: ShopifyStoreEntry, draft: string) => join(THEMES_DIR, store.shop, draft)

async function liveTheme(store: ShopifyStoreEntry, cli: CliRunner): Promise<{ id: number; name: string } | { error: string }> {
  const r = await cli(['theme', 'list', ...authArgs(store), '--role', 'live', '--json'], THEMES_DIR)
  if (r.code !== 0) return { error: `Could not list themes on ${store.shop}: ${cliError(r)}` }
  try {
    const list = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as Array<{ id: number; name: string; role: string }>
    const live = list.find((t) => t.role === 'live')
    return live !== undefined ? { id: live.id, name: live.name } : { error: 'No live theme found.' }
  } catch {
    return { error: `Unexpected output from the Shopify CLI: ${cliError(r)}` }
  }
}

export function registerShopifyThemeTools(server: McpServer, cli: CliRunner = runShopifyCli): void {
  const withTheme = async (selector: string, fn: (store: ShopifyStoreEntry) => Promise<string>) =>
    await guarded(async () => {
      const store = storeFor(selector)
      if ('error' in store) return text(store.error)
      mkdirSync(join(THEMES_DIR, store.shop), { recursive: true })
      return text(`Store: ${store.name} (${store.shop})\n\n${await fn(store)}`)
    })

  server.tool(
    'shopify_theme_start_draft',
    'Start a theme draft: download the live theme (kept untouched as the backup) and make an editable copy. Nothing on the store changes. Then use shopify_theme_read / shopify_theme_edit, shopify_theme_preview, and shopify_theme_publish.',
    { store: storeArg },
    async ({ store }) =>
      await withTheme(store, async (s) => {
        const live = await liveTheme(s, cli)
        if ('error' in live) return live.error
        const draft = `draft-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
        const root = draftRoot(s, draft)
        mkdirSync(join(root, 'live'), { recursive: true })
        const r = await cli(['theme', 'pull', ...authArgs(s), '--theme', String(live.id), '--path', join(root, 'live')], root)
        if (r.code !== 0) return `Could not download the live theme: ${cliError(r)}`
        cpSync(join(root, 'live'), join(root, 'draft'), { recursive: true })
        writeState(root, { shop: s.shop, draft, liveThemeId: live.id, liveThemeName: live.name, createdAt: new Date().toISOString() })
        const files = listFiles(join(root, 'draft'))
        const key = files.filter((f) => /^(layout\/theme\.liquid|config\/settings_data\.json|sections\/(header|footer|announcement)[^/]*|templates\/(index|product|collection|cart)\.json)$/.test(f))
        return [
          `Draft "${draft}" made from the live theme "${live.name}" (#${live.id}): ${files.length} files.`,
          'Nothing on the store has changed. The download in live/ is the backup.',
          '',
          'Files most edits start from:',
          ...key.map((f) => `  ${f}`),
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_theme_read',
    'Read a file from a theme draft (for example sections/header-group.json for the announcement bar, templates/product.json for the product page). Reads only.',
    { store: storeArg, draft: draftArg, file: z.string(), from: z.number().int().min(0).default(0), length: z.number().int().min(100).max(40_000).default(20_000) },
    async ({ store, draft, file, from, length }) =>
      await withTheme(store, async (s) => {
        const rel = safeThemePath(file)
        if (typeof rel !== 'string') return rel.error
        const path = join(draftRoot(s, draft), 'draft', ...rel.split('/'))
        if (!existsSync(path)) {
          const all = listFiles(join(draftRoot(s, draft), 'draft'))
          if (all.length === 0) return `No draft "${draft}". Start one with shopify_theme_start_draft.`
          const near = all.filter((f) => f.startsWith(rel.split('/')[0]!)).slice(0, 40)
          return `${rel} is not in the draft. Files in ${rel.split('/')[0]}/:\n${near.map((f) => `  ${f}`).join('\n')}`
        }
        const content = readFileSync(path, 'utf8')
        const part = content.slice(from, from + length)
        return `${rel} (${content.length.toLocaleString('en-US')} characters${from + length < content.length ? `, showing ${from}–${from + part.length}` : ''}):\n\n${part}`
      }),
  )

  server.tool(
    'shopify_theme_edit',
    'Edit a file in a theme draft: an exact find-and-replace (preferred; the text must appear exactly once), or full content to create or replace a file. JSON files must stay valid. Only the local draft changes, never the live theme.',
    {
      store: storeArg,
      draft: draftArg,
      file: z.string(),
      find: z.string().optional(),
      replace: z.string().optional(),
      content: z.string().optional(),
    },
    async ({ store, draft, file, find, replace, content }) =>
      await withTheme(store, async (s) => {
        const root = draftRoot(s, draft)
        if (readState(root) === undefined) return `No draft "${draft}". Start one with shopify_theme_start_draft.`
        const r = editDraftFile(root, file, { ...(find !== undefined ? { find } : {}), ...(replace !== undefined ? { replace } : {}), ...(content !== undefined ? { content } : {}) })
        if ('error' in r) return r.error
        const c = draftChanges(root)
        return `${r.summary}\nDraft now differs from live in ${c.changed.length + c.added.length + c.removed.length} file(s). Preview it with shopify_theme_preview.`
      }),
  )

  server.tool(
    'shopify_theme_preview',
    'Upload a theme draft as a HIDDEN theme and return its preview link, so the owner can see the change as a customer would before anything goes live. Customers do not see it. Run again after more edits to update the same hidden theme.',
    { store: storeArg, draft: draftArg },
    async ({ store, draft }) =>
      await withTheme(store, async (s) => {
        const root = draftRoot(s, draft)
        const state = readState(root)
        if (state === undefined) return `No draft "${draft}".`
        const c = draftChanges(root)
        if (c.changed.length + c.added.length + c.removed.length === 0) return 'The draft has no changes yet: nothing to preview.'
        const target = state.previewThemeId !== undefined ? ['--theme', String(state.previewThemeId)] : ['--unpublished', '--theme', `AdsPilot ${draft}`]
        const r = await cli(['theme', 'push', ...authArgs(s), '--path', join(root, 'draft'), ...target, '--json'], root)
        if (r.code !== 0) return `Upload failed: ${cliError(r)}`
        let theme: { id: number; role: string; preview_url: string; editor_url: string }
        try {
          theme = (JSON.parse(r.stdout.slice(r.stdout.lastIndexOf('{"theme"'))) as { theme: typeof theme }).theme
        } catch {
          return `Uploaded, but the CLI's reply could not be read: ${cliError(r)}`
        }
        if (theme.role !== 'unpublished') return `Refused to continue: the uploaded theme reports role "${theme.role}", not unpublished. Check the store now.`
        writeState(root, { ...state, previewThemeId: theme.id, previewUrl: theme.preview_url, previewHash: draftHash(root) })
        return [
          `Hidden preview theme #${theme.id} is up to date with the draft. Customers do not see it.`,
          `Preview: ${theme.preview_url}`,
          `Editor: ${theme.editor_url}`,
          '',
          `Files different from the live theme: ${[...c.changed, ...c.added.map((f) => `${f} (new)`), ...c.removed.map((f) => `${f} (removed)`)].join(', ')}`,
          'Ask the owner to look at the preview on a phone and a computer before publishing.',
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_theme_publish',
    'Make a previewed theme draft the live theme. Needs the owner’s approval. Refuses if the draft changed after its preview or if the live theme changed since the draft was made. The previous live theme is kept for shopify_theme_rollback.',
    { store: storeArg, draft: draftArg, confirm: z.string().optional() },
    async ({ store, draft, confirm }) =>
      await withTheme(store, async (s) => {
        const root = draftRoot(s, draft)
        const state = readState(root)
        if (state === undefined) return `No draft "${draft}".`
        if (state.previewThemeId === undefined) return 'Preview it first (shopify_theme_preview): nothing goes live without a preview.'
        if (draftHash(root) !== state.previewHash) return 'The draft changed after its last preview. Preview again so the owner approves what will actually go live.'
        const live = await liveTheme(s, cli)
        if ('error' in live) return live.error
        if (live.id !== state.liveThemeId) {
          return `Refused: the live theme changed since this draft was made (was #${state.liveThemeId} "${state.liveThemeName}", now #${live.id} "${live.name}"). Publishing would undo those changes. Start a new draft.`
        }
        const c = draftChanges(root)
        const gate = decide({
          action: 'shopify_theme_publish',
          payload: { shop: s.shop, draft, theme: state.previewThemeId, hash: state.previewHash },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Publish theme draft "${draft}" on ${s.name}: hidden theme #${state.previewThemeId} becomes the live theme.`,
              `  Preview first: ${state.previewUrl}`,
              `  Changed files: ${[...c.changed, ...c.added, ...c.removed].join(', ')}`,
              `  The current live theme "${live.name}" (#${live.id}) is kept; shopify_theme_rollback puts it back.`,
              '',
              'Every customer sees the new theme from this moment.',
            ].join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        const r = await cli(['theme', 'publish', ...authArgs(s), '--theme', String(state.previewThemeId), '--force'], root)
        if (r.code !== 0) return `Publishing failed; the old theme is still live. ${cliError(r)}`
        const after = await liveTheme(s, cli)
        writeState(root, { ...state, publishedAt: new Date().toISOString(), previousLiveThemeId: live.id })
        writeFileSync(join(THEMES_DIR, s.shop, 'last-publish.json'), JSON.stringify({ draft, publishedThemeId: state.previewThemeId, previousLiveThemeId: live.id, previousLiveThemeName: live.name, at: new Date().toISOString() }, null, 2))
        await audit('shopify.theme.published', { shop: s.shop, draft, theme: state.previewThemeId, previous: live.id })
        const ok = !('error' in after) && after.id === state.previewThemeId
        return ok
          ? `Done, and read back: theme #${state.previewThemeId} is now live. The previous theme "${live.name}" (#${live.id}) is kept for rollback.`
          : `Publish ran, but the read-back shows a different live theme (${'error' in after ? after.error : `#${after.id}`}). Check the store now.`
      }),
  )

  server.tool(
    'shopify_theme_rollback',
    'Put back the theme that was live before the last AdsPilot publish. Needs the owner’s approval.',
    { store: storeArg, confirm: z.string().optional() },
    async ({ store, confirm }) =>
      await withTheme(store, async (s) => {
        const p = join(THEMES_DIR, s.shop, 'last-publish.json')
        if (!existsSync(p)) return 'AdsPilot has not published a theme on this store, so there is nothing to roll back.'
        const last = JSON.parse(readFileSync(p, 'utf8')) as { previousLiveThemeId: number; previousLiveThemeName: string; publishedThemeId: number }
        const gate = decide({
          action: 'shopify_theme_rollback',
          payload: { shop: s.shop, to: last.previousLiveThemeId },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => `Roll back ${s.name}: make "${last.previousLiveThemeName}" (#${last.previousLiveThemeId}) the live theme again, replacing #${last.publishedThemeId}. Every customer sees it at once.`,
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        const r = await cli(['theme', 'publish', ...authArgs(s), '--theme', String(last.previousLiveThemeId), '--force'], THEMES_DIR)
        if (r.code !== 0) return `Rollback failed: ${cliError(r)}`
        const after = await liveTheme(s, cli)
        await audit('shopify.theme.rolled_back', { shop: s.shop, to: last.previousLiveThemeId })
        return !('error' in after) && after.id === last.previousLiveThemeId
          ? `Done, and read back: "${last.previousLiveThemeName}" (#${last.previousLiveThemeId}) is live again.`
          : 'Rollback ran, but the read-back shows a different live theme. Check the store now.'
      }),
  )

  server.tool(
    'shopify_theme_discard',
    'Throw away a theme draft: delete its hidden preview theme from the store (never a live theme) and its local files, except the live backup download. No approval needed: nothing customers see changes.',
    { store: storeArg, draft: draftArg },
    async ({ store, draft }) =>
      await withTheme(store, async (s) => {
        const root = draftRoot(s, draft)
        const state = readState(root)
        if (state === undefined) return `No draft "${draft}".`
        if (state.previewThemeId !== undefined) {
          const live = await liveTheme(s, cli)
          if ('error' in live) return live.error
          if (live.id === state.previewThemeId) return 'Refused: that theme is live. Publish or roll back to another theme first.'
          const r = await cli(['theme', 'delete', ...authArgs(s), '--theme', String(state.previewThemeId), '--force'], root)
          if (r.code !== 0) return `Could not delete the hidden theme: ${cliError(r)}`
        }
        rmSync(join(root, 'draft'), { recursive: true, force: true })
        const { previewThemeId: _id, previewUrl: _url, previewHash: _hash, ...rest } = state
        writeState(root, rest)
        return `Draft "${draft}" discarded. The live theme download is kept in ${join(root, 'live')} as a backup.`
      }),
  )
}
