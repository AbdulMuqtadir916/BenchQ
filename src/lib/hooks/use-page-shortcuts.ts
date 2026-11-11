"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUiStore } from "@/lib/stores/ui-store";
import type { ShortcutHint } from "@/lib/list-shortcuts";

export function usePageShortcuts(hints: readonly ShortcutHint[]) {
  const pathname = usePathname();
  useEffect(() => {
    const registration = { pathname, hints };
    useUiStore.setState({ pageShortcuts: registration });
    return () => {
      if (useUiStore.getState().pageShortcuts === registration) useUiStore.setState({ pageShortcuts: null });
    };
  }, [pathname, hints]);
}
