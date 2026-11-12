"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { Application } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { EmailReview, InboxMessage, ReviewEmailAction } from "@/lib/schemas/inbox";
import { useReviewEmail } from "@/lib/hooks/use-email-reviews";
import { SELECTABLE, STATUS_LABEL, STATUS_TONE, isSelectable } from "@/components/app/applications/status-meta";
import { categoryStatus, emailCategoryLabel, reviewReasonLabel } from "@/components/app/inbox/review-reason";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";

/** A review may confirm every stage except Saved (DEBUG D-10). */
const REVIEW_STAGES: readonly ApplicationStatus[] = SELECTABLE.filter((s) => s !== "SAVED");
/** Not a stage: confirming it dismisses the review as not about any application (DISMISS_NON_APPLICATION). */
const IRRELEVANT = "IRRELEVANT";
/** The stages this review may confirm: Incomplete only for an email classified Incomplete or an application already
 * Incomplete (DEBUG D-10; the backend refuses the rest). */
export function reviewStages(category: InboxMessage["classificationCategory"], appStatus?: Application["status"]): ApplicationStatus[] {
  return REVIEW_STAGES.filter((s) => s !== "INCOMPLETE_APPLICATION" || category === "incomplete_application" || appStatus === "INCOMPLETE_APPLICATION");
}
const stageOptions = (stages: readonly ApplicationStatus[]) => [{ value: "", label: "Choose a stage" },
  ...stages.map((s) => ({ value: s, label: STATUS_LABEL[s] })), { value: IRRELEVANT, label: "Irrelevant (not about an application)" }];
export const STAGE_OPTIONS = stageOptions(REVIEW_STAGES);

function failure(error: Error): string {
  return error instanceof ApiError && error.status === 409
    ? "This email or application changed. The latest data was loaded: check the status, then decide again."
    : error.message;
}

interface Props {
  message: InboxMessage;
  review: EmailReview;
  applications: Application[];
  canAct: boolean;
  /** The reader mounts this panel only while the review is open; Hide asks it to close. */
  onHide: () => void;
}

/** The BDE's decision on one email: confirm a stage, keep the current one, link only, or mark it Irrelevant. */
export function EmailReviewPanel({ message, review, applications, canAct, onHide }: Props) {
  const mutation = useReviewEmail(message.candidateId);
  const suggested = categoryStatus(message.classificationCategory);
  const [chosenApp, setChosenApp] = useState("");
  const [stage, setStage] = useState<string>(message.classificationCategory === "other" ? IRRELEVANT
    : suggested && REVIEW_STAGES.includes(suggested) ? suggested : "");
  const isIrrelevant = stage === IRRELEVANT;
  const [note, setNote] = useState("");
  const lockedId = message.applicationId ?? review.applicationId;
  const appId = lockedId ?? chosenApp;
  const app = applications.find((a) => a.id === appId);
  // Same rule as the backend's match eligibility: a draft that never left Saved cannot receive an email.
  const choices = applications.filter((a) => a.status !== "SAVED" || a.id === lockedId);
  const canKeep = !!app && isSelectable(app.status) && app.status !== "SAVED";
  const stages = reviewStages(message.classificationCategory, app?.status);
  const stageAllowed = isIrrelevant || stages.includes(stage as ApplicationStatus);
  const busy = mutation.isPending;
  const ready = message.contentRevision !== undefined;

  function decide(action: ReviewEmailAction) {
    if (!ready) return;
    const forApp = action !== "DISMISS_NON_APPLICATION" && app;
    mutation.mutate({
      messageId: message.id,
      command: {
        reviewId: review.id,
        expectedReviewRevision: review.revision,
        expectedContentRevision: message.contentRevision ?? 0,
        applicationId: forApp ? app.id : null,
        // The application's current, server-confirmed revision, never the one stored when the review was created.
        expectedApplicationRevision: forApp ? app.statusRevision : null,
        action,
        status: action === "SET_STATUS" ? (stage as ApplicationStatus) : undefined,
        note: note.trim() || null,
      },
    });
  }

  return (
    <section aria-label="Email review" className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-body-strong text-[var(--color-text)]">Needs your review</h3>
          <p className="text-sm text-[var(--color-text-3)]">
            {reviewReasonLabel(review.reason)}.
            {message.classificationCategory ? <> The classifier read it as <span className="font-[550] text-[var(--color-text-2)]">{emailCategoryLabel(message.classificationCategory)}</span>.</> : null}
            {" "}The application keeps its status until you decide.
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" className="self-start" aria-expanded onClick={onHide}>Hide review</Button>
      </div>
      {canAct ? (
        <div className="space-y-3">
          <div>
            <span className="block text-caption text-[var(--color-text-3)]">Application</span>
            <Select aria-label="Application" className="mt-1" value={appId} disabled={!!lockedId || busy}
              options={[{ value: "", label: "Choose an application" }, ...choices.map((a) => ({ value: a.id, label: `${a.companyNameAtApply} · ${a.jobTitleAtApply}` }))]}
              onValueChange={setChosenApp} />
            {app ? <p className="mt-1.5 flex items-center gap-2 text-caption text-[var(--color-text-3)]">Current status <Tag tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Tag></p> : null}
          </div>
          <div>
            <span className="block text-caption text-[var(--color-text-3)]">Confirm stage</span>
            <Select aria-label="Confirm stage" className="mt-1" value={stage} options={stageOptions(stages)} onValueChange={setStage} disabled={busy} />
          </div>
          <label className="block text-caption text-[var(--color-text-3)]">Note (optional)
            <textarea className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm text-[var(--color-text)]"
              value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          {app && !canKeep ? <p className="text-caption text-[var(--color-text-3)]">This application has an older status ({STATUS_LABEL[app.status]}); keeping it is not possible. Confirm a current stage, link only, or choose Irrelevant.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={(!isIrrelevant && (!app || !stage)) || !stageAllowed || busy || !ready}
              onClick={() => decide(isIrrelevant ? "DISMISS_NON_APPLICATION" : "SET_STATUS")}>{isIrrelevant ? "Confirm: Irrelevant" : "Confirm stage"}</Button>
            <Button size="sm" variant="secondary" disabled={!canKeep || busy || !ready} onClick={() => decide("KEEP_CURRENT")}>{canKeep && app ? `Keep ${STATUS_LABEL[app.status]}` : "Keep current stage"}</Button>
            <Button size="sm" variant="secondary" disabled={!app || busy || !ready} onClick={() => decide("LINK_ONLY")}>Link only</Button>
          </div>
          {mutation.isSuccess ? <p role="status" className="text-sm text-[var(--color-text-2)]">Decision saved.</p> : null}
          {mutation.error ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{failure(mutation.error)}</p> : null}
        </div>
      ) : !canAct ? <p className="text-sm text-[var(--color-text-3)]">You have read-only access to this review.</p> : null}
    </section>
  );
}
