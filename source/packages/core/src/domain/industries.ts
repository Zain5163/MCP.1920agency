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
 * Not stored yet. `tenants.industry` is the next migration and needs the
 * owner's approval; until it exists no tenant has an industry and events go out
 * without one. The analytics code already accepts it (packages/telemetry
 * analytics.ts), so it starts flowing as soon as the column is read.
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
