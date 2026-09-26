import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The policy layer — what an AI is allowed to execute on its own.
 *
 * Until this existed, the only thing between a model's mistake and a public post
 * was a sentence in a tool description asking it to confirm first. That is a
 * prompt, not a control: a prompt is advice to the very component you are trying
 * to constrain, and it fails exactly when the model is confused, which is the
 * case that matters.
 *
 * The rule (RULES.md R11) is **AI proposes, a deterministic validator
 * authorises**. So classification and limits live here, in code, and no part of
 * them can be talked out of a decision.
 *
 * ## How confirmation works, and why it is not just a boolean
 *
 * A `confirm: true` flag would be worthless — the model that decided to post
 * wrongly is the same one that would set the flag. Instead a high-risk call
 * returns a **summary plus a token derived from the exact payload**. Executing
 * requires echoing that token back. Because the token is an HMAC over the
 * canonical payload:
 *
 *   - a token cannot be invented without the server secret;
 *   - a token for *this* text does not authorise *different* text;
 *   - the human approved the summary that the token commits to.
 *
 * Changing so much as one character after approval invalidates it. That is the
 * property a boolean cannot give.
 */

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ActionPolicy {
  /** Why this action carries the risk it does, in words a person would use. */
  readonly rationale: string
  readonly risk: RiskLevel
  /** Whether the effect can be taken back once it has happened. */
  readonly reversible: boolean
  /** Whether it can cost money. */
  readonly spendsMoney: boolean
}

/**
 * Every action the system can take, and how dangerous it is.
 *
 * Unlisted actions are treated as **high** risk rather than low. An action
 * someone forgot to classify is far more likely to be new and unconsidered than
 * to be harmless, so the default has to fail closed. The test suite asserts this,
 * because it is the property that makes the whole layer trustworthy as the system
 * grows.
 */
export const ACTION_POLICY: Readonly<Record<string, ActionPolicy>> = {
  check_status: {
    rationale: 'Reads health and counts. Changes nothing.',
    risk: 'low',
    reversible: true,
    spendsMoney: false,
  },
  list_accounts: {
    rationale: 'Reads connected accounts. Changes nothing.',
    risk: 'low',
    reversible: true,
    spendsMoney: false,
  },
  list_posts: {
    rationale: 'Reads posts already created. Changes nothing.',
    risk: 'low',
    reversible: true,
    spendsMoney: false,
  },
  validate_post: {
    rationale: 'Checks a draft against platform limits without sending it.',
    risk: 'low',
    reversible: true,
    spendsMoney: false,
  },

  schedule_post: {
    rationale:
      'Queues something to publish later. Not yet public, and cancellable right up ' +
      'until the worker sends it — so a mistake here is recoverable in a way that ' +
      'publishing is not.',
    risk: 'medium',
    reversible: true,
    spendsMoney: false,
  },
  cancel_scheduled_post: {
    rationale:
      'Stops a post going out. The damage from a wrong cancellation is a post that ' +
      'did not happen, which can be redone.',
    risk: 'medium',
    reversible: true,
    spendsMoney: false,
  },

  publish_post: {
    rationale:
      'Puts content in front of the public under someone’s name, immediately and ' +
      'permanently. Deleting it afterwards does not unsee it, and on some platforms ' +
      'does not remove it from feeds that already pulled it.',
    risk: 'high',
    reversible: false,
    spendsMoney: false,
  },
}

/** Fails closed: an action nobody classified is treated as the most dangerous kind. */
export function policyFor(action: string): ActionPolicy {
  return (
    ACTION_POLICY[action] ?? {
      rationale:
        `"${action}" has no policy entry, so it is treated as high risk. Classify it in ` +
        'policy.ts rather than relying on this default.',
      risk: 'high',
      reversible: false,
      spendsMoney: true,
    }
  )
}

/**
 * A stable string for a payload, so the same request always yields the same
 * token.
 *
 * Object key order must not matter: two callers describing the same post with
 * keys in a different order are making the same request, and would otherwise get
 * tokens that do not match their own approval.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`
}

/**
 * The secret that makes a confirmation unforgeable.
 *
 * Generated per process rather than configured. That is deliberate: tokens do not
 * survive a restart, so an approval cannot be replayed days later against a system
 * that has moved on. An approval is meant to be acted on now.
 */
let secret: Buffer | undefined

export function confirmationSecret(): Buffer {
  if (secret === undefined) secret = randomBytes(32)
  return secret
}

/** Only for tests, which need a known secret to assert against. */
export function setConfirmationSecret(value: Buffer): void {
  secret = value
}

