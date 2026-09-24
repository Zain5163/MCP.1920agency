import { createServer, type Server } from 'node:http'

import { statesMatch } from '@social-publisher/adapters'

/**
 * A one-shot localhost listener that catches the OAuth redirect.
 *
 * This is the whole reason the connect flow needs any HTTP at all: Meta will only
 * redirect a browser, it will not hand a token to a CLI. The server lives for one
 * request and then shuts down — it is not a web UI and does not reopen that decision.
 */

export interface CallbackResult {
  readonly code: string
}

export class CallbackError extends Error {}

const PAGE = (title: string, body: string, accent: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0d10;color:#e6e8eb;
       display:grid;place-items:center;height:100vh;margin:0}
  .card{max-width:32rem;padding:2.5rem;border:1px solid #232830;border-radius:14px;background:#12151a}
  h1{margin:0 0 .5rem;font-size:1.25rem;color:${accent}}
  p{margin:0;color:#9aa4b2;line-height:1.6}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`

/**
 * Waits for one callback on `port`.
 *
 * Rejects on a state mismatch: without that check, anyone who can reach this port
 * during the window could feed us their own authorisation code and bind their
 * Facebook account to this install.
 */
export function waitForCallback(options: {
  port: number
  path: string
  expectedState: string
  timeoutMs?: number
}): { promise: Promise<CallbackResult>; close: () => void } {
  let server: Server | undefined
  let timer: NodeJS.Timeout | undefined

  const close = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    server?.close()
  }

  const promise = new Promise<CallbackResult>((resolve, reject) => {
    const settle = (fn: () => void): void => {
      close()
      fn()
    }

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${options.port}`)
      if (url.pathname !== options.path) {
        res.writeHead(404).end()
        return
      }

      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      if (error !== null) {
        res.writeHead(400, { 'content-type': 'text/html' })
        res.end(PAGE('Connection cancelled', escapeHtml(error), '#ff6b6b'))
        settle(() => reject(new CallbackError(`Facebook returned an error: ${error}`)))
        return
      }

      const state = url.searchParams.get('state')
      if (state === null || !statesMatch(state, options.expectedState)) {
        res.writeHead(400, { 'content-type': 'text/html' })
        res.end(PAGE('Security check failed', 'The state parameter did not match. Nothing was connected.', '#ff6b6b'))
        settle(() => reject(new CallbackError('State mismatch — possible CSRF attempt. Nothing was connected.')))
        return
      }

      const code = url.searchParams.get('code')
      if (code === null || code === '') {
        res.writeHead(400, { 'content-type': 'text/html' })
        res.end(PAGE('Nothing returned', 'Facebook did not send an authorisation code.', '#ff6b6b'))
        settle(() => reject(new CallbackError('No authorisation code in the callback')))
        return
      }

      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE('Connected', 'You can close this tab and go back to the terminal.', '#5ee6a8'))
      settle(() => resolve({ code }))
    })

    server.on('error', (err) => {
      settle(() =>
        reject(
          new CallbackError(
            `Could not listen on port ${options.port}. ${
              (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
                ? 'Something else is already using it.'
                : err.message
            }`,
          ),
        ),
      )
    })

    server.listen(options.port, '127.0.0.1')

    timer = setTimeout(() => {
      settle(() => reject(new CallbackError('Timed out waiting for Facebook to redirect back.')))
    }, options.timeoutMs ?? 5 * 60 * 1000)
  })

  return { promise, close }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}
