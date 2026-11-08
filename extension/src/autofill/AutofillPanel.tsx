import { useCallback, useEffect, useRef, useState } from "react";
import type { Application } from "../api";
import { ALERT, BELOW_TOP_BAR, button, CARD, FITTED_BUTTONS, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON, WARNING } from "../ui";
import { sendToBackground } from "./connection-store";
import DocumentSections from "./DocumentSections";
import { documentOf } from "./documents";
import { filledValue } from "./form-memory";
import { CHECK } from "./icons";
import JobCard from "./JobCard";
import MarkApplied from "./MarkApplied";
import OutcomeNote from "./OutcomeNote";
import ReviewList from "./ReviewList";
import RunList from "./RunList";
import type { AppliedForm, Connection, ReviewRow } from "./types";
import { useAutofill, type Outcome } from "./use-autofill";

type AutofillPanelProps = {
  connection: Connection;
  /** The saved application behind the tab, once the job list has it: where the job is, its pay, its documents. */
  details?: Application | null;
  /** The candidate's résumés on the website, when the firm is known. */
  resumesUrl?: string | null;
  candidateName: string;
  applying: boolean;
  isApplied: boolean;
  onApply?: (form: AppliedForm) => void;
  onDisconnect: () => void;
  onSessionExpired: () => void;
  onAccessLost: () => void;
};

const SKELETON = "grid gap-1.5 *:h-[var(--skeleton-row)] *:animate-pulse *:rounded-[var(--radius-md)] *:bg-[var(--color-surface-3)]";

/** To "Autofill complete" once a run ends, or to the run's note when fields are left, so the BDE sees how it went: just
 * under the sticky top bar (their scroll margin), with the résumé and the fields below. Smoothly, unless the BDE's
 * system asks for less motion. With neither on show, back to the top of whatever scrolls the panel. */
