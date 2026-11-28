import { useLayoutEffect, useRef, useState } from "react";
import { button, MOTION, SOFT_TEXT } from "../ui";
import { CHECK } from "./icons";

type MarkAppliedProps = {
  isPrimary: boolean;
  isSaving: boolean;
  isDisabled: boolean;
  /** Which job and whose: "Java Developer at Acme · for Priya". */
  jobLine: string;
  /** The required fields the form on show still needs. Mark applied waits for them; the note beside it (`noteId`) says
   * how many. */
  requiredLeft: number;
  noteId: string;
  onConfirm: () => void;
};

const DIALOG = "m-auto max-h-[calc(100dvh-var(--dialog-gutter))] w-[min(var(--dialog-width),calc(100vw-var(--dialog-gutter)))] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-glass-edge)] bg-[var(--color-surface)] p-5 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-[var(--color-overlay)] backdrop:backdrop-blur-[var(--blur-overlay)]";
/** The dialog's round mark over the question. */
const MARK = "grid size-10 place-items-center rounded-full bg-[var(--color-success-bg)] text-[var(--color-success-fg)] [&_svg]:size-5";
/** Mark applied while fields are still left to fill: Autofill keeps the primary look, and this one reads as "done", in
 * the success colours, so it's never mistaken for a quiet extra. */
const DONE = `inline-flex min-h-[var(--control-lg)] items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-success-fg)_40%,transparent)] bg-[var(--color-success-bg)] px-3 py-1 text-body-strong text-[var(--color-success-fg)] transition-[border-color,box-shadow,background,color] ${MOTION} enabled:hover:border-[var(--color-success-fg)] disabled:cursor-not-allowed disabled:border-[color-mix(in_srgb,var(--color-primary)_22%,transparent)] disabled:bg-[var(--color-primary-subtle)] disabled:text-[color-mix(in_srgb,var(--color-primary-subtle-fg)_62%,transparent)] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;

/** Marking the job applied, behind a modal dialog: the panel waits behind it, focus starts on Mark applied, and Cancel
 * or Esc brings it back to the button. The button waits while the form on show still has a required field to fill. */
export default function MarkApplied({ isPrimary, isSaving, isDisabled, jobLine, requiredLeft, noteId, onConfirm }: MarkAppliedProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const yesButton = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

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
    markButton.current?.focus();
  };
  const confirm = () => {
    close();
    onConfirm();
  };
  const isWaiting = requiredLeft > 0;

  return <>
    <button ref={markButton} type="button" data-slot="mark-applied" className={isPrimary ? button("primary", "large") : DONE}
      disabled={isSaving || isDisabled || isWaiting} aria-busy={isSaving} aria-describedby={isWaiting ? noteId : "mark-applied-hint"} onClick={() => setIsOpen(true)}>
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
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`w-full ${button("secondary", "large")}`} onClick={close}>Cancel</button>
          <button ref={yesButton} type="button" data-slot="mark-applied-confirm" className={`w-full ${button("primary", "large")}`} disabled={isDisabled} onClick={confirm}>Mark applied</button>
        </div>
      </div>}
    </dialog>
  </>;
}
