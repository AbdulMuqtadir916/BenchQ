"use client";

import { useEffect } from "react";
import { isEscapeBackKey } from "@/lib/list-keys";
import { readKeyInput } from "@/lib/list-keys-dom";

/**
 * Esc goes back on a screen that is not a panel (docs/04 §1.3, BUG-004): `leave` runs on a plain Esc when nothing else wants it
 * (see `isEscapeBackKey`). It listens in the capture phase so that it sees an open drawer, dialog, palette or shortcut sheet before
 * they close themselves on that same key press.
 */
export function useEscapeBack(leave: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isEscapeBackKey(readKeyInput(event))) return;
      event.preventDefault();
      leave();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [leave]);
}
