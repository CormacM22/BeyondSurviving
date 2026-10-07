// Turns the plain text Ciara types into formatted text for Eventbrite and the
// website. The rules are deliberately few, so they're easy to remember:
//  - a blank line starts a new paragraph (a single line break is kept);
//  - a line starting with "- " or "• " is a bullet point;
//  - **two stars** around words make them bold.
// Everything else is shown exactly as typed (HTML is escaped, never run).

export type Block = { type: 'p'; lines: string[] } | { type: 'ul'; items: string[] }

const BULLET = /^(-|•)\s+/

export function parseText(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  const flush = () => {
    if (current) blocks.push(current)
    current = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (BULLET.test(line)) {
      if (current?.type !== 'ul') { flush(); current = { type: 'ul', items: [] } }
      current.items.push(line.replace(BULLET, ''))
    } else {
      if (current?.type !== 'p') { flush(); current = { type: 'p', lines: [] } }
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Escapes a line, then turns **pairs** into bold. */
function inline(line: string): string {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

/** Plain HTML, as Eventbrite's description takes it. */
export function formatHtml(text: string): string {
  return parseText(text)
    .map((b) => b.type === 'p'
      ? `<p>${b.lines.map(inline).join('<br>')}</p>`
      : `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`)
    .join('')
}

/** WordPress block markup, matching the paragraphs and lists in Ciara's own posts. */
export function formatWordPressBlocks(text: string): string {
  return parseText(text)
    .map((b) => b.type === 'p'
      ? `<!-- wp:paragraph -->\n<p>${b.lines.map(inline).join('<br>')}</p>\n<!-- /wp:paragraph -->`
      : '<!-- wp:list -->\n<ul class="wp-block-list">' +
        b.items.map((i) => `<!-- wp:list-item -->\n<li>${inline(i)}</li>\n<!-- /wp:list-item -->`).join('') +
        '</ul>\n<!-- /wp:list -->')
    .join('\n\n')
}
