'use client'

import { useActionState, useState } from 'react'

import { createToken, revoke, type TokenResult } from '@/app/tokens/actions'
import { formatDate, formatDateTime } from '@/lib/format'

export interface TokenRow {
  readonly id: string
  readonly name: string
  readonly prefix: string
  readonly lastUsedAt: string | null
  readonly expiresAt: string | null
  readonly revokedAt: string | null
  readonly createdAt: string
}

export function TokenManager({ tokens, mcpUrl }: { tokens: readonly TokenRow[]; mcpUrl: string }) {
  const [state, action, pending] = useActionState<TokenResult | null, FormData>(createToken, null)
  const [copied, setCopied] = useState(false)

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; the value is on screen to select manually.
    }
  }

  const active = tokens.filter((t) => t.revokedAt === null)
  const revoked = tokens.filter((t) => t.revokedAt !== null)

  return (
    <div className="grid gap-5">
      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Connect your AI</h2>
        <p className="mb-4 text-[0.85rem] text-muted">
          Point Claude, ChatGPT or any MCP client at this endpoint with a token below.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[0.8rem] text-ink">
{`{
  "mcpServers": {
    "adspilot": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`}
        </pre>
      </section>

      <form action={action} className="card">
        <h2 className="mb-1 text-base font-semibold">New token</h2>
        <p className="mb-4 text-[0.85rem] text-muted">
          One per device or AI client, so you can revoke a single one without breaking the rest.
        </p>

        <div className="mb-4">
          <label htmlFor="name" className="field-label">
            What is it for?
          </label>
          <input id="name" name="name" type="text" placeholder="Claude on my laptop" required />
        </div>

        <div className="mb-5">
          <label htmlFor="expiry" className="field-label">
            Expires
          </label>
          <select id="expiry" name="expiry" defaultValue="never">
            <option value="never">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In a year</option>
          </select>
        </div>

        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Creating…' : 'Create token'}
        </button>

        {state?.ok === true && state.token !== undefined && (
          <div className="mt-4 rounded-lg border border-ok/30 bg-ok/10 p-4">
            <p className="mb-2 text-[0.88rem] font-semibold">{state.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded-md border border-line bg-surface-2 px-3 py-2 text-[0.8rem]">
                {state.token}
              </code>
              <button type="button" className="btn-ghost" onClick={() => void copy(state.token!)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-[0.78rem] text-warn">
              This is the only time it will be shown. We store a hash, not the token, so we
              genuinely cannot show it again.
            </p>
          </div>
        )}

        {state?.ok === false && (
          <div className="mt-4 rounded-lg border border-bad/30 bg-bad/10 p-3 text-[0.88rem]">
            {state.message}
          </div>
        )}
      </form>

      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Your tokens</h2>
        <p className="mb-3 text-[0.85rem] text-muted">
          Revoking takes effect immediately — the next request with it is refused.
        </p>

        {active.length === 0 && (
          <p className="py-2 text-[0.88rem] text-muted">No active tokens.</p>
        )}

        {active.map((token) => (
          <div
            key={token.id}
            className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[0.9rem]">{token.name}</div>
              <div className="text-[0.76rem] text-muted">
                <code>{token.prefix}…</code>
                {' · created '}
                {formatDate(token.createdAt)}
                {token.lastUsedAt === null
                  ? ' · never used'
                  : ` · last used ${formatDateTime(token.lastUsedAt)}`}
                {token.expiresAt !== null &&
                  ` · expires ${formatDate(token.expiresAt)}`}
              </div>
            </div>
            <form action={revoke}>
              <input type="hidden" name="tokenId" value={token.id} />
              <button type="submit" className="btn-ghost text-bad">
                Revoke
              </button>
            </form>
          </div>
        ))}

        {revoked.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[0.82rem] text-muted">
              {revoked.length} revoked
            </summary>
            {revoked.map((token) => (
              <div key={token.id} className="py-2 text-[0.82rem] text-muted line-through">
                {token.name} <code>{token.prefix}…</code>
              </div>
            ))}
          </details>
        )}
      </section>
    </div>
  )
}
