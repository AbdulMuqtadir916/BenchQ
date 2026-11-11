"use client";

import { useMemo } from "react";
import { FolderOpen, TriangleAlert } from "lucide-react";
import { useRemoveDocument } from "@/lib/hooks/use-documents";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import { DocumentList } from "./document-list";
import { ScreeningAnswers } from "./screening-answers";
import { UploadDocument } from "./upload-document";
import { expiryStatus } from "./document-meta";

/** What vendors ask for, in one place: the files, and the answers to their standard questions. */
export function DocumentsTab({ ws, canAct, onNotify }: { ws: CandidateWorkspace; canAct: boolean; onNotify: (message: string) => void }) {
  const candidate = ws.candidate!;
  const remove = useRemoveDocument(candidate.id);
  const documents = useMemo(() => ws.documentsQuery.data ?? [], [ws.documentsQuery.data]);
  const expiring = ws.expiringDocuments;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        {expiring.length ? (
          <div role="status" className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2.5 text-sm text-[var(--color-warning-fg)]">
            <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
            <span>{expiring.map((d) => `${d.title} — ${expiryStatus(d, ws.now)?.label.toLowerCase()}`).join(" · ")}. Ask {candidate.fullName.split(" ")[0]} for the renewed copy before vendors do.</span>
          </div>
        ) : null}
        {canAct ? <UploadDocument candidateId={candidate.id} onSaved={(title) => onNotify(`${title} added`)} /> : null}
        {ws.documentsQuery.error ? (
          <ErrorState error={ws.documentsQuery.error} onRetry={() => void ws.documentsQuery.refetch()} />
        ) : ws.documentsQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : documents.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No documents yet" description="Add the visa copy, ID and certifications — vendors ask for them with almost every submission." />
        ) : (
          <DocumentList
            documents={documents}
            now={ws.now}
            canAct={canAct}
            onRemove={(id) => {
              const doc = documents.find((d) => d.id === id);
              remove.mutate(id);
              onNotify(`${doc?.title ?? "Document"} removed`);
            }}
          />
        )}
      </div>
      <div className="lg:sticky lg:top-[calc(var(--topbar-height)+4.5rem)] lg:self-start">
        <ScreeningAnswers entries={candidate.qaBank} />
      </div>
    </div>
  );
}
