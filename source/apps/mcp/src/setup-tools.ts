import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { MetaAccountSetup, type SetupState } from '@social-publisher/adapters'
import { optional } from '@social-publisher/config'
import { decide, formatApprovalRequest } from '@social-publisher/core'

import { audit, guarded, type ToolResult } from './ads-tools.ts'

/**
 * Setting up someone with no ad account (roadmap 5b.5).
 *
 * `check_ad_setup` reads what exists and says what is missing. Each of the
 * three things Meta allows by API has its own tool and its own approval, because
 * none can be undone: a business cannot be deleted, an ad account only closed,
 * and a pixel is one per account. The two Meta keeps in its own screens — the
 * Page and the payment method — come back as links for the person.
 *
 * **Local server only**, like the ads tools: the token is the owner's. Serving
 * customers needs Meta App Review for `business_management` and per-tenant
 * connections (decision 0005).
 */

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

function loadSetup(): MetaAccountSetup | { error: string } {
  const accessToken = optional('META_ADS_ACCESS_TOKEN')
  if (accessToken === undefined) {
    return { error: 'Meta is not connected. Missing from ~/.social-publisher/.env: META_ADS_ACCESS_TOKEN.' }
  }
  return new MetaAccountSetup({ accessToken })
}

export function formatSetup(state: SetupState): string {
  const lines = [
    `Connected as ${state.who.name}.`,
    '',
    ...state.steps.flatMap((s) => [`${s.done ? '✓' : '✗'} ${s.detail}`, ...(s.next !== undefined ? [`    → ${s.next}`] : [])]),
    '',
    state.ready
      ? 'Everything needed to run ads is in place.'
      : 'Not ready to run ads yet. Do the ✗ steps in order; the → line says who does each one.',
  ]
  if (state.focus?.timezoneId !== undefined) {
    lines.push('', `For a new ad account in the same time zone: timezoneId ${state.focus.timezoneId} (${state.focus.timezoneName}).`)
  }
  return lines.join('\n')
}

const confirmArg = z.string().optional().describe('The token from the approval summary, once the user has said yes.')

export function registerSetupTools(server: McpServer): void {
  server.tool(
    'check_ad_setup',
    'Check whether this Meta connection has everything needed to run ads — Page, business portfolio, ad account, payment method, pixel, and whether the pixel is receiving website events — and say what is missing and who does it. Reads only. Run this first for anyone new to Meta ads.',
    { adAccountId: z.string().optional().describe('The ad account to check payment and pixel on. Defaults to the first active one.') },
    async ({ adAccountId }) =>
      await guarded(async () => {
        const setup = loadSetup()
        if ('error' in setup) return text(setup.error)
        return text(formatSetup(await setup.inspect(adAccountId)))
      }),
  )

  server.tool(
    'create_business',
    'Create a Meta business portfolio, with a published Page as its primary Page. PERMANENT: Meta does not allow deleting one. Needs the user’s approval. Needs a person’s own Facebook login, not a system user.',
    {
      name: z.string().min(1).describe('The business’s real name.'),
      vertical: z
        .string()
        .default('OTHER')
        .describe('Meta’s industry code, e.g. PROFESSIONAL_SERVICES, ECOMMERCE, RETAIL, HEALTH, EDUCATION, OTHER.'),
      primaryPageId: z.string().describe('A published Page the person manages (from check_ad_setup).'),
      confirm: confirmArg,
    },
    async ({ confirm, ...args }) =>
      await guarded(async () => {
        const setup = loadSetup()
        if ('error' in setup) return text(setup.error)
        const gate = decide({
          action: 'create_business',
          payload: args,
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [`Create the business portfolio "${args.name}"`, `  industry: ${args.vertical}`, `  primary Page: ${args.primaryPageId}`].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        const id = await setup.createBusiness(args)
        await audit('meta.business.created', { businessId: id })
        return text(`Business portfolio created: ${id}\nNext: create_ad_account with businessId ${id}.`)
      }),
  )

  server.tool(
    'create_ad_account',
    'Create a Meta ad account in a business portfolio. PERMANENT: it can be closed but not deleted, and Meta allows five by API per business. Needs the user’s approval. Spends nothing.',
    {
      businessId: z.string(),
      name: z.string().min(1),
      currency: z.string().length(3).describe('ISO code, e.g. PKR, USD, GBP. Cannot be changed later.'),
      timezoneId: z.number().int().describe('Meta’s time zone id; check_ad_setup shows an existing account’s. Asia/Karachi is 105. Cannot be changed later.'),
      confirm: confirmArg,
    },
    async ({ confirm, ...args }) =>
      await guarded(async () => {
        const setup = loadSetup()
        if ('error' in setup) return text(setup.error)
        const gate = decide({
          action: 'create_ad_account',
          payload: args,
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Create the ad account "${args.name}" in business ${args.businessId}`,
              `  currency: ${args.currency} and time zone id ${args.timezoneId} — neither can be changed later`,
            ].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        const id = await setup.createAdAccount(args)
        await audit('meta.adaccount.created', { adAccountId: id, businessId: args.businessId })
        return text(
          [
            `Ad account created: ${id}`,
            'Next: the person adds a payment method (check_ad_setup gives the link), then create_pixel.',
            `To run campaigns on it from here, set META_AD_ACCOUNT_ID=${id} and META_AD_ACCOUNT_CURRENCY=${args.currency} in ~/.social-publisher/.env.`,
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'create_pixel',
    'Create the pixel (website events dataset) for a Meta ad account. Meta allows one per ad account by API, and it cannot be deleted. Needs the user’s approval. Returns the pixel id; the code must then go on the website.',
    {
      adAccountId: z.string(),
      name: z.string().min(1).describe('Usually the website’s domain, e.g. acme.com.'),
      confirm: confirmArg,
    },
    async ({ confirm, ...args }) =>
      await guarded(async () => {
        const setup = loadSetup()
        if ('error' in setup) return text(setup.error)
        const gate = decide({
          action: 'create_pixel',
          payload: args,
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => `Create the pixel "${args.name}" on ad account ${args.adAccountId}`,
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        const id = await setup.createPixel(args)
        await audit('meta.pixel.created', { pixelId: id, adAccountId: args.adAccountId })
        return text(
          [
            `Pixel created: ${id}`,
            'It records nothing until its code is on every page of the website (Events Manager → the pixel → Add events).',
            `To attach it to every ad made here, set META_PIXEL_ID=${id} in ~/.social-publisher/.env.`,
          ].join('\n'),
        )
      }),
  )
}
