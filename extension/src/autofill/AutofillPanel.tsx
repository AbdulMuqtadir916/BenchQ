import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { applicationUrl, resumeStudioUrl, type Application } from "../api";
import { ALERT, button, MOTION, MUTED_TEXT, SOFT_TEXT, TEXT_BUTTON } from "../ui";
import { sendToBackground } from "./connection-store";
import { confirmsSmartApplication, smartApplication } from "./smart-application";
import { isOtherJobOnSite } from "./AddJobCard";
import AppliedPage from "./AppliedPage";
import AutofillDone from "./AutofillDone";
import DocumentSections from "./DocumentSections";
import { documentOf, fileKey, readOwnFile, resumeFileName } from "./documents";
import { needsRequiredAnswer } from "./form-memory";
import FormProgress from "./FormProgress";
import { ALERT_ICON, CHECK, CHEVRON_DOWN_ICON, RESUME_ICON, SPARKLES_ICON, SPINNER_ICON } from "./icons";
import CoverLetterPicker from "./CoverLetterPicker";
import { useCoverLetters } from "./use-cover-letters";
import JobCard from "./JobCard";
import JobDetails from "./JobDetails";
import { savedJobFacts } from "./job-details";
import { isThisJob, usePageJob } from "./use-page-job";
import { usePosting } from "./use-posting";
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
/** A page with no form yet: a quiet card that says what to do. */
const NO_FORM = "grid justify-items-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-3 py-4 text-center";
/** Why Mark applied waits: one quiet amber line over it. */
const REQUIRED_LEFT = "flex items-center justify-center gap-1.5 text-caption font-[550] text-[var(--color-warning-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none";

/** To "Autofill complete" once a run ends, or to the note of a run that stopped, so the BDE sees how it went: just
 * under the sticky top bar (their scroll margin), with the résumé and the fields below. Smoothly, unless the BDE's
 * system asks for less motion. With neither on show, to Needs you, where the BDE takes over; with nothing there
 * either, back to the top of the fields section. */
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
  card?.querySelector<HTMLElement>("[data-slot='autofill-fields']")?.scrollTo?.({ top: 0, behavior });
  return true;
}

/** A fill waiting for its résumé's review: which application it's for and which résumé answers it. */
/** `isFileSwap`: a file to put in place of the one on the form, which runs Autofill though no answer is left to fill:
 * taking the old file off is what brings the upload back for the new one (#148's review). */
type PendingFill = { context: string; resumeId: string | null; isFileSwap?: boolean };

/** The connected tab's job and its form, top to bottom: the job, the résumé the answers come from, Autofill, the run as
 * it goes, the résumé and the cover letter, then the rest of the form. The form stays theirs to submit. */
/** The design mock's state cards (job mismatch, marked applied): centred, a round mark over the title, tinted by meaning. */
const NOTICE = {
  danger: "grid justify-items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-danger-fg)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-danger-bg)_55%,transparent)] px-3 py-4 text-center",
  warning: "grid justify-items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-warning-fg)_26%,transparent)] bg-[color-mix(in_srgb,var(--color-warning-bg)_55%,transparent)] px-3 py-4 text-center",
  success: "grid justify-items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--color-success-fg)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-success-bg)_55%,transparent)] px-3 py-4 text-center",
} as const;
const MARK = "grid size-10 place-items-center rounded-full [&_svg]:size-5";
const MARK_TINT = {
  danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]",
  success: "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
} as const;
/** A state card's buttons: one under the other, full width, the way out first. */
const STACKED = "mt-1 grid w-full gap-1.5";
/** Facts in a state card, as the mock's monospace box: small caps names, then the values. */
const COMPARE = "grid w-full gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-left text-sm text-[var(--color-text)]";
const COMPARE_ROW = "flex min-w-0 items-baseline gap-2";
const COMPARE_LABEL = "w-20 flex-none font-mono text-caption uppercase tracking-wider text-[var(--color-text-3)]";

