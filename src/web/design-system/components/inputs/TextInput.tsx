import type { InputHTMLAttributes } from 'react'

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={`ods-input ${className ?? ''}`} {...rest} />
}
