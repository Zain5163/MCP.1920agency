import type { Provider } from '@social-publisher/adapters'
import { resolutionFor } from '@social-publisher/core'

/**
 * What to print when a sign-in lacks a permission it needs, or undefined when
 * it may be stored.
 *
 * Google's consent screen lets people untick permissions one by one, and
 * account discovery only needs read access. A channel whose owner unticked
 * "Manage your YouTube videos" was found, stored and listed as ready, and every
 * upload to it then failed. So the grant is checked straight after the token
 * exchange, before anything is discovered or stored, and a partial one is
 * refused with the labels the owner saw on the consent screen.
 *
 * The provider judges what is missing (`Provider.missingPermissions`), by what
 * the grant can do rather than by comparing scope strings, so nothing here
 * names a platform. A provider that cannot report its grant, or does not
 * implement the check, is not refused here, exactly as before.
 *
 * The steps are the catalogue's GOOGLE_SCOPE_NOT_GRANTED entry: Google is the
 * provider whose consent can be granted in part and that implements the check,
 * and its last step (removing the app's access when Google does not ask again)
 * is the one people cannot guess.
 */
export function partialGrantRefusal(
  provider: Pick<Provider, 'displayName' | 'missingPermissions'>,
  grantedScopes: readonly string[] | undefined,
  scopeBundles: readonly string[],
): string[] | undefined {
  if (grantedScopes === undefined || provider.missingPermissions === undefined) return undefined
  const missing = provider.missingPermissions(grantedScopes, scopeBundles)
  if (missing.length === 0) return undefined

  const resolution = resolutionFor('GOOGLE_SCOPE_NOT_GRANTED')
  return [
    `${provider.displayName} authorised, but without ${missing.length === 1 ? 'a permission' : 'permissions'} this needs:`,
    ...missing.map((label) => `  - ${label}`),
    '',
    `Why: ${resolution.why}`,
    '',
    'How to fix:',
    ...resolution.fix.map((step, i) => `  ${i + 1}. ${step}`),
    '',
    'Nothing was stored.',
  ]
}
