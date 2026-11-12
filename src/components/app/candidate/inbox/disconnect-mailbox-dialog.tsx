"use client";

import { AdminDialog } from "@/features/admin/admin-dialog";
import { useDisconnectMailbox } from "@/lib/hooks/use-inbox";

/** Confirm before disconnecting a candidate's Gmail: hard to undo without the candidate signing in to Google again. */
export function DisconnectMailboxDialog({ candidateId, candidateName, onClose }: {
  candidateId: string; candidateName: string; onClose: () => void;
}) {
  const disconnect = useDisconnectMailbox(candidateId);
  return (
    <AdminDialog open onClose={onClose} title={`Disconnect Gmail for ${candidateName}?`}
      description={<>
        <p>Emails already saved stay in BenchQ until an Owner or Manager deletes them. Connecting again needs a sign-in to that Google account.</p>
      </>}
      confirmLabel="Disconnect" pendingLabel="Disconnecting…" tone="danger"
      isPending={disconnect.isPending} error={disconnect.error?.message}
      onConfirm={() => disconnect.mutate(undefined, { onSuccess: onClose })} />
  );
}
