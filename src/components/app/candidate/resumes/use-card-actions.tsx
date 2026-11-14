"use client";

import { useState } from "react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeRemoval } from "@/lib/schemas/resume";
import type { TreeBase, TreeVersion } from "@/lib/derive/resume-tree";
import { canChangeResume, canManageResume } from "@/lib/auth/permissions";
import { useDeleteBase, useDeleteVersion, useRemovalPreview, useShowBase, useUseAsBase } from "@/lib/hooks/use-resumes";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useShowToast } from "@/lib/stores/toast-store";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { plural } from "./resume-cards";

/** What a person may do here (07 Q55), and the handlers. */
export interface CardActions {
  canChange: boolean;
  canManage: boolean;
  makeMain: (node: TreeBase, title: string) => void;
  saveAsNew: (version: TreeVersion, title: string) => void;
  deleteResume: (node: TreeBase, title: string) => void;
  deleteVersion: (version: TreeVersion, title: string) => void;
  showAgain: (node: TreeBase, title: string) => void;
}

type Pending =
  | { kind: "resume"; node: TreeBase; title: string; removal: ResumeRemoval; step: 1 | 2 }
  | { kind: "version"; version: TreeVersion; title: string; removal: ResumeRemoval }
  | { kind: "saveAsNew"; version: TreeVersion; title: string };

const failed = (error: unknown) => (error instanceof Error && !/base|tailored|workflow/i.test(error.message) ? error.message : "That didn't go through. Try again.");

/** "2 old versions and 1 job copy". */
function restWords(rest: ResumeRemoval["rest"]): string {
  return [rest.versions ? plural(rest.versions, "old version") : null, rest.tailored ? plural(rest.tailored, "job copy", "job copies") : null].filter(Boolean).join(" and ");
}

/**
 * The tab's actions, in plain words. The backend decides what a delete does (resume-versioning.md §4.7): delete it,
 * hide it (something sent still uses it), or refuse. Its own messages use internal terms, so the dialog is written
 * here from the outcome and the counts.
 */
