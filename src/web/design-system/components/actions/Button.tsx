import type { ComponentProps, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'default' | 'ghost'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  children: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'ods-btn--primary',
  default: '',
  ghost: 'ods-btn--ghost',
}

export function Button({ variant = 'default', className, children, ...rest }: ButtonProps) {
  const classes = ['ods-btn', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  )
}
