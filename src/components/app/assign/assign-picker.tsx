"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hasTeamScope } from "@/lib/auth/policy";
import { isBde, isManager } from "@/lib/auth/roles";
import { queueByManager } from "@/lib/derive/assignment";
import { deriveBdeLoad, isWorkingCandidate } from "@/lib/derive/tenancy";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useFirm } from "@/lib/tenancy/firm-context";
import { AssignOption, onRadioJK } from "./assign-option";

/** "works 2 similar profiles" (A4): the BDE's working candidates marketed as the same title, ignoring case. */
function similarCount(bdeId: string, title: string, candidates: readonly Candidate[]): number {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return 0;
  return candidates.filter((candidate) => candidate.bdeId === bdeId && isWorkingCandidate(candidate) && candidate.primaryRole?.trim().toLowerCase() === wanted).length;
}

export interface AssignTarget {
  managerId: string;
  bdeId: string | null;
}

/**
 * Who works a candidate (07 Q41, Q43; docs/candidate-onboarding/05 §1, §6), for step 5 and the reassign dialog. A
 * MANAGER (team scope) is always the manager and picks one of their BDEs; the OWNER picks a manager, then that
 * manager's BDE or "Let {manager} choose". Load is a warning (Q46). `blockReason` (the candidate limit, Q45) disables
 * the BDE rows; handing to a manager still works. `primaryRole` drives "works N similar profiles".
 */
export function AssignPicker({
  idPrefix,
  value,
  onChange,
  primaryRole,
  blockReason,
  errors = {},
}: {
  idPrefix: string;
  value: AssignTarget;
  onChange: (next: AssignTarget) => void;
  primaryRole: string;
  blockReason: string | null;
  errors?: { managerId?: string; bdeId?: string };
}) {
  const principal = useSignedInPrincipal();
  const firm = useFirm();
  const team = useTeam();
  const candidates = useCandidates();
  const [query, setQuery] = useState("");
  const isTeamScoped = hasTeamScope(principal);
  const ownId = principal.kind === "firm" ? principal.userId : null;

  // A MANAGER is always the manager (Q41).
  useEffect(() => {
    if (isTeamScoped && ownId && value.managerId !== ownId) onChange({ managerId: ownId, bdeId: null });
  }, [isTeamScoped, ownId, value.managerId, onChange]);

  const members = useMemo(() => (team.data ?? []).filter((user) => user.isActive), [team.data]);
  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  const queues = useMemo(() => queueByManager(list), [list]);

  if (team.isPending || candidates.isPending) {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading the team">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-14 w-full" />)}</div>;
  }
  if (team.error || candidates.error) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger-fg)]">
        The team couldn&apos;t be loaded. <button type="button" className="underline" onClick={() => { void team.refetch(); void candidates.refetch(); }}>Try again</button>
      </p>
    );
  }

  const managers = members.filter(isManager);
  const manager = managers.find((user) => user.id === value.managerId) ?? null;
  const bdes = members.filter((user) => isBde(user) && user.managerId === value.managerId);
  const needle = query.trim().toLowerCase();
  const shown = needle ? bdes.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(needle)) : bdes;

  const bdeRow = (user: User) => {
    const load = deriveBdeLoad(user.id, list, firm.bdeCapacity);
    const similar = similarCount(user.id, primaryRole, list);
    return (
      <AssignOption key={user.id} name={user.name} avatarKey={user.id} group={`${idPrefix}-bde`} value={user.id} checked={value.bdeId === user.id} disabled={blockReason !== null}
        title={user.name} onChange={() => onChange({ managerId: value.managerId, bdeId: user.id })} isWarning={load.isAtCapacity}
        detail={<>{user.email}{similar > 0 ? ` · works ${similar} similar ${similar === 1 ? "profile" : "profiles"}` : ""}</>}
        figure={<>{load.load} / {load.capacity}{load.isAtCapacity ? <span> · At capacity</span> : null}</>} />
    );
  };

  return (
    <div className="space-y-6">
      {isTeamScoped ? null : (
        <section className="space-y-3">
          <div>
            <h3 className="text-h3 text-[var(--color-text)]">Manager</h3>
            <p className="mt-0.5 text-caption text-[var(--color-text-3)]">The manager owns this candidate and picks their BDE.</p>
          </div>
          <fieldset aria-label="Manager" aria-invalid={errors.managerId ? true : undefined} className="space-y-2" onKeyDown={onRadioJK}>
            {managers.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">There are no active managers. Invite one from Team settings first.</p> : null}
            {managers.map((user) => {
              const teamSize = members.filter((member) => isBde(member) && member.managerId === user.id).length;
              const queue = queues.get(user.id) ?? 0;
              return (
                <AssignOption key={user.id} name={user.name} avatarKey={user.id} group={`${idPrefix}-manager`} value={user.id} checked={value.managerId === user.id}
                  title={user.name} detail={`${teamSize} ${teamSize === 1 ? "BDE" : "BDEs"} · ${queue} waiting for a BDE`}
                  onChange={() => onChange({ managerId: user.id, bdeId: null })} />
              );
            })}
          </fieldset>
          {errors.managerId ? <p className="text-caption text-[var(--color-danger-fg)]">{errors.managerId}</p> : null}
        </section>
      )}

      {manager || isTeamScoped ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-h3 text-[var(--color-text)]">BDE{isTeamScoped ? <span className="sr-only"> (required)</span> : null}</h3>
            <span className="text-caption text-[var(--color-text-3)]">Capacity {firm.bdeCapacity} per BDE</span>
          </div>
          {blockReason ? (
            <p role="status" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning-fg)]">
              <AlertTriangle size={14} aria-hidden />{blockReason}
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
              <AssignOption name={manager.name} avatarKey={null} group={`${idPrefix}-bde`} value="" checked={value.bdeId === null} title={`Let ${manager.name} choose`}
                detail="The candidate waits in their Needs a BDE queue." onChange={() => onChange({ managerId: value.managerId, bdeId: null })} />
            ) : null}
            {shown.map(bdeRow)}
            {bdes.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">{isTeamScoped ? "No BDEs report to you yet. Ask the owner to invite one." : `No BDEs report to ${manager?.name ?? "this manager"} yet.`}</p> : null}
            {bdes.length > 0 && shown.length === 0 ? <p className="text-sm text-[var(--color-text-3)]">No BDE matches “{query}”.</p> : null}
          </fieldset>
          {errors.bdeId ? <p className="text-caption text-[var(--color-danger-fg)]">{errors.bdeId}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
