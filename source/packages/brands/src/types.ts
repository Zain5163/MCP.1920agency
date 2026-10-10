/**
 * The shape of one brand's design system, as stored in brands/<slug>/brand.json.
 *
 * schema/brand.schema.json is the contract for the file; these types mirror it
 * for the code that reads it. The schema is what a file is validated against
 * (validate.ts), so a field added here and not there fails the tests rather
 * than drifting quietly.
 *
 * Every value carries a `source`: the id of an entry in `sources`. That is how
 * an imported value says where it came from, and how a value nobody has
 * approved yet says so: its source has kind "proposed".
 */

export type SourceKind = 'file' | 'live' | 'owner' | 'proposed'

export interface BrandSource {
  readonly id: string
  readonly kind: SourceKind
  /** A workspace path, a URL, or for "proposed" what the proposal is based on. */
  readonly ref: string
  /** YYYY-MM-DD the source was read. */
  readonly checked: string
  readonly note?: string
}

export interface BrandColor {
  readonly id: string
  readonly name: string
  /** #RRGGBB, upper case. */
  readonly hex: string
  readonly role: string
  readonly use: string
  readonly source: string
}

/**
 * How a foreground/background pair may be used, and so which WCAG 2.2 minimum
 * it must meet: text 4.5:1 (1.4.3), large-text and ui 3:1 (1.4.3, 1.4.11).
 * "decorative" has no minimum and must never carry meaning; "avoid" is a pair
 * the brand forbids, recorded so the rule is visible and checked to really fail.
 */
export type PairUse = 'text' | 'large-text' | 'ui' | 'decorative' | 'avoid'

export interface ContrastPair {
  readonly fg: string
  readonly bg: string
  readonly use: PairUse
  readonly note?: string
  /** The ratio the source document states, checked against the computed one. */
  readonly documentedRatio?: number
  readonly source: string
}

export interface Gradient {
  readonly id: string
  readonly name: string
  readonly css: string
  readonly use: string
  readonly source: string
}

export interface FontFile {
  /** Relative to the brand folder. */
  readonly path: string
  /** CSS font-weight: "400", or a variable range such as "200 800". */
  readonly weight: string
  readonly style: 'normal' | 'italic'
  readonly format: 'woff2' | 'woff' | 'truetype'
}

export interface FontLicence {
  readonly name: string
  /** The licence text shipped beside the font, relative to the brand folder. */
  readonly file?: string
  readonly url?: string
  readonly notes: string
}

export interface FontFamily {
  readonly id: string
  readonly name: string
  readonly role: string
  /** The CSS font-family list to use, fallbacks included. */
  readonly stack: string
  readonly files: readonly FontFile[]
  readonly licence: FontLicence
  readonly source: string
}

export interface TypeRole {
  readonly id: string
  readonly role: string
  readonly family: string
  readonly size: string
  readonly sizeMobile?: string
  readonly weight: string
  readonly lineHeight: string
  readonly tracking?: string
  readonly transform?: 'none' | 'uppercase' | 'capitalize'
  /** The sample sentence shown in the viewer. */
  readonly sample: string
  readonly source: string
}

export interface Typography {
  readonly families: readonly FontFamily[]
  readonly scale: readonly TypeRole[]
  readonly rules: readonly string[]
}

export interface Spacing {
  readonly unitPx: number
  readonly scalePx: readonly number[]
  readonly rules: readonly string[]
  readonly source: string
}

export interface Radius {
  readonly id: string
  readonly px: number
  readonly use: string
  readonly source: string
}

export interface Shadow {
  readonly id: string
  readonly css: string
  readonly use: string
  readonly source: string
}

export interface Layout {
  readonly maxWidthPx: number
  readonly gutters: string
  readonly breakpointsPx: readonly number[]
  readonly grid: string
  readonly rules: readonly string[]
  readonly source: string
}

export interface LogoFile {
  readonly id: string
  readonly name: string
  /** Relative to the brand folder. */
  readonly path: string
  readonly format: 'png' | 'webp' | 'svg' | 'jpeg'
  readonly widthPx: number
  readonly heightPx: number
  /** Of the file as copied; a test fails if the file stops matching. */
  readonly sha256: string
  /** Which backgrounds the artwork was made for. */
  readonly background: 'dark' | 'light' | 'any'
  readonly use: string
  readonly source: string
}

export interface Logo {
  readonly files: readonly LogoFile[]
  /**
   * Only where no logo exists yet: a plain text stand-in, never designed to
   * look like a logo. The viewer labels it as a placeholder.
   */
  readonly placeholder?: { readonly text: string; readonly note: string }
  readonly clearSpace: string
  /** Fraction of the logo's height drawn as clear space in the viewer diagram. */
  readonly clearSpaceRatio: number
  readonly minSize: { readonly digitalPx: number; readonly note: string }
  readonly do: readonly string[]
  readonly dont: readonly string[]
  readonly licence: string
  readonly source: string
}

