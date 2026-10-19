"use client";

import { useEffect } from "react";

/**
 * A single-key shortcut on one page (e.g. `n` = New firm, docs/04 §14.1). Inert while typing, with a
 * modifier, or while a dialog is open (WCAG 2.1.4).
 */
export function usePageKey(key: string, onKey: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function handle(event: KeyboardEvent) {
      if (event.key !== key || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog[open]") || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      onKey();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [key, onKey, enabled]);
}
