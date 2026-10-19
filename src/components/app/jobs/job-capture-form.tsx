"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Building2, Link2, MapPin, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { EMPLOYMENT_LABEL } from "@/components/app/candidate/overview/submission-facts";
import { isDuplicateJob } from "@/lib/api/jobs";
import { useCaptureJob } from "@/lib/hooks/use-jobs";
import { useHref } from "@/lib/routes/use-href";
import { EmploymentType, RemoteMode } from "@/lib/schemas/enums";
import { CaptureJobSchema } from "@/lib/schemas/job";

const WORK_MODE_OPTIONS: SelectOption[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
];

const EMPLOYMENT_OPTIONS: SelectOption[] = EmploymentType.options.map((value) => ({ value, label: EMPLOYMENT_LABEL[value] }));

const PAY_PERIOD_OPTIONS: SelectOption[] = [
  { value: "HOUR", label: "Per hour" },
  { value: "YEAR", label: "Per year" },
];

const toNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));

/**
 * Capture a job by hand (docs/04 §5.2), on /jobs/capture, in its intercepted dialog and in the jobs
 * page's dialog. Saves through the mock (the backend in Phase D) and opens the new job; the same listing
 * twice in a firm is refused with a link to the one already captured.
 */
export function JobCaptureForm({ modal = false, onClose }: { modal?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const toHref = useHref();
  const capture = useCaptureJob();
  const [workMode, setWorkMode] = useState<RemoteMode>("HYBRID");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("C2C");
  const [payPeriod, setPayPeriod] = useState<"HOUR" | "YEAR">("HOUR");
  const [problem, setProblem] = useState<{ message: string; jobId?: string } | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const parsed = CaptureJobSchema.safeParse({
      sourceUrl: text("sourceUrl"),
      title: text("title"),
      companyName: text("company"),
      location: text("location"),
      remoteMode: workMode,
      employmentType,
      payPeriod,
      payMin: toNumber(text("payMin")),
      payMax: toNumber(text("payMax")),
      sponsorsVisa: form.get("sponsorsVisa") === "on",
      excludesC2C: form.get("excludesC2C") === "on",
      experience: text("experience"),
      skills: text("skills").split(",").map((skill) => skill.trim()).filter(Boolean),
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
        router.push(toHref("jobs.detail", { id: job.id }));
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
        <p className="mt-1 text-sm text-[var(--color-text-3)]">Add the source and role details used for matching, outreach, and application tracking.</p>
      </header>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5" noValidate>
        <section aria-labelledby="capture-source-heading" className="space-y-3">
          <div>
            <h2 id="capture-source-heading" className="text-body-strong text-[var(--color-text)]">Source</h2>
            <p className="text-caption text-[var(--color-text-3)]">Keep the original listing attached to the job record.</p>
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
          <div>
            <h2 id="capture-details-heading" className="text-body-strong text-[var(--color-text)]">Role details</h2>
            <p className="text-caption text-[var(--color-text-3)]">The essentials candidates will be scored against.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="text-label">Job title</span><span className="relative block"><BriefcaseBusiness size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="title" required placeholder="Senior Java Developer" className="pl-8" /></span></label>
            <label className="block space-y-1.5"><span className="text-label">Company</span><span className="relative block"><Building2 size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="company" required placeholder="Company name" className="pl-8" /></span></label>
            <label className="block space-y-1.5"><span className="text-label">Location</span><span className="relative block"><MapPin size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" /><Input name="location" required placeholder="Dallas, TX" className="pl-8" /></span></label>
            <FieldLabel label="Work mode"><Select value={workMode} options={WORK_MODE_OPTIONS} onValueChange={(value) => setWorkMode(RemoteMode.parse(value))} aria-label="Work mode" /></FieldLabel>
            <FieldLabel label="Employment type"><Select value={employmentType} options={EMPLOYMENT_OPTIONS} onValueChange={(value) => setEmploymentType(EmploymentType.parse(value))} aria-label="Employment type" /></FieldLabel>
            <label className="block space-y-1.5"><span className="text-label">Required experience</span><Input name="experience" placeholder="e.g. 5+ years" /></label>
          </div>
        </section>

        <section aria-labelledby="capture-comp-heading" className="space-y-3">
          <h2 id="capture-comp-heading" className="text-body-strong text-[var(--color-text)]">Compensation & eligibility</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.15fr]">
            <label className="block space-y-1.5"><span className="text-label">Minimum</span><Input name="payMin" type="number" min="0" placeholder="$85" /></label>
            <label className="block space-y-1.5"><span className="text-label">Maximum</span><Input name="payMax" type="number" min="0" placeholder="$115" /></label>
            <FieldLabel label="Pay period"><Select value={payPeriod} options={PAY_PERIOD_OPTIONS} onValueChange={(value) => setPayPeriod(value === "YEAR" ? "YEAR" : "HOUR")} aria-label="Pay period" /></FieldLabel>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <CheckLabel name="sponsorsVisa" label="Visa sponsorship available" />
            <CheckLabel name="excludesC2C" label="No C2C" />
          </div>
        </section>

        <section className="space-y-3">
          <label className="block space-y-1.5"><span className="text-label">Core skills</span><Input name="skills" placeholder="Java, Spring Boot, AWS, PostgreSQL" /><span className="block text-caption text-[var(--color-text-3)]">Separate skills with commas.</span></label>
          <label className="block space-y-1.5"><span className="text-label">Job description</span><textarea name="description" required className="bq-input min-h-28 resize-y py-2 text-body" placeholder="Paste the responsibilities, requirements, and role context…" /></label>
        </section>

        <footer className="sticky -bottom-6 -mx-6 flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
          {problem ? (
            <p role="alert" className="text-sm text-[var(--color-danger-fg)]">
              {problem.message}
              {problem.jobId ? <> <Link className="underline" href={toHref("jobs.detail", { id: problem.jobId })} onClick={() => onClose?.()}>View job</Link></> : null}
            </p>
          ) : (
            <span className="hidden items-center gap-1.5 text-caption text-[var(--color-text-3)] sm:inline-flex"><Sparkles size={13} aria-hidden />Matching starts after capture</span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" type="button" onClick={() => (onClose ? onClose() : router.back())}>Cancel</Button>
            <Button type="submit" disabled={capture.isPending}>{capture.isPending ? "Capturing…" : "Capture job"}</Button>
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

function CheckLabel({ name, label }: { name: string; label: string }) {
  return <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-2)]"><Checkbox name={name} />{label}</label>;
}
