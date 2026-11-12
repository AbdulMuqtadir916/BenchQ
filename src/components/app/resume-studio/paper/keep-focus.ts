/**
 * Moving a block to another page remounts it, which would drop the caret of whoever is typing in it. Fields keep
 * their document order across pages, so the field is found again by its index among the paper's editable fields.
 */
export interface FocusMark {
  index: number;
  caret: number | null;
}

const fieldsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-editable][contenteditable]")];

/** Where the caret is, if it's in a field inside `root`. */
export function markFocus(root: HTMLElement | null): FocusMark | null {
  const active = document.activeElement;
  if (!root || !(active instanceof HTMLElement) || !root.contains(active)) return null;
  const index = fieldsOf(root).indexOf(active);
  if (index < 0) return null;
  const selection = window.getSelection();
  let caret: number | null = null;
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (active.contains(range.endContainer)) {
      const before = document.createRange();
      before.selectNodeContents(active);
      before.setEnd(range.endContainer, range.endOffset);
      caret = before.toString().length;
    }
  }
  return { index, caret };
}

/** Puts the caret back, unless the field kept focus anyway. */
export function restoreFocus(root: HTMLElement | null, mark: FocusMark): void {
  const field = root ? fieldsOf(root)[mark.index] : undefined;
  if (!field || document.activeElement === field) return;
  field.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let left = mark.caret ?? Number.POSITIVE_INFINITY;
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      range.setStart(node, left);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    left -= length;
  }
  range.selectNodeContents(field);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
