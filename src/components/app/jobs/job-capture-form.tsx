"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Building2, Link2, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { isDuplicateJob } from "@/lib/api/jobs";
import { canSearchJobs, scopeCandidates } from "@/lib/auth/permissions";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useCaptureJob } from "@/lib/hooks/use-jobs";
import { useHref } from "@/lib/routes/use-href";
import { CaptureJobSchema } from "@/lib/schemas/job";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

/**
 * Capture a job by hand for one of the BDE's candidates (docs/02 §6.z), on /jobs/capture, in its intercepted dialog
 * and in the jobs page's dialog. Only what the backend keeps: the link, title, company, location and description.
 * Opens the new job; the same job again for the candidate links to the one they already have.
 */
export function JobCaptureForm({ modal = false, onClose }: { modal?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const candidatesQuery = useCandidates();
  const capture = useCaptureJob();
  const options = useMemo<SelectOption[]>(
    () => scopeCandidates(principal, candidatesQuery.data ?? []).filter((candidate) => canSearchJobs(principal, candidate)).map((candidate) => ({ value: candidate.id, label: candidate.fullName })),
    [candidatesQuery.data, principal],
  );
  // A first, choosable "Choose the candidate" entry: the list opens on it, so the keyboard can step to a candidate
  // (a disabled entry can't take focus). Choosing it and saving says "Choose the candidate."
  const choices = useMemo<SelectOption[]>(() => [{ value: "", label: "Choose the candidate" }, ...options], [options]);
  const [candidateId, setCandidateId] = useState("");
  const [problem, setProblem] = useState<{ message: string; jobId?: string } | null>(null);
  const chosen = candidateId || (options.length === 1 ? options[0]!.value : "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const parsed = CaptureJobSchema.safeParse({
      candidateId: chosen,
      sourceUrl: text("sourceUrl"),
      title: text("title"),
      companyName: text("company"),
      location: text("location"),
      description: text("description"),
    });
    if (!parsed.success) {
      setProblem({ message: parsed.error.issues[0]?.message ?? "Check the form." });
      return;
    }
    setProblem(null);
    capture.mutate(parsed.data, {
      onSuccess: (job) => {
        onClose?.();
        router.push(toHref("jobs.detail", { id: job.id }, { candidate: parsed.data.candidateId }));
      },
      onError: (error) => {
        if (isDuplicateJob(error)) setProblem({ message: error.message, jobId: error.jobId });
        else setProblem({ message: error instanceof Error ? error.message : "The job wasn't captured. Try again." });
      },
    });
  }

  return (
    <div>
      <header className={modal ? "pr-10" : undefined}>
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]">
          <BriefcaseBusiness size={18} aria-hidden />
        </div>
        <h1 id="capture-job-title" className="text-title text-[var(--color-text)]">Capture job</h1>
        <p className="mt-1 text-sm text-[var(--color-text-3)]">Add a job you found for one of your candidates. It joins their jobs.</p>
      </header>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5" noValidate>
        <section aria-labelledby="capture-for-heading" className="space-y-3">
          <h2 id="capture-for-heading" className="text-body-strong text-[var(--color-text)]">For</h2>
          {candidatesQuery.isLoading ? (
            <p className="text-caption text-[var(--color-text-3)]">Loading your candidates…</p>
          ) : candidatesQuery.error ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-2)]">
              <span>Your candidates didn&apos;t load.</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => void candidatesQuery.refetch()}>Retry</Button>
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-[var(--color-text-2)]">You have no candidates to capture a job for. A job is captured for a candidate you are the BDE of.</p>
          ) : (
            <FieldLabel label="Candidate">
              <Select value={chosen} options={choices} onValueChange={(value) => { setCandidateId(value); setProblem(null); }} aria-label="Candidate" />
            </FieldLabel>
          )}
        </section>

        <div className="h-px bg-[var(--color-border)]" />

        <section aria-labelledby="capture-source-heading" className="space-y-3">
          <div>
            <h2 id="capture-source-heading" className="text-body-strong text-[var(--color-text)]">Source</h2>
            <p className="text-caption text-[var(--color-text-3)]">Keep the original listing attached to the job.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-label">Job URL</span>
            <span className="relative block">
              <Link2 size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
              <Input name="sourceUrl" type="url" required placeholder="https://www.linkedin.com/jobs/view/…" className="pl-8" />
            </span>
          </label>
        </section>

        <div className="h-px bg-[var(--color-border)]" />

        <section aria-labelledby="capture-details-heading" className="space-y-3">
          <h2 id="capture-details-heading" className="text-body-strong text-[var(--color-text)]">Role</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="text-label">Job title</span><span className="relative block"><BriefcaseBusiness size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="title" required maxLength={300} placeholder="Senior Java Developer" className="pl-8" /></span></label>
            <label className="block space-y-1.5"><span className="text-label">Company</span><span className="relative block"><Building2 size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="company" required maxLength={300} placeholder="Company name" className="pl-8" /></span></label>
            <label className="block space-y-1.5 sm:col-span-2"><span className="text-label">Location <span className="text-[var(--color-text-3)]">(optional)</span></span><span className="relative block"><MapPin size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="location" maxLength={300} placeholder="Dallas, TX or Remote" className="pl-8" /></span></label>
          </div>
          <label className="block space-y-1.5"><span className="text-label">Job description</span><textarea name="description" required className="bq-input min-h-28 resize-y py-2 text-body" placeholder="Paste the responsibilities, requirements, and role context…" /></label>
        </section>

        <footer className="sticky -bottom-6 -mx-6 flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
          {problem ? (
            <p role="alert" className="text-sm text-[var(--color-danger-fg)]">
              {problem.message}
              {problem.jobId ? <> <Link className="underline" href={toHref("jobs.detail", { id: problem.jobId }, { candidate: chosen })} onClick={() => onClose?.()}>View job</Link></> : null}
            </p>
          ) : <span />}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" type="button" onClick={() => (onClose ? onClose() : router.back())}>Cancel</Button>
            <Button type="submit" disabled={capture.isPending || options.length === 0}>{capture.isPending ? "Capturing…" : "Capture job"}</Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export function JobCaptureDialogTrigger() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()}><Plus size={14} aria-hidden />Capture job</Button>
      <dialog
        ref={dialogRef}
        className="bq-dialog bq-dialog-wide"
        aria-labelledby="capture-job-title"
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
        }}
      >
        <div className="absolute right-4 top-4">
          <Button variant="ghost" size="icon" onClick={closeDialog} aria-label="Close capture job"><X size={18} /></Button>
        </div>
        <JobCaptureForm modal onClose={closeDialog} />
      </dialog>
    </>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><span className="text-label">{label}</span>{children}</div>;
}

