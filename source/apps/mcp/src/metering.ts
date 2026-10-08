import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { allCodes, industryOf, isFreeTool, limitMessage, meterCall, planOf, usageMonth, type Industry, type Plan } from '@social-publisher/core'
import type { CountedMonth, ToolCallInput, UsageSnapshot } from '@social-publisher/db'
import type { Analytics } from '@social-publisher/telemetry'

import type { McpAnalyticsSetup } from './mcp-analytics.ts'

/**
 * Usage metering for every MCP tool, on both transports (decision 0009).
 *
 * Installed on the server itself, before any tool is registered, by wrapping
 * the two ways the SDK registers a tool. A tool therefore cannot be added
 * unmetered by forgetting a call: whoever registers it, through whichever
 * helper, the handler the SDK stores is this wrapper. createAdsPilotServer
 * (mcp-server.ts) is the only place a server is built, and a test enumerates
 * every registered tool on both transports and checks its mark.
 *
 * Per call, the wrapper:
 *   1. reads the plan and this month's count; on Free at the allowance it
 *      returns the limit message and the tool does no work;
 *   2. runs the tool;
 *   3. records the call (tool, ok or the catalogue code, duration, client,
 *      transport — never arguments or results) and adds it to the month;
 *   4. appends a usage notice to the result when this call crossed a threshold.
 *
 * Next to each record it sends the same facts to product analytics (Phase 2):
 * `mcp_call` for every call, `limit_reached` when Free is refused,
 * `limit_notice_shown` when a notice goes out. Analytics is fire-and-forget
 * and never throws (packages/telemetry analytics.ts), so it cannot slow or
 * break a call; without POSTHOG_KEY it does nothing.
 *
 * Metering must never be why a call fails. If the count cannot be read, the
 * call runs (fail open) and that is logged; if it cannot be written, the
 * result is returned as it is and that is logged. A database outage then costs
 * some uncounted calls, which is cheaper than every customer's tools failing.
 */

/** Marks a stored handler with how it is metered. Read by the registration test. */
export const METERED = Symbol.for('adspilot.metered')
export type Metering = 'counted' | 'free'

/** What metering needs of an account. TenantScope has exactly this shape. */
export interface UsageAccount {
  readonly tenantId: string
  usage(month: string): Promise<UsageSnapshot>
  recordToolCall(call: ToolCallInput, options: { month: string; count: boolean }): Promise<CountedMonth | null>
  markNoticesShown(month: string, thresholds: readonly number[]): Promise<void>
  /** For set_business_type (account-tools.ts); metering itself never writes it. */
  setIndustry(code: string): Promise<void>
}

/** The MCP initialize request's clientInfo, as the SDK keeps it. */
export interface ClientInfo {
  readonly name?: string | undefined
  readonly version?: string | undefined
}

export interface MeterOptions {
  readonly transport: 'stdio' | 'http'
  /** The account the call acts for. Resolved per call; a failure is logged and the call runs. */
  readonly account: () => Promise<UsageAccount>
  readonly userId?: string | undefined
  /**
   * Where the client's name comes from when this server instance never saw the
   * initialize request. The hosted server is stateless: initialize and each
   * tools/call arrive as separate HTTP requests, each with a fresh server.
   */
  readonly clientInfo?: () => ClientInfo | undefined
  /** UPGRADE_URL from configuration; plain words are used when it is unset. */
  readonly upgradeUrl?: string | undefined
  /** Must not throw. Metering failures go here, never to the customer. */
  readonly log: (event: string, message: string, error: unknown) => void
  readonly now?: () => Date
  /** Product analytics (PostHog). Absent or disabled: nothing is sent. */
  readonly analytics?: Analytics | undefined
  /**
   * PostHog MCP Analytics ($mcp_tool_call), installed by createAdsPilotServer
   * (mcp-analytics.ts). Absent (no POSTHOG_KEY): the server is not instrumented.
   */
  readonly mcpAnalytics?: McpAnalyticsSetup | undefined
}

type Handler = (...args: unknown[]) => unknown
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

const INSTALLED = Symbol.for('adspilot.metering-installed')
const CODES = new Set<string>(allCodes())
/** Client-supplied strings are stored; a hostile client must not be able to store a novel. */
const CLIENT_FIELD_MAX = 120

/**
 * Wraps tool registration on this server so every tool is metered.
 *
 * Must run before the first tool is registered; createAdsPilotServer does that.
 * Installing twice would count every call twice, so it refuses.
 */