export interface Imagery {
  readonly style: string
  readonly do: readonly string[]
  readonly dont: readonly string[]
  readonly source: string
}

export interface Icons {
  readonly style: string
  readonly rules: readonly string[]
  readonly source: string
}

export interface Voice {
  readonly personality: readonly string[]
  readonly rules: readonly string[]
  readonly examples: ReadonlyArray<{ readonly say: string; readonly avoid: string }>
  /** Words that must never appear on a creative (a working product name, for example). */
  readonly neverOnCreative: readonly string[]
  readonly source: string
}

export interface Placement {
  readonly id: string
  readonly name: string
  readonly ratio: string
  readonly widthPx: number
  readonly heightPx: number
  /** Keep essential text and the logo inside these margins. */
  readonly safeZonePx: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
  readonly rules: readonly string[]
  readonly source: string
}

/** How the viewer draws the sample ad and post: references into this brand's tokens. */
export interface CreativeStyle {
  /** A colour id or a gradient id. */
  readonly background: string
  readonly text: string
  readonly accent: string
  readonly muted: string
  readonly headlineFamily: string
  readonly bodyFamily: string
  readonly headlineWeight: string
  readonly headlineTransform?: 'none' | 'uppercase' | 'capitalize'
  /** A logo file id, or null when the brand has no logo yet. */
  readonly logo: string | null
  /** A colour id to put behind the logo, when the artwork needs a field (e.g. a dark logo on a dark ad). */
  readonly logoField?: string
  readonly logoPosition: 'top' | 'bottom'
  readonly ctaBackground: string
  readonly ctaText: string
  readonly ctaRadiusPx: number
}

export interface CreativeSample {
  readonly eyebrow?: string
  readonly headline: string
  /** One phrase inside the headline drawn in the accent (or the brand gradient). */
  readonly emphasis?: string
  readonly emphasisGradient?: string
  readonly body?: string
  readonly price?: string
  readonly cta: string
  readonly note: string
  readonly source: string
}

export interface AdCreatives {
  readonly rules: readonly string[]
  readonly placements: readonly Placement[]
  readonly style: CreativeStyle
  readonly sample: CreativeSample
}

export interface SocialTemplate {
  readonly id: string
  readonly name: string
  /** A placement id. */
  readonly format: string
  readonly purpose: string
  readonly structure: readonly string[]
  readonly rules: readonly string[]
  readonly source: string
}

export type ComponentKind = 'button-primary' | 'button-secondary' | 'card' | 'chip' | 'input' | 'link' | 'badge'

export interface ComponentStyle {
  /** Colour or gradient id. */
  readonly background?: string
  readonly color: string
  /** A colour id for a 1px border, or a literal CSS border. */
  readonly border?: string
  readonly radiusPx: number
  readonly padding?: string
  readonly fontWeight?: string
  readonly fontSizePx?: number
  readonly family?: string
  readonly shadow?: string
  readonly transform?: 'none' | 'uppercase' | 'capitalize'
  readonly letterSpacing?: string
  readonly minHeightPx?: number
}

export interface Component {
  readonly id: string
  readonly kind: ComponentKind
  readonly name: string
  readonly label: string
  readonly spec: string
  /** Which surface the specimen sits on: a colour id. */
  readonly surface: string
  readonly style: ComponentStyle
  readonly rules: readonly string[]
  readonly source: string
}

export interface Ownership {
  /**
   * "owner" (the agency owner's own tenant, configured per server) or a tenant
   * id. Only that tenant can list, read or view the brand.
   */
  readonly tenant: string
  readonly note: string
}

export interface Approval {
  readonly approvers: readonly string[]
  readonly rule: string
}

export interface Brand {
  readonly $schema?: string
  readonly schemaVersion: 1
  readonly slug: string
  readonly name: string
  /** When set, the display name is read from this product setting (the name is not final). */
  readonly nameSetting?: 'productName'
  readonly status: 'imported' | 'proposed' | 'mixed'
  readonly version: string
  readonly updated: string
  readonly summary: string
  readonly ownership: Ownership
  readonly approval: Approval
  readonly sources: readonly BrandSource[]
  readonly colors: readonly BrandColor[]
  readonly contrastPairs: readonly ContrastPair[]
  readonly gradients: readonly Gradient[]
  readonly typography: Typography
  readonly spacing: Spacing
  readonly radii: readonly Radius[]
  readonly shadows: readonly Shadow[]
  readonly layout: Layout
  readonly logo: Logo
  readonly imagery: Imagery
  readonly icons: Icons
  readonly voice: Voice
  readonly adCreatives: AdCreatives
  readonly socialTemplates: readonly SocialTemplate[]
  readonly components: readonly Component[]
  readonly motion?: { readonly rules: readonly string[]; readonly source: string }
}