/** The job's views, as tabs under its card. */
const VIEWS = [{ id: "autofill", label: "Autofill", icon: SPARKLES_ICON }, { id: "tailoring", label: "Résumé tailoring", icon: RESUME_ICON }] as const;
/** Simplify's switch: the two views side by side in a soft track, the one on show raised. */
const VIEW_TABS = "grid flex-none grid-cols-2 gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-1";
const VIEW_TAB_BASE = `inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 text-sm font-[600] transition-[background,color,box-shadow] ${MOTION} [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none`;
const VIEW_TAB = `${VIEW_TAB_BASE} text-[var(--color-text-2)] hover:text-[var(--color-text)]`;
const VIEW_TAB_ON = `${VIEW_TAB_BASE} bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[var(--shadow-xs)]`;
/** Simplify's big Autofill button, in BenchQ's blue gradient: the panel's first action, right under the job. */
const CTA = `bq-primary inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[image:var(--gradient-primary)] px-4 text-body-strong transition-[background,box-shadow,transform] ${MOTION} enabled:hover:bg-[image:var(--gradient-primary-hover)] disabled:cursor-not-allowed disabled:bg-none [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;
const SPIN = "[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none";
/** The filled form's heading, Simplify's "Autofill complete!", kept at the top of the fields as they scroll. */
const FIELDS_HEAD = "sticky top-0 z-1 -mx-3 grid gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-0.5 pb-2";
/** The accordion's arrow: down while the fields are open, sideways while closed. */
const ACCORDION_MARK = "mt-0.5 flex-none text-[var(--color-text-3)] [&_svg]:size-[var(--icon-md)] [&_svg]:transition-transform motion-reduce:[&_svg]:transition-none";
/** Closed, the fields are their heading alone, as a card under the pickers. */
const FIELDS_HEAD_CLOSED = "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 shadow-[var(--shadow-xs)]";
/** Under the job and its Autofill: the pickers, and the fields over them from a run on. It clips the sheet while it's
 * down, so nothing of it reaches the actions under the panel. */
const STAGE = "relative -mx-3 flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-3";
/** The fields as a sheet over the pickers, sliding up and down with one smooth ease (motion reduced: no slide). */
const SHEET = "absolute inset-0 z-10 grid grid-cols-[minmax(0,1fr)] content-start gap-2.5 overflow-y-auto overscroll-contain bg-[var(--color-surface)] px-3 pb-1 transition-transform duration-[var(--duration-slide)] ease-[var(--ease-sheet)] will-change-transform motion-reduce:transition-none [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
/** The one part of Autofill that scrolls: the form's fields and answers, with the job, the résumé and the actions fixed
 * around it. It shrinks with the panel and scrolls; it never spills over the actions under it. */
const FIELDS = "relative -mx-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2.5 overflow-y-auto overscroll-contain px-3 pb-1 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin] empty:hidden";

const isAdp = (url: string | null) => {
  try {
    return url !== null && /(?:^|\.)adp\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

export default function AutofillPanel({ connection, tabUrl = null, firmId = null, firmSlug = null, details = null, applicationStatus = "ready", onRetryContext = () => {}, resumesUrl = null, candidateName, applying, isApplied, onApply, onDisconnect, onSessionExpired, onAccessLost }: AutofillPanelProps) {
  const { tabId, job } = connection;
  // The address the BDE said to keep this tab connected on, though it shows another job's page.
  const [keptUrl, setKeptUrl] = useState<string | null>(null);
  // The job's two views: filling the form, and the résumé that goes on it (picked, tailored). Both stay mounted, so a
  // tailoring that runs or a pick in progress carries on while the other view shows.
  const [view, setView] = useState<"autofill" | "tailoring">("autofill");
  // The job's own page (JobDetails), over the panel, from the job's bar.
  const [isDetailsShown, setIsDetailsShown] = useState(false);
  // The job's posting, read once its details page opens: its description, type, mode and posted date are in BenchQ's
  // posting, not in the applications list the panel has.
  const { posting, retry: retryPosting } = usePosting(firmId, connection.userId, connection.candidateId,
    isDetailsShown && applicationStatus === "ready" ? details?.job_id ?? null : null, onSessionExpired);
  // The cover letter the BDE picked for this form; until they pick, the job's newest in BenchQ.
  const [coverLetterPick, setCoverLetterPick] = useState<string | null | undefined>(undefined);
  // Once the form is filled the fields list can fold to its heading.
  const [isFieldsFolded, setIsFieldsFolded] = useState(false);
  // How tall the résumé and cover letter are: the closed fields' heading sits just under them.
  const [pickersHeight, setPickersHeight] = useState(0);
  const measurePickers = useCallback((box: HTMLDivElement | null) => {
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPickersHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // The tab moved on to another job's page on the job's own site, and the BDE hasn't said to keep it connected there:
  // the panel asks first, and nothing fills, on its own or queued, until they answer (PR #140's review).
  const [verified, setVerified] = useState<{ posting: string; form: string } | null>(null);
  useEffect(() => {
    const target = smartApplication(job.url, tabUrl);
    if (!target || !tabUrl) return;
    const controller = new AbortController();
    void confirmsSmartApplication(job.url, target, controller.signal).then(matches => {
      if (matches && !controller.signal.aborted) setVerified({ posting: job.url, form: tabUrl });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [job.url, tabUrl]);
  const verifiedForm = verified?.posting === job.url && verified.form === tabUrl ? tabUrl : null;
  const reviewConnection = useMemo(() => verifiedForm
    ? { ...connection, job: { ...connection.job, url: verifiedForm } } : connection, [connection, verifiedForm]);
  const movedAway = Boolean(!verifiedForm && tabUrl && job.url && tabUrl !== keptUrl && isOtherJobOnSite(tabUrl, job.url));
  // The job's page as the tab shows it now, for its details page: read as it opens, while the tab still shows the job.
  const pageJob = usePageJob(connection.tabId, isDetailsShown && !movedAway);
  const live = pageJob && isThisJob(pageJob, job, details) ? pageJob : null;
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
  // The job's cover letters in BenchQ, once the job is confirmed: the picked one goes on the form's cover-letter upload.
  const { letters: coverLetters, retry: retryLetters } = useCoverLetters(applicationStatus === "ready" && details?.job_id
    ? connection.applicationId : null, onSessionExpired);
  const coverLetterId = coverLetters.status !== "ready" ? null : coverLetterPick === undefined
    ? coverLetters.letters[0]?.id ?? null : coverLetters.letters.find(({ id }) => id === coverLetterPick)?.id ?? null;
  const state = useAutofill({ connection: reviewConnection, firmId, resumeId, fileName, pickedFile, coverLetterId, onSessionExpired, onAccessLost, isHeld: movedAway || isReadingOwnFile });
  const { rows, scanning, error, filling, run, outcome, fillCount, staleCount, needsConfirmation, answeredFrom, reviewedFor, attachment, step } = state;
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
  const tailorView = jobPostingId && listed.length > 0 ? <TailorResume tailoring={tailoring} from={source?.label ?? null}
    forJob={`${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""}`} onBack={() => setView("autofill")}
    isAgain={Boolean(source && listed.some(({ isTailored, baseId }) => isTailored && baseId === source.baseId))}
    isReadyListed={Boolean(tailoredId && listed.some(({ id }) => id === tailoredId))} isInUse={Boolean(tailoredId && tailoredId === pickedId)}
    studioUrl={tailoredId ? studioUrl(tailoredId) : null} isBusy={isWorking} refreshFailed={refreshFailed}
    onStart={() => tailor(source?.resumeId ?? null)} onUse={() => { if (tailoredId) pickResume(tailoredId); }} onDismiss={dismissTailoring}
    onReload={refresh} /> : null;
  // The tailoring view before it can tailor: why not yet.
  const tailorWaits = !jobPostingId ? "Tailoring opens once BenchQ has confirmed this job."
    : resumes.status === "ready" ? `${candidateName} has no resume in BenchQ to tailor yet.` : `Tailoring opens once ${candidateName}'s resumes are in.`;
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
  // A run the panel left before it ended (the BDE went to another tab, or closed the panel) goes on from the fields still
  // to fill once the panel is back on its page and ready, queued as a pick's fill is: no Autofill button to press again.
  // Once per panel: the run itself clears what it left when it ends here.
  const [isResumeTaken, setIsResumeTaken] = useState(false);
  if (state.resumeQueued && !isResumeTaken && readyContext === context && resumeId !== undefined) {
    setIsResumeTaken(true);
    setPendingFill({ context, resumeId });
  }
  // The keyboard shortcuts (background.ts), for this tab's job: each clicks its button, so it does nothing when the
  // button couldn't be clicked. Mark applied opens its dialog with Yes focused, so Enter confirms.
  useEffect(() => {
    const onShortcut = (message: unknown, sender: { id?: string; tab?: ChromeTab }) => {
      const shortcut = message as Partial<ShortcutMessage> | null;
      if (sender.id !== chrome.runtime.id || sender.tab || shortcut?.type !== "shortcut" || shortcut.tabId !== tabId) return false;
      const slot = { "run-autofill": "autofill-run", "mark-applied": "mark-applied" }[shortcut.command ?? "run-autofill"];
      setView("autofill");
      card.current?.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)?.click();
      return false;
    };
    chrome.runtime.onMessage.addListener(onShortcut);
    return () => chrome.runtime.onMessage.removeListener(onShortcut);
  }, [tabId]);
  const [isCollecting, setIsCollecting] = useState(false);
  const [applyCheckFailed, setApplyCheckFailed] = useState(false);
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
  // Simplify's flow: before a run, the big Autofill and the résumé, with only how many fields it fills; once a run has
  // filled the form, or there's nothing BenchQ can fill, the fields themselves, in a section that takes the room left.
  const stage = filling ? "during" : outcome || (hasForm && !hasFillsLeft) ? "after" : "before";
  // A required field counts once the form holds it, or says it's done (a password, a box the site ticks): a value
  // BenchQ only proposed doesn't.
  const emptyRequired = (currentRows ?? []).filter(needsRequiredAnswer);
  const unreadableForm = state.unreadableFrames > 0 && currentRows !== null && !currentRows.some(({ field }) => !field.isGone);
  // Mark applied waits for the form on show to have every required field; once it has gone, or there's none, it doesn't.
  const requiredLeft = !movedAway && !state.needsAccess && hasForm ? emptyRequired.length : 0;
  // Every field of the form, the résumé's upload and the cover letter's too, as Simplify lists them.
  const rest = currentRows ?? [];
  const jobLine = `${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""} · for ${candidateName}`;
  const goTo = (row: ReviewRow) => void state.goToField(row);
  // Another application in this tab whose résumés aren't ready yet: the form still holds the last one's fills.
  const contextChanged = readyContext !== null && readyContext !== context;
  const canApply = applicationStatus === "ready" && !["loading", "unavailable", "missing"].includes(resumes.status)
    && !contextChanged && !isSelectionSyncing;
  const confirmHost = () => void sendToBackground({ type: "confirm-host", tabId, host: state.confirmKey });
  const apply = async () => {
    setApplyCheckFailed(false);
    setIsCollecting(true);
    const { form, complete } = await state.finalForm();
    setIsCollecting(false);
    if (!complete) {
      setApplyCheckFailed(true);
      return;
    }
    onApply?.(form, picked?.id ?? null);
  };

  const jobName = `${job.title || "Untitled role"}${job.company ? ` at ${job.company}` : ""}`;
  // Wait for the tab or site-access question before showing the form review.
  const isOpen = !movedAway && !state.needsAccess;
  // Once filled, the open fields take the room under the job; closed, the résumé and cover letter come back above them.
  // From a run on, the fields are a sheet over the pickers: up over them while open (the run, then the filled form), down
  // to a heading under them when closed. The pickers stay put under it.
  const isSheet = isOpen && stage !== "before";
  const isSheetUp = isSheet && (stage === "during" || !isFieldsFolded);
  const hasLetterField = (currentRows ?? []).some(({ field }) => documentOf(field) === "cover-letter");
  // What the résumé's file needs the BDE for, on the résumé card (its own file, a file that couldn't be made, another file).
  const fileLine = isOpen && hasForm ? <DocumentSections rows={currentRows} details={details} resumesUrl={resumesUrl} isFilling={filling} onGoTo={goTo}
    picked={picked ? { label: picked.label, meta: picked.meta, url: studioUrl(picked.id), file: answeredFrom === picked.id ? attachment : null,
      source: answeredFrom === picked.id ? state.attachmentSource : null } : null} attached={state.attachedShown ? state.attachedFile : null}
    fileProblem={state.fileProblem} onRetryFile={() => void state.rescan()}
    ownFileError={ownFileError} onOwnFile={(chosen) => void takeOwnFile(chosen)} onRemoveOwnFile={removeOwnFile}
    ownFile={pickedFile ? { name: pickedFile.name } : null} refusedAccept={state.refusedAccept ?? null} benchQFile={state.attachedFile} /> : null;
  // A question about the tab comes first, in Autofill.
  const shown = isOpen ? view : "autofill";
  // The views as tabs: the arrow keys, Home and End move between them, as tabs do.
  const onViewKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = VIEWS.findIndex(({ id }) => id === shown);
    const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: VIEWS.length - 1 } as Record<string, number | undefined>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const to = VIEWS[(next + VIEWS.length) % VIEWS.length]!.id;
    setView(to);
    card.current?.querySelector<HTMLButtonElement>(`[data-slot='job-view-${to}']`)?.focus();
  };
  const jobUrl = details?.url ?? job.url;
  if (isDetailsShown) {
    // What Add job read and BenchQ saved, else the job's page as the tab shows it now, else what the jobs list has.
    const facts = savedJobFacts(job, details, posting.status === "ready" ? posting.posting : null, live);
    const descriptionStatus = facts.description ? "ready" : posting.status === "loading" ? "loading" : posting.status === "error" ? "error" : "ready";
    return <div data-slot="autofill" className="flex min-h-0 flex-1 flex-col">
      <JobDetails job={facts} descriptionStatus={descriptionStatus} onRetry={retryPosting} onBack={() => setIsDetailsShown(false)} actions={<>
        <button type="button" className={button("secondary", "large")} onClick={() => setIsDetailsShown(false)}>Back to Autofill</button>
        {jobUrl && <a className={button("primary", "large")} href={jobUrl} target="_blank" rel="noreferrer">Open posting</a>}
      </>} />
    </div>;
  }
  if (!movedAway && isApplied && applicationStatus === "ready") {
    return <div data-slot="autofill" className="flex min-h-0 flex-1 flex-col">
      <AppliedPage title={job.title || details?.title || "Untitled role"} company={job.company || details?.company || ""} logoUrl={details?.logoUrl}
        candidateName={candidateName} viewUrl={firmSlug ? applicationUrl(firmSlug, connection.applicationId) : null} onBack={onDisconnect} />
    </div>;
  }
  return <section ref={card} data-slot="autofill" className="flex min-h-0 flex-1 flex-col pt-2.5" aria-labelledby="autofill-title">
    {/* Simplify's layout: the job's two views as a switch at the top. Not while a question about the tab comes first. */}
    {isOpen && <div role="tablist" aria-label="This job" data-slot="job-views" className={VIEW_TABS} onKeyDown={onViewKey}>
      {VIEWS.map(({ id, label, icon }) => <button key={id} type="button" role="tab" id={`job-view-${id}`} data-slot={`job-view-${id}`}
        aria-selected={shown === id} aria-controls={`job-panel-${id}`} tabIndex={shown === id ? 0 : -1} className={shown === id ? VIEW_TAB_ON : VIEW_TAB}
        onClick={() => setView(id)}>{icon}{label}</button>)}
    </div>}

    {/* Autofill: the job and the résumé stay put; only the form's fields and answers scroll, between them and the actions. */}
    <div role="tabpanel" id="job-panel-autofill" aria-labelledby="job-view-autofill" hidden={shown !== "autofill"} data-slot="autofill-body"
      className="flex min-h-0 flex-1 flex-col gap-2.5 pt-2.5">
      <JobCard job={job} details={details} candidateName={candidateName} onDisconnect={onDisconnect} onDetails={() => setIsDetailsShown(true)} isCompact={stage === "after"} />
      {/* The résumé and the cover letter, and over them, from a run on, the form's fields (Simplify's accordion). */}
      <div data-slot="autofill-stage" className={STAGE}>
        {isOpen && <div ref={measurePickers} data-slot="autofill-pickers" className="grid flex-none gap-2.5" inert={isSheetUp}>
          {/* Simplify's big button, right under the job: Autofill, and how many fields it fills. */}
          {hasFillsLeft && <div data-slot="autofill-cta" className="grid flex-none gap-1">
            <button type="button" data-slot="autofill-run" className={`${CTA} ${isWorking ? SPIN : ""}`} disabled={isWorking || !reviewMatches || scanning || fillCount === 0 || needsConfirmation} onClick={() => {
                setIsFieldsFolded(false);
                void state.autofill();
              }}>
              {isWorking ? <>{SPINNER_ICON}Filling…</> : <>{SPARKLES_ICON}Autofill this page</>}
            </button>
            {reviewMatches && !filling && fillCount > 0 && <p data-slot="autofill-ready" className="sr-only">
              Ready to fill {fillCount} field{fillCount === 1 ? "" : "s"}{attachment && answeredFrom === picked?.id && rows?.some((row) => row.status === "ready" && row.write?.type === "file") ? ", the resume file first" : ""}.
            </p>}
          </div>}
          <ResumePicker resumes={resumes} candidateName={candidateName} resumesUrl={resumesUrl} studioUrl={studioUrl}
            isBusy={isWorking || applicationStatus !== "ready"} onPick={pickResume} onRetry={retry} onRetryContext={onRetryContext}
            onTailor={tailorView ? () => setView("tailoring") : undefined} fileLine={fileLine} />
          <CoverLetterPicker letters={coverLetters} pickedId={coverLetterId} hasField={hasLetterField} isBusy={isWorking}
            onPick={setCoverLetterPick} onRetry={retryLetters} />
        </div>}
      <div data-slot="autofill-fields" data-state={isSheet ? (isSheetUp ? "up" : "down") : undefined}
        className={isSheet ? `${SHEET} motion-safe:animate-sheet-rise` : FIELDS}
        style={isSheet ? { "--sheet-down": `calc(${pickersHeight}px + var(--spacing) * 2.5)`, ...(isSheetUp ? {} : { transform: "translateY(var(--sheet-down))" }) } as CSSProperties : undefined}>
      {/* The tab moved on to another job: asked first, and nothing else shows until the BDE answers. */}
      {movedAway && <div data-slot="moved-away" className={NOTICE.danger} role="alert">
        <span className={`${MARK} ${MARK_TINT.danger}`} aria-hidden="true">{ALERT_ICON}</span>
        <strong className="text-body-strong text-[var(--color-text)]">This tab now shows another job.</strong>
        <p className={`wrap-anywhere ${SOFT_TEXT}`}>It&apos;s still connected to {jobName}. Disconnect it to add or open the job on this page.</p>
        <div className={STACKED}>
          <button type="button" className={button("primary")} onClick={onDisconnect}>Disconnect</button>
          <button type="button" className={button("secondary")} onClick={() => setKeptUrl(tabUrl)}>Keep it connected</button>
        </div>
      </div>}
      {/* A site BenchQ may not read yet: its permission first, alone; the rest shows once it's given. */}
      {!movedAway && state.needsAccess && <SiteAccessNotice access={state.needsAccess} isDenied={state.isAccessDenied} isAsking={state.isAsking} onAllow={() => void state.allowAccess()} />}
      {isSheet && hasForm && <div data-slot="fields-head" className={isSheetUp ? FIELDS_HEAD : FIELDS_HEAD_CLOSED}>
        {/* Simplify's accordion: the heading opens and closes the fields, its arrow sideways while they're closed. While a
            run fills the form it says so, with how far it is, and stays open. */}
        <h3 className="text-body-strong text-[var(--color-text)]">
          <button type="button" data-slot="fields-fold" className="flex w-full min-w-0 items-start gap-2 text-left" aria-expanded={isSheetUp}
            aria-controls="autofill-fields-list" disabled={filling} onClick={() => setIsFieldsFolded((now) => !now)}>
            <span className="min-w-0 flex-1">
              {filling ? (run ? `Autofilling ${run.total} field${run.total === 1 ? "" : "s"}` : "Autofilling…") : <>
                {outcome ? "Autofill complete! " : ""}
                {emptyRequired.length ? <><span className="text-[var(--color-primary)]">{emptyRequired.length}</span> required field{emptyRequired.length === 1 ? " needs" : "s need"} review</> : "Every required field is filled"}
              </>}
            </span>
            {filling && run && <span data-slot="fields-run-count" className="flex-none self-center text-mono-sm text-[var(--color-text-3)]" aria-hidden="true">
              {run.items.filter(({ status }) => status !== "filling").length} of {run.total}
            </span>}
            {!filling && <span className={`${ACCORDION_MARK} ${isSheetUp ? "" : "[&_svg]:-rotate-90"}`} aria-hidden="true">{CHEVRON_DOWN_ICON}</span>}
          </button>
        </h3>
        {!filling && isSheetUp && <FormProgress rows={currentRows} isRestarting={pendingFill !== null} isCompact />}
      </div>}
      <div id="autofill-fields-list" hidden={stage === "after" && isFieldsFolded} className="grid grid-cols-[minmax(0,1fr)] gap-2.5 empty:hidden">
      {isOpen && needsConfirmation && <div data-slot="maybe-other-job" className={NOTICE.warning} role="alert">
        <span className={`${MARK} ${MARK_TINT.warning}`} aria-hidden="true">{ALERT_ICON}</span>
        <strong className="text-body-strong text-[var(--color-text)]">This page may be a different job.</strong>
        {/* The two jobs side by side, as the mock's code box: the one saved, and what this page says it is. */}
        <dl className={COMPARE}>
          <div className={COMPARE_ROW}><dt className={COMPARE_LABEL}>Saved</dt><dd className="min-w-0 wrap-anywhere">{jobName}</dd></div>
          {state.check.detected && <div className={COMPARE_ROW}><dt className={COMPARE_LABEL}>This page</dt><dd className="min-w-0 wrap-anywhere">{state.check.detected}</dd></div>}
        </dl>
        <div className={STACKED}>
          <button type="button" className={button("secondary")} onClick={confirmHost}>It&apos;s the right job</button>
          <button type="button" className={button("secondary")} onClick={onDisconnect}>Disconnect</button>
        </div>
      </div>}

      {/* Marked applied: the mock's success card, over the form it was filled on. */}

      {isOpen && isComplete && <AutofillDone filled={outcome?.filled ?? 0} rows={currentRows ?? []} attached={state.attachedFile}
        attachedShown={state.attachedShown} canSave onGoTo={goTo} />}

      {isOpen && isAdp(tabUrl) && <p data-slot="adp-focus" className={MUTED_TEXT}>ADP only takes typing on its own page: after you click Autofill, click the ADP form and BenchQ types in the details. Alt+Shift+F on the form works too.</p>}
      {isOpen && error && <div role="alert">
        <p data-slot="error" className={ALERT}>{error}</p>
        <button type="button" className={TEXT_BUTTON} disabled={scanning} onClick={() => void state.rescan()}>Try again</button>
      </div>}
      {isOpen && canReview && currentRows === null && !error && <p role="status" className="sr-only">Scanning this page…</p>}
      {isOpen && currentRows?.length === 0 && !scanning && !error && <div data-slot="no-form" className={NO_FORM}>
        <span className={`${MARK} ${MARK_TINT.warning}`} aria-hidden="true">{ALERT_ICON}</span>
        <h3 className="text-body-strong text-[var(--color-text)]">No form on this page yet</h3>
        <p className={`mt-0.5 ${SOFT_TEXT}`}>Click Apply on the employer&apos;s page. BenchQ scans the form when it opens, in this tab or a new one.</p>
        {unreadableForm && <p className={`mt-1 ${SOFT_TEXT}`}>If the form is embedded, open it in its own tab so BenchQ can verify it.</p>}
      </div>}
      {isOpen && hasForm && state.bankEmpty && picked && <p className={MUTED_TEXT}>This resume has no answers BenchQ can fill yet.</p>}

      {isOpen && step && <p data-slot="autofill-step" role="status" className={STEP}>{SPINNER_ICON}{step}</p>}
      {isOpen && filling && run && <RunList run={run} isHeadless={isSheet} />}
      {isOpen && reviewMatches && outcome?.stopped && outcome !== dismissed && <OutcomeNote onDismiss={dismiss} />}
      {isOpen && state.undoNote && <p className={MUTED_TEXT} role="status">{state.undoNote}</p>}

      {isOpen && stage === "after" && rest.length > 0 && <ReviewList rows={rest} isFilling={filling} onGoTo={goTo} onReplace={(chosen) => void state.replace(chosen)}
        onListOptions={state.listOptions} onChoose={(row, label) => void state.choose(row, label)}
        onSuggest={(row, entry) => void state.fillWith(row, entry)} onSave={state.saveAnswer} />}
      </div>
      </div>
      </div>
    </div>

    {/* Résumé tailoring: rewriting the résumé for this job, its action fixed at the foot of the view. */}
    <div role="tabpanel" id="job-panel-tailoring" aria-labelledby="job-view-tailoring" hidden={shown !== "tailoring"} data-slot="tailoring-body"
      className="flex min-h-0 flex-1 flex-col">
      {isOpen && (tailorView ?? <p data-slot="tailor-waits" className={`my-auto text-center ${MUTED_TEXT}`}>{tailorWaits}</p>)}
    </div>

    {/* The main actions, fixed at the foot of the panel under the fields, so Autofill and Mark applied are always in reach
        however long the form is. */}
    <div data-slot="autofill-actions" hidden={shown !== "autofill"} className="-mx-3 mt-2.5 grid flex-none gap-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2.5 pb-3 empty:hidden">
      {/* Once the BDE has run Autofill on this application, its form's next pages fill as they open (07 Q4). */}
      {isOpen && state.isFollowingSteps && hasForm && !isWorking && <p data-slot="autofill-follows" className="sr-only">Next pages of this form fill on their own as they open.</p>}
      {/* Mark applied steps aside while a run fills the form, and is back once it ends. */}
      {/* Not while the tab shows another job: marking it would mark the connected job from another job's page. */}
      {/* What's left before the BDE submits the form, once Autofill has done its part (Simplify's line over Submit). */}
      {!movedAway && onApply && canApply && !filling && requiredLeft > 0 && <p id="required-left" data-slot="required-left" className={REQUIRED_LEFT}>
        {ALERT_ICON}Fill {requiredLeft} required field{requiredLeft === 1 ? "" : "s"} to mark applied
      </p>}
      {!movedAway && onApply && canApply && !filling && requiredLeft === 0 && applyCheckFailed && <p role="status" className={REQUIRED_LEFT}>
        {ALERT_ICON}BenchQ couldn&apos;t verify the form. Check the page and try again.
      </p>}
      {!movedAway && onApply && canApply && !filling && <MarkApplied isPrimary={!hasFillsLeft} isSaving={applying || isCollecting} isDisabled={isWorking || scanning || !reviewMatches || unreadableForm || Boolean(state.needsAccess)} jobLine={jobLine} requiredLeft={requiredLeft} noteId="required-left" onConfirm={() => void apply()} />}
      {isApplied && applicationStatus === "ready" && <button type="button" className={button("secondary", "large")} disabled>{CHECK}Applied</button>}
      {isOpen && reviewMatches && state.undoable > 0 && !filling && <button type="button" className={button("secondary", "compact")}
        disabled={isWorking || scanning || applying || isCollecting || needsConfirmation} onClick={() => void state.undo()}>Undo</button>}
    </div>
  </section>;
}
