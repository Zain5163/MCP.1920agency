/**
 * Which stored authorisations the Accounts page searches for accounts.
 *
 * Every usable authorisation is searched, one after another. One whose
 * provider this app does not register is neither searched nor reported: a
 * LinkedIn authorisation, for one, is made and used from the CLI, and the web
 * app registers no provider for it. Reporting it put "No provider is
 * registered" on every load of the page, made a healthy connection look
 * broken, and hid "Everything available is already connected".
 *
 * `isRegistered` answers for this process's providers, so no provider or
 * platform is named here.
 */
export function authorisationsToSearch<A extends { readonly provider: string; readonly needsReauth: boolean }>(
  auths: readonly A[],
  isRegistered: (provider: string) => boolean,
): { readonly usable: readonly A[] } | { readonly error: string } {
  if (auths.length === 0) {
    return { error: 'No authorisation stored yet. Run the connect command once — after that, accounts can be added here.' }
  }
  const known = auths.filter((a) => isRegistered(a.provider))
  if (known.length === 0) {
    return {
      error:
        'None of the stored authorisations can add accounts on this page. Run the connect command for one ' +
        'that can — after that, accounts can be added here.',
    }
  }
  const usable = known.filter((a) => !a.needsReauth)
  if (usable.length === 0) {
    return { error: 'The stored authorisation expired. Run the connect command again to renew it.' }
  }
  return { usable }
}
