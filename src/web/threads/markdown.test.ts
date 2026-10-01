import { describe, expect, it } from 'vitest'
import { parseInline, parseMessageBody } from './markdown.ts'

describe('parseInline', () => {
  it('parses plain text with no formatting', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('parses inline code', () => {
    expect(parseInline('use `git status` here')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: 'git status' },
      { type: 'text', value: ' here' },
    ])
  })

  it('parses bold text', () => {
    expect(parseInline('this is **important**')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'bold', children: [{ type: 'text', value: 'important' }] },
    ])
  })

  it('parses italic text', () => {
    expect(parseInline('this is *subtle*')).toEqual([
      { type: 'text', value: 'this is ' },
      { type: 'italic', children: [{ type: 'text', value: 'subtle' }] },
    ])
  })

  it('parses several spans in one string', () => {
    expect(parseInline('**bold** and *italic* and `code`')).toEqual([
      { type: 'bold', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' and ' },
      { type: 'italic', children: [{ type: 'text', value: 'italic' }] },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'code' },
    ])
  })
})

describe('parseMessageBody', () => {
  it('parses a single paragraph', () => {
    expect(parseMessageBody('Looks good to me.')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'Looks good to me.' }] },
    ])
  })

  it('splits paragraphs on blank lines', () => {
    const blocks = parseMessageBody('First paragraph.\n\nSecond paragraph.')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'First paragraph.' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'Second paragraph.' }] },
    ])
  })

  it('parses an unordered list', () => {
    const blocks = parseMessageBody('- one\n- two\n* three')
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', value: 'one' }], [{ type: 'text', value: 'two' }], [{ type: 'text', value: 'three' }]],
      },
    ])
  })

  it('parses an ordered list', () => {
    const blocks = parseMessageBody('1. first\n2. second')
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'text', value: 'first' }], [{ type: 'text', value: 'second' }]],
      },
    ])
  })

  it('parses a fenced code block, left unparsed for inline formatting', () => {
    const blocks = parseMessageBody('```ts\nconst x = 1\n```')
    expect(blocks).toEqual([{ type: 'code-block', value: 'const x = 1', lang: 'ts' }])
  })

  it('parses a fenced code block with no language', () => {
    const blocks = parseMessageBody('```\nplain\n```')
    expect(blocks).toEqual([{ type: 'code-block', value: 'plain', lang: null }])
  })

  it('mixes paragraphs, lists, and code blocks in order', () => {
    const blocks = parseMessageBody('Summary:\n\n- item one\n- item two\n\n```js\nok()\n```\n\nDone.')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'code-block', 'paragraph'])
  })

  it('returns an empty array for an empty body', () => {
    expect(parseMessageBody('')).toEqual([])
  })
})

describe('italic emphasis', () => {
  it('leaves glob patterns and arithmetic as plain text', () => {
    expect(parseInline('*.ts and *.tsx')).toEqual([{ type: 'text', value: '*.ts and *.tsx' }])
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }])
  })

  it('still reads a word wrapped in single asterisks as italic', () => {
    expect(parseInline('an *important* note')).toEqual([
      { type: 'text', value: 'an ' },
      { type: 'italic', children: [{ type: 'text', value: 'important' }] },
      { type: 'text', value: ' note' },
    ])
  })
})
