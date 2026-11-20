"use client";

import { Inbox, Mail } from "lucide-react";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { formatRelative } from "@/lib/format/timezone";
import { reviewReasonLabel } from "@/components/app/inbox/review-reason";
import { SkeletonList } from "@/components/app/skeleton-list";
import { Button } from "@/components/ui/button";

/**
 * The BDE review column: emails waiting for a person, newest first. Each card opens the exact email, where the
 * review panel lives. The application keeps its last confirmed status until the decision is saved.
 */
export function ReviewQueue({ ws, actions, inBoard = false }: { ws: CandidateWorkspace; actions: CandidateActions; inBoard?: boolean }) {
  const query = ws.reviewsQuery;
  const hidden = ws.reviews.length === 0 && ws.reviewTotal > 0; // support view: counts only

  return (
    <section aria-label={`BDE review, ${ws.reviewTotal}`} className={inBoard ? "min-h-0" : "rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"}>
      {!inBoard ? <div className="mb-2 flex items-center gap-2">
        <Inbox size={16} aria-hidden className="text-[var(--color-violet-fg)]" />
        <h2 className="text-body-strong text-[var(--color-text)]">BDE Review</h2>
        <span className="bq-count">{ws.reviewTotal}</span>
      </div> : null}
      {query.isLoading ? <SkeletonList rows={2} /> : query.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-danger-fg)]">
          <span>{query.error.message}</span>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : hidden ? (
        <p className="text-sm text-[var(--color-text-3)]">{ws.reviewTotal} emails are waiting for a BDE. Their content is not shown in a support view.</p>
      ) : ws.reviews.length === 0 ? (
        <p className="text-sm text-[var(--color-text-3)]">Nothing waiting for review.</p>
      ) : (
        <ul className={inBoard ? "grid gap-2" : "grid gap-2 md:grid-cols-2"}>
          {ws.reviews.map((review) => (
            <li key={review.id}>
              <button type="button" onClick={() => actions.openMessage(review.messageId)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:bg-[var(--color-surface-2)]">
                <span className="block text-caption text-[var(--color-violet-fg)]">{reviewReasonLabel(review.reason)}</span>
                <span className="mt-0.5 block truncate text-body-strong text-[var(--color-text)]">{review.subject || "(no subject)"}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-[var(--color-text-3)]">
                  <Mail size={12} aria-hidden />{review.fromName || "Unknown sender"}{review.receivedAt ? ` · ${formatRelative(review.receivedAt)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? <Button size="sm" variant="secondary" className="mt-2" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more reviews</Button> : null}
    </section>
  );
}
