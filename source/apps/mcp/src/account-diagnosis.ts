/**
 * Account turnaround maths: why a Meta ad account's cost per sale changed, and what a
 * sale can cost before the business loses money.
 *
 * Built from a real turnaround (PK footwear, COD, 2026-10-09): a 9-month decline where
 * cost per purchase rose 2.2× was fully explained by three funnel steps, and the
 * business's real costs moved the break-even far from the target everyone assumed.
 * Pure functions; the tools in performance-tools.ts fetch the data.
 *
 * Cost per purchase = CPM ÷ (1,000 × link CTR × page views per click × add-to-cart rate
 * × purchase rate). So the change in cost per purchase between two periods is the product
 * of each step's change, and the steps can be ranked by how much each one moved it.
 */

export interface MonthFunnel {
  month: string
  spend: number
  impressions: number
  linkClicks: number
  landingPageViews: number
  addToCarts: number
  purchases: number
  revenue: number
  frequency: number
  /** Derived. Undefined where the denominator is zero. */
  cpm: number | undefined
  linkCtr: number | undefined
  pageViewsPerClick: number | undefined
  addToCartRate: number | undefined
  purchaseRate: number | undefined
  costPerPurchase: number | undefined
  roas: number | undefined
  averageOrder: number | undefined
}

const PURCHASE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']
const ADD_TO_CART = ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart', 'omni_add_to_cart']
const LANDING = ['landing_page_view', 'omni_landing_page_view']

function action(row: Record<string, unknown>, types: readonly string[], key = 'actions'): number {
  const list = (row[key] as Array<{ action_type: string; value: string }> | undefined) ?? []
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t)
    if (hit !== undefined) return Number(hit.value) || 0
  }
  return 0
}

const div = (a: number, b: number) => (b > 0 ? a / b : undefined)

/** One Insights row (account level, one month) as funnel numbers. */
export function toMonthFunnel(row: Record<string, unknown>): MonthFunnel {
  const spend = Number(row.spend) || 0
  const impressions = Number(row.impressions) || 0
  const linkClicks = Number(row.inline_link_clicks) || 0
  const landingPageViews = action(row, LANDING)
  const addToCarts = action(row, ADD_TO_CART)
  const purchases = action(row, PURCHASE)
  const revenue = action(row, PURCHASE, 'action_values')
  return {
    month: String(row.date_start ?? '').slice(0, 7),
    spend,
    impressions,
    linkClicks,
    landingPageViews,
    addToCarts,
    purchases,
    revenue,
    frequency: Number(row.frequency) || 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : undefined,
    linkCtr: div(linkClicks, impressions),
    pageViewsPerClick: div(landingPageViews, linkClicks),
    addToCartRate: div(addToCarts, landingPageViews),
    purchaseRate: div(purchases, addToCarts),
    costPerPurchase: div(spend, purchases),
    roas: div(revenue, spend),
    averageOrder: div(revenue, purchases),
  }
}

/** The month with the lowest cost per purchase among months with enough purchases. */
export function bestMonth(months: readonly MonthFunnel[], minPurchases: number): MonthFunnel | undefined {
  return months
    .filter((m) => m.purchases >= minPurchases && m.costPerPurchase !== undefined)
    .sort((a, b) => a.costPerPurchase! - b.costPerPurchase!)[0]
}

export interface StepChange {
  step: 'cpm' | 'linkCtr' | 'pageViewsPerClick' | 'addToCartRate' | 'purchaseRate'
  label: string
  before: number
  after: number
  /** How much this step multiplied cost per purchase (above 1 = made it worse). */
  effect: number
  meaning: string
  fixes: string
}

const STEPS: ReadonlyArray<{ step: StepChange['step']; label: string; meaning: string; fixes: string }> = [
  {
    step: 'cpm',
    label: 'Cost per 1,000 impressions (CPM)',
    meaning: 'the auction got more expensive (season, competition, or more spend pushed at the same people)',
    fixes: 'better click-through lowers effective cost; do not scale into a tiring audience; plan big seasons early',
  },
  {
    step: 'linkCtr',
    label: 'Link click-through',
    meaning: 'the ads stopped stopping people: creative fatigue or creative that all looks alike',
    fixes: '8–12 genuinely different concepts; proven formats (often video) re-cut; in-season product and one clear price; refresh every 2–3 weeks',
  },
  {
    step: 'pageViewsPerClick',
    label: 'Page views per link click',
    meaning: 'clicks are not loading the page: slow site, bad links, or accidental clicks from weak placements',
    fixes: 'page speed on mobile data, check every ad link, review placements (Audience Network, Reels)',
  },
  {
    step: 'addToCartRate',
    label: 'Add to cart ÷ page views',
    meaning: 'visitors want the product less once they see it: price, offer, photos, sizes, delivery terms or trust',
    fixes: 'store-builder work: clear price and offer (a bundle), delivery and returns stated the same everywhere, real photos and size help, no stale banners; match the ad to the landing product',
  },
  {
    step: 'purchaseRate',
    label: 'Purchase ÷ add to cart',
    meaning: 'carts are not becoming orders: surprise costs, checkout friction or payment options',
    fixes: 'show the total with delivery early, guest checkout, the payment methods buyers expect (cash on delivery where relevant)',
  },
]

/**
 * Splits the change in cost per purchase between two periods into the funnel steps.
 * The product of the effects equals the change in cost per purchase (when every step is
 * measurable), so the ranking says where the money went.
 */
export function decompose(before: MonthFunnel, after: MonthFunnel): StepChange[] {
  const out: StepChange[] = []
  for (const s of STEPS) {
    const b = before[s.step]
    const a = after[s.step]
    if (b === undefined || a === undefined || b <= 0 || a <= 0) continue
    // CPM raises cost when it rises; every rate raises cost when it falls.
    const effect = s.step === 'cpm' ? a / b : b / a
    out.push({ step: s.step, label: s.label, before: b, after: a, effect, meaning: s.meaning, fixes: s.fixes })
  }
  return out.sort((x, y) => y.effect - x.effect)
}

export interface BreakEvenInput {
  /** What the customer pays for one order, in the account currency. */
  orderValue: number
  /** Items in one order (1.2 for an average order of 1.2 items, 2 for a two-item bundle). */
  itemsPerOrder: number
  /** Cost per item including packaging. */
  costPerItem: number
  /** Delivery the business pays per delivered order (0 if the customer pays it). */
  deliveryCost: number
  /** Taxes and fees taken as a percentage of the order value (e.g. 6.1). */
  percentTaken: number
  /** Share of orders refused or returned, in percent (cash on delivery). */
  refusedPercent: number
  /** What one refused order costs (courier both ways, packaging lost). */
  refusedOrderCost: number
}

export interface BreakEven {
  profitPerDeliveredOrder: number
  /** The most the ads can pay per purchase reported by Meta (an order placed) and break even. */
  breakEvenCostPerPurchase: number
}

/** What a purchase (as Meta counts it: an order placed) can cost before it loses money. */
export function breakEven(i: BreakEvenInput): BreakEven {
  const profitPerDeliveredOrder = i.orderValue - i.itemsPerOrder * i.costPerItem - i.deliveryCost - (i.percentTaken / 100) * i.orderValue
  const delivered = 1 - i.refusedPercent / 100
  return {
    profitPerDeliveredOrder,
    breakEvenCostPerPurchase: delivered * profitPerDeliveredOrder - (1 - delivered) * i.refusedOrderCost,
  }
}
