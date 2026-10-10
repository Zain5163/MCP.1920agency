/**
 * A deliberately small Markdown renderer for guidelines.md.
 *
 * Supports what the guideline files use: ### and #### headings, paragraphs,
 * "- " and "1. " lists, pipe tables, **bold**, *italic*, `code` and
 * [text](https://...) links. Everything is escaped first and only these
 * constructs are turned back into tags, so a guideline cannot inject markup
 * into the private viewer. WHY not a library: no runtime dependencies, and the
 * viewer must not run anything it did not write.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function inline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  // Only https links, and they open nothing in this window's context.
  out = out.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer nofollow" target="_blank">$1</a>')
  return out
}

function table(lines: string[]): string {
  const rows = lines
    .filter((l) => !/^\|\s*:?-{2,}/.test(l))
    .map((l) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
  const [head, ...body] = rows
  if (head === undefined) return ''
  return (
    '<div class="table-wrap"><table><thead><tr>' +
    head.map((c) => `<th>${inline(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></div>'
  )
}

export function renderMarkdown(markdown: string): string {
  const out: string[] = []
  const lines = markdown.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = /^(#{3,4}) (.+)$/.exec(line)
    if (heading !== null) {
      const level = heading[1]!.length
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`)
      i++
      continue
    }
    if (line.startsWith('|')) {
      const block: string[] = []
      while (i < lines.length && lines[i]!.startsWith('|')) block.push(lines[i++]!)
      out.push(table(block))
      continue
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]!) : /^- /.test(lines[i]!))) {
        items.push(lines[i++]!.replace(ordered ? /^\d+\. / : /^- /, ''))
        // Continuation lines indented under an item.
        while (i < lines.length && /^ {2,}\S/.test(lines[i]!)) items[items.length - 1] += ' ' + lines[i++]!.trim()
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (i < lines.length && lines[i]!.startsWith('> ')) quote.push(lines[i++]!.slice(2))
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{3,4} |\||- |\d+\. |> )/.test(lines[i]!)) para.push(lines[i++]!.trim())
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }
  return out.join('\n')
}
