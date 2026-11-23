import type { ErrorText } from "@/lib/api/error-text";
import { cn } from "@/lib/cn";
import { ErrorReference } from "./error-reference";

/**
 * An inline error after a button press: the words `describeError` picked (src/lib/api/error-text.ts) and, for an
 * unexpected error, its reference with a copy button. A plain string is a screen's own words (a check before the
 * request was sent). Renders nothing for no error. `as="span"` sits in a row of buttons.
 */
export function ErrorNote({ text, id, as: Tag = "div", className }: {
  text: ErrorText | string | null | undefined;
  id?: string;
  as?: "div" | "span";
  className?: string;
}) {
  if (!text) return null;
  const { message, reference } = typeof text === "string" ? { message: text, reference: null } : text;
  const Line = Tag === "span" ? "span" : "p";
  return (
    <Tag id={id} role="alert" className={cn("text-sm text-[var(--color-danger-fg)]", Tag === "span" && "inline-flex flex-wrap items-center gap-x-2", className)}>
      <Line>{message}</Line>
      {reference ? <ErrorReference reference={reference} className={Tag === "div" ? "mt-1" : undefined} /> : null}
    </Tag>
  );
}
