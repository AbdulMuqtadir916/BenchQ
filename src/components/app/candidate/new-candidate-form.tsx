"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { WORK_AUTH_LABEL } from "@/components/app/work-auth-chip";
import { useCan } from "@/lib/auth/permissions";
import { isBde, isManager } from "@/lib/auth/roles";
import { useAssignBlock, useCreateCandidate } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { useHref } from "@/lib/routes/use-href";
import { CreateCandidateSchema } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { useSignedInUser } from "@/lib/stores/session-store";
import { WorkAuth } from "@/lib/schemas/enums";

const WORK_AUTH_OPTIONS: SelectOption[] = WorkAuth.options.map((value) => ({ value, label: WORK_AUTH_LABEL[value] }));
const UNASSIGNED = "";

/**
 * New candidate (docs/04 §4.2), on the page and in the intercepted dialog. Saves through the mock
 * (the backend in Phase D) and opens the new candidate. At the firm's candidate limit the save is
 * visible but disabled with the reason (A4, docs/04 §0). Only a role with `candidate.assign` picks the
 * BDE; a BDE's new candidate is their own.
 */
export function NewCandidateForm({ idPrefix, onCancel }: { idPrefix: string; onCancel: () => void }) {
  const router = useRouter();
  const toHref = useHref();
  const canAssign = useCan("candidate.assign");
  const me = useSignedInUser();
  const team = useTeam();
  const block = useAssignBlock();
  const create = useCreateCandidate();
  const [workAuth, setWorkAuth] = useState<WorkAuth>("H1B");
  const [assignee, setAssignee] = useState(UNASSIGNED);
  const [problem, setProblem] = useState<string | null>(null);

  const bdeOptions: SelectOption[] = [
    { value: UNASSIGNED, label: "Unassigned" },
    ...(team.data ?? []).filter((user) => user.isActive && isBde(user)).map((user) => ({ value: user.id, label: user.name })),
  ];
  const id = (name: string) => `${idPrefix}-${name}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const parsed = CreateCandidateSchema.safeParse({
      fullName: text("fullName"),
      primaryRole: text("primaryRole"),
      email: text("email"),
      phone: text("phone") || null,
      linkedinUrl: null,
      city: null,
      state: null,
      yearsExperience: null,
      workAuth,
      workAuthExpiry: null,
      needsSponsorship: form.get("needsSponsorship") === "on",
      needsTransfer: form.get("needsTransfer") === "on",
      employmentTypes: [],
      rateTarget: null,
      rateMin: null,
      availableFrom: null,
      noticePeriodDays: null,
      targetRoles: [],
      willingToRelocate: false,
      workSettings: [],
      preferredLocations: [],
      contactNotes: null,
      summary: null,
      skills: [],
      preferredIndustries: [],
      dealBreakers: [],
      resumeParseId: null,
      ...legacyAssignment(me, team.data ?? [], canAssign && assignee !== UNASSIGNED ? assignee : null),
      handoffNote: null,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setProblem(null);
    create.mutate(parsed.data, {
      onSuccess: (candidate) => router.push(toHref("candidates.detail", { id: candidate.id })),
      onError: (error) => setProblem(error instanceof Error ? error.message : "The candidate wasn't saved. Try again."),
    });
  }

  // 07 Q45: only giving the candidate a BDE counts toward the limit (a BDE's own candidate always has one).
  const isBlocked = block.reason !== null && (isBde(me) || assignee !== UNASSIGNED);

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="space-y-4">
        <Field id={id("name")} label="Full name"><Input id={id("name")} name="fullName" className="bq-input" placeholder="e.g. Jane Doe" required autoComplete="off" /></Field>
        <Field id={id("title")} label="Target role / title"><Input id={id("title")} name="primaryRole" className="bq-input" placeholder="e.g. Senior Frontend Engineer" required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("email")} label="Email"><Input id={id("email")} name="email" type="email" className="bq-input" placeholder="jane@example.com" required /></Field>
          <Field id={id("phone")} label="Phone"><Input id={id("phone")} name="phone" type="tel" className="bq-input" placeholder="(555) 123-4567" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <span className="text-label">Work authorization</span>
            <Select value={workAuth} options={WORK_AUTH_OPTIONS} onValueChange={(value) => setWorkAuth(WorkAuth.parse(value))} aria-label="Work authorization" />
          </div>
          {canAssign ? (
            <div className="space-y-2">
              <span className="text-label">Assigned BDE</span>
              <Select value={assignee} options={bdeOptions} onValueChange={setAssignee} aria-label="Assigned BDE" disabled={team.isPending} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-2)]"><Checkbox name="needsSponsorship" />Needs sponsorship</label>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-2)]"><Checkbox name="needsTransfer" />Needs H-1B transfer</label>
        </div>
      </div>

      {problem ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{problem}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {isBlocked ? <p id={id("blocked")} className="mr-auto text-sm text-[var(--color-text-2)]">{block.reason}</p> : null}
        <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
        <Button className="bq-primary" type="submit" disabled={isBlocked || block.isPending || create.isPending} aria-describedby={isBlocked ? id("blocked") : undefined}>
          {create.isPending ? "Saving…" : "Save candidate"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The old form's assignment in the new shape (docs/02 §3.4): no BDE → the signed-in MANAGER's queue, or the firm's
 * first MANAGER's for the OWNER. With a BDE (or for a BDE's own candidate) the manager sent is only a placeholder: the
 * candidates mock files the candidate under that BDE's own manager, which the live team doesn't carry yet (06 PR 1).
 * Removed in onboarding module 04, with this form.
 */
function legacyAssignment(me: User, team: readonly User[], bdeId: string | null): { managerId: string; bdeId: string | null } {
  const queueOwner = isManager(me) ? me.id : (team.find((user) => user.isActive && isManager(user))?.id ?? "");
  if (isBde(me)) return { managerId: me.managerId ?? (queueOwner || me.id), bdeId: me.id };
  if (bdeId !== null) return { managerId: team.find((user) => user.id === bdeId)?.managerId ?? (queueOwner || bdeId), bdeId };
  return { managerId: queueOwner, bdeId: null };
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
