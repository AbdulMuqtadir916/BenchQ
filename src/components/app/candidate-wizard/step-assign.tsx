"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hasTeamScope } from "@/lib/auth/policy";
import { isBde, isManager } from "@/lib/auth/roles";
import { NOTE_MAX_LENGTH } from "@/lib/constants/candidate-intake";
import { deriveBdeLoad, isWorkingCandidate } from "@/lib/derive/tenancy";
import { useAssignBlock, useCandidates } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";
import { AssignOption, onRadioJK } from "./bde-option";
import { fieldAria, StepSection, WizardField } from "./field";
import type { Errors } from "./model";
import type { Wizard } from "./use-wizard";

/** "works 2 similar profiles" (A4): the BDE's working candidates marketed as the same title, ignoring case. */
function similarCount(bdeId: string, title: string, candidates: readonly Candidate[]): number {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return 0;
  return candidates.filter((candidate) => candidate.bdeId === bdeId && isWorkingCandidate(candidate) && candidate.primaryRole?.trim().toLowerCase() === wanted).length;
}

/**
 * Step 5 (docs/candidate-onboarding/05-assign.md §1, 07 Q41): a MANAGER picks one of their BDEs; the OWNER picks a
 * manager, then that manager's BDE or "Let {manager} choose" (the manager's "Needs a BDE" queue). Load is a warning
 * (Q46); at the candidate limit the BDE rows are disabled with the reason (Q45), and handing to a manager still works.
 */
export function StepAssign({ wizard, errors }: { wizard: Wizard; errors: Errors }) {
  const principal = useSignedInPrincipal();
  const firm = useFirm();
  const team = useTeam();
  const candidates = useCandidates();
  const block = useAssignBlock();
  const [query, setQuery] = useState("");
  const { values, set } = wizard;
  const isTeamScoped = hasTeamScope(principal);
  const ownId = principal.kind === "firm" ? principal.userId : null;

  // A MANAGER is always the candidate's manager (Q41).
  useEffect(() => {
    if (isTeamScoped && ownId && values.managerId !== ownId) set("managerId", ownId);
  }, [isTeamScoped, ownId, values.managerId, set]);

  const members = useMemo(() => (team.data ?? []).filter((user) => user.isActive), [team.data]);
  const managers = members.filter(isManager);
  const manager = managers.find((user) => user.id === values.managerId) ?? null;
  const bdes = members.filter((user) => isBde(user) && user.managerId === values.managerId);
  const needle = query.trim().toLowerCase();
  const shown = needle ? bdes.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(needle)) : bdes;
  const list = candidates.data ?? [];

  if (team.isPending || candidates.isPending) {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading the team">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-14 w-full" />)}</div>;
  }
  if (team.error || candidates.error) {
    return <p role="alert" className="text-sm text-[var(--color-danger-fg)]">The team couldn&apos;t be loaded. Go back a step and try again.</p>;
  }

  const bdeRow = (user: User) => {
    const load = deriveBdeLoad(user.id, list, firm.bdeCapacity);
    const similar = similarCount(user.id, values.primaryRole, list);
    return (
      <AssignOption key={user.id} name={user.name} avatarKey={user.id} group="cw-bde" value={user.id} checked={values.bdeId === user.id} disabled={block.reason !== null}
        title={user.name} onChange={() => set("bdeId", user.id)} isWarning={load.isAtCapacity}
        detail={<>{user.email}{similar > 0 ? ` · works ${similar} similar ${similar === 1 ? "profile" : "profiles"}` : ""}</>}
        figure={<>{load.load} / {load.capacity}{load.isAtCapacity ? <span> · At capacity</span> : null}</>} />
    );
  };

  return (
    <div className="space-y-8">
      {isTeamScoped ? null : (
        <StepSection title="Manager" description="The manager owns this candidate and picks their BDE.">
          <fieldset aria-label="Manager" aria-invalid={errors.managerId ? true : undefined} className="space-y-2" onKeyDown={onRadioJK}>
            {managers.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">There are no active managers. Invite one from Team settings first.</p> : null}
            {managers.map((user) => {
              const teamSize = members.filter((member) => isBde(member) && member.managerId === user.id).length;
              const queue = list.filter((candidate) => candidate.managerId === user.id && candidate.bdeId === null).length;
              return (
                <AssignOption key={user.id} name={user.name} avatarKey={user.id} group="cw-manager" value={user.id} checked={values.managerId === user.id}
                  title={user.name} detail={`${teamSize} ${teamSize === 1 ? "BDE" : "BDEs"} · ${queue} waiting for a BDE`}
                  onChange={() => { set("managerId", user.id); set("bdeId", null); }} />
              );
            })}
          </fieldset>
          {errors.managerId ? <p className="text-caption text-[var(--color-danger-fg)]">{errors.managerId}</p> : null}
        </StepSection>
      )}

      {manager || isTeamScoped ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-h3 text-[var(--color-text)]">BDE{isTeamScoped ? <span className="sr-only"> (required)</span> : null}</h3>
            <span className="text-caption text-[var(--color-text-3)]">Capacity {firm.bdeCapacity} per BDE</span>
          </div>
          {block.reason ? (
            <p role="status" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning-fg)]">
              <AlertTriangle size={14} aria-hidden />{block.reason}
            </p>
          ) : null}
          {bdes.length > 0 ? (
            <div className="bq-input flex items-center gap-2 text-body">
              <Search size={14} aria-hidden className="shrink-0 text-[var(--color-text-3)]" />
              <input type="search" aria-label="Search BDEs by name or email" placeholder="Search BDEs by name or email" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" />
            </div>
          ) : null}
          <fieldset aria-label="BDE" aria-invalid={errors.bdeId ? true : undefined} className="space-y-2" onKeyDown={onRadioJK}>
            {manager && !isTeamScoped ? (
              <AssignOption name={manager.name} avatarKey={null} group="cw-bde" value="" checked={values.bdeId === null} title={`Let ${manager.name} choose`}
                detail="The candidate waits in their Needs a BDE queue." onChange={() => set("bdeId", null)} />
            ) : null}
            {shown.map(bdeRow)}
            {bdes.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">{isTeamScoped ? "No BDEs report to you yet. Ask the owner to invite one." : `No BDEs report to ${manager?.name ?? "this manager"} yet.`}</p> : null}
            {bdes.length > 0 && shown.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No BDE matches “{query}”.</p> : null}
          </fieldset>
          {errors.bdeId ? <p className="text-caption text-[var(--color-danger-fg)]">{errors.bdeId}</p> : null}
        </section>
      ) : null}

      <WizardField id="cw-handoff" label={values.bdeId === null && manager && !isTeamScoped ? `Note to ${manager.name}` : "Note to the BDE"} hint="Context that isn't on the résumé.">
        <textarea {...fieldAria("cw-handoff", undefined, true)} rows={3} maxLength={NOTE_MAX_LENGTH} value={values.handoffNote} onChange={(event) => set("handoffNote", event.target.value)}
          placeholder="Strong in banking domains. Avoid roles that need onsite in NYC." className="bq-input h-auto w-full py-2" />
      </WizardField>
    </div>
  );
}
