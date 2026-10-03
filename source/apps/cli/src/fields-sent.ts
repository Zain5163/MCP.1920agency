import { fieldsSentTo, type Platform, type PostDraft } from '@social-publisher/core'

/**
 * Where the draft's title and AI-media declaration go, as lines to print.
 *
 * `post` printed "Title:" and "Declared as realistic AI-generated or altered
 * media" once for every target, while Facebook, Instagram and a LinkedIn text
 * post drop the title and only YouTube is sent the declaration: an owner could
 * publish to Meta believing the post had been declared there. So both are now
 * shown per platform, from capability data (`fieldsSentTo`), and a title or a
 * declaration that some platforms will not receive says so.
 *
 * The MCP server prints the same lines (apps/mcp/src/publishing.ts); an app
 * cannot import another, so keep the two in step.
 */
export function fieldsSentLines(
  draft: PostDraft,
  platforms: readonly Platform[],
): { titles: string[]; declaration: string[] } {
  const sent = fieldsSentTo(draft, platforms)
  const titled = new Set(sent.titles.map((t) => t.platform))
  const untitled = [...new Set(platforms)].filter((p) => !titled.has(p))
  const titles = sent.titles.map((t) => `Title on ${t.platform}: ${t.title}`)
  if (draft.title !== undefined && untitled.length > 0) {
    titles.push(`No title on ${untitled.join(', ')}: ${untitled.length === 1 ? 'it takes' : 'they take'} none for this post.`)
  }
  const declaration: string[] = []
  if (sent.disclosedTo.length > 0) {
    declaration.push(`Declared as realistic AI-generated or altered media on: ${sent.disclosedTo.join(', ')}`)
  }
  if (sent.notDisclosedTo.length > 0) {
    declaration.push(
      `NOT declared on ${sent.notDisclosedTo.join(', ')}: their API takes no such declaration, so label it in the app.`,
    )
  }
  return { titles, declaration }
}
