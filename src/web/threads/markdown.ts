export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; value: string }

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code-block'; value: string; lang: string | null }

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*(?![\s*])([^*]*?[^\s*])\*(?![\w*])/g

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    if (match[1] !== undefined) nodes.push({ type: 'code', value: match[1] })
    else if (match[2] !== undefined) nodes.push({ type: 'bold', children: [{ type: 'text', value: match[2] }] })
    else if (match[3] !== undefined) nodes.push({ type: 'italic', children: [{ type: 'text', value: match[3] }] })
    lastIndex = INLINE_PATTERN.lastIndex
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', value: text.slice(lastIndex) })
  return nodes
}

const FENCE = /^```(\S*)\s*$/
const LIST_ITEM = /^\s*([-*]|\d+\.)\s+(.*)$/

export function parseMessageBody(text: string): BlockNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const lang = fence[1] || null
      const codeLines: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push({ type: 'code-block', value: codeLines.join('\n'), lang })
      continue
    }

    const firstItem = LIST_ITEM.exec(line)
    if (firstItem) {
      const ordered = /^\d+\.$/.test(firstItem[1])
      const items: InlineNode[][] = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i])
        if (!item) break
        items.push(parseInline(item[2]))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraphLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !FENCE.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
      paragraphLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraphLines.join('\n')) })
  }

  return blocks
}
