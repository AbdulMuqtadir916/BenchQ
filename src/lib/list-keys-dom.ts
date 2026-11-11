import { useUiStore } from "@/lib/stores/ui-store";
import type { ListKeyInput } from "./list-keys";

/** `g` then a letter is the global navigation (docs/04 §1.3); a list key right after `g` is that letter's, not the list's. */
const G_PREFIX_MS = 1200;
let gPressedAt = 0;

/** Focus is in a field: input, select, textarea or contenteditable (WCAG 2.1.4: character shortcuts stay inert there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * What a page-level key handler needs to know about a keydown, read in one place (browser only). Besides reading, it notes a
 * plain `g`, so that handlers asking about the next key know it came right after one; every handler that calls this shares that.
 */
export function readKeyInput(event: KeyboardEvent): Omit<ListKeyInput, "insideTable"> {
  const target = event.target;
  const ui = useUiStore.getState();
  const isTyping = isTypingTarget(target);
  const afterG = Date.now() - gPressedAt < G_PREFIX_MS;
  if (event.key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping) gPressedAt = Date.now();
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    defaultPrevented: event.defaultPrevented,
    isTyping,
    // Every overlay in the app is a native open <dialog> or `role="dialog" aria-modal="true"` (the palette, the shortcut sheet, the
    // application drawer, the résumé studio), and a menu or list that has the keyboard is a listbox or menu.
    overlayOpen:
      ui.commandPaletteOpen || ui.hintSheetOpen
      || Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true'], [role='alertdialog']"))
      || (target instanceof Element && Boolean(target.closest("[role='listbox'], [role='menu'], details[data-column-chooser][open]"))),
    afterG,
  };
}
