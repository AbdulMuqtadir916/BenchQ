import { useEffect, useState, type FocusEvent } from "react";
import { BELOW_TOP_BAR, MOTION } from "../ui";
import { ALERT_ICON, CHECK, CROSS_ICON } from "./icons";
import type { Outcome } from "./use-autofill";

/** Long enough to read two short lines. */
const SHOWN_MS = 6000;
/** The fade out ends the note, and this does if the page never says the fade ended. */
const GONE_BY_MS = 1000;

const NOTE = "flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,currentColor_18%,transparent)] py-1 pr-0.5 pl-2 text-caption";
const DONE = "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]";
const NEEDS_YOU = "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]";
const MARK = "flex-none [&_svg]:size-[var(--icon-sm)]";
const CLOSE = `grid size-[var(--control-sm)] flex-none place-items-center rounded-[var(--radius-sm)] transition-[background] ${MOTION} hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] [&_svg]:size-[var(--icon-sm)]`;

function headline({ filled, stopped }: Outcome): string {
  if (stopped) return "BenchQ stopped: the form changed";
  if (filled === 0) return "Nothing was filled";
  return filled === 1 ? "Filled 1 field" : `Filled ${filled} fields`;
}

/** Fields still empty on the form once the run is done, whether Autofill tried them or not. */
export type Left = { required: number; optional: number };

/** What's left, how much of it is required, and why: fields Autofill didn't recognize, had no saved answer for, or tried
 * and couldn't fill. "Still empty: 2 required, 1 optional." */
function detail({ stopped }: Outcome, { required, optional }: Left): string {
  if (stopped) return "Check the form before going on.";
  const total = required + optional;
  if (total === 0) return "Check the form, then submit it.";
  const counts = [required > 0 ? `${required} required` : "", optional > 0 ? `${optional} optional` : ""].filter(Boolean).join(", ");
  const why = total === 1 ? "Autofill didn't recognize it or couldn't fill it." : "Autofill didn't recognize these or couldn't fill them.";
  const next = required === 0 ? "Fill in any you need below" : `Fill in the required ${required === 1 ? "one" : "ones"} below`;
  return `Still empty: ${counts}. ${why} ${next}, then submit the form.`;
}

type OutcomeNoteProps = {
  outcome: Outcome;
  left: Left;
  onDismiss: () => void;
};

/** What a run did, in a short strip: what it filled, how many required and optional fields are still empty and why, and
 * that the form is the BDE's to submit. Amber while a required field is empty, green when only optional ones are. It
 * goes after a few seconds, since the list below shows the same, but not while the BDE is reading it, and not when the
 * run stopped, which they need to act on. */
export default function OutcomeNote({ outcome, left, onDismiss }: OutcomeNoteProps) {
  const { filled, stopped } = outcome;
  const [isHeld, setIsHeld] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const needsYou = left.required > 0 || stopped || filled === 0;

  useEffect(() => {
    if (stopped || isHeld || isLeaving) return undefined;
    const timer = window.setTimeout(() => setIsLeaving(true), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [isHeld, isLeaving, stopped]);

  useEffect(() => {
    if (!isLeaving) return undefined;
    const timer = window.setTimeout(onDismiss, GONE_BY_MS);
    return () => window.clearTimeout(timer);
  }, [isLeaving, onDismiss]);

  const letGo = ({ currentTarget, relatedTarget }: FocusEvent<HTMLElement>) => {
    if (!currentTarget.contains(relatedTarget)) setIsHeld(false);
  };

  return <div data-slot="autofill-result" role="status"
    className={`${NOTE} ${BELOW_TOP_BAR} ${needsYou ? NEEDS_YOU : DONE} ${isLeaving ? "animate-fade-out" : "animate-rise-in"}`}
    onAnimationEnd={({ target, currentTarget }) => { if (isLeaving && target === currentTarget) onDismiss(); }}
    onMouseEnter={() => setIsHeld(true)} onMouseLeave={() => setIsHeld(false)} onFocus={() => setIsHeld(true)} onBlur={letGo}>
    <span className={MARK}>{needsYou ? ALERT_ICON : CHECK}</span>
    <p className="min-w-0 flex-1">
      <span data-slot="autofill-result-title" className="font-[550]">{headline(outcome)}</span>
      {" "}<span data-slot="autofill-result-detail">{detail(outcome, left)}</span>
    </p>
    <button type="button" className={CLOSE} aria-label="Dismiss this note" title="Dismiss" onClick={onDismiss}>{CROSS_ICON}</button>
  </div>;
}
