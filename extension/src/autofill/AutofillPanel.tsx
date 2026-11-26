import { useCallback, useEffect, useRef, useState } from "react";
import { resumeStudioUrl, type Application } from "../api";
import { ALERT, button, CARD, FITTED_BUTTONS, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON, WARNING } from "../ui";
import { sendToBackground } from "./connection-store";
import { isOtherJobOnSite } from "./AddJobCard";
import AutofillDone from "./AutofillDone";
import DocumentSections from "./DocumentSections";
import { documentOf, fileKey, readOwnFile, resumeFileName } from "./documents";
import { filledValue } from "./form-memory";
import FormProgress from "./FormProgress";
import { CHECK, SPARKLES_ICON, SPINNER_ICON } from "./icons";
import JobCard from "./JobCard";
import MarkApplied from "./MarkApplied";
import OutcomeNote from "./OutcomeNote";
import ResumePicker from "./ResumePicker";
import ReviewList from "./ReviewList";
import RunList from "./RunList";
import type { AppliedForm, Connection, ReviewRow, ShortcutMessage } from "./types";
import { SiteAccessNotice } from "./SiteAccessNotice";
import { useAutofill, type Outcome } from "./use-autofill";
import { finishOwnFile, removeOwnFile as forgetOwnFile, settleSwap, startOwnFile, useOwnFile } from "./own-files";
import { useResumes, type ApplicationContextStatus } from "./use-resumes";
import TailorResume from "./TailorResume";
import { useTailoring } from "./use-tailoring";

type AutofillPanelProps = {
  connection: Connection;
  /** The connected tab's address now: on another job's page of the job's site, the panel asks whether to disconnect. */
  tabUrl?: string | null;
  /** The BDE's firm: its id reaches the candidate's résumés, its slug links to them on the website. */
  firmId?: string | null;
  firmSlug?: string | null;
  /** The saved application behind the tab, once the job list has it: where the job is, its pay, its documents. */
  details?: Application | null;
  /** Loading until the connected application's saved-job record is confirmed. */
  applicationStatus?: ApplicationContextStatus;
  onRetryContext?: () => void;
  /** The candidate's résumés on the website, when the firm is known. */
  resumesUrl?: string | null;
  candidateName: string;
  applying: boolean;
  isApplied: boolean;
  /** Marks the job applied with the form as it stands and the résumé the answers came from, the one sent. */
  onApply?: (form: AppliedForm, resumeId: string | null) => void;
  onDisconnect: () => void;
  onSessionExpired: () => void;
  onAccessLost: () => void;
};

/** What a run is doing before its first fill, beside a spinner. */
const STEP = "flex items-center gap-1.5 text-sm text-[var(--color-text-2)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none [&_svg]:animate-spin [&_svg]:text-[var(--color-primary)] motion-reduce:[&_svg]:animate-none";
const SKELETON = "grid gap-1.5 *:h-[var(--skeleton-row)] *:animate-pulse *:rounded-[var(--radius-md)] *:bg-[var(--color-surface-3)]";

/** To "Autofill complete" once a run ends, or to the note of a run that stopped, so the BDE sees how it went: just
 * under the sticky top bar (their scroll margin), with the résumé and the fields below. Smoothly, unless the BDE's
 * system asks for less motion. With neither on show, to Needs you, where the BDE takes over; with nothing there
 * either, back to the top of whatever scrolls the panel. */
const LOOK_EVERY_MS = 150;
const LOOKS_AFTER_RUN = 12;

function scrollToResult(card: HTMLElement | null, isLastLook = true): boolean {
  const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  // A run that stopped says why first. Then what Autofill couldn't fill, so the BDE starts there (the keyboard lands on
  // it too), and only a form with nothing left goes to "Autofill complete" and Mark applied.
  const stopped = card?.querySelector<HTMLElement>("[data-slot='autofill-result']");
  const needed = stopped ? null : card?.querySelector<HTMLElement>("[data-slot='review-needed']");
  const target = stopped ?? needed ?? card?.querySelector<HTMLElement>("[data-slot='autofill-done']");
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ behavior, block: "start" });
    needed?.querySelector<HTMLElement>("[data-slot='review-needed-title']")?.focus({ preventScroll: true });
    return true;
  }
  if (!isLastLook) return false;
  let scroller = card?.parentElement ?? null;
  while (scroller && !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  scroller?.scrollTo?.({ top: 0, behavior });
  return true;
}

