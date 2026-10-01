import { Fragment } from 'react'
import { parseMessageBody, type InlineNode } from './markdown.ts'

function InlineNodes({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === 'text') return <Fragment key={i}>{node.value}</Fragment>
        if (node.type === 'code') return (
          <code key={i} className="message-body__code">
            {node.value}
          </code>
        )
        if (node.type === 'bold') return (
          <strong key={i}>
            <InlineNodes nodes={node.children} />
          </strong>
        )
        return (
          <em key={i}>
            <InlineNodes nodes={node.children} />
          </em>
        )
      })}
    </>
  )
}

export function MessageBody({ body }: { body: string }) {
  const blocks = parseMessageBody(body)
  return (
    <div className="message-body">
      {blocks.map((block, i) => {
        if (block.type === 'code-block') {
          return (
            <pre key={i} className="message-body__pre">
              <code>{block.value}</code>
            </pre>
          )
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={i} className="message-body__list">
              {block.items.map((item, j) => (
                <li key={j}>
                  <InlineNodes nodes={item} />
                </li>
              ))}
            </Tag>
          )
        }
        return (
          <p key={i} className="message-body__paragraph">
            <InlineNodes nodes={block.children} />
          </p>
        )
      })}
    </div>
  )
}
