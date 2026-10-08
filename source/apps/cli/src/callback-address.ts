/**
 * Where the one-shot OAuth listener listens, worked out from the redirect address.
 *
 * Two shapes of redirect address are supported:
 *
 *   http://localhost:8787/<path>              the provider sends the browser straight
 *                                            to this PC (how every connection was made
 *                                            until 2026-10-08)
 *   https://mcp.1920agency.com/<path>        the provider sends the browser to the
 *                                            hosted server, whose Caddy answers with a
 *                                            302 to http://localhost:8787/<path>?<query>
 *                                            (deploy/caddy/mcp.1920agency.com.caddy)
 *
 * The second exists because Meta's "Enforce HTTPS" refuses http://localhost while
 * an app is Live (the 2026-10-02 "Can't load URL"). Before this, the port came from
 * the redirect address, so an https address made the CLI listen on port 80 and the
 * code never arrived.
 *
 * Pure on purpose: no network, no env file. The connect commands pass in the
 * redirect address and the OAUTH_CALLBACK_PORT setting, so the choice is tested
 * without a browser or a provider.
 */

/** Where the hosted server's bounce sends the browser. Fixed in the Caddy snippet. */
export const BOUNCE_PORT = 8787

/**
 * Names that always mean "this machine". A redirect to any of them is caught here
 * directly; any other host has to send the browser on to us.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface ListenAddress {
  /** The port on 127.0.0.1 the listener binds. */
  readonly port: number
  /** The callback path; always the redirect address's own path. */
  readonly path: string
  /** True when the browser reaches this PC through the hosted server's bounce. */
  readonly bounced: boolean
}

export class CallbackAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CallbackAddressError'
  }
}

/**
 * Chooses the listener's port and path.
 *
 * The PATH always comes from the redirect address, bounced or not: the bounce
 * keeps the path, and matching it is what lets one listener refuse a callback
 * meant for a different provider.
 *
 * The PORT: for a localhost redirect, the redirect's own port (the browser goes
 * exactly there, so any other port would wait forever). For a public redirect,
 * OAUTH_CALLBACK_PORT, else 8787, the port the Caddy bounce points at.
 */
export function listenAddress(redirectUri: string, portSetting?: string): ListenAddress {
  let redirect: URL
  try {
    redirect = new URL(redirectUri)
  } catch {
    throw new CallbackAddressError(
      `The redirect address "${redirectUri}" is not a valid URL. ` +
        'Fix the matching *_REDIRECT_URI in ~/.social-publisher/.env (see deploy/README.md, "OAuth callbacks").',
    )
  }

  const configured = parsePort(portSetting)
  const path = redirect.pathname

  if (LOOPBACK_HOSTS.has(redirect.hostname)) {
    // The listener speaks plain http; a browser told to use https on localhost
    // would fail the TLS handshake and the code would never arrive.
    if (redirect.protocol !== 'http:') {
      throw new CallbackAddressError(
        `The redirect address "${redirectUri}" uses ${redirect.protocol.replace(':', '')} on this PC, ` +
          'but the connect command can only listen with plain http. Use http://localhost:8787/<path>, ' +
          'or the https address of the hosted server (deploy/README.md, "OAuth callbacks").',
      )
    }
    const port = redirect.port === '' ? 80 : Number(redirect.port)
    if (configured !== undefined && configured !== port) {
      throw new CallbackAddressError(
        `OAUTH_CALLBACK_PORT is ${configured}, but the redirect address "${redirectUri}" sends the browser to port ${port}, ` +
          'so the listener would never be reached. Remove OAUTH_CALLBACK_PORT from ~/.social-publisher/.env ' +
          '(it is only for https redirect addresses), or make the two match.',
      )
    }
    return { port, path, bounced: false }
  }

  return { port: configured ?? BOUNCE_PORT, path, bounced: true }
}

/**
 * The one line printed before the browser opens when the redirect is bounced.
 *
 * Without it, seeing the browser visit the hosted server and then a localhost
 * page looks like something went wrong, or like the code was handed to a server.
 */
export function bounceNotice(redirectUri: string, address: ListenAddress): string | undefined {
  if (!address.bounced) return undefined
  const host = new URL(redirectUri).host
  return `  Your browser will come back through ${host}, which sends it straight on to this PC (localhost:${address.port}).`
}

function parsePort(setting: string | undefined): number | undefined {
  if (setting === undefined || setting.trim() === '') return undefined
  const value = setting.trim()
  const port = Number(value)
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new CallbackAddressError(
      `OAUTH_CALLBACK_PORT is "${value}", which is not a port number (1 to 65535). ` +
        'Fix or remove it in ~/.social-publisher/.env; without it the listener uses 8787.',
    )
  }
  return port
}
