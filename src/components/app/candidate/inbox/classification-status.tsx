"use client";

import { RotateCw } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { describeError, type ErrorText } from "@/lib/api/error-text";
import { ErrorNote } from "@/components/app/error-note";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { useCan } from "@/lib/auth/permissions";
import { useRetryClassification } from "@/lib/hooks/use-email-reviews";
import { SETUP_ERRORS, classificationFailureReason } from "@/components/app/inbox/signal-meta";
import { Button } from "@/components/ui/button";

/** The screen's words for a 403, and for a 409 that came without the backend's own; a system error reads as
 * everywhere else (src/lib/api/error-text.ts). */
function retryFailure(error: Error): ErrorText {
  const isConflict = error instanceof ApiError && error.status === 409;
  return describeError(error, {
    fallback: isConflict ? "This email changed or the classifier is paused. Reload and try again." : undefined,
    screenText: (e) => (e instanceof ApiError && e.status === 403 ? "You don't have permission to retry classification." : null),
  });
}

/** What is happening with this email's classification, in words, with Retry where the role allows it (D-28). */
export function ClassificationStatus({ message }: { message: InboxMessage }) {
  // Always rendered: one polite region for every state, so a change (Classifying… → failed) is announced.
  return <div role="status" aria-live="polite"><StatusBody message={message} /></div>;
}

function StatusBody({ message }: { message: InboxMessage }) {
  const canRetry = useCan("email.retry");
  const retry = useRetryClassification(message.candidateId);
  const state = message.classificationState;
  if (!state || state === "DONE" || state === "EXCLUDED") return null;

  const box = "rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 text-sm";
  if (state === "NOT_QUEUED") {
    return <p className={`${box} text-[var(--color-text-3)]`}>Received before classification was switched on. It is classified when earlier emails are processed, and can then only suggest a change for review.</p>;
  }
  if (state === "PENDING" || state === "PROCESSING") {
    return <p className={`${box} text-[var(--color-text-3)]`}>Classifying this email…</p>;
  }
  const setup = !!message.classificationError && SETUP_ERRORS.includes(message.classificationError);
  const ready = message.contentRevision !== undefined && message.classificationVersion !== undefined;
  return (
    <div className={`${box} space-y-2 ${setup ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]"}`}>
      <p><span className="font-[550]">{setup ? "Waiting for classifier setup." : "Classification failed."}</span> {classificationFailureReason(message.classificationError)}</p>
      {setup ? <p>It is retried automatically once the classifier is set up, if recovery is switched on.</p> : null}
      {canRetry && ready ? (
        <Button size="sm" variant="secondary" disabled={retry.isPending || retry.isSuccess}
          onClick={() => retry.mutate({ messageId: message.id, contentRevision: message.contentRevision ?? 0, resultVersion: message.classificationVersion ?? 0 })}>
          <RotateCw size={13} aria-hidden /> Retry classification
        </Button>
      ) : null}
      {retry.isSuccess ? <p>Queued again.</p> : null}
      {retry.error ? <ErrorNote text={retryFailure(retry.error)} className="text-inherit" /> : null}
    </div>
  );
}
