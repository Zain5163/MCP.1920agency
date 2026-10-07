/**
 * Plans and usage metering: the rules, with no I/O.
 *
 * Decision 0009: Free is 200 MCP calls a month, reset on the 1st (UTC); Premium
 * is $9 a month and unlimited (a fair-use limit comes later, from real data).
 * Every tool call counts, successful or not, except the free account tools, so a
 * user at the limit can always see where they stand and how to upgrade.
 *
 * Kept pure so the numbers that decide whether a customer's call runs are
 * tested without a database, and so both transports read the same rules. The
 * MCP wrapper (apps/mcp/src/metering.ts) does the reading and writing.
 */

export const PLANS = ['free', 'premium'] as const
export type Plan = (typeof PLANS)[number]

/** Calls a Free account gets each calendar month (UTC). */
export const FREE_MONTHLY_CALLS = 200

/**
 * The percentages of the Free allowance at which a call's result carries a
 * notice. Dense near the end on purpose: that is when a user is deciding.
 */
export const USAGE_NOTICE_THRESHOLDS: readonly number[] = [25, 50, 75, 85, 90, 95, 99]

export const PREMIUM_PRICE = '$9/month'

/**
 * Tools that are never counted and never blocked. A user at the limit must
 * still be able to ask where they stand and how to upgrade, or the limit
 * message would be the last thing the product could ever say to them.
 *
 * set_business_type is free for a different reason: the AI asks for it on our
 * behalf (it serves our analytics, not the user's task), so it must not cost
 * the user one of their calls.
 */
export const FREE_TOOLS: readonly string[] = ['check_usage', 'upgrade', 'set_business_type']

export function isFreeTool(name: string): boolean {
  return FREE_TOOLS.includes(name)
}

/**
 * Reads a stored plan. Anything that is not exactly Premium is Free: an
 * unreadable value must not hand out unlimited use.
 */
export function planOf(value: unknown): Plan {
  return value === 'premium' ? 'premium' : 'free'
}

/** Premium is never blocked and never shown a notice. */
export function isUnlimited(plan: Plan): boolean {
  return plan === 'premium'
}

/** The usage month a moment falls in, as 'YYYY-MM' in UTC. */
export function usageMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** When the Free allowance resets: 00:00 UTC on the 1st of the next month. */
export function resetDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * '1 November 2026'. Spelled out rather than ISO because it is read by a
 * person, and built by hand rather than with toLocaleDateString so the text
 * does not depend on the machine's locale data.
 */
