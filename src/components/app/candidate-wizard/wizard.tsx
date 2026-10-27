"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/features/admin/admin-dialog";
import { hasTeamScope } from "@/lib/auth/policy";
import { WORKING_STATUSES } from "@/lib/derive/tenancy";
import { useAssignBlock, useCreateCandidate } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { useHref } from "@/lib/routes/use-href";
import type { Candidate } from "@/lib/schemas/candidate";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { DiscardDialog } from "./discard-dialog";
import { STEPS, toCreateCandidate, validateStep, type StepId } from "./model";
import { StepAssign } from "./step-assign";
import { StepBasic } from "./step-basic";
import { StepDone, type Created } from "./step-done";
import { StepPreferences } from "./step-preferences";
import { StepResume } from "./step-resume";
import { StepWorkRate } from "./step-work-rate";
import { Stepper } from "./stepper";
import { SummaryCard } from "./summary-card";
import { useWizard } from "./use-wizard";

const STATUS_PHRASE: Record<Candidate["status"], string> = { ON_BENCH: "on the bench", INTERVIEWING: "interviewing", OFFER: "at offer", PLACED: "placed", PAUSED: "paused", INACTIVE: "inactive" };
const phrases = WORKING_STATUSES.map((status) => STATUS_PHRASE[status]);
/** "on the bench, interviewing or at offer", from the rule itself (07 Q45), so the copy can't drift from it. */
const WORKING_PHRASE = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} or ${phrases.at(-1)}` : phrases.join("");

const COPY: Record<StepId, { title: string; description: string }> = {
  resume: { title: "Start with the resume", description: "Drop it in and BenchQ fills the profile for you. Everything it pulls out stays editable, and nothing is saved until you create the candidate." },
  basic: { title: "Basic details", description: "The identity vendors see on every submission. Fields marked * are required." },
  work: { title: "Work authorization & rate", description: "Jobs that can't take this candidate are filtered out before a BDE ever sees them, so get these right." },
  preferences: { title: "Preferences", description: "What the candidate wants, and how the team should work their bench." },
  assign: { title: "Assign a BDE", description: `The BDE markets this candidate every night and answers for their pipeline. Load counts candidates ${WORKING_PHRASE}.` },
};

/**
 * The new-candidate flow (docs/candidate-onboarding/04-wizard-steps.md): stepper, the step, the summary card, and
 * Back · Skip for now · Continue. ⌘/Ctrl+Enter continues; Esc closes, asking first when anything was entered (07 Q48).
 * Step 5 assigns and creates (05-assign.md §1–§2); then the done screen.
 */
export function CandidateWizard() {
  const wizard = useWizard();
  const router = useRouter();
  const toHref = useHref();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [attempted, setAttempted] = useState<Partial<Record<StepId, boolean>>>({});
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const principal = useSignedInPrincipal();
  const team = useTeam();
  const block = useAssignBlock();
  const create = useCreateCandidate();
  const { step, stepIndex, values } = wizard;
  // A MANAGER must name a BDE (Q41), so at the candidate limit they can't create; the OWNER can still hand to a manager.
  const requiresBde = hasTeamScope(principal);
  const createBlock = requiresBde || values.bdeId !== null ? block.reason : null;
  const errors = attempted[step] ? validateStep(step, values, { requiresBde }) : {};

  // A new step: focus its heading, so a screen reader announces it and Tab starts at its first field.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(toHref("candidates"));
  }, [router, toHref]);

  const requestClose = useCallback(() => {
    if (wizard.isDirty) setIsConfirmingClose(true);
    else leave();
  }, [wizard.isDirty, leave]);

  const submit = useCallback(() => {
    if (create.isPending || createBlock) return;
    create.mutate(toCreateCandidate(values), {
      onSuccess: (candidate) => {
        const nameOf = (id: string | null) => (id ? team.data?.find((user) => user.id === id)?.name ?? null : null);
        setCreated({ id: candidate.id, name: candidate.fullName, bdeName: nameOf(candidate.bdeId), managerName: nameOf(candidate.managerId) ?? "the manager" });
        wizard.reset();
        wizard.goTo("resume");
      },
    });
  }, [create, createBlock, values, team.data, wizard]);

  const addAnother = useCallback(() => {
    setCreated(null);
    setAttempted({});
    create.reset();
  }, [create]);

  const goNext = useCallback(() => {
    if (Object.keys(validateStep(step, values, { requiresBde })).length > 0) {
      setAttempted((previous) => ({ ...previous, [step]: true }));
      requestAnimationFrame(() => {
        const invalid = mainRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        (invalid?.matches("input, textarea, select") ? invalid : invalid?.querySelector<HTMLElement>("input, textarea, select"))?.focus();
      });
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next) wizard.goTo(next.id);
    else submit();
  }, [step, stepIndex, values, wizard, requiresBde, submit]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!created) goNext();
      } else if (event.key === "Escape") {
        // Without this, the browser's own Escape handling runs after us and closes the dialog we just opened.
        event.preventDefault();
        if (created) leave();
        else requestClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, requestClose, leave, created]);

  const nameOf = (id: string | null) => (id ? team.data?.find((user) => user.id === id)?.name ?? null : null);
  const assignedName = nameOf(values.bdeId) ?? (values.managerId && !requiresBde ? `${nameOf(values.managerId) ?? "The manager"} picks` : null);
  const copy = COPY[step];
  const canContinue = step !== "resume" || values.resume !== null;
  const isLast = step === "assign";

  if (created) {
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 md:px-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"><UserPlus size={16} aria-hidden /></span>
          <h1 className="text-h3 text-[var(--color-text)]">New candidate</h1>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={leave} aria-label="Close new candidate"><X size={16} aria-hidden /></Button>
        </header>
        <StepDone created={created} onAddAnother={addAnother} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--color-border)] px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"><UserPlus size={16} aria-hidden /></span>
          <h1 className="text-h3 text-[var(--color-text)]">New candidate</h1>
        </div>
        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1 xl:flex xl:justify-center">
          <Stepper current={step} onGo={wizard.goTo} orientation="horizontal" />
        </div>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={requestClose} aria-label="Close new candidate"><X size={16} aria-hidden /></Button>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <section ref={mainRef} className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8" aria-labelledby="cw-step-heading">
          <h2 id="cw-step-heading" ref={headingRef} tabIndex={-1} className="bq-focus-target text-h2 text-[var(--color-text)]">{copy.title}</h2>
          <p className="mt-1 mb-6 text-body text-[var(--color-text-2)]">{copy.description}</p>
          {step === "resume" ? <StepResume wizard={wizard} /> : null}
          {step === "basic" ? <StepBasic wizard={wizard} errors={errors} /> : null}
          {step === "work" ? <StepWorkRate wizard={wizard} errors={errors} /> : null}
          {step === "preferences" ? <StepPreferences wizard={wizard} /> : null}
          {step === "assign" ? <StepAssign wizard={wizard} errors={errors} /> : null}
        </section>
        <aside className="space-y-4 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 lg:border-t-0 lg:border-l">
          <SummaryCard values={values} assignedBdeName={assignedName} />
          <Stepper current={step} onGo={wizard.goTo} orientation="vertical" />
        </aside>
      </div>

      <footer className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:px-6">
        {stepIndex > 0 ? (
          <Button variant="ghost" onClick={() => wizard.goTo(STEPS[stepIndex - 1]!.id)}><ArrowLeft size={14} aria-hidden />Back</Button>
        ) : (
          <Button variant="ghost" onClick={requestClose}>Cancel</Button>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {isLast && (createBlock || create.isError) ? (
            <p id="cw-create-problem" role={create.isError ? "alert" : undefined} className="text-caption text-[var(--color-danger-fg)]">{createBlock ?? errorMessage(create.error)}</p>
          ) : null}
          {step === "preferences" ? <Button variant="ghost" onClick={() => wizard.goTo("assign")}>Skip for now</Button> : null}
          {isLast ? (
            <Button onClick={goNext} disabled={createBlock !== null || create.isPending} aria-describedby={createBlock || create.isError ? "cw-create-problem" : undefined} aria-keyshortcuts="Control+Enter Meta+Enter">
              <Check size={14} aria-hidden />{create.isPending ? "Creating…" : "Create candidate"}
            </Button>
          ) : canContinue ? (
            <Button onClick={goNext} aria-keyshortcuts="Control+Enter Meta+Enter">Continue<ArrowRight size={14} aria-hidden /></Button>
          ) : null}
        </div>
      </footer>

      <DiscardDialog open={isConfirmingClose} onKeep={() => setIsConfirmingClose(false)} onDiscard={() => { setIsConfirmingClose(false); wizard.reset(); leave(); }} />
    </div>
  );
}
