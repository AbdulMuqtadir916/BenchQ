export interface ListKeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** Something (usually the table's own handler) already took this key. */
  defaultPrevented: boolean;
  /** Focus is in a field: input, select, textarea or contenteditable (WCAG 2.1.4: character shortcuts stay inert there). */
  isTyping: boolean;
  /** A dialog, the command palette, the shortcut sheet, or an open menu or list has the keyboard. */
  overlayOpen: boolean;
  /** Focus is inside the table: its own handler already owns J, K, X and `/` (and Enter, Space, the arrows). */
  insideTable: boolean;
  /** `g` was pressed a moment ago: `g` then `j` is the global "go to Jobs" (docs/04 §1.3). */
  afterG: boolean;
}

export type ListKeyAction = "enter" | "filter";

/**
 * What a key pressed anywhere on the page does to the list the screen marks as primary (docs/04 §1.3: `J`/`K` move through
 * any list, `x` selects, `/` focuses the filter). Before, those keys only worked once focus was inside the table, so on a
 * freshly loaded list `J` did nothing (BUG-003). Deliberately narrow:
 *
 * - only the letters `j`, `k`, `x` and `/`, never Enter, Space or the arrows, which belong to buttons, links and scrolling;
 * - only while focus is outside the table: the first press "enters" the list (focuses the current row), and from then on the
 *   table's own handler moves, selects and opens, so one press can never move two rows;
 * - never in a field, with an overlay open, with a modifier held, after `g`, or for a key already handled.
 */
export function listKeyAction(input: ListKeyInput): ListKeyAction | null {
  if (input.defaultPrevented || input.isTyping || input.overlayOpen || input.insideTable || input.afterG) return null;
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  switch (input.key.toLowerCase()) {
    case "j":
    case "k":
    case "x":
      return "enter";
    case "/":
      return "filter";
    default:
      return null;
  }
}

/**
 * `n`, "New" on a list (docs/04 §1.3). It works from anywhere on the page, inside the table too (the table has no `n` of its
 * own), under the same guards as the list keys: never in a field, with an overlay open, with a modifier held, right after `g`,
 * or for a key something else already handled. Whether this person may add one at all (permission, the firm's state) is the
 * screen's call, made before it listens.
 */
export function isNewItemKey(input: Omit<ListKeyInput, "insideTable">): boolean {
  if (input.defaultPrevented || input.isTyping || input.overlayOpen || input.afterG) return false;
  if (input.metaKey || input.ctrlKey || input.altKey) return false;
  return input.key.toLowerCase() === "n";
}

/**
 * Esc as "go back" on a screen that is not a panel (docs/04 §1.3: Esc closes a panel, clears a selection, or goes back; BUG-004).
 * Only a plain Esc, and only when nothing else wants it: a drawer, dialog, the command palette, the shortcut sheet or an open
 * menu closes itself on Esc, and a field uses it to leave itself, so going back on that same press would throw the person off the
 * page they were using. The `g` prefix is about letters, so it does not matter here. The caller must listen before those overlays
 * handle the key (the capture phase), so that it still sees them open.
 */
export function isEscapeBackKey(input: Omit<ListKeyInput, "insideTable">): boolean {
  if (input.defaultPrevented || input.isTyping || input.overlayOpen) return false;
  if (input.metaKey || input.ctrlKey || input.altKey) return false;
  return input.key === "Escape";
}
