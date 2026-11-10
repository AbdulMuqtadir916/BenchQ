"use client";

import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']"));
}

/** Esc goes one step back (up a level of the dashboard), unless the reader is typing. */
export function useEscapeBack(goBack: (() => void) | null) {
  useEffect(() => {
    if (!goBack) return;
    const back = goBack;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isTypingTarget(event.target)) back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);
}
