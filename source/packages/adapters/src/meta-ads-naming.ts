/**
 * Naming and attribution for Meta ads.
 *
 * Consistent names are not cosmetic. They are what makes a report readable six
 * months later, and what lets a rule or a script find the right object without
 * guessing. An account full of "Campaign 1 - Copy (2)" cannot be reasoned about
 * by a person or by an AI.
 */

const NON_SLUG = /[^a-z0-9]+/g

/**
 * Meta's dynamic URL parameters, filled by Meta **at click time**, not by us.
 *
 * The doubled braces are literal: what Meta expects to receive is
 * `{{campaign.name}}`, so the string must survive intact rather than being
 * interpolated on our side. Substituting our own values here would freeze the
 * names at creation time and break the moment anything is renamed.
 *
 * The payoff is that campaign, ad set and ad names flow straight into GA4 and
 * Shopify without anyone maintaining a mapping.
 */
export const META_UTM_TEMPLATE =
  'utm_source=facebook' +
  '&utm_medium=paid_social' +
  '&utm_campaign={{campaign.name}}' +
  '&utm_content={{adset.name}}' +
  '&utm_term={{ad.name}}' +
  '&utm_id={{campaign.id}}'

export function slug(text: string, maxLength = 40): string {
  return text
    .trim()
    .toLowerCase()
    .replace(NON_SLUG, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '')
}

/** `OUTCOME_SALES` reads as `SALES` in a name; the prefix is noise in every row. */
function shortObjective(objective: string): string {
  return objective.replace('OUTCOME_', '') || 'UNSPEC'
}

export interface NamingTemplates {
  readonly campaign: string
  readonly adSet: string
  readonly ad: string
}

export const META_DEFAULT_NAMING: NamingTemplates = {
  campaign: '{objective}|{name}|{date}',
  adSet: '{audience}|{country}|{optimization}',
  ad: '{concept}|{format}|{iteration}',
}

/** `today` is injectable so a name is testable without freezing the clock. */
export function campaignName(
  template: string,
  briefName: string,
  objective: string,
  today: Date = new Date(),
): string {
  return template
    .replace('{objective}', shortObjective(objective))
    .replace('{name}', slug(briefName))
    .replace('{date}', today.toISOString().slice(0, 10))
}

export function adSetName(
  template: string,
  options: {
    readonly given?: string
    readonly countries: readonly string[]
    readonly interests?: readonly string[]
    readonly optimizationGoal?: string
  },
): string {
  if (options.given !== undefined && options.given.trim() !== '') return options.given

  // "broad" and "targeted" are the distinction that actually matters when
  // reading a report: it is the first thing you want to compare.
  const audience = (options.interests?.length ?? 0) > 0 ? 'targeted' : 'broad'

  return template
    .replace('{audience}', audience)
    .replace('{country}', options.countries.join('-') || 'unset')
    .replace('{optimization}', options.optimizationGoal ?? 'unset')
}

export function adName(
  template: string,
  options: { readonly given?: string; readonly headline?: string; readonly kind?: string; readonly index: number },
): string {
  if (options.given !== undefined && options.given.trim() !== '') return options.given

  return template
    .replace('{concept}', slug(options.headline ?? `concept-${options.index + 1}`, 30))
    .replace('{format}', options.kind ?? 'unknown')
    .replace('{iteration}', `v${options.index + 1}`)
}

/**
 * Attribution tags for an ad's destination URL.
 *
 * An explicit value wins, including an explicit empty string — that is someone
 * deliberately turning attribution off, and overriding it would be ignoring a
 * decision. Otherwise the dynamic template is used, so names flow into analytics
 * without anyone thinking about it.
 */
export function urlTags(explicit: string | undefined): string {
  return explicit ?? META_UTM_TEMPLATE
}
