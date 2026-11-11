"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

interface TypewriterTextProps {
  text: string;
  isStreaming?: boolean;
  intervalMs?: number;
  onComplete?: () => void;
  className?: string;
}

export function TypewriterText({
  text,
  isStreaming = true,
  intervalMs = 18,
  onComplete,
  className,
}: TypewriterTextProps) {
  const shouldReduceMotion = useReducedMotion();
  const shouldAnimate = isStreaming && !shouldReduceMotion;

  if (!shouldAnimate) {
    return (
      <span className={cn("whitespace-pre-wrap", className)}>{text}</span>
    );
  }

  return (
    <AnimatedTypewriter
      key={text}
      text={text}
      intervalMs={intervalMs}
      onComplete={onComplete}
      className={className}
    />
  );
}

function AnimatedTypewriter({
  text,
  intervalMs,
  onComplete,
  className,
}: Required<Pick<TypewriterTextProps, "text" | "intervalMs">> &
  Pick<TypewriterTextProps, "onComplete" | "className">) {
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(text.length, current + 1);
        if (next === text.length) window.clearInterval(timer);
        return next;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, text.length]);

  React.useEffect(() => {
    if (visibleCount === text.length) onComplete?.();
  }, [onComplete, text.length, visibleCount]);

  const visibleText = text.slice(0, visibleCount);

  return (
    <span
      aria-label={text}
      aria-live="polite"
      className={cn("whitespace-pre-wrap", className)}
    >
      <span aria-hidden="true">{visibleText}</span>
      {visibleCount < text.length ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-[var(--color-neutral-fg)] align-text-bottom"
        />
      ) : null}
    </span>
  );
}
