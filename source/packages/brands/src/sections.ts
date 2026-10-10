import type { Brand } from './types.ts'

/**
 * The sections every brand is documented in, in reading order.
 *
 * One list drives three things, so they cannot disagree: the headings
 * guidelines.md must have, the parts get_brand can return on their own, and
 * the viewer's sidebar.
 */
export const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'colours', title: 'Colours' },
  { id: 'typography', title: 'Typography' },
  { id: 'logo', title: 'Logo' },
  { id: 'layout-spacing', title: 'Layout and spacing' },
  { id: 'components', title: 'Components' },
  { id: 'imagery', title: 'Imagery and icons' },
  { id: 'voice', title: 'Voice and copy' },
  { id: 'ad-creatives', title: 'Ad creatives' },
  { id: 'social-templates', title: 'Social templates' },
  { id: 'downloads', title: 'Downloads' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id)

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value)
}

/** The tokens that belong to one section, as get_brand returns them. */
export function tokensFor(brand: Brand, section: SectionId): Record<string, unknown> {
  switch (section) {
    case 'overview':
      return {
        slug: brand.slug,
        name: brand.name,
        status: brand.status,
        version: brand.version,
        updated: brand.updated,
        summary: brand.summary,
        approval: brand.approval,
        sources: brand.sources,
      }
    case 'colours':
      return { colors: brand.colors, contrastPairs: brand.contrastPairs, gradients: brand.gradients }
    case 'typography':
      return { typography: brand.typography }
    case 'logo':
      return { logo: brand.logo }
    case 'layout-spacing':
      return { spacing: brand.spacing, radii: brand.radii, shadows: brand.shadows, layout: brand.layout }
    case 'components':
      return { components: brand.components, ...(brand.motion !== undefined ? { motion: brand.motion } : {}) }
    case 'imagery':
      return { imagery: brand.imagery, icons: brand.icons }
    case 'voice':
      return { voice: brand.voice }
    case 'ad-creatives':
      return { adCreatives: brand.adCreatives }
    case 'social-templates':
      return { socialTemplates: brand.socialTemplates, placements: brand.adCreatives.placements }
    case 'downloads':
      return {
        logoFiles: brand.logo.files.map((f) => ({ id: f.id, path: f.path, use: f.use })),
        fonts: brand.typography.families.map((f) => ({ name: f.name, files: f.files.map((x) => x.path), licence: f.licence })),
      }
  }
}
