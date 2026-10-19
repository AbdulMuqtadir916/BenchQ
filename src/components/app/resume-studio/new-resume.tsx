"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, FileText, FileUp, Users } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Record_ } from "@/lib/schemas/record";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useRecord } from "@/lib/hooks/use-records";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { can, scopeCandidates } from "@/lib/auth/permissions";
import { buildResumeDocument, newClaim, newId } from "@/lib/resume-doc/build";
import { allClaims, setClaimState } from "@/lib/resume-doc/ops";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { cn } from "@/lib/cn";
import { RESUME_TEMPLATES } from "./templates";
import { ResumeStudio } from "./resume-studio";
import { StudioFrame } from "./studio-states";
import { useCloseStudio } from "./open-resume";
import { useStudio, type StudioMode } from "./studio-store";

type StartFrom = "record" | "blank";

function composeDocument(id: string, start: StartFrom, candidate: Candidate, record: Record_ | undefined, templateId: string, upload: string | null): ResumeDocument {
  const name = upload ? upload.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " ") : "Untitled resume";
  const shell = { id, firmId: candidate.firmId, candidateId: candidate.id, name, isMaster: false, targetJobId: null, templateId, versions: [], latestVersionId: "" };
  const doc = buildResumeDocument(shell, candidate, start === "record" ? record : undefined);
  if (start === "blank") {
    return { ...doc, summary: newClaim(), experience: [{ id: newId("exp"), company: "", title: "", location: "", dates: "", description: "", bullets: [newClaim()] }] };
  }
  if (!upload) return doc;
  // Parsed text is never evidence — every line of an upload starts unverified.
  return allClaims(doc).reduce((d, { claim }) => setClaimState(d, claim.id, "UNVERIFIED", `Parsed from ${upload} — confirm before it ships.`), doc);
}

export function NewResume({ initialMode, upload }: { initialMode: StudioMode; upload: string | null }) {
  const principal = useSignedInPrincipal();
  const close = useCloseStudio();
  const candidatesQuery = useCandidates();
  const [draftId] = useState(() => newId("resume_new"));
  const [candidateId, setCandidateId] = useState("");
  const [templateId, setTemplateId] = useState("template_modern");
  const [start, setStart] = useState<StartFrom | null>(null);
  const loadedId = useStudio((s) => s.doc?.resumeId);
  const load = useStudio((s) => s.load);

  const candidates = useMemo(() => {
    const all = candidatesQuery.data ?? [];
    return scopeCandidates(principal, all);
  }, [candidatesQuery.data, principal]);
  // The first candidate is preselected, so fall back to it until the user picks another.
  const candidate = candidates.find((c) => c.id === candidateId) ?? candidates[0];
  const recordQuery = useRecord(start === "record" && candidate ? candidate.id : "");

  useEffect(() => {
    if (!start || !candidate || loadedId === draftId) return;
    if (start === "record" && !recordQuery.data) return;
    load(composeDocument(draftId, start, candidate, recordQuery.data, templateId, upload), initialMode);
  }, [start, candidate, recordQuery.data, loadedId, draftId, templateId, upload, initialMode, load]);

  if (loadedId === draftId) {
    return <ResumeStudio subtitle={[candidate?.fullName, candidate?.primaryRole].filter(Boolean).join(" · ")} canEdit={can(principal, "resume.edit")} onClose={close} />;
  }

  const isBusy = start !== null;
  return (
    <StudioFrame onClose={close}>
      <div className="bq-card mx-auto my-6 w-[calc(100%-2rem)] max-w-2xl p-6 sm:my-10 sm:p-8">
        <span aria-hidden className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]">
          {upload ? <FileUp size={20} /> : <FilePlus2 size={20} />}
        </span>
        <h1 className="text-h1 text-[var(--color-text)]">{upload ? "Your upload is ready" : "Start a new resume"}</h1>
        <p className="mt-1 text-body text-[var(--color-text-3)]">
          {upload ? `We read ${upload}. Choose the candidate it belongs to — every line comes in unverified until you confirm it.` : "Choose a candidate and a template. You can switch templates any time."}
        </p>

        {candidatesQuery.error ? (
          <ErrorState error={candidatesQuery.error} onRetry={() => void candidatesQuery.refetch()} />
        ) : candidatesQuery.isLoading ? (
          <div role="status" aria-label="Loading candidates" className="mt-6 space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : !candidate ? (
          <EmptyState icon={Users} title="No candidates yet" description="Add a candidate first — a resume always belongs to someone on the bench." />
        ) : (
          <div className="mt-6 space-y-6">
            <div>
              <p className="mb-1.5 text-label text-[var(--color-text-2)]">Candidate</p>
              <Select aria-label="Candidate" value={candidate.id} onValueChange={setCandidateId} options={candidates.map((c) => ({ value: c.id, label: c.fullName, description: c.primaryRole ?? undefined }))} />
            </div>
            <div>
              <p className="mb-1.5 text-label text-[var(--color-text-2)]">Template</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {RESUME_TEMPLATES.map((t) => (
                  <button key={t.id} type="button" aria-pressed={t.id === templateId} onClick={() => setTemplateId(t.id)} className={cn("rounded-[var(--radius-md)] border p-2.5 text-left transition-colors", t.id === templateId ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]")}>
                    <span className="block text-sm font-[550] text-[var(--color-text)]">{t.name}</span>
                    <span className="block text-caption text-[var(--color-text-3)]">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-5">
              <Button onClick={() => setStart("record")} disabled={isBusy}>
                <FileText size={14} aria-hidden />
                {start === "record" ? "Reading the record…" : upload ? "Open parsed resume" : "Fill from candidate record"}
              </Button>
              {upload ? null : (
                <Button variant="secondary" onClick={() => setStart("blank")} disabled={isBusy}>Start blank</Button>
              )}
            </div>
            {recordQuery.error ? <ErrorState error={recordQuery.error} onRetry={() => void recordQuery.refetch()} /> : null}
          </div>
        )}
      </div>
    </StudioFrame>
  );
}