export function useCardActions(candidate: Candidate): { actions: CardActions; dialogs: React.ReactNode } {
  const principal = useSignedInPrincipal();
  const toast = useShowToast();
  const preview = useRemovalPreview();
  const deleteBase = useDeleteBase();
  const deleteVersion = useDeleteVersion();
  const useAsBase = useUseAsBase();
  const showBase = useShowBase();
  const [pending, setPending] = useState<Pending | null>(null);
  const [alsoRest, setAlsoRest] = useState(false);
  const close = () => { setPending(null); setAlsoRest(false); };
  const isBusy = deleteBase.isPending || deleteVersion.isPending || useAsBase.isPending;
  const candidateId = candidate.id;

  const actions: CardActions = {
    canChange: canChangeResume(principal, candidate),
    canManage: canManageResume(principal, candidate),
    makeMain: (node, title) => {
      const first = node.versions.find((v) => v.number === 1);
      if (!first) return;
      useAsBase.mutate({ candidateId, versionId: first.id }, { onSuccess: () => toast(`"${title}" is now the main résumé.`), onError: (e) => toast(failed(e)) });
    },
    saveAsNew: (version, title) => setPending({ kind: "saveAsNew", version, title }),
    deleteResume: (node, title) => preview.mutate({ candidateId, baseId: node.base.id }, { onSuccess: (removal) => setPending({ kind: "resume", node, title, removal, step: 1 }), onError: (e) => toast(failed(e)) }),
    deleteVersion: (version, title) => preview.mutate({ candidateId, versionId: version.id }, { onSuccess: (removal) => setPending({ kind: "version", version, title, removal }), onError: (e) => toast(failed(e)) }),
    showAgain: (node, title) => showBase.mutate({ candidateId, baseId: node.base.id }, { onSuccess: () => toast(`"${title}" is back on the list. Make it main if you want to send it by default.`), onError: (e) => toast(failed(e)) }),
  };

  function confirm() {
    if (!pending) return;
    if (pending.kind === "saveAsNew") {
      useAsBase.mutate({ candidateId, versionId: pending.version.id }, { onSuccess: () => { close(); toast(`Version ${pending.version.number} is now a new résumé, and the main one.`); }, onError: (e) => { close(); toast(failed(e)); } });
      return;
    }
    if (pending.removal.outcome === "REFUSED") return close();
    if (pending.kind === "version") {
      deleteVersion.mutate({ candidateId, versionId: pending.version.id }, { onSuccess: () => { close(); toast(`Version ${pending.version.number} deleted.`); }, onError: (e) => { close(); toast(failed(e)); } });
      return;
    }
    const { node, removal, title } = pending;
    if (removal.outcome === "HIDE" && alsoRest && pending.step === 1) return setPending({ ...pending, step: 2 });
    deleteBase.mutate({ candidateId, baseId: node.base.id, keepUsed: removal.outcome === "HIDE" && alsoRest }, {
      onSuccess: (done) => { close(); toast(done.outcome === "DELETE" ? `"${title}" deleted.` : `"${title}" is hidden: it was sent with open applications.`); },
      onError: (e) => { close(); toast(failed(e)); },
    });
  }

  const removal = pending && pending.kind !== "saveAsNew" ? pending.removal : null;
  const sentTo = removal?.uses.applications ? plural(removal.uses.applications, "open application") : null;
  let title = "";
  let body: React.ReactNode = null;
  let confirmLabel = "Delete";
  if (pending?.kind === "saveAsNew") {
    title = `Save version ${pending.version.number} as a new résumé?`;
    body = <p>It becomes a new résumé and the main one, so it&apos;s what gets sent by default. &ldquo;{pending.title}&rdquo; stays as it is.</p>;
    confirmLabel = "Save as new résumé";
  } else if (pending?.kind === "version") {
    if (removal?.outcome === "REFUSED") {
      title = "This version can't be deleted";
      body = <p>{sentTo ? `It was sent with ${sentTo}.` : "It was added by an owner or manager, or it's the first version of the résumé."}</p>;
      confirmLabel = "OK";
    } else {
      title = `Delete version ${pending.version.number} of "${pending.title}"?`;
      body = <p>This can&apos;t be undone.</p>;
    }
  } else if (pending?.kind === "resume") {
    const copies = pending.node.tailored.length;
    if (removal?.outcome === "REFUSED") {
      title = "This résumé can't be deleted";
      body = <p>The main résumé, and one an owner or manager added to, can&apos;t be deleted. Make another résumé the main one first, or ask an owner or manager.</p>;
      confirmLabel = "OK";
    } else if (removal?.outcome === "HIDE" && pending.step === 2) {
      title = "Delete them for good?";
      body = <p>{restWords(removal.rest)} will be deleted. This can&apos;t be undone. What was sent stays.</p>;
    } else if (removal?.outcome === "HIDE") {
      title = `Hide the "${pending.title}" résumé?`;
      body = (
        <>
          <p>It was sent with {sentTo ?? "applications that are still open"}, so it can&apos;t be deleted. Hiding takes it off this list; it stays on everything it was sent with, and you can show it again later.</p>
          {restWords(removal.rest) ? (
            <label className="mt-3 flex items-start gap-2">
              <Checkbox checked={alsoRest} onChange={(e) => setAlsoRest(e.target.checked)} />
              <span>Also delete what nothing uses: {restWords(removal.rest)}.</span>
            </label>
          ) : null}
        </>
      );
      confirmLabel = alsoRest ? "Delete" : "Hide";
    } else {
      title = `Delete the "${pending.title}" résumé?`;
      body = <p>This removes all its versions{copies ? ` and its ${plural(copies, "job copy", "job copies")}` : ""} and can&apos;t be undone.</p>;
    }
  }

  const dialogs = (
    <ConfirmDialog open={!!pending} title={title} tone={pending?.kind === "saveAsNew" ? "primary" : "danger"} confirmLabel={confirmLabel} cancelLabel="Cancel" isBusy={isBusy} onCancel={close} onConfirm={confirm}>
      {body}
    </ConfirmDialog>
  );
  return { actions, dialogs };
}
