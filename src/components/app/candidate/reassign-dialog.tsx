"use client";

import { useCallback, useState } from "react";
import { ArrowLeftRight, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssignPicker, type AssignTarget } from "@/components/app/assign/assign-picker";
import { AdminDialog, Field, errorMessage, fieldAria } from "@/features/admin/admin-dialog";
import { canAssignTo, hasTeamScope } from "@/lib/auth/policy";
import { NOTE_MAX_LENGTH } from "@/lib/constants/candidate-intake";
import { countsTowardLimit } from "@/lib/derive/tenancy";
import { useAssignBlock, useReassignCandidate } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import type { Candidate } from "@/lib/schemas/candidate";
import { useSignedInPrincipal } from "@/lib/stores/session-store";

/**
 * Reassign a candidate (07 Q43, docs/candidate-onboarding/05 §6): the OWNER to any manager and one of their BDEs or
 * the manager's queue; a MANAGER to one of their own BDEs. Applications, résumés and history stay with the candidate.
 * A queue candidate getting a BDE is blocked at the candidate limit (Q45); moving between BDEs never changes the count.
 */
export function ReassignDialog({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const principal = useSignedInPrincipal();
  const team = useTeam();
  const block = useAssignBlock();
  const reassign = useReassignCandidate(candidate.id);
  const [target, setTarget] = useState<AssignTarget>({ managerId: candidate.managerId, bdeId: candidate.bdeId });
  const [note, setNote] = useState("");
  const nameOf = (id: string | null) => (id ? team.data?.find((user) => user.id === id)?.name ?? null : null);
  const manager = nameOf(candidate.managerId) ?? "their manager";
  const now = candidate.bdeId ? `${nameOf(candidate.bdeId) ?? "A BDE"} (${manager})` : `Waiting in ${manager}'s queue`;
  const isChanged = target.managerId !== candidate.managerId || target.bdeId !== candidate.bdeId;
  const isAllowed = canAssignTo(principal, candidate, target, team.data ?? []);
  const blockReason = countsTowardLimit(candidate) ? null : block.reason;
  const onChange = useCallback((next: AssignTarget) => setTarget(next), []);

  return (
    <AdminDialog
      open
      onClose={() => { reassign.reset(); onClose(); }}
      title={candidate.bdeId ? `Reassign ${candidate.fullName}` : `Pick a BDE for ${candidate.fullName}`}
      description={<p>Now: <strong className="text-[var(--color-text)]">{now}</strong>. Applications, résumés and history stay with the candidate.</p>}
      confirmLabel="Reassign"
      pendingLabel="Reassigning…"
      isPending={reassign.isPending}
      canConfirm={isChanged && isAllowed}
      error={errorMessage(reassign.error)}
      wide
      onConfirm={() => reassign.mutate({ ...target, note: note.trim() || null }, { onSuccess: onClose })}
    >
      <div className="space-y-6">
        <AssignPicker idPrefix="reassign" value={target} onChange={onChange} primaryRole={candidate.primaryRole ?? ""} blockReason={blockReason} />
        <Field id="reassign-note" label={target.bdeId === null && !hasTeamScope(principal) ? `Note to ${nameOf(target.managerId) ?? "the manager"}` : "Note to the BDE"}>
          <textarea {...fieldAria("reassign-note")} rows={3} maxLength={NOTE_MAX_LENGTH} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="Why the move, and anything they should know." className="bq-input h-auto w-full py-2" />
        </Field>
      </div>
    </AdminDialog>
  );
}

/** "Reassign", or "Pick a BDE" on a queue candidate, opening the dialog. Render it through `<Can action="candidate.assign">`. */
export function ReassignAction({ candidate }: { candidate: Candidate }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        {candidate.bdeId ? <><ArrowLeftRight size={14} aria-hidden />Reassign</> : <><UserPlus size={14} aria-hidden />Pick a BDE</>}
      </Button>
      {isOpen ? <ReassignDialog candidate={candidate} onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}
