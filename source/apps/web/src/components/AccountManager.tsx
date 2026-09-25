'use client'

import { useActionState } from 'react'

import {
  connectAccount,
  disconnect,
  reconnect,
  type AccountsResult,
  type AvailableAccount,
} from '@/app/accounts/actions'
import { PlatformBadge, humanisePlatform } from '@/components/PlatformBadge'

export interface ConnectedRow {
  readonly id: string
  readonly platform: string
  readonly platformLabel: string
  readonly platformAccent?: string | undefined
  readonly displayName: string
  readonly needsReauth: boolean
  readonly reauthReason: string | null
}

export function AccountManager({
  available,
  connected,
  loadError,
}: {
  available: readonly AvailableAccount[]
  connected: readonly ConnectedRow[]
  loadError?: string | undefined
}) {
  const [state, action, pending] = useActionState<AccountsResult | null, FormData>(
    connectAccount,
    null,
  )

  const notConnected = available.filter((a) => !a.connected)

  return (
    <div className="grid gap-5">
      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Connected</h2>
        <p className="mb-4 text-[0.85rem] text-muted">
          Accounts you can publish to. Disconnecting keeps their post history.
        </p>

        {connected.length === 0 && (
          <p className="py-2 text-[0.88rem] text-muted">Nothing connected yet.</p>
        )}

        {connected.map((account) => (
          <div
            key={account.id}
            className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[0.9rem]">{account.displayName}</span>
                <PlatformBadge label={account.platformLabel} accent={account.platformAccent} />
              </div>
              <div className="text-[0.76rem] text-muted">
                {account.needsReauth && (
                  <span className="text-bad">
                    {' · '}
                    {account.reauthReason ?? 'needs reconnecting'}
                  </span>
                )}
              </div>
            </div>

            {account.needsReauth ? (
              <form action={reconnect}>
                <input type="hidden" name="connectionId" value={account.id} />
                <button type="submit" className="btn-ghost text-ok">
                  Re-enable
                </button>
              </form>
            ) : (
              <form action={disconnect}>
                <input type="hidden" name="connectionId" value={account.id} />
                <button type="submit" className="btn-ghost text-bad">
                  Disconnect
                </button>
              </form>
            )}
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Available to connect</h2>
        <p className="mb-4 text-[0.85rem] text-muted">
          Every Page your Meta authorisation can reach. Connecting one takes no new sign-in.
        </p>

        {loadError !== undefined && (
          <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-[0.88rem]">
            {loadError}
          </div>
        )}

        {loadError === undefined && notConnected.length === 0 && (
          <p className="py-2 text-[0.88rem] text-muted">
            Everything available is already connected.
          </p>
        )}

        {notConnected.map((account) => (
          <form
            key={account.externalId}
            action={action}
            className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <input type="hidden" name="externalId" value={account.externalId} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[0.9rem]">{account.name}</span>
                <PlatformBadge label={humanisePlatform(account.platform)} />
              </div>
              <div className="text-[0.76rem] text-muted">
                {/* Linked accounts share one credential, so they connect together. */}
                {account.linkedNames.length > 0 &&
                  ` · also connects ${account.linkedNames.join(', ')}`}
              </div>
            </div>
            <button type="submit" className="btn" disabled={pending}>
              {pending ? 'Connecting…' : 'Connect'}
            </button>
          </form>
        ))}

        {state !== null && (
          <div
            className={`mt-4 rounded-lg border p-3 text-[0.88rem] ${
              state.ok ? 'border-ok/30 bg-ok/10' : 'border-bad/30 bg-bad/10'
            }`}
          >
            {state.message}
            {state.details !== undefined && state.details.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {state.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
