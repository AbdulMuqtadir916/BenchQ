"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHref } from "@/lib/routes/use-href";
import { DiscardDialog } from "./discard-dialog";
import { STEPS, validateStep, type StepId } from "./model";
import { StepBasic } from "./step-basic";
import { StepPreferences } from "./step-preferences";
import { StepResume } from "./step-resume";
import { StepWorkRate } from "./step-work-rate";
import { Stepper } from "./stepper";
import { SummaryCard } from "./summary-card";
import { useWizard } from "./use-wizard";

const COPY: Record<StepId, { title: string; description: string }> = {
  resume: { title: "Start with the resume", description: "Drop it in and BenchQ fills the profile for you. Everything it pulls out stays editable, and nothing is saved until you create the candidate." },
  basic: { title: "Basic details", description: "The identity vendors see on every submission. Fields marked * are required." },
  work: { title: "Work authorization & rate", description: "Jobs that can't take this candidate are filtered out before a BDE ever sees them, so get these right." },
  preferences: { title: "Preferences", description: "What the candidate wants, and how the team should work their bench." },
  assign: { title: "Assign a BDE", description: "Choosing the manager and BDE arrives with the next part of this flow (onboarding module 05)." },
};

/**
 * The new-candidate flow (docs/candidate-onboarding/04-wizard-steps.md): stepper, the step, the summary card, and
 * Back · Skip for now · Continue. ⌘/Ctrl+Enter continues; Esc closes, asking first when anything was entered (07 Q48).
 * Steps 1–4 here; step 5 and the done screen are module 05. Behind NEXT_PUBLIC_CANDIDATE_WIZARD until then.
 */
export function CandidateWizard() {
  const wizard = useWizard();
  const router = useRouter();
  const toHref = useHref();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [attempted, setAttempted] = useState<Partial<Record<StepId, boolean>>>({});
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const { step, stepIndex, values } = wizard;
  const errors = attempted[step] ? validateStep(step, values) : {};

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

  const goNext = useCallback(() => {
    if (Object.keys(validateStep(step, values)).length > 0) {
      setAttempted((previous) => ({ ...previous, [step]: true }));
      requestAnimationFrame(() => {
        const invalid = mainRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        (invalid?.matches("input, textarea, select") ? invalid : invalid?.querySelector<HTMLElement>("input, textarea, select"))?.focus();
      });
      return;
    }
    const next = STEPS[stepIndex + 1];
    if (next) wizard.goTo(next.id);
  }, [step, stepIndex, values, wizard]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        goNext();
      } else if (event.key === "Escape") {
        requestClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, requestClose]);

  const copy = COPY[step];
  const canContinue = step !== "assign" && (step !== "resume" || values.resume !== null);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--color-border)] px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"><UserPlus size={16} aria-hidden /></span>
          <h1 className="text-h3 text-[var(--color-text)]">New candidate</h1>
        </div>
        <div className="order-3 w-full md:order-none md:w-auto md:flex-1 md:justify-center lg:flex">
          <Stepper current={step} onGo={wizard.goTo} orientation="horizontal" />
        </div>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={requestClose} aria-label="Close new candidate"><X size={16} aria-hidden /></Button>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <section ref={mainRef} className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8" aria-labelledby="cw-step-heading">
          <h2 id="cw-step-heading" ref={headingRef} tabIndex={-1} className="text-h2 text-[var(--color-text)] outline-none">{copy.title}</h2>
          <p className="mt-1 mb-6 text-body text-[var(--color-text-2)]">{copy.description}</p>
          {step === "resume" ? <StepResume wizard={wizard} /> : null}
          {step === "basic" ? <StepBasic wizard={wizard} errors={errors} /> : null}
          {step === "work" ? <StepWorkRate wizard={wizard} errors={errors} /> : null}
          {step === "preferences" ? <StepPreferences wizard={wizard} /> : null}
        </section>
        <aside className="space-y-4 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 lg:border-t-0 lg:border-l">
          <SummaryCard values={values} />
          <Stepper current={step} onGo={wizard.goTo} orientation="vertical" />
        </aside>
      </div>

      <footer className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:px-6">
        {stepIndex > 0 ? (
          <Button variant="ghost" onClick={() => wizard.goTo(STEPS[stepIndex - 1]!.id)}><ArrowLeft size={14} aria-hidden />Back</Button>
        ) : (
          <Button variant="ghost" onClick={requestClose}>Cancel</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {step === "preferences" ? <Button variant="ghost" onClick={() => wizard.goTo("assign")}>Skip for now</Button> : null}
          {canContinue ? (
            <Button onClick={goNext} aria-keyshortcuts="Control+Enter Meta+Enter">Continue<ArrowRight size={14} aria-hidden /></Button>
          ) : null}
        </div>
      </footer>

      <DiscardDialog open={isConfirmingClose} onKeep={() => setIsConfirmingClose(false)} onDiscard={() => { setIsConfirmingClose(false); wizard.reset(); leave(); }} />
    </div>
  );
}
