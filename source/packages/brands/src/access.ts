import type { LoadedBrand } from './load.ts'
import type { Brand } from './types.ts'

/**
 * Which tenant may see which brand.
 *
 * A brand's ownership is stored in its own metadata (brand.json `ownership.tenant`):
 * either a tenant id, or "owner", which means the agency owner's tenant on this
 * server. "owner" is resolved per server from configuration (BRANDS_OWNER_TENANT_ID)
 * rather than written into the repository, because the same files serve every
 * environment and a tenant id is not something the code should hard-wire.
 *
 * Fail closed: with no owner tenant configured, an "owner" brand belongs to
 * nobody, so no tenant can list, read or view it.
 */

export interface BrandViewer {
  /** The tenant asking. */
  readonly tenantId: string
  /** This server's owner tenant, from configuration; undefined means none. */
  readonly ownerTenantId?: string | undefined
}

export function ownerTenantOf(brand: Brand, ownerTenantId: string | undefined): string | undefined {
  if (brand.ownership.tenant !== 'owner') return brand.ownership.tenant
  const owner = ownerTenantId?.trim()
  return owner === undefined || owner === '' ? undefined : owner
}

export function canSee(brand: Brand, viewer: BrandViewer): boolean {
  const owner = ownerTenantOf(brand, viewer.ownerTenantId)
  return owner !== undefined && viewer.tenantId !== '' && owner === viewer.tenantId
}

/** The brands this tenant owns, in slug order. Another tenant's brands are simply absent. */
export function brandsFor(all: ReadonlyMap<string, LoadedBrand>, viewer: BrandViewer): LoadedBrand[] {
  return [...all.values()].filter((b) => canSee(b.brand, viewer))
}

/**
 * One brand, only if this tenant owns it. A brand that exists but belongs to
 * someone else is reported exactly like one that does not exist, so a caller
 * cannot learn other tenants' brand names by guessing.
 */
export function brandFor(all: ReadonlyMap<string, LoadedBrand>, slug: string, viewer: BrandViewer): LoadedBrand | undefined {
  const found = all.get(slug)
  return found !== undefined && canSee(found.brand, viewer) ? found : undefined
}
