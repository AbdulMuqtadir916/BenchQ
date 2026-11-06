"use client";

import { useState } from "react";
import type { ResumeRemoval } from "@/lib/schemas/resume";
import type { Candidate } from "@/lib/schemas/candidate";
import type { TreeBase, TreeVersion } from "@/lib/derive/resume-tree";
import { versionName } from "@/lib/derive/resume-name";
import { canChangeResume, canManageResume } from "@/lib/auth/permissions";
import { useDeleteBase, useDeleteVersion, useRemovalPreview, useShowBase, useUseAsBase } from "@/lib/hooks/use-resumes";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useShowToast } from "@/lib/stores/toast-store";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import type { TreeActions } from "./base-folder";

type Pending =
  | { kind: "base"; node: TreeBase; label: string; removal: ResumeRemoval; step: 1 | 2 }
  | { kind: "version"; candidateId: string; version: TreeVersion; label: string; removal: ResumeRemoval }
  | { kind: "useAsBase"; candidateId: string; version: TreeVersion; label: string };

const failed = (error: unknown) => (error instanceof Error ? error.message : "That didn't go through. Try again.");

/**
 * The tree's actions (resume-versioning.md §4.3, §4.7; 07 Q55) and the dialogs they need. A delete always reads the
 * backend's warning first; a base in use is hidden, and "also delete what nothing uses" asks a second time.
 */
export function useResumeActions(candidateById: (id: string) => Candidate | undefined): { actions: TreeActions; dialogs: React.ReactNode } {
  const principal = useSignedInPrincipal();
  const toast = useShowToast();
  const preview = useRemovalPreview();
  const deleteBase = useDeleteBase();
  const deleteVersion = useDeleteVersion();
  const useAsBase = useUseAsBase();
  const showBase = useShowBase();
  const [pending, setPending] = useState<Pending | null>(null);
  const [keepUsed, setKeepUsed] = useState(false);
  const close = () => { setPending(null); setKeepUsed(false); };
  const isBusy = deleteBase.isPending || deleteVersion.isPending || useAsBase.isPending;

  const actions: TreeActions = {
    canChange: (id) => { const c = candidateById(id); return !!c && canChangeResume(principal, c); },
    canManage: (id) => { const c = candidateById(id); return !!c && canManageResume(principal, c); },
    onPickBase: (node) => {
      const v1 = node.versions.find((v) => v.number === 1);
      if (!v1) return;
      useAsBase.mutate({ candidateId: node.base.candidateId, versionId: v1.id }, { onSuccess: () => toast(`Base ${node.number} is now the base in use.`), onError: (e) => toast(failed(e)) });
    },
    onUseAsBase: (candidateId, version) => setPending({ kind: "useAsBase", candidateId, version, label: `v${version.number}` }),
    onDeleteBase: (node, label) => preview.mutate({ candidateId: node.base.candidateId, baseId: node.base.id }, { onSuccess: (removal) => setPending({ kind: "base", node, label, removal, step: 1 }), onError: (e) => toast(failed(e)) }),
    onDeleteVersion: (candidateId, version, label) => preview.mutate({ candidateId, versionId: version.id }, { onSuccess: (removal) => setPending({ kind: "version", candidateId, version, label, removal }), onError: (e) => toast(failed(e)) }),
    onShowBase: (node) => showBase.mutate({ candidateId: node.base.candidateId, baseId: node.base.id }, { onSuccess: () => toast(`Base ${node.number} is shown again. It isn't the base in use until you pick it.`), onError: (e) => toast(failed(e)) }),
  };

  function confirm() {
    if (!pending) return;
    if (pending.kind === "useAsBase") {
      useAsBase.mutate({ candidateId: pending.candidateId, versionId: pending.version.id }, { onSuccess: () => { close(); toast(`${pending.label} is now the base in use.`); }, onError: (e) => { close(); toast(failed(e)); } });
    } else if (pending.kind === "version") {
      if (pending.removal.outcome === "REFUSED") return close();
      deleteVersion.mutate({ candidateId: pending.candidateId, versionId: pending.version.id }, { onSuccess: () => { close(); toast(`${versionName(pending.label, pending.version.number)} deleted.`); }, onError: (e) => { close(); toast(failed(e)); } });
    } else {
      const { node, removal } = pending;
      if (removal.outcome === "REFUSED") return close();
      if (removal.outcome === "HIDE" && keepUsed && pending.step === 1) return setPending({ ...pending, step: 2 });
      deleteBase.mutate({ candidateId: node.base.candidateId, baseId: node.base.id, keepUsed: removal.outcome === "HIDE" && keepUsed }, {
        onSuccess: (done) => { close(); toast(done.outcome === "DELETE" ? `Base ${node.number} deleted.` : `Base ${node.number} hidden: something still uses it.`); },
        onError: (e) => { close(); toast(failed(e)); },
      });
    }
  }

  const removal = pending && pending.kind !== "useAsBase" ? pending.removal : null;
  const rest = removal?.rest ?? {};
  const restWords = [rest.versions ? `${rest.versions} unused version${rest.versions === 1 ? "" : "s"}` : null, rest.tailored ? `${rest.tailored} tailored cop${rest.tailored === 1 ? "y" : "ies"} nobody sent` : null].filter(Boolean).join(" and ");
  const title = !pending ? "" : pending.kind === "useAsBase" ? `Use ${pending.label} as the base?`
    : removal?.outcome === "REFUSED" ? "Can't delete this" : pending.kind === "base" && pending.step === 2 ? "Delete them for good?"
      : removal?.outcome === "HIDE" ? `Hide ${pending.kind === "base" ? pending.label : "it"}?`
        : `Do you want to delete ${pending.kind === "base" ? pending.label : versionName(pending.label, pending.version.number)}?`;

  const dialogs = (
    <ConfirmDialog
      open={!!pending}
      title={title}
      tone={pending?.kind === "useAsBase" ? "primary" : "danger"}
      confirmLabel={!pending ? "" : pending.kind === "useAsBase" ? "Use as the base" : removal?.outcome === "REFUSED" ? "OK" : removal?.outcome === "HIDE" && !(pending.kind === "base" && keepUsed) ? "Hide" : "Delete"}
      cancelLabel="Cancel"
      isBusy={isBusy}
      onCancel={close}
      onConfirm={confirm}
    >
      {pending?.kind === "useAsBase" ? <p>It becomes a new base and the one the workflow uses: new tailoring starts from it. The current base stays as it is.</p> : null}
      {pending?.kind === "base" && pending.step === 2 ? <p>{restWords} will be deleted. What is in use stays.</p> : removal && removal.outcome !== "DELETE" ? <p>{removal.message}</p> : null}
      {pending?.kind === "base" && pending.step === 1 && removal?.outcome === "HIDE" && restWords ? (
        <label className="flex items-start gap-2">
          <Checkbox checked={keepUsed} onChange={(e) => setKeepUsed(e.target.checked)} />
          <span>Also delete what nothing uses: {restWords}.</span>
        </label>
      ) : null}
    </ConfirmDialog>
  );

  return { actions, dialogs };
}
