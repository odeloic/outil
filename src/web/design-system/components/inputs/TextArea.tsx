import type { TextareaHTMLAttributes } from 'react'

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function TextArea({ className, ...rest }: TextAreaProps) {
  return <textarea className={`ods-textarea ${className ?? ''}`} {...rest} />
}
