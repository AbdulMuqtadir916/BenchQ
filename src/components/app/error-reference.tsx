"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/** How long "Copied" shows. */
const CONFIRM_MS = 2000;
/** How long the "blocked" hint shows: long enough to read it and select the reference by hand. */
const BLOCKED_MS = 8000;
export type CopyState = "idle" | "copied" | "blocked";

/** Copies the reference: "copied", or "blocked" when the browser refuses (no permission, an insecure page, no API). */
export async function copyReference(reference: string, clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<CopyState> {
  if (!clipboard) return "blocked";
  try {
    await clipboard.writeText(reference);
    return "copied";
  } catch {
    return "blocked";
  }
}

/** What the copy result says, on screen and to a screen reader. */
export function copyAnnouncement(state: CopyState): string {
  if (state === "copied") return "Copied";
  if (state === "blocked") return "Your browser blocked copying. Select the reference, then press Ctrl+C.";
  return "";
}

const noSubscription = () => () => undefined;

/**
 * "Reference: <request id>" with a copy button, under an unexpected error (INTERNAL) only (docs/02 §12.2 rule 5;
 * docs/team/uzair.md step 4b, decision 4). The id is what support looks up in the log. Inherits the colour of the
 * error it sits under. The copy result shows for a few seconds and clears (or on the next press).
 *
 * The result is announced from a polite live region rendered at the end of <body>, never here: every caller sits in an
 * alert (an error note, a toast, a page error card), and a live region inside another is announced twice or not at all.
 */
export function ErrorReference({ reference, className }: { reference: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClient = useSyncExternalStore(noSubscription, () => true, () => false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
    const result = await copyReference(reference, typeof navigator === "undefined" ? undefined : navigator.clipboard);
    setState(result);
    timer.current = setTimeout(() => setState("idle"), result === "copied" ? CONFIRM_MS : BLOCKED_MS);
  }

  const said = copyAnnouncement(state);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 text-caption", className)}>
      <span>
        {/* break-all: a request id has no spaces, so on a narrow line it breaks rather than clips. */}
        Reference: <code className="text-mono select-all break-all">{reference}</code>
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy reference"
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-current opacity-80",
          "transition-opacity duration-[var(--duration-instant)] hover:opacity-100",
          // A tint of the line's own colour, so the hover reads on a danger line, a toast or a card, light or dark.
          "hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)]",
          "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]",
        )}
      >
        {state === "copied" ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
      {/* Read out by the live region below; shown here for sighted readers. */}
      {said ? <span aria-hidden="true">{said}</span> : null}
      {isClient ? createPortal(<span role="status" aria-live="polite" className="sr-only">{said}</span>, document.body) : null}
    </span>
  );
}