export function formatDay(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * Where to send someone who wants Premium.
 *
 * Only an https link is used: the value comes from configuration, and a typo
 * there must not put a broken or unsafe link in front of every customer.
 * Until checkout exists there may be no link at all, and the text says so
 * instead of inventing one.
 */
export function upgradeTarget(upgradeUrl: string | undefined): string {
  if (upgradeUrl !== undefined && /^https:\/\/\S+$/.test(upgradeUrl.trim())) return upgradeUrl.trim()
  return 'checkout is not open yet, so ask your AdsPilot contact to put you on the waitlist'
}

/** The call count at which a threshold is crossed: 90% of 200 is the 180th call. */
function thresholdCalls(percent: number, allowance: number): number {
  return Math.ceil((allowance * percent) / 100)
}

export interface MeterInput {
  readonly plan: Plan
  /** This month's counted calls before this one. */
  readonly callsBefore: number
  /** This month's counted calls including this one. */
  readonly callsAfter: number
  /** Thresholds already shown this month, so each is shown once. */
  readonly noticesShown: readonly number[]
  readonly upgradeUrl?: string | undefined
  readonly allowance?: number
}

export interface MeterDecision {
  /** Whether the call may run. Decided on callsBefore: the 200th call runs, the 201st does not. */
  readonly allowed: boolean
  /** The text to append to this call's result, when it crossed a threshold. */
  readonly notice?: string
  /** Thresholds to record as shown. */
  readonly newlyShown: number[]
}

/**
 * Whether a call may run, and which notice its result carries.
 *
 * A threshold is shown when this call is the one that crosses it and it has
 * not been shown this month. Crossing, rather than "at or above", is what makes
 * a notice appear once: only one call can move the count past a given number.
 * If one call ever crossed several (a count corrected by hand), all are marked
 * shown and only the highest is said, since the lower ones are already stale.
 */
export function meterCall(input: MeterInput): MeterDecision {
  const allowance = input.allowance ?? FREE_MONTHLY_CALLS
  if (isUnlimited(input.plan)) return { allowed: true, newlyShown: [] }

  const allowed = input.callsBefore < allowance
  if (!allowed) return { allowed, newlyShown: [] }

  const newlyShown = USAGE_NOTICE_THRESHOLDS.filter((percent) => {
    const at = thresholdCalls(percent, allowance)
    return input.callsBefore < at && input.callsAfter >= at && !input.noticesShown.includes(percent)
  })
  const highest = newlyShown.at(-1)
  if (highest === undefined) return { allowed, newlyShown }

  return {
    allowed,
    newlyShown,
    notice: usageNotice(highest, input.callsAfter, allowance, input.upgradeUrl),
  }
}

/**
 * The notice a crossing call carries. Wording from decision 0009, so the AI
 * relaying it has a sentence it can pass on as it is.
 */
export function usageNotice(percent: number, callsUsed: number, allowance: number, upgradeUrl: string | undefined): string {
  return (
    `USAGE NOTICE: You've used ${percent}% of your free calls this month (${callsUsed} of ${allowance}). ` +
    `Premium is ${PREMIUM_PRICE} for unlimited use: ${upgradeTarget(upgradeUrl)}.`
  )
}

/**
 * What a Free call returns at 100%, instead of doing any work.
 *
 * Carries a catalogue code like every other failure (USAGE_LIMIT_REACHED in
 * resolutions.ts), so the call is recorded and counted as that, and an AI reading
 * it knows retrying will not help.
 */
export function limitMessage(input: {
  readonly callsUsed: number
  readonly now: Date
  readonly upgradeUrl?: string | undefined
  readonly allowance?: number
}): string {
  const allowance = input.allowance ?? FREE_MONTHLY_CALLS
  return [
    `[USAGE_LIMIT_REACHED] You've used all ${allowance} of your free calls this month ` +
      `(${input.callsUsed} of ${allowance}), so this request was not carried out.`,
    `Your free calls reset on ${formatDay(resetDate(input.now))} (UTC).`,
    `Premium is ${PREMIUM_PRICE} for unlimited use: ${upgradeTarget(input.upgradeUrl)}.`,
    'check_usage and upgrade still work.',
  ].join('\n')
}

/** What check_usage says. */
export function usageSummary(input: {
  readonly plan: Plan
  readonly callsUsed: number
  readonly now: Date
  readonly planRenewsAt?: Date | null | undefined
  readonly upgradeUrl?: string | undefined
  readonly allowance?: number
}): string {
  if (isUnlimited(input.plan)) {
    const lines = ['Plan: Premium (unlimited use, fair use applies)', `Calls this month: ${input.callsUsed}`]
    if (input.planRenewsAt !== undefined && input.planRenewsAt !== null) {
      lines.push(`Renews: ${formatDay(input.planRenewsAt)}`)
    }
    return lines.join('\n')
  }

  const allowance = input.allowance ?? FREE_MONTHLY_CALLS
  const left = Math.max(0, allowance - input.callsUsed)
  return [
    `Plan: Free (${allowance} calls a month)`,
    `Calls this month: ${input.callsUsed} of ${allowance} (${left} left)`,
    `Resets: ${formatDay(resetDate(input.now))} (UTC)`,
    `Premium is ${PREMIUM_PRICE} for unlimited use: ${upgradeTarget(input.upgradeUrl)}.`,
  ].join('\n')
}

/** What the upgrade tool says. */
export function upgradeMessage(plan: Plan | undefined, upgradeUrl: string | undefined): string {
  if (plan !== undefined && isUnlimited(plan)) {
    return 'This account is already on Premium: unlimited use, nothing to upgrade.'
  }
  return [
    `Premium is ${PREMIUM_PRICE}: unlimited calls to every AdsPilot service, now and in future.`,
    `To upgrade: ${upgradeTarget(upgradeUrl)}.`,
  ].join('\n')
}
