"use client";

import { useState } from "react";
import { AdminDialog } from "@/features/admin/admin-dialog";
import { useDeleteInboxContent } from "@/lib/hooks/use-inbox";

export function InboxContentDialog({candidateId, candidateName, count, messageId, onClose, onDeleted}: {
  candidateId: string; candidateName: string; count: number; messageId?: string; onClose: () => void; onDeleted: (nextId: string) => void;
}) {
  const deletion = useDeleteInboxContent(candidateId);
  const [disconnect, setDisconnect] = useState(!messageId);
  return <AdminDialog open onClose={onClose} title={`Delete stored email for ${candidateName}?`}
    description={<>
      <p>{messageId ? "1 email" : `${count} emails currently stored`}. This removes BenchQ’s copies and linked email content. It cannot be undone. Gmail originals and application statuses remain unchanged.</p>
      {!messageId ? <p>Deletion includes all stored emails when the server accepts confirmation; the count may change if new mail arrives.</p> : null}
      <p>The restricted connection audit retains who confirmed the mailbox, its verified Gmail address, candidate and time.</p>
    </>}
    confirmLabel={disconnect ? "Disconnect and delete" : "Delete stored emails"} pendingLabel="Deleting…" tone="danger"
    isPending={deletion.isPending} error={deletion.error?.message} canConfirm={count > 0}
    onConfirm={() => deletion.mutate({message: messageId, disconnect}, {onSuccess: inbox => {onDeleted(inbox.messages[0]?.id ?? ""); onClose();}})}>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={disconnect} onChange={event => setDisconnect(event.target.checked)} disabled={deletion.isPending} />
      <span>Disconnect and stop syncing before deletion. If unchecked, new emails will continue importing. Google revocation failures will be shown with manual instructions.</span>
    </label>
  </AdminDialog>;
}
