import type { Connection, Platform } from './types.ts'

/**
 * Which connected accounts a post goes to.
 *
 * Until 2026-10-02 a post went to every ready account on the platforms named,
 * or on every platform when none was named. That was safe with one Page. Then
 * the owner reconnected Facebook and connected about 40 Pages and Instagram
 * accounts, most of them clients'. "Post to Facebook" would have published on
 * every client's Page.
 *
 * The rule now:
 *   - Accounts can be named, by display name or id. Named accounts are exactly
 *     what is posted to.
 *   - Without names, a platform with **one** ready account is fine.
 *   - Without names, a platform with **several** is refused, listing them, so
 *     the choice is made by a person and never by default.
 */
export type TargetSelection =
  | { readonly ok: true; readonly chosen: readonly Connection[]; readonly platforms: readonly Platform[] }
  | { readonly ok: false; readonly message: string }

export function selectTargets(
  connections: readonly Connection[],
  wanted: { readonly platforms?: readonly Platform[] | undefined; readonly accounts?: readonly string[] | undefined },
): TargetSelection {
  const ready = connections.filter((c) => !c.needsReauth)

  if (wanted.accounts !== undefined && wanted.accounts.length > 0) {
    const chosen: Connection[] = []
    const unknown: string[] = []
    for (const name of wanted.accounts) {
      const key = name.trim().toLowerCase()
      const matches = ready.filter(
        (c) =>
          c.id === name.trim() &&
          (wanted.platforms === undefined || wanted.platforms.includes(c.platform)),
      )
      const byName = ready.filter(
        (c) =>
          c.displayName.trim().toLowerCase() === key &&
          (wanted.platforms === undefined || wanted.platforms.includes(c.platform)),
      )
      const hit = matches.length > 0 ? matches : byName
      if (hit.length === 0) unknown.push(name)
      for (const c of hit) if (!chosen.some((x) => x.id === c.id)) chosen.push(c)
    }
    if (unknown.length > 0) {
      return {
        ok: false,
        message:
          `No ready account called ${unknown.map((u) => `"${u}"`).join(', ')}` +
          (wanted.platforms !== undefined ? ` on ${wanted.platforms.join(', ')}` : '') +
          '. Nothing was posted. Use list_accounts for exact names.',
      }
    }
    return { ok: true, chosen, platforms: [...new Set(chosen.map((c) => c.platform))] }
  }

  const platforms = wanted.platforms ?? [...new Set(ready.map((c) => c.platform))]
  const chosen = ready.filter((c) => platforms.includes(c.platform))
  const crowded = platforms
    .map((p) => ({ p, names: chosen.filter((c) => c.platform === p).map((c) => c.displayName) }))
    .filter((x) => x.names.length > 1)

  if (crowded.length > 0) {
    return {
      ok: false,
      message: [
        'Several accounts are connected on this platform, so the post needs to say which. Nothing was posted.',
        ...crowded.map((x) => `  ${x.p}: ${x.names.join(', ')}`),
        // The example is one of the user's own account names, not a fixed company name.
        `Name them with \`accounts\`, e.g. accounts: [${JSON.stringify(crowded[0]!.names[0] ?? 'Account name')}].`,
      ].join('\n'),
    }
  }
  return { ok: true, chosen, platforms: [...new Set(chosen.map((c) => c.platform))] }
}
