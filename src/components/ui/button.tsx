"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { SPRING_PRESS } from "@/lib/motion";

/**
 * Button — shadcn/ui base primitive rethemed to DESIGN.md tokens.
 * Primary has a restrained raised gradient; secondary is a neutral face.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[var(--radius-md)] font-[550]",
    "transition-[background,border-color,color,box-shadow,transform] duration-[var(--duration-instant)] ease-[var(--ease-out)]",
    "active:scale-[0.97] motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bq-primary",
        secondary:
          "bq-secondary",
        ghost:
          "bg-transparent text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        subtle:
          "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)] hover:bg-[var(--color-primary-subtle)]/80",
        danger:
          // Text on the red: --color-surface, not white (AA in dark too: 6.7:1; white on the dark theme's red was 2.8:1).
        "bg-[var(--color-danger-fg)] text-[var(--color-surface)] hover:opacity-90",
        link:
          "text-[var(--color-primary-subtle-fg)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // §9.5 — targets ≥24px; here ≥32px comfortable, ≥40px large
        sm: "h-[var(--control-sm)] px-2.5 text-sm",
        md: "h-[var(--control-height)] px-3 text-body",
        lg: "h-[var(--control-lg)] px-4 text-body",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

// motion.button redefines these handlers with incompatible signatures.
type MotionConflictingHandlers = "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, MotionConflictingHandlers>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const reduceMotion = useReducedMotion() ?? false;
    const classes = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      return <Slot ref={ref} className={classes} {...props} />;
    }

    return (
      <motion.button
        ref={ref}
        className={classes}
        type="button"
        whileTap={reduceMotion ? undefined : { scale: 0.97 }}
        transition={SPRING_PRESS}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