export function installMetering(server: McpServer, options: MeterOptions): void {
  const target = server as unknown as Record<string | symbol, unknown>
  if (target[INSTALLED] === true) throw new Error('Metering is already installed on this server.')

  for (const method of ['tool', 'registerTool'] as const) {
    const original = (target[method] as Handler).bind(server)
    target[method] = (...args: unknown[]) => {
      // In every SDK overload the name comes first and the handler last.
      const name = args[0]
      const last = args.length - 1
      const handler = args[last]
      if (typeof name !== 'string' || typeof handler !== 'function') {
        throw new Error(`A tool must be registered with a name and a handler (${String(name)}).`)
      }
      args[last] = metered(server, name, handler as Handler, options)
      return original(...args)
    }
  }

  // The SDK's experimental task tools register past the two methods above. None
  // are used; if one ever is, it must be metered first, not slip through.
  const tasks = (server as unknown as { experimental?: { tasks?: Record<string, unknown> } }).experimental?.tasks
  if (tasks !== undefined) {
    tasks.registerToolTask = () => {
      throw new Error('Task tools are not metered yet. Add metering for them before registering one.')
    }
  }

  Object.defineProperty(target, INSTALLED, { value: true })
}

function metered(server: McpServer, name: string, handler: Handler, options: MeterOptions): Handler {
  const free = isFreeTool(name)

  const wrapper = async (...args: unknown[]): Promise<unknown> => {
    const now = options.now?.() ?? new Date()
    const month = usageMonth(now)

    const account = await resolve(options)

    // 1. The limit. Free tools skip it: they must work at the limit.
    let plan: Plan | undefined
    let industry: Industry | undefined
    if (!free && account !== undefined) {
      try {
        const usage = await account.usage(month)
        plan = planOf(usage.plan)
        industry = industryOf(usage.industry)
        const decision = meterCall({ plan, callsBefore: usage.calls, callsAfter: usage.calls + 1, noticesShown: usage.noticesShown })
        if (!decision.allowed) {
          // Logged as refused but not counted: the month already shows the allowance used.
          const facts = { plan, industry }
          await record(server, account, options, name, month, false, { ok: false, errorCode: 'USAGE_LIMIT_REACHED' }, 0, facts)
          track(options, account, 'limit_reached', { tool: name, transport: options.transport, ...facts })
          return { content: [{ type: 'text', text: limitMessage({ callsUsed: usage.calls, now, upgradeUrl: options.upgradeUrl }) }] }
        }
      } catch (error) {
        options.log('mcp.usage.read_failed', `usage for ${name} could not be read; the call runs (fail open)`, error)
      }
    }

    // 2. The tool itself.
    const started = performance.now()
    let result: unknown
    let thrown: { error: unknown } | undefined
    try {
      result = await handler(...args)
    } catch (error) {
      thrown = { error }
    }
    const durationMs = performance.now() - started
    const outcome = thrown !== undefined ? { ok: false, errorCode: 'UNKNOWN' } : outcomeOf(result)

    // 3 and 4. Record, count, and say so when a threshold was crossed.
    let notice: string | undefined
    if (account !== undefined) {
      const counted = await record(server, account, options, name, month, !free, outcome, durationMs, { plan, industry })
      // No plan means the read above failed: without it a notice could be wrong, so none is shown.
      if (counted !== null && plan !== undefined) {
        const decision = meterCall({
          plan,
          callsBefore: counted.calls - 1,
          callsAfter: counted.calls,
          noticesShown: counted.noticesShown,
          upgradeUrl: options.upgradeUrl,
        })
        notice = decision.notice
        const shown = decision.newlyShown.at(-1)
        // The threshold said, which is the highest crossed (plans.ts meterCall).
        if (shown !== undefined) track(options, account, 'limit_notice_shown', { threshold: shown, plan, industry })
        if (decision.newlyShown.length > 0) {
          try {
            await account.markNoticesShown(month, decision.newlyShown)
          } catch (error) {
            options.log('mcp.usage.notice_unsaved', 'a usage notice was shown but not saved', error)
          }
        }
      }
    }

    if (thrown !== undefined) throw thrown.error
    return notice === undefined ? result : withNotice(result, notice)
  }

  const mark: Metering = free ? 'free' : 'counted'
  Object.defineProperty(wrapper, METERED, { value: mark })
  return wrapper
}

async function resolve(options: MeterOptions): Promise<UsageAccount | undefined> {
  try {
    return await options.account()
  } catch (error) {
    options.log('mcp.usage.account_unresolved', 'no account to meter this call against; it runs unmetered', error)
    return undefined
  }
}

