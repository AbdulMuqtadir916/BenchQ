"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHref } from "@/lib/routes/use-href";

export interface Created {
  id: string;
  name: string;
  /** Who works it now: a BDE, or the manager whose queue it waits in. */
  bdeName: string | null;
  managerName: string;
}

/**
 * The done screen (docs/candidate-onboarding/05-assign.md §3). No promise of notifications or tonight's matching
 * (Q50): the backend makes neither. Open profile is focused; Find jobs opens the jobs page on this candidate (A6).
 */
export function StepDone({ created, onAddAnother }: { created: Created; onAddAnother: () => void }) {
  const toHref = useHref();
  const openRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    openRef.current?.focus();
  }, []);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center" aria-labelledby="cw-done-heading">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-success-bg)] text-[var(--color-success-fg)]">
        <Check size={28} aria-hidden />
        <span className="sr-only">Created</span>
      </span>
      <h2 id="cw-done-heading" className="mt-5 text-h2 text-[var(--color-text)]">{created.name} is on the bench</h2>
      <p role="status" className="mt-2 text-body text-[var(--color-text-2)]">
        {created.bdeName ? (
          <>Assigned to <strong className="text-[var(--color-text)]">{created.bdeName}</strong>. They&apos;ll see it under New assignments on their dashboard.</>
        ) : (
          <>Handed to <strong className="text-[var(--color-text)]">{created.managerName}</strong>, who will pick a BDE.</>
        )}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link ref={openRef} href={toHref("candidates.detail", { id: created.id })}>Open profile<ArrowRight size={14} aria-hidden /></Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={toHref("jobs", {}, { candidate: created.id })}><Search size={14} aria-hidden />Find jobs</Link>
        </Button>
        <Button variant="ghost" onClick={onAddAnother}><Plus size={14} aria-hidden />Add another</Button>
      </div>
    </section>
  );
}
