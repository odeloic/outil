import { common, createLowlight } from 'lowlight'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import type { Element, ElementContent, Root } from 'hast'
import type { HighlightRequest, HighlightResponse, Token } from './highlight.ts'

const lowlight = createLowlight({ ...common, dockerfile })

const BY_EXTENSION: Record<string, string> = {
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  htm: 'xml',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  jsonc: 'json',
  toml: 'ini',
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
}

function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1)
  const language = BY_EXTENSION[extension] ?? extension
  return lowlight.registered(language) ? language : null
}

function toLines(root: Root): Token[][] {
  const lines: Token[][] = [[]]
  const walk = (nodes: ElementContent[], className: string) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        node.value.split('\n').forEach((part, i) => {
          if (i > 0) lines.push([])
          if (part) lines[lines.length - 1].push([className, part.replace(/\r$/, '')])
        })
      } else if (node.type === 'element') {
        const own = ((node as Element).properties.className as string[] | undefined)?.join(' ') ?? ''
        walk(node.children, own ? `${className} ${own}`.trim() : className)
      }
    }
  }
  walk(root.children as ElementContent[], '')
  return lines
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, path, texts } = event.data
  const language = languageFor(path)
  const response: HighlightResponse = {
    id,
    lines: texts.map((text) => (text === null || language === null ? null : toLines(lowlight.highlight(language, text)))),
  }
  self.postMessage(response)
}
