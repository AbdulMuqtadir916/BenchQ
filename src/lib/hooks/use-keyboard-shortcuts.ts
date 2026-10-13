"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUiStore } from "@/lib/stores/ui-store";
import { useSession } from "@/lib/stores/session-store";
import { shortcutsFor } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";

/**
 * Global keyboard system per docs/04 §1.3.
 *
 *   ⌘K / Ctrl+K   command palette
 *   g <key>       navigate — keys come from the route registry, only for routes the role can open
 *   ?             open keyboard hint sheet
 *   Esc           close palette / hint sheet
 *
 * Shortcuts are inert while focus is inside an input/textarea/contenteditable,
 * per WCAG 2.2 SC 2.1.4 (Character Key Shortcuts). Modifier combos (⌘K) still fire.
 */

const G_PREFIX_MS = 1200;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts() {
  const router = useRouter();
  const toHref = useHref();
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const closeCommandPalette = useUiStore((s) => s.closeCommandPalette);
  const openHintSheet = useUiStore((s) => s.openHintSheet);
  const closeHintSheet = useUiStore((s) => s.closeHintSheet);
  const role = useSession((s) => s.user.role);

  const gPressedAt = useRef<number>(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K — fires regardless of focus
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      if (e.key === "Escape") {
        closeCommandPalette();
        closeHintSheet();
        return;
      }

      // Everything else — inert inside editable targets
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        openHintSheet();
        return;
      }

      const now = Date.now();
      if (e.key === "g") {
        gPressedAt.current = now;
        return;
      }

      if (now - gPressedAt.current < G_PREFIX_MS) {
        const target = shortcutsFor(role).find((shortcut) => shortcut.key === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          gPressedAt.current = 0;
          router.push(toHref(target.route));
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    router,
    toHref,
    role,
    openCommandPalette,
    closeCommandPalette,
    openHintSheet,
    closeHintSheet,
  ]);
}
