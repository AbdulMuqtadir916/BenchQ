"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { FileText, Filter, Loader2, Plus, Search, Upload, CheckCircle2, X } from "lucide-react";
import type { Resume } from "@/lib/schemas/resume";
import type { Candidate } from "@/lib/schemas/candidate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { PageHeader } from "@/components/app/page-header";
import { ResumeCard } from "./resume-card";
import { useHref } from "@/lib/routes/use-href";

type Kind = "all" | "master" | "tailored";
type Upload = { name: string; status: "parsing" | "done" };

const KIND_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "master", label: "Master" },
  { value: "tailored", label: "Tailored" },
];

export function ResumeLibrary({
  resumes,
  candidates,
  isLoading,
  error,
  onRetry,
  canEdit,
}: {
  resumes: Resume[];
  candidates: Candidate[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  canEdit: boolean;
}) {
  const toHref = useHref();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [candidateId, setCandidateId] = useState("all");
  const [upload, setUpload] = useState<Upload | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const candidateOptions = useMemo(() => {
    const ids = new Set(resumes.map((r) => r.candidateId));
    return [
      { value: "all", label: "All candidates" },
      ...candidates.filter((c) => ids.has(c.id)).map((c) => ({ value: c.id, label: c.fullName })),
    ];
  }, [resumes, candidates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resumes.filter((r) => {
      if (kind === "master" && !r.isMaster) return false;
      if (kind === "tailored" && r.isMaster) return false;
      if (candidateId !== "all" && r.candidateId !== candidateId) return false;
      if (!q) return true;
      const c = byId.get(r.candidateId);
      return [r.name, c?.fullName, c?.primaryRole].some((f) => f?.toLowerCase().includes(q));
    });
  }, [resumes, byId, query, kind, candidateId]);

  const isFiltered = query.trim() !== "" || kind !== "all" || candidateId !== "all";

  function reset() {
    setQuery("");
    setKind("all");
    setCandidateId("all");
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    setUpload({ name: file.name, status: "parsing" });
    window.setTimeout(() => setUpload({ name: file.name, status: "done" }), 1400);
  }

  return (
    <div className="bq-page bq-page-wide">
      <PageHeader
        title="Resume Builder"
        subtitle="Every resume across your candidates. Open one to edit claims and export."
        actions={
          canEdit ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx"
                className="sr-only"
                aria-label="Upload resume file"
                tabIndex={-1}
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden />Upload resume</Button>
              <Button asChild><Link href={toHref("resumes.studio", { id: "new" })}><Plus size={14} aria-hidden />New resume</Link></Button>
            </>
          ) : undefined
        }
      />

      {upload ? (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-[var(--color-text-2)]">
            {upload.status === "parsing" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} className="text-[var(--color-verified-fg)]" aria-hidden />}
            <span className="truncate">{upload.status === "parsing" ? `Reading ${upload.name}…` : `${upload.name} parsed. Every line comes in unverified until you confirm it.`}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {upload.status === "done" ? <Button asChild size="sm"><Link href={toHref("resumes.studio", { id: "new" }, { upload: upload.name })}>Open in builder</Link></Button> : null}
            <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={() => setUpload(null)}><X size={14} aria-hidden /></Button>
          </span>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by resume, candidate or role" aria-label="Search resumes" className="pl-8" />
        </div>
        <Filter size={14} aria-hidden className="ml-1 text-[var(--color-text-3)]" />
        <Select className="w-36" aria-label="Filter by type" value={kind} options={KIND_OPTIONS} onValueChange={(v) => setKind(v as Kind)} />
        <Select className="w-48" aria-label="Filter by candidate" value={candidateId} options={candidateOptions} onValueChange={setCandidateId} />
        {isFiltered ? <Button variant="ghost" size="sm" onClick={reset}>Clear</Button> : null}
        {!isLoading && !error ? <span className="ml-auto text-caption text-[var(--color-text-3)] tabular">{filtered.length} of {resumes.length}</span> : null}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div role="status" aria-busy="true" aria-label="Loading resumes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bq-card space-y-3 p-4">
              <div className="flex gap-3"><Skeleton className="h-10 w-10" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        isFiltered ? (
          <EmptyState variant="filtered" icon={Search} title="No resumes match" description="Try a different search or clear the filters." action={<Button variant="secondary" onClick={reset}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={FileText} title="No resumes yet" description="Create a resume from scratch or upload an existing one to start verifying claims." action={canEdit ? <Button asChild><Link href={toHref("resumes.studio", { id: "new" })}><Plus size={14} aria-hidden />New resume</Link></Button> : undefined} />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <li key={r.id} className="flex"><ResumeCard resume={r} candidate={byId.get(r.candidateId)} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