function scrollToResult(card: HTMLElement | null) {
  const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const result = card?.querySelector<HTMLElement>("[data-slot='autofill-done'], [data-slot='autofill-result']");
  if (result && typeof result.scrollIntoView === "function") {
    result.scrollIntoView({ behavior, block: "start" });
    return;
  }
  let scroller = card?.parentElement ?? null;
  while (scroller && !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  scroller?.scrollTo?.({ top: 0, behavior });
}

/** The connected tab's job and its form, top to bottom: the job, Autofill, the run as it goes, the résumé and the cover
 * letter, then the rest of the form. Nothing is written until the BDE clicks Autofill, and the form is theirs to submit. */
export default function AutofillPanel({ connection, details = null, resumesUrl = null, candidateName, applying, isApplied, onApply, onDisconnect, onSessionExpired, onAccessLost }: AutofillPanelProps) {
  const { tabId, job } = connection;
  const state = useAutofill({ connection, onSessionExpired, onAccessLost });
  const { rows, scanning, error, filling, run, outcome, undoable, fillCount, needsConfirmation } = state;
  const [isCollecting, setIsCollecting] = useState(false);
  const card = useRef<HTMLElement>(null);
  const wasFilling = useRef(filling);
  // The run's note, once it has gone or the BDE closed it. A new run brings a new one.
  const [dismissed, setDismissed] = useState<Outcome | null>(null);
  const dismiss = useCallback(() => setDismissed(outcome), [outcome]);
  // A run follows its newest field down the panel, so once it ends the panel goes back up to how it went.
  useEffect(() => {
    if (wasFilling.current && !filling) scrollToResult(card.current);
    wasFilling.current = filling;
  }, [filling]);
  // Once nothing is left to fill, Mark applied is the next step, so it takes the main button.
  const hasFillsLeft = filling || fillCount > 0 || rows === null;
  const isComplete = !hasFillsLeft && Boolean(outcome?.filled);
  const hasForm = rows !== null && rows.length > 0;
  const emptyRequired = (rows ?? []).filter((row) => row.field.required && !filledValue(row));
  // What the run's note says is still empty, required and optional.
  const left = { required: emptyRequired.length, optional: (rows ?? []).filter((row) => !row.field.required && !filledValue(row)).length };
  // The résumé and the cover letter have sections of their own, so the list leaves them out.
  const rest = (rows ?? []).filter(({ field }) => !documentOf(field));
  const jobLine = `${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""} · for ${candidateName}`;
  const goTo = (row: ReviewRow) => void state.goToField(row);
  const confirmHost = () => void sendToBackground({ type: "confirm-host", tabId, host: state.host });
  const apply = async () => {
    setIsCollecting(true);
    const form = await state.finalForm();
    setIsCollecting(false);
    onApply?.(form);
  };

  return <section ref={card} data-slot="autofill" className={`mb-3 ${CARD}`} aria-labelledby="autofill-title">
    <JobCard job={job} details={details} candidateName={candidateName} onDisconnect={onDisconnect} />

    <div data-slot="autofill-body" className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3 empty:hidden">
      {needsConfirmation && <div className={WARNING} role="alert">
        <strong>This page may be a different job.</strong>
        <p className="mt-0.5 mb-2 wrap-anywhere">Saved: {job.title || "Untitled role"}{job.company ? ` at ${job.company}` : ""}.{state.check.detected ? ` This page: ${state.check.detected}.` : ""}</p>
        <div className={FITTED_BUTTONS}>
          <button type="button" className={button("secondary", "compact")} onClick={confirmHost}>It&apos;s the right job</button>
          <button type="button" className={button("secondary", "compact")} onClick={onDisconnect}>Disconnect</button>
        </div>
      </div>}

      {hasFillsLeft && <button type="button" className={button("primary", "large")} disabled={filling || scanning || fillCount === 0 || needsConfirmation} onClick={() => void state.autofill()}>
        {filling ? "Filling…" : "Autofill"}
      </button>}
      {isComplete && <p data-slot="autofill-done" className={`flex items-center gap-1 ${BELOW_TOP_BAR} text-caption font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none`} role="status">{CHECK}Autofill complete</p>}

      {error && <div role="alert">
        <p data-slot="error" className={ALERT}>{error}</p>
        <button type="button" className={TEXT_BUTTON} disabled={scanning} onClick={() => void state.rescan()}>Try again</button>
      </div>}
      {rows === null && !error && <div className={SKELETON} role="status" aria-label="Scanning this page"><span /><span /><span /></div>}
      {rows?.length === 0 && !scanning && !error && <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] p-2.5">
        <h3 className="text-sm font-[550]">No form on this page yet</h3>
        <p className={`mt-0.5 ${SOFT_TEXT}`}>Click Apply on the employer&apos;s page. BenchQ scans the form when it opens, in this tab or a new one.</p>
        {state.unreadableFrames > 0 && <p className={`mt-1 ${SOFT_TEXT}`}>If you can already see a form, BenchQ can&apos;t read that part of the page, so fill it in yourself.</p>}
      </div>}
      {hasForm && state.bankEmpty && <p className={MUTED_TEXT}>{candidateName} has nothing in their QA bank yet, so BenchQ has no answers to fill.</p>}

      {filling && run && <RunList run={run} />}
      {outcome && outcome !== dismissed && <OutcomeNote outcome={outcome} left={left} onDismiss={dismiss} />}
      {state.undoNote && <p className={MUTED_TEXT} role="status">{state.undoNote}</p>}

      {hasForm && <DocumentSections rows={rows} details={details} resumesUrl={resumesUrl} isFilling={filling} onGoTo={goTo} />}
      {!filling && rest.length > 0 && <ReviewList rows={rest} isFilling={filling} onGoTo={goTo} onReplace={(chosen) => void state.replace(chosen)}
        onListOptions={state.listOptions} onChoose={(row, label) => void state.choose(row, label)} />}
    </div>

    <div data-slot="autofill-actions" className="sticky bottom-0 z-1 grid gap-1.5 rounded-b-[var(--radius-lg)] border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2 pb-3 empty:hidden">
      {/* Mark applied steps aside while a run fills the form, and is back once it ends. */}
      {onApply && !filling && <MarkApplied isPrimary={!hasFillsLeft} isSaving={applying || isCollecting} isDisabled={filling} jobLine={jobLine} emptyRequired={emptyRequired} onConfirm={() => void apply()} onGoTo={goTo} />}
      {isApplied && <button type="button" className={button("secondary", "large")} disabled>{CHECK}Applied</button>}
      {undoable > 0 && <button type="button" className={button("secondary", "compact")} disabled={filling} onClick={() => void state.undo()}>Undo</button>}
    </div>
  </section>;
}