/** What metering knows about the account when it records a call, for analytics. */
interface AccountFacts {
  readonly plan: Plan | undefined
  readonly industry: Industry | undefined
}

/** The AI client for this call: from initialize, or the stateless fallback. */
export function clientOf(server: McpServer, options: Pick<MeterOptions, 'clientInfo'>): ClientInfo | undefined {
  return server.server.getClientVersion() ?? options.clientInfo?.()
}

/**
 * Sends one analytics event for this account. Never throws and never waits:
 * capture only queues. The analytics client checks the names and values
 * again (allow-list), so nothing here can leak an argument by mistake.
 */
export function track(
  options: Pick<MeterOptions, 'analytics'>,
  account: Pick<UsageAccount, 'tenantId'>,
  event: Parameters<Analytics['capture']>[0]['event'],
  properties: Parameters<Analytics['capture']>[0]['properties'],
): void {
  try {
    options.analytics?.capture({ event, tenantId: account.tenantId, ...(properties !== undefined ? { properties } : {}) })
  } catch {
    // capture never throws; this is for an injected fake or a future client that might.
  }
}

/**
 * Writes the call, and sends it to analytics as mcp_call. Never throws: a lost
 * record is logged, the call's result still goes back.
 */
async function record(
  server: McpServer,
  account: UsageAccount,
  options: MeterOptions,
  tool: string,
  month: string,
  count: boolean,
  outcome: { ok: boolean; errorCode?: string | undefined },
  durationMs: number,
  facts: AccountFacts,
): Promise<CountedMonth | null> {
  const client = clientOf(server, options)
  // Sent whether or not the database write below succeeds: analytics is a
  // separate, lossy channel, and a database outage is exactly when knowing
  // which calls failed matters.
  track(options, account, 'mcp_call', {
    tool,
    ok: outcome.ok,
    error_code: outcome.errorCode,
    duration_ms: Math.round(durationMs),
    client_name: client?.name?.slice(0, CLIENT_FIELD_MAX),
    client_version: client?.version?.slice(0, CLIENT_FIELD_MAX),
    transport: options.transport,
    plan: facts.plan,
    industry: facts.industry,
  })
  const call: ToolCallInput = {
    tool,
    ok: outcome.ok,
    durationMs,
    transport: options.transport,
    ...(outcome.errorCode !== undefined ? { errorCode: outcome.errorCode } : {}),
    ...(options.userId !== undefined ? { userId: options.userId } : {}),
    ...(client?.name !== undefined ? { clientName: client.name.slice(0, CLIENT_FIELD_MAX) } : {}),
    ...(client?.version !== undefined ? { clientVersion: client.version.slice(0, CLIENT_FIELD_MAX) } : {}),
  }
  try {
    return await account.recordToolCall(call, { month, count })
  } catch (error) {
    options.log('mcp.usage.record_failed', `the ${tool} call was not recorded or counted`, error)
    return null
  }
}

/**
 * Whether a tool's result was a failure, and its catalogue code.
 *
 * Every failure in this server starts with "[CODE]" from the catalogue
 * (callFailure, formatResolution), so the code is read from the first line
 * rather than each tool having to report it. Only a known code counts: a line
 * that merely starts with a bracket is not a failure.
 */
export function outcomeOf(result: unknown): { ok: boolean; errorCode?: string } {
  const r = result as ToolResult | undefined
  const first = r?.content?.find((c) => c.type === 'text')?.text?.trimStart() ?? ''
  const code = /^\[([A-Z][A-Z0-9_]*)\]/.exec(first)?.[1]
  if (code !== undefined && CODES.has(code)) return { ok: false, errorCode: code }
  // The ads tools' fallback for an unexpected throw, and the SDK's own error flag.
  if (r?.isError === true || first.startsWith('FAILED:')) return { ok: false, errorCode: 'UNKNOWN' }
  return { ok: true }
}

/**
 * Appends the notice to the result's last text, so a client that shows only
 * the text still shows it. A result with no text gets one.
 */
function withNotice(result: unknown, notice: string): unknown {
  const r = result as ToolResult | undefined
  const content = [...(r?.content ?? [])]
  const index = content.map((c) => c.type).lastIndexOf('text')
  if (index === -1) content.push({ type: 'text', text: notice })
  else content[index] = { ...content[index]!, text: `${content[index]!.text ?? ''}\n\n${notice}` }
  return { ...r, content }
}
