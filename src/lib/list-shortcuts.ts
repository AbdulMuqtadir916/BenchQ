export type ShortcutHint = { keys: readonly string[]; label: string };

const LIST_SHORTCUTS: readonly ShortcutHint[] = [
  { keys: ["J", "K", "↓", "↑"], label: "Move between rows" },
  { keys: ["Enter"], label: "Open focused row" },
  { keys: ["Space", "X"], label: "Select focused row" },
  { keys: ["/"], label: "Focus list search" },
];
const WITH_CREATE = [...LIST_SHORTCUTS, { keys: ["N"], label: "New candidate" }];
export const BACK_SHORTCUT: readonly ShortcutHint[] = [{ keys: ["Esc"], label: "Go back to Candidates" }];

export function candidateListShortcuts(canOpenNew: boolean): readonly ShortcutHint[] {
  return canOpenNew ? WITH_CREATE : LIST_SHORTCUTS;
}
