"use client";

import { useCallback } from "react";
import { AssignPicker, type AssignTarget } from "@/components/app/assign/assign-picker";
import { hasTeamScope } from "@/lib/auth/policy";
import { NOTE_MAX_LENGTH } from "@/lib/constants/candidate-intake";
import { useAssignBlock } from "@/lib/hooks/use-candidates";
import { useTeam } from "@/lib/hooks/use-team";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { fieldAria, WizardField } from "./field";
import type { Errors } from "./model";
import type { Wizard } from "./use-wizard";

/**
 * Step 5 (docs/candidate-onboarding/05-assign-and-reassign.md §1, 07 Q41): who works the new candidate (the shared
 * `AssignPicker`), and the handoff note to the BDE, or to the manager when the candidate goes to their queue.
 */
export function StepAssign({ wizard, errors }: { wizard: Wizard; errors: Errors }) {
  const principal = useSignedInPrincipal();
  const team = useTeam();
  const block = useAssignBlock();
  const { values, set } = wizard;
  const managerName = team.data?.find((user) => user.id === values.managerId)?.name ?? null;
  const isToManager = values.bdeId === null && managerName !== null && !hasTeamScope(principal);

  const onChange = useCallback((next: AssignTarget) => {
    set("managerId", next.managerId);
    set("bdeId", next.bdeId);
  }, [set]);

  return (
    <div className="space-y-8">
      <AssignPicker idPrefix="cw" value={{ managerId: values.managerId, bdeId: values.bdeId }} onChange={onChange} primaryRole={values.primaryRole}
        blockReason={block.reason} errors={{ managerId: errors.managerId, bdeId: errors.bdeId }} />
      <WizardField id="cw-handoff" label={isToManager ? `Note to ${managerName}` : "Note to the BDE"} hint="Context that isn't on the résumé.">
        <textarea {...fieldAria("cw-handoff", undefined, true)} rows={3} maxLength={NOTE_MAX_LENGTH} value={values.handoffNote} onChange={(event) => set("handoffNote", event.target.value)}
          placeholder="Strong in banking domains. Avoid roles that need onsite in NYC." className="bq-input h-auto w-full py-2" />
      </WizardField>
    </div>
  );
}
