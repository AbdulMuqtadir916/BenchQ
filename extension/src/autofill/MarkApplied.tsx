import { useLayoutEffect, useRef, useState } from "react";
import { button, MOTION, SOFT_TEXT } from "../ui";
import { fieldLabel } from "./form-memory";
import { ALERT_ICON, CHECK, CHEVRON_DOWN_ICON } from "./icons";
import type { ReviewRow } from "./types";

type MarkAppliedProps = {
  isPrimary: boolean;
  isSaving: boolean;
  isDisabled: boolean;
  /** Which job and whose: "Java Developer at Acme · for Priya". */
  jobLine: string;
  emptyRequired: ReviewRow[];
  onConfirm: () => void;
  onGoTo: (row: ReviewRow) => void;
};

const DIALOG = "m-auto max-h-[calc(100dvh-var(--dialog-gutter))] w-[min(var(--dialog-width),calc(100vw-var(--dialog-gutter)))] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-glass-edge)] bg-[var(--color-surface)] p-5 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-[var(--color-overlay)] backdrop:backdrop-blur-[var(--blur-overlay)]";
/** The dialog's round mark over the question. */
const MARK = "grid size-10 place-items-center rounded-full bg-[var(--color-success-bg)] text-[var(--color-success-fg)] [&_svg]:size-5";
/** The required fields still empty: one soft amber card. */
const NOTE = "grid gap-1.5 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-warning-fg)_26%,transparent)] bg-[color-mix(in_srgb,var(--color-warning-bg)_55%,transparent)] p-2.5";
/** One empty field, one line (its whole label on hover), with its mark and a way back to it. */
const FIELD_ROW = `flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-sm text-[var(--color-text)] transition-[background] ${MOTION} hover:bg-[var(--color-surface)] [&>svg]:size-[var(--icon-sm)] [&>svg]:flex-none [&>svg:first-child]:text-[var(--color-warning-fg)] [&>svg:last-child]:-rotate-90 [&>svg:last-child]:text-[var(--color-text-3)]`;
const MORE = "justify-self-start px-2 text-caption font-[600] text-[var(--color-warning-fg)] hover:underline";
/** The empty fields the dialog lists before "Show all". */
const SHOWN_EMPTY = 3;
/** Mark applied while fields are still left to fill: Autofill keeps the primary look, and this one reads as "done", in
 * the success colours, so it's never mistaken for a quiet extra. */
const DONE = `inline-flex min-h-[var(--control-lg)] items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success-fg)_40%,transparent)] bg-[var(--color-success-bg)] px-3 py-1 text-body-strong text-[var(--color-success-fg)] transition-[border-color,box-shadow] ${MOTION} hover:border-[var(--color-success-fg)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;

/** Marking the job applied, behind a modal dialog: the panel waits behind it, focus starts on Yes, and Cancel or Esc
 * brings it back to the button. Required fields left empty are a warning, not a block, because the BDE may have filled
 * them where BenchQ can't see; each one is a way back to its field. */
export default function MarkApplied({ isPrimary, isSaving, isDisabled, jobLine, emptyRequired, onConfirm, onGoTo }: MarkAppliedProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const yesButton = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isAllShown, setIsAllShown] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!isOpen || !element || element.open) return;
    element.showModal();
    yesButton.current?.focus();
  }, [isOpen]);

  const close = () => dialog.current?.close();
  // However it closes (a button, Esc), the dialog empties and focus goes back to where the BDE was.
  const onClose = () => {
    setIsOpen(false);
    setIsAllShown(false);
    markButton.current?.focus();
  };
  const confirm = () => {
    close();
    onConfirm();
  };
  const goTo = (row: ReviewRow) => {
    close();
    onGoTo(row);
  };
  const count = emptyRequired.length;
  const shown = isAllShown ? emptyRequired : emptyRequired.slice(0, SHOWN_EMPTY);

  return <>
    <button ref={markButton} type="button" data-slot="mark-applied" className={isPrimary ? button("primary", "large") : DONE} disabled={isSaving || isDisabled}
      aria-describedby="mark-applied-hint" onClick={() => setIsOpen(true)}>
      {CHECK}{isSaving ? "Saving…" : "Mark applied"}
    </button>
    <p id="mark-applied-hint" data-slot="mark-applied-hint" className="sr-only">Submitted the form? Mark the job applied in BenchQ.</p>
    <dialog ref={dialog} data-slot="autofill-confirm" className={DIALOG} aria-labelledby="autofill-confirm-title" aria-describedby="autofill-confirm-job" onClose={onClose}>
      {isOpen && <div className="grid animate-rise-in gap-4">
        <div className="grid justify-items-center gap-2 text-center">
          <span className={MARK} aria-hidden="true">{CHECK}</span>
          <div className="grid gap-0.5">
            <h2 id="autofill-confirm-title" className="text-h3">Mark this job as applied?</h2>
            <p id="autofill-confirm-job" className={`wrap-anywhere ${SOFT_TEXT}`}>{jobLine}</p>
          </div>
        </div>
        {count > 0 && <div data-slot="autofill-confirm-note" className={NOTE}>
          <p className="px-2 text-sm font-[600] text-[var(--color-warning-fg)]">{count === 1 ? "1 required field is still empty:" : `${count} required fields are still empty:`}</p>
          <ul className="grid gap-0.5">
            {shown.map((row) => <li key={row.key} className="min-w-0">
              <button type="button" className={FIELD_ROW} title={fieldLabel(row.field)} onClick={() => goTo(row)}>
                {ALERT_ICON}<span data-slot="autofill-confirm-field" className="min-w-0 flex-1 truncate">{fieldLabel(row.field)}</span>{CHEVRON_DOWN_ICON}
              </button>
            </li>)}
          </ul>
          {count > SHOWN_EMPTY && <button type="button" data-slot="autofill-confirm-more" className={MORE} aria-expanded={isAllShown}
            onClick={() => setIsAllShown(!isAllShown)}>{isAllShown ? "Show fewer" : `Show all ${count}`}</button>}
        </div>}
        <div className="grid gap-2">
          <button ref={yesButton} type="button" data-slot="mark-applied-confirm" className={`w-full ${button("primary", "large")}`} disabled={isDisabled} onClick={confirm}>Mark applied</button>
          <button type="button" className={`w-full ${button("secondary", "large")}`} onClick={close}>Cancel</button>
        </div>
      </div>}
    </dialog>
  </>;
}
