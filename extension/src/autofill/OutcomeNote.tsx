import { BELOW_TOP_BAR, MOTION } from "../ui";
import { ALERT_ICON, CROSS_ICON } from "./icons";

const NOTE = "flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,currentColor_18%,transparent)] bg-[var(--color-warning-bg)] py-1 pr-0.5 pl-2 text-caption text-[var(--color-warning-fg)]";
const MARK = "flex-none [&_svg]:size-[var(--icon-sm)]";
const CLOSE = `grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-sm)] transition-[background] ${MOTION} hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] [&_svg]:size-[var(--icon-sm)]`;

/** A run that stopped because the form changed under it: the BDE checks the form before going on, so the note stays until
 * they close it. A run that ends as it should leaves no note: "Autofill complete" says so, the progress says how far the
 * form is, and the list shows what's left to the BDE. */
export default function OutcomeNote({ onDismiss }: { onDismiss: () => void }) {
  return <div data-slot="autofill-result" role="status" className={`${NOTE} ${BELOW_TOP_BAR} animate-rise-in`}>
    <span className={MARK}>{ALERT_ICON}</span>
    <p className="min-w-0 flex-1">
      <span data-slot="autofill-result-title" className="font-[550]">BenchQ stopped: the form changed</span>
      {" "}<span data-slot="autofill-result-detail">Check the form before going on.</span>
    </p>
    <button type="button" className={CLOSE} aria-label="Dismiss this note" title="Dismiss" onClick={onDismiss}>{CROSS_ICON}</button>
  </div>;
}