export function confirmationToken(action: string, payload: unknown): string {
  return createHmac('sha256', confirmationSecret())
    .update(`${action}\u0000${canonicalise(payload)}`)
    .digest('base64url')
}

/**
 * Constant-time comparison.
 *
 * The timing difference on a 43-character token is not a realistic attack here,
 * but a credential check that leaks position is the kind of thing that gets
 * copied into somewhere it does matter.
 */
export function confirmationMatches(
  action: string,
  payload: unknown,
  provided: string | undefined,
): boolean {
  if (provided === undefined || provided === '') return false
  const expected = Buffer.from(confirmationToken(action, payload))
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export type PolicyDecision =
  | { readonly allowed: true; readonly risk: RiskLevel }
  | {
      readonly allowed: false
      readonly risk: RiskLevel
      /** What the person is being asked to approve, in full. */
      readonly summary: string
      /** Echo this back to execute. Only valid for this exact payload. */
      readonly token: string
    }

export interface DecideOptions {
  readonly action: string
  readonly payload: unknown
  /** A token returned by an earlier call, if this is the second attempt. */
  readonly confirmation?: string
  /** Human-readable description of what will happen, shown when approval is needed. */
  readonly describe: () => string
}

/**
 * The single decision point.
 *
 * Low and medium risk execute. High risk executes only when the caller echoes a
 * token matching this exact payload.
 */
export function decide(options: DecideOptions): PolicyDecision {
  const policy = policyFor(options.action)

  if (policy.risk !== 'high') return { allowed: true, risk: policy.risk }

  if (confirmationMatches(options.action, options.payload, options.confirmation)) {
    return { allowed: true, risk: policy.risk }
  }

  return {
    allowed: false,
    risk: policy.risk,
    summary: options.describe(),
    token: confirmationToken(options.action, options.payload),
  }
}

/**
 * The message a caller sees when approval is required.
 *
 * Written for the person, not the model: it states what will happen, why it is
 * being asked, and that nothing has happened yet. Per RULES.md R1, a refusal is
 * only useful if it says how to proceed.
 */
export function formatApprovalRequest(decision: Extract<PolicyDecision, { allowed: false }>): string {
  return [
    'APPROVAL NEEDED — nothing has been sent.',
    '',
    decision.summary,
    '',
    'This is public and cannot be undone. Show the above to the user and ask them to',
    'confirm. If they approve, call this tool again with everything identical plus:',
    '',
    `  confirm: "${decision.token}"`,
    '',
    'The token covers this exact content. Changing any of it invalidates the token,',
    'and a new approval will be required.',
  ].join('\n')
}

/**
 * A spend ceiling, checked before anything that can cost money.
 *
 * Defined now and used by nothing, because no ads code exists yet. It is here
 * rather than waiting so that the first ads adapter has an obvious place to call
 * rather than an excuse to invent its own — the ordering mistake that tier 5b
 * exists to avoid.
 *
 * Amounts are in minor units (cents), never floats: 0.1 + 0.2 is not 0.3, and
 * budgets are exactly where that matters.
 */
export interface SpendLimit {
  readonly dailyMaxMinor: number
  readonly monthlyMaxMinor: number
  readonly currency: string
}

export type SpendCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export function checkSpend(
  limit: SpendLimit,
  request: { readonly dailyMinor: number; readonly currency: string },
  alreadyCommittedDailyMinor = 0,
): SpendCheck {
  if (request.currency !== limit.currency) {
    // Refused rather than converted: a wrong exchange rate silently multiplies a
    // budget, and this layer exists to make that impossible rather than unlikely.
    return {
      ok: false,
      reason: `Budget is in ${request.currency} but the limit is set in ${limit.currency}. No conversion is applied here.`,
    }
  }
  if (request.dailyMinor <= 0) {
    return { ok: false, reason: 'A daily budget must be greater than zero.' }
  }

  const total = alreadyCommittedDailyMinor + request.dailyMinor
  if (total > limit.dailyMaxMinor) {
    return {
      ok: false,
      reason:
        `This would take daily spend to ${format(total, limit.currency)}, over the ` +
        `limit of ${format(limit.dailyMaxMinor, limit.currency)}.`,
    }
  }
  if (total * 30 > limit.monthlyMaxMinor) {
    return {
      ok: false,
      reason:
        `At ${format(total, limit.currency)} per day this runs to about ` +
        `${format(total * 30, limit.currency)} a month, over the limit of ` +
        `${format(limit.monthlyMaxMinor, limit.currency)}.`,
    }
  }
  return { ok: true }
}

function format(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`
}
