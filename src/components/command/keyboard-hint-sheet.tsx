"use client";

import { useUiStore } from "@/lib/stores/ui-store";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { shortcutsFor } from "@/lib/routes/registry";
import { cn } from "@/lib/cn";

/**
 * KeyboardHintSheet — opened by `?`. Lists every global shortcut.
 * Keep it accurate — the docs (04 §1.3) call this "the cheapest documentation
 * in the product" and an out-of-date sheet is worse than none. The `g` entries come
 * from the route registry, so they match exactly what the current role can use.
 */

type Shortcut = { keys: string[]; label: string };

export function KeyboardHintSheet() {
  const isOpen = useUiStore((s) => s.hintSheetOpen);
  const close = useUiStore((s) => s.closeHintSheet);
  const principal = useSignedInPrincipal();

  if (!isOpen) return null;

  const shortcuts: Shortcut[] = [
    { keys: ["⌘", "K"], label: "Open command palette" },
    ...shortcutsFor(principal).map(({ key, route }) => ({ keys: ["g", key], label: `Go to ${route.title}` })),
    { keys: ["?"], label: "Open this shortcut sheet" },
    { keys: ["Esc"], label: "Close panel / clear selection" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hint-sheet-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={close}
    >
      <div className="absolute inset-0 bg-[var(--color-overlay)]" aria-hidden="true" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full max-w-md",
          "rounded-[var(--radius-xl)] border border-[var(--color-border)]",
          "bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
          "p-5",
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="hint-sheet-title" className="text-h2 text-[var(--color-text)]">
            Keyboard shortcuts
          </h2>
          <kbd className="tabular text-caption text-[var(--color-text-3)]">Esc</kbd>
        </div>
        <ul className="space-y-2">
          {shortcuts.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-4">
              <span className="text-body text-[var(--color-text-2)]">
                {s.label}
              </span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, ki) => (
                  <kbd
                    key={ki}
                    className="tabular text-caption font-[600] px-2 h-6 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-2)] inline-flex items-center"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
