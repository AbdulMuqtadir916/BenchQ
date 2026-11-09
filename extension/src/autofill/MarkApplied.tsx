import { useLayoutEffect, useRef, useState } from "react";
import { button, FITTED_BUTTONS, SOFT_TEXT, WARNING } from "../ui";
import { fieldLabel } from "./form-memory";
import { CHECK } from "./icons";
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

const DIALOG = "m-auto max-h-[calc(100dvh-var(--dialog-gutter))] w-[min(var(--dialog-width),calc(100vw-var(--dialog-gutter)))] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-glass-edge)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-[var(--color-overlay)] backdrop:backdrop-blur-[var(--blur-overlay)]";
const FIELD_LINK = "text-left font-[550] underline underline-offset-2 wrap-anywhere hover:text-[var(--color-text)]";

/** Marking the job applied, behind a modal dialog: the panel waits behind it, focus starts on Yes, and Cancel or Esc
 * brings it back to the button. Required fields left empty are a warning, not a block, because the BDE may have filled
 * them where BenchQ can't see; each one is a way back to its field. */
export default function MarkApplied({ isPrimary, isSaving, isDisabled, jobLine, emptyRequired, onConfirm, onGoTo }: MarkAppliedProps) {
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
  const goTo = (row: ReviewRow) => {
    close();
    onGoTo(row);
  };
  const count = emptyRequired.length;

  return <>
    <button ref={markButton} type="button" data-slot="mark-applied" className={button(isPrimary ? "primary" : "secondary", "large")} disabled={isSaving || isDisabled} onClick={() => setIsOpen(true)}>
      {CHECK}{isSaving ? "Saving…" : "Mark applied"}
    </button>
    <dialog ref={dialog} data-slot="autofill-confirm" className={DIALOG} aria-labelledby="autofill-confirm-title" aria-describedby="autofill-confirm-job" onClose={onClose}>
      {isOpen && <div className="grid animate-rise-in gap-3">
        <div>
          <h2 id="autofill-confirm-title" className="text-h3">Mark this job as applied?</h2>
          <p id="autofill-confirm-job" className={`mt-0.5 wrap-anywhere ${SOFT_TEXT}`}>{jobLine}</p>
        </div>
        {count > 0 && <div data-slot="autofill-confirm-note" className={WARNING}>
          <p>{count === 1 ? "1 required field is still empty:" : `${count} required fields are still empty:`}</p>
          <ul className="mt-1 grid gap-0.5">
            {emptyRequired.map((row) => <li key={row.key}>
              <button type="button" className={FIELD_LINK} onClick={() => goTo(row)}>{fieldLabel(row.field)}</button>
            </li>)}
          </ul>
        </div>}
        <div className={FITTED_BUTTONS}>
          <button ref={yesButton} type="button" className={button("primary", "large")} disabled={isDisabled} onClick={confirm}>{CHECK}Yes, mark applied</button>
          <button type="button" className={button("secondary", "large")} onClick={close}>Cancel</button>
        </div>
      </div>}
    </dialog>
  </>;
}