/** A fill waiting for its résumé's review: which application it's for and which résumé answers it. */
/** `isFileSwap`: a file to put in place of the one on the form, which runs Autofill though no answer is left to fill:
 * taking the old file off is what brings the upload back for the new one (#148's review). */
type PendingFill = { context: string; resumeId: string | null; isFileSwap?: boolean };

/** The connected tab's job and its form, top to bottom: the job, the résumé the answers come from, Autofill, the run as
 * it goes, the résumé and the cover letter, then the rest of the form. The form stays theirs to submit. */
export default function AutofillPanel({ connection, tabUrl = null, firmId = null, firmSlug = null, details = null, applicationStatus = "ready", onRetryContext = () => {}, resumesUrl = null, candidateName, applying, isApplied, onApply, onDisconnect, onSessionExpired, onAccessLost }: AutofillPanelProps) {
  const { tabId, job } = connection;
  // The address the BDE said to keep this tab connected on, though it shows another job's page.
  const [keptUrl, setKeptUrl] = useState<string | null>(null);
  // The tab moved on to another job's page on the job's own site, and the BDE hasn't said to keep it connected there:
  // the panel asks first, and nothing fills, on its own or queued, until they answer (PR #140's review).
  const movedAway = Boolean(tabUrl && job.url && tabUrl !== keptUrl && isOtherJobOnSite(tabUrl, job.url));
  const { resumes, pick, retry, refresh, refreshFailed, source } = useResumes({
    firmId, candidateId: connection.candidateId, applicationId: connection.applicationId, applicationStatus,
    jobId: details?.job_id ?? null, namedId: details?.tailored_resume_id ?? null,
    onSessionExpired, onAccessLost,
  });
  const picked = resumes.status === "ready" ? resumes.picked : null;
  // Don't review from a fallback résumé until this application's own résumé is known and available.
  const canReview = applicationStatus === "ready" && !["loading", "unavailable", "missing"].includes(resumes.status);
  const resumeId = canReview ? picked?.id ?? null : undefined;
  const fileName = picked ? resumeFileName(candidateName, picked.title) : null;
  // A file the BDE picked from their computer for this candidate (Q5): kept outside the panel while the side panel is
  // open (`own-files.ts`), so switching tabs and back keeps it (#148's review); never saved or sent to BenchQ. It goes on
  // the form in place of the résumé's own until they remove it. While a pick is still being read, nothing fills, from a
  // click, a shortcut or a next page, so the file the BDE replaced can't go on the form (#148); the hold lifts once the
  // read settles, and the form is looked at again. Each pick and Remove counts, so the last one wins.
  const own = useOwnFile(connection.candidateId);
  const pickedFile = own.file;
  const isReadingOwnFile = own.isReading;
  const [ownFileError, setOwnFileError] = useState<string | null>(null);
  const state = useAutofill({ connection, firmId, resumeId, fileName, pickedFile, onSessionExpired, onAccessLost, isHeld: movedAway || isReadingOwnFile });
  const { rows, scanning, error, filling, run, outcome, undoable, fillCount, staleCount, needsConfirmation, answeredFrom, reviewedFor, attachment, step } = state;
  const context = `${connection.candidateId}:${connection.applicationId}`;
  // A pick, or another application linked to this tab, waits for its own résumé's review, then fills the form so
  // nothing of the last one stays (07 Q24). The panel is busy until that fill ends, unless the review failed: then the
  // BDE can pick again, and Try again picks the fill up.
  const [pendingFill, setPendingFill] = useState<PendingFill | null>(null);
  // The application the panel was last ready for, as state, so a new one is seen in the render that shows it.
  const [readyContext, setReadyContext] = useState<string | null>(null);
  if (applicationStatus === "ready" && resumes.status === "ready" && readyContext !== context) {
    setReadyContext(context);
    if (readyContext !== null) setPendingFill({ context, resumeId: picked?.id ?? null });
  }
  // A queued fill (a résumé pick, another application) waits for its review. On a site BenchQ may not read there is no review
  // to wait for until access is given, so the wait stays queued but no longer holds the panel, or Mark applied, busy.
  const isSelectionSyncing = pendingFill !== null && !(error && !scanning) && !state.needsAccess;
  // A run is busy from its first step (taking the old file off) to its last fill.
  const isWorking = filling || Boolean(step) || isSelectionSyncing;
  // A review is this application's, this résumé's and this file's: one for an earlier pick from the computer isn't (#148).
  const reviewMatches = canReview && reviewedFor?.applicationId === connection.applicationId
    && reviewedFor.candidateId === connection.candidateId && reviewedFor.resumeId === resumeId
    && (reviewedFor.fileId ?? null) === (pickedFile ? fileKey(pickedFile) : null);
  const currentRows = reviewMatches ? rows : null;
  const studioUrl = useCallback((versionId: string) => (firmSlug ? resumeStudioUrl(firmSlug, versionId) : null), [firmSlug]);
  const pickResume = (id: string) => {
    setPendingFill({ context, resumeId: id });
    pick(id);
  };
  // A file picked while BenchQ's is on the form takes its place at once, as a résumé pick does (07 Q24): once the read
  // settles and the form is looked at again, Autofill takes the old file off and puts this one on. The swap is the
  // candidate's, in the store, so a panel rebuilt while the file was read (a switch to another tab and back) still makes
  // it; whichever panel queues it settles it there, so none queues it twice. Remove does the same the other way, when
  // the BDE's file is the one on the form, known by its identity: it goes on under the résumé's file name (#148's review).
  const takeOwnFile = async (chosen: File) => {
    const candidateId = connection.candidateId;
    const pick = startOwnFile(candidateId, Boolean(state.attachedFile));
    const read = await readOwnFile(chosen).catch(() => "That file couldn't be read. Pick it again.");
    if (!finishOwnFile(candidateId, pick, typeof read === "string" ? null : read)) return;
    setOwnFileError(typeof read === "string" ? read : null);
  };
  const [queuedSwap, setQueuedSwap] = useState<number | null>(null);
  // Queued once the résumés are in: one queued while they load would wait for a résumé that never comes (#148's review).
  if (own.swap !== null && !own.isReading && own.file && own.swap !== queuedSwap && canReview && resumeId !== undefined) {
    setQueuedSwap(own.swap);
    setPendingFill({ context, resumeId, isFileSwap: true });
  }
  useEffect(() => {
    if (own.swap !== null && own.swap === queuedSwap) settleSwap(connection.candidateId, own.swap);
  }, [own.swap, queuedSwap, connection.candidateId]);
  const removeOwnFile = () => {
    const isOnForm = Boolean(pickedFile && state.holdsFile(fileKey(pickedFile)));
    forgetOwnFile(connection.candidateId);
    setOwnFileError(null);
    if (isOnForm && resumeId !== undefined) setPendingFill({ context, resumeId, isFileSwap: true });
  };
  // Tailor for this job: the connected job as BenchQ holds it for the candidate, once its record is confirmed.
  const jobPostingId = applicationStatus === "ready" ? details?.job_id ?? null : null;
  const pickedId = picked?.id ?? null;
  // A tailoring that finished: the list again, the résumé in use kept (refresh pins it), so nothing changes under the
  // BDE until they use the new one.
  const onTailored = useCallback(() => refresh(), [refresh]);
  const { tailoring, start: tailor, dismiss: dismissTailoring } = useTailoring({
    firmId, candidateId: connection.candidateId, jobId: jobPostingId, onSessionExpired, onTailored,
  });
  const listed = resumes.status === "ready" ? resumes.choices : [];
  const tailoredId = tailoring.status === "completed" ? tailoring.resumeId : null;
  const tailorFooter = jobPostingId && listed.length > 0 ? <TailorResume tailoring={tailoring} from={source?.label ?? null}
    isAgain={Boolean(source && listed.some(({ isTailored, baseId }) => isTailored && baseId === source.baseId))}
    isReadyListed={Boolean(tailoredId && listed.some(({ id }) => id === tailoredId))} isInUse={Boolean(tailoredId && tailoredId === pickedId)}
    studioUrl={tailoredId ? studioUrl(tailoredId) : null} isBusy={isWorking} refreshFailed={refreshFailed}
    onStart={() => tailor(source?.resumeId ?? null)} onUse={() => { if (tailoredId) pickResume(tailoredId); }} onDismiss={dismissTailoring}
    onReload={refresh} /> : null;
  const { autofill } = state;
  // The pending fill already started, so each one starts once.
  const startedFill = useRef<PendingFill | null>(null);
  // A pick fills the form at once, once its answers are in, when the form is on the page and it's the right job.
  useEffect(() => {
    const wanted = pendingFill;
    // While the tab shows another job, the fill waits, queued: "Keep it connected" lets it run (PR #140's review).
    // A file still being read keeps the fill queued: it runs once the read settles, with that file (#148).
    if (!wanted || movedAway || isReadingOwnFile || startedFill.current === wanted || wanted.context !== context || wanted.resumeId !== resumeId || !reviewMatches || scanning || filling) return;
    startedFill.current = wanted;
    // A new pick fills what it answers and takes back what the old one filled that it doesn't, so nothing stale stays.
    const fill = !needsConfirmation && rows?.length && (fillCount > 0 || staleCount > 0 || wanted.isFileSwap) ? autofill() : undefined;
    void Promise.resolve(fill).finally(() => setPendingFill((now) => (now === wanted ? null : now)));
  }, [pendingFill, movedAway, isReadingOwnFile, context, resumeId, reviewMatches, scanning, filling, rows, needsConfirmation, fillCount, staleCount, autofill]);
  // The keyboard shortcuts (background.ts), for this tab's job: each clicks its button, so it does nothing when the
  // button couldn't be clicked. Mark applied opens its dialog with Yes focused, so Enter confirms.
  useEffect(() => {
    const onShortcut = (message: unknown, sender: { id?: string; tab?: ChromeTab }) => {
      const shortcut = message as Partial<ShortcutMessage> | null;
      if (sender.id !== chrome.runtime.id || sender.tab || shortcut?.type !== "shortcut" || shortcut.tabId !== tabId) return false;
      const slot = { "run-autofill": "autofill-run", "mark-applied": "mark-applied" }[shortcut.command ?? "run-autofill"];
      card.current?.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)?.click();
      return false;
    };
    chrome.runtime.onMessage.addListener(onShortcut);
    return () => chrome.runtime.onMessage.removeListener(onShortcut);
  }, [tabId]);
  const [isCollecting, setIsCollecting] = useState(false);
  const card = useRef<HTMLElement>(null);
  const wasFilling = useRef(filling);
  // The note of a run that stopped, once the BDE closed it. A new run brings a new one.
  const [dismissed, setDismissed] = useState<Outcome | null>(null);
  const dismiss = useCallback(() => setDismissed(outcome), [outcome]);
  // A run follows its newest field down the panel, so once it ends the panel goes back up to how it went.
  useEffect(() => {
    const hasEnded = wasFilling.current && !filling;
    wasFilling.current = filling;
    if (!hasEnded || scrollToResult(card.current, false)) return;
    // The form is read again after a run, so its Needs you list can show a moment later: look for it briefly.
    let looks = 0;
    const timer = setInterval(() => {
      looks += 1;
      if (scrollToResult(card.current, looks >= LOOKS_AFTER_RUN)) clearInterval(timer);
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [filling]);
  // Once nothing is left to fill, Mark applied is the next step, so it takes the main button.
  const hasFillsLeft = canReview && (filling || !reviewMatches || fillCount > 0 || rows === null);
  const isComplete = reviewMatches && !hasFillsLeft && Boolean(outcome?.filled);
  const hasForm = currentRows !== null && currentRows.length > 0;
  const emptyRequired = (currentRows ?? []).filter((row) => row.field.required && !filledValue(row));
  // The résumé and the cover letter have sections of their own, so the list leaves them out.
  const rest = (currentRows ?? []).filter(({ field }) => !documentOf(field));
  const jobLine = `${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""} · for ${candidateName}`;
  const goTo = (row: ReviewRow) => void state.goToField(row);
  // The attached résumé's Change resume opens the picker at the top, on its list, when there's another to pick (07 Q55).
  const hasOtherResumes = resumes.status === "ready" && resumes.choices.length > 1;
  // Another application in this tab whose résumés aren't ready yet: the form still holds the last one's fills.
  const contextChanged = readyContext !== null && readyContext !== context;
  const canApply = applicationStatus === "ready" && !["loading", "unavailable", "missing"].includes(resumes.status)
    && !contextChanged && !isSelectionSyncing;
  const changeResume = () => {
    const select = card.current?.querySelector<HTMLButtonElement>("[data-slot='resume-select']");
    if (!select) return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    select.scrollIntoView?.({ block: "nearest", behavior });
    if (select.getAttribute("aria-expanded") === "true") select.focus();
    else select.click();
  };
  const confirmHost = () => void sendToBackground({ type: "confirm-host", tabId, host: state.confirmKey });
  const apply = async () => {
    setIsCollecting(true);
    const form = await state.finalForm();
    setIsCollecting(false);
    onApply?.(form, picked?.id ?? null);
  };

  const jobName = `${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""}`;
  // The panel's own content shows once nothing is asked first: neither that, nor a site's permission (Mark applied stays).
  const isOpen = !movedAway && !state.needsAccess;
  return <section ref={card} data-slot="autofill" className={`mb-3 ${CARD}`} aria-labelledby="autofill-title">
    <JobCard job={job} details={details} candidateName={candidateName} onDisconnect={onDisconnect} />

    <div data-slot="autofill-body" className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3 empty:hidden">
      {/* The tab moved on to another job: asked first, and nothing else shows until the BDE answers. */}
      {movedAway && <div data-slot="moved-away" className={WARNING} role="alert">
        <strong>This tab now shows another job.</strong>
        <p className="mt-0.5 mb-2 wrap-anywhere">It&apos;s still connected to {jobName}. Disconnect it to add or open the job on this page.</p>
        <div className={FITTED_BUTTONS}>
          <button type="button" className={button("secondary", "compact")} onClick={onDisconnect}>Disconnect</button>
          <button type="button" className={button("secondary", "compact")} onClick={() => setKeptUrl(tabUrl)}>Keep it connected</button>
        </div>
      </div>}
      {/* A site BenchQ may not read yet: its permission first, alone; the rest shows once it's given. */}
      {!movedAway && state.needsAccess && <SiteAccessNotice access={state.needsAccess} isDenied={state.isAccessDenied} isAsking={state.isAsking} onAllow={() => void state.allowAccess()} />}
      {isOpen && needsConfirmation && <div className={WARNING} role="alert">
        <strong>This page may be a different job.</strong>
        <p className="mt-0.5 mb-2 wrap-anywhere">Saved: {jobName}.{state.check.detected ? ` This page: ${state.check.detected}.` : ""}</p>
        <div className={FITTED_BUTTONS}>
          <button type="button" className={button("secondary", "compact")} onClick={confirmHost}>It&apos;s the right job</button>
          <button type="button" className={button("secondary", "compact")} onClick={onDisconnect}>Disconnect</button>
        </div>
      </div>}

      {/* How far the form is, then the résumé it answers from; Autofill itself floats at the bottom. */}
      {isOpen && hasForm && <FormProgress rows={currentRows} isRestarting={pendingFill !== null} />}
      {isOpen && isComplete && <AutofillDone filled={outcome?.filled ?? 0} rows={currentRows ?? []} attached={state.attachedFile}
        attachedShown={state.attachedShown} canSave onGoTo={goTo} />}

      {isOpen && <ResumePicker resumes={resumes} candidateName={candidateName} resumesUrl={resumesUrl} studioUrl={studioUrl}
        isBusy={isWorking || applicationStatus !== "ready"} onPick={pickResume} onRetry={retry} onRetryContext={onRetryContext} footer={tailorFooter} />}

      {isOpen && error && <div role="alert">
        <p data-slot="error" className={ALERT}>{error}</p>
        <button type="button" className={TEXT_BUTTON} disabled={scanning} onClick={() => void state.rescan()}>Try again</button>
      </div>}
      {isOpen && canReview && currentRows === null && !error && <div className={SKELETON} role="status" aria-label="Scanning this page"><span /><span /><span /></div>}
      {isOpen && currentRows?.length === 0 && !scanning && !error && <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] p-2.5">
        <h3 className="text-sm font-[550]">No form on this page yet</h3>
        <p className={`mt-0.5 ${SOFT_TEXT}`}>Click Apply on the employer&apos;s page. BenchQ scans the form when it opens, in this tab or a new one.</p>
        {state.unreadableFrames > 0 && <p className={`mt-1 ${SOFT_TEXT}`}>If you can already see a form, BenchQ can&apos;t read that part of the page, so fill it in yourself.</p>}
      </div>}
      {isOpen && hasForm && state.bankEmpty && picked && <p className={MUTED_TEXT}>This resume has no answers BenchQ can fill yet.</p>}

      {isOpen && step && <p data-slot="autofill-step" role="status" className={STEP}>{SPINNER_ICON}{step}</p>}
      {isOpen && filling && run && <RunList run={run} />}
      {isOpen && reviewMatches && outcome?.stopped && outcome !== dismissed && <OutcomeNote onDismiss={dismiss} />}
      {isOpen && state.undoNote && <p className={MUTED_TEXT} role="status">{state.undoNote}</p>}

      {isOpen && hasForm && <DocumentSections rows={currentRows} details={details} resumesUrl={resumesUrl} isFilling={filling} onGoTo={goTo}
        picked={picked ? { label: picked.label, meta: picked.meta, url: studioUrl(picked.id), file: answeredFrom === picked.id ? attachment : null,
          source: answeredFrom === picked.id ? state.attachmentSource : null } : null} attached={state.attachedShown ? state.attachedFile : null}
        onChangeResume={hasOtherResumes ? changeResume : undefined} fileProblem={state.fileProblem} onRetryFile={() => void state.rescan()}
        ownFileError={ownFileError} onOwnFile={(chosen) => void takeOwnFile(chosen)} onRemoveOwnFile={removeOwnFile}
        ownFile={pickedFile ? { name: pickedFile.name } : null} refusedAccept={state.refusedAccept ?? null} benchQFile={state.attachedFile} />}
      {isOpen && !filling && rest.length > 0 && <ReviewList rows={rest} isFilling={filling} onGoTo={goTo} onReplace={(chosen) => void state.replace(chosen)}
        onListOptions={state.listOptions} onChoose={(row, label) => void state.choose(row, label)}
        onSuggest={(row, entry) => void state.fillWith(row, entry)} onSave={state.saveAnswer} />}
    </div>

    {/* The main actions float at the bottom of the panel, so Autofill is always in reach however long the form is: flush
        with its edge, over the workspace's own bottom padding (-bottom-3 matches its pb-3). */}
    <div data-slot="autofill-actions" className="sticky -bottom-3 z-1 grid gap-1.5 rounded-b-[var(--radius-lg)] border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2 pb-3 shadow-[var(--shadow-sm)] empty:hidden">
      {isOpen && hasFillsLeft && <button type="button" data-slot="autofill-run" className={button("primary", "large")} disabled={isWorking || !reviewMatches || scanning || fillCount === 0 || needsConfirmation} onClick={() => void state.autofill()}>
        {isWorking ? "Filling…" : <>{SPARKLES_ICON}Autofill</>}
      </button>}
      {isOpen && hasFillsLeft && reviewMatches && !filling && fillCount > 0 && <p data-slot="autofill-ready" className={`text-center ${MUTED_TEXT}`}>
        Ready to fill {fillCount} field{fillCount === 1 ? "" : "s"}{attachment && answeredFrom === picked?.id && rows?.some((row) => row.status === "ready" && row.write?.type === "file") ? ", the resume file first" : ""}.
      </p>}
      {/* Once the BDE has run Autofill on this application, its form's next pages fill as they open (07 Q4). */}
      {isOpen && state.isFollowingSteps && hasForm && !isWorking && <p data-slot="autofill-follows" className={`text-center ${MUTED_TEXT}`}>Next pages of this form fill on their own as they open.</p>}
      {/* Mark applied steps aside while a run fills the form, and is back once it ends. */}
      {/* On a site BenchQ may not read yet there is no review to wait for: the BDE who declines fills the form by hand, and may still mark it applied. */}
      {/* Not while the tab shows another job: marking it would mark the connected job from another job's page. */}
      {!movedAway && onApply && canApply && !filling && <MarkApplied isPrimary={!hasFillsLeft} isSaving={applying || isCollecting} isDisabled={isWorking || (!reviewMatches && !state.needsAccess)} jobLine={jobLine} emptyRequired={emptyRequired} onConfirm={() => void apply()} onGoTo={goTo} />}
      {isApplied && applicationStatus === "ready" && <button type="button" className={button("secondary", "large")} disabled>{CHECK}Applied</button>}
      {isOpen && undoable > 0 && <button type="button" className={button("secondary", "compact")} disabled={filling} onClick={() => void state.undo()}>Undo</button>}
    </div>
  </section>;
}
