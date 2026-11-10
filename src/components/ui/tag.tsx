import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type TagTone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "teal";

/** Monospace metadata. */
export function Tag({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: TagTone }) {
  return <span data-tone={tone} className={cn("bq-tag", className)} {...props} />;
}
