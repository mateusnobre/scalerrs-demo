'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-0)] focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--bg-3)] text-[var(--fg-0)] border border-[var(--border-strong)] hover:bg-[var(--border)]',
        outline:
          'bg-transparent text-[var(--fg-1)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:text-[var(--fg-0)]',
        ghost: 'text-[var(--fg-1)] hover:bg-[var(--bg-2)] hover:text-[var(--fg-0)]',
        danger: 'bg-red-600/90 text-white hover:bg-red-600',
        accent: 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 font-semibold',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';
