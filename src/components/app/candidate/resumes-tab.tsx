"use client";

import Link from "next/link";
import { FilePlus2, FileText, ShieldCheck } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Resume } from "@/lib/schemas/resume";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ResumeCard } from "@/components/app/resumes/resume-card";
import { useHref } from "@/lib/routes/use-href";

/** This candidate's resumes — same cards as the Resume Builder library, plus a quick start. */
export function ResumesTab({ candidate, resumes, isLoading, error, onRetry, canAct }: { candidate: Candidate; resumes: Resume[]; isLoading: boolean; error: Error | null; onRetry: () => void; canAct: boolean }) {
  const toHref = useHref();
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading resumes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="bq-card space-y-3 p-4"><Skeleton className="h-10 w-10" /><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-full" /></div>)}
      </div>
    );
  }
  if (resumes.length === 0) {
    return <EmptyState icon={FileText} title="No resumes yet" description="Build one from the verified profile — it fills itself in." action={canAct ? <Button asChild><Link href={toHref("resumes.studio", { id: "new" })}>Build resume</Link></Button> : undefined} />;
  }
  const ordered = [...resumes].sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
  const master = ordered.find((r) => r.isMaster);
  return (
    <div className="space-y-4">
      {master ? (
        <p className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-info-bg)] px-3 py-2.5 text-sm text-[var(--color-info-fg)]">
          <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>The <span className="font-[550]">master resume</span> is {candidate.fullName.split(" ")[0]}&apos;s verified source. Verify a claim there once and every tailored copy reuses it.</span>
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((r) => <li key={r.id} className="flex"><ResumeCard resume={r} candidate={candidate} /></li>)}
        {canAct ? (
          <li className="flex">
            <Link href={toHref("resumes.studio", { id: "new" })} className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] p-6 text-center text-sm text-[var(--color-text-3)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary-subtle-fg)]">
              <FilePlus2 size={20} aria-hidden />
              <span className="text-body-strong">New resume</span>
              <span>Tailor a copy for a specific role</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
