/**
 * Industry categories: what kind of business a tenant is.
 *
 * Phase 2 of the plans/analytics plan (architecture/2026-10-08-plans-usage-
 * analytics-hosting.md): every analytics event carries the tenant's industry, so
 * usage and results can be read per industry and the playbooks tuned per
 * industry (Phase 5).
 *
 * WHY a closed list rather than free text: an industry is counted and grouped,
 * and free text splits one industry into many spellings ("dentist", "Dental
 * clinic", "dentistry"). It also keeps a customer's own description of their
 * business out of analytics: only one of these fixed words ever leaves the
 * process. 'other' catches everything else until the data shows a new category
 * is worth adding.
 *
 * Stored in `tenants.industry` (migration 20261008160000_add_tenant_industry,
 * whose CHECK constraint repeats this list; a test keeps the two in step). The
 * user picks one through the free set_business_type tool; until then the
 * tenant has none and events go out without one.
 */
export const INDUSTRIES = ['dentist', 'education', 'real_estate', 'ecommerce', 'tool_website', 'agency', 'other'] as const
export type Industry = (typeof INDUSTRIES)[number]

/**
 * Reads a stored or supplied industry. Anything not on the list is no
 * industry at all, rather than 'other': an unreadable value is unknown, and
 * calling it 'other' would quietly inflate that bucket.
 */
export function industryOf(value: unknown): Industry | undefined {
  return typeof value === 'string' && (INDUSTRIES as readonly string[]).includes(value) ? (value as Industry) : undefined
}

/**
 * How each industry is said to a person. A Record over Industry, so adding a
 * code without a label fails the typecheck.
 */
export const INDUSTRY_LABELS: Readonly<Record<Industry, string>> = {
  dentist: 'Dentist',
  education: 'Education',
  real_estate: 'Real estate',
  ecommerce: 'E-commerce',
  tool_website: 'Tool website',
  agency: 'Agency',
  other: 'Other',
}

/**
 * The check_usage line. "not set" is said plainly, because the server
 * instructions tell the AI to ask the user when it reads exactly that.
 */
export function businessTypeLine(industry: Industry | undefined): string {
  return `Business type: ${industry === undefined ? 'not set' : INDUSTRY_LABELS[industry]}`
}
