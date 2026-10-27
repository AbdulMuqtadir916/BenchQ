"use client";

import { useState } from "react";
import { ArrowLeftRight, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { AdminDialog, Field, errorMessage, fieldAria } from "@/features/admin/admin-dialog";
import { useCan } from "@/lib/auth/permissions";
import { isBde, isManager, ROLE_TONE } from "@/lib/auth/roles";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useChangeManager } from "@/lib/hooks/use-team";
import type { User } from "@/lib/schemas/session";

/**
 * The firm's members on /settings/team (docs/candidate-onboarding/02-hierarchy-and-seats.md §4–§5). A BDE's row says
 * who they report to (07 Q40), or "No manager" for a BDE from before the hierarchy (Q51). The OWNER changes it
 * (`member.changeManager`); the BDE's candidates follow (Q43).
 */
export function MembersTable({ members, allMembers }: { members: readonly User[]; allMembers: readonly User[] }) {
  const canChange = useCan("member.changeManager");
  const [moving, setMoving] = useState<User | null>(null);
  const nameOf = (id: string | null) => (id ? allMembers.find((user) => user.id === id)?.name ?? null : null);

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Reports to</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {members.map((u) => {
            const manager = nameOf(u.managerId);
            return (
              <tr key={u.id}>
                <td className="px-4 py-3 text-body-strong">{u.name}</td>
                <td className="px-4 py-3 text-[var(--color-text-3)]">{u.email}</td>
                <td className="px-4 py-3"><Tag tone={ROLE_TONE[u.role]}>{u.role}</Tag></td>
                <td className="px-4 py-3">
                  {isBde(u) ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {manager ? <span className="text-[var(--color-text-2)]">{manager}</span> : <Tag tone="amber"><UserX size={11} aria-hidden />No manager</Tag>}
                      {canChange && u.isActive ? (
                        <Button variant="ghost" size="sm" onClick={() => setMoving(u)} aria-label={`${manager ? "Change" : "Set"} ${u.name}'s manager`}>
                          <ArrowLeftRight size={13} aria-hidden />{manager ? "Change" : "Set manager"}
                        </Button>
                      ) : null}
                    </span>
                  ) : <span aria-hidden className="text-[var(--color-text-3)]">—</span>}
                </td>
                <td className="px-4 py-3">{u.isActive ? <Tag tone="green">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {moving ? <ChangeManagerDialog bde={moving} managers={allMembers.filter((user) => user.isActive && isManager(user))} onClose={() => setMoving(null)} /> : null}
    </>
  );
}

function ChangeManagerDialog({ bde, managers, onClose }: { bde: User; managers: readonly User[]; onClose: () => void }) {
  const change = useChangeManager();
  const candidatesQuery = useCandidates();
  const choices = managers.filter((manager) => manager.id !== bde.managerId);
  const [managerId, setManagerId] = useState(choices[0]?.id ?? "");
  const working = (candidatesQuery.data ?? []).filter((candidate) => candidate.bdeId === bde.id).length;
  const noChoice = choices.length === 0 ? "There's no other active manager to move them to." : null;

  return (
    <AdminDialog
      open
      onClose={() => { change.reset(); onClose(); }}
      title={bde.managerId ? `Change ${bde.name}'s manager` : `Set ${bde.name}'s manager`}
      description={<p>{bde.name}&apos;s {working} {working === 1 ? "candidate moves" : "candidates move"} with them. Candidates waiting in the old manager&apos;s queue stay there.</p>}
      confirmLabel="Save"
      pendingLabel="Saving…"
      isPending={change.isPending}
      canConfirm={!noChoice && Boolean(managerId)}
      error={errorMessage(change.error) ?? noChoice}
      onConfirm={() => change.mutate({ userId: bde.id, managerId }, { onSuccess: onClose })}
    >
      <Field id="change-manager" label="Manager">
        <select {...fieldAria("change-manager")} value={managerId} onChange={(event) => setManagerId(event.target.value)} className="bq-input w-full" disabled={choices.length === 0}>
          {choices.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
        </select>
      </Field>
    </AdminDialog>
  );
}
