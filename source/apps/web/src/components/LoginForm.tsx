'use client'

import { useActionState, type ReactNode } from 'react'

import { login } from '@/app/actions'

/**
 * The sign-in form. A client component (it keeps the form state), so it cannot
 * read the product name itself: login/page.tsx renders the wordmark on the
 * server and passes it in.
 */
export function LoginForm({ wordmark }: { wordmark: ReactNode }) {
  const [state, action, pending] = useActionState(login, null)

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form action={action} className="card w-full max-w-sm">
        <div className="text-lg font-bold tracking-tight">{wordmark}</div>
        <p className="mb-5 mt-1 text-[0.85rem] text-muted">Sign in to publish and schedule.</p>

        <div className="mb-4">
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="mb-5">
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" className="btn w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        {state?.ok === false && (
          <div className="mt-4 rounded-lg border border-bad/30 bg-bad/10 p-3 text-[0.88rem]">
            {state.message}
          </div>
        )}

        <p className="mt-5 text-[0.78rem] text-muted">
          No account yet? Create one with{' '}
          <code className="text-ink">create-user.ts</code> in the CLI.
        </p>
      </form>
    </div>
  )
}
