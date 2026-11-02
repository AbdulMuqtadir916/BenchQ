"use client";

import type { Candidate } from "@/lib/schemas/candidate";
import { useMailboxConfirmation } from "@/lib/hooks/use-inbox";
import { Button } from "@/components/ui/button";

export function MailboxConfirmation({candidate, attempt, onClose}: {
  candidate: Candidate; attempt: string; onClose: (cleanupPending?: boolean) => void;
}) {
  const {details, confirm, cancel} = useMailboxConfirmation(candidate.id, attempt);
  const expired = [details.error, confirm.error].some(error => error && "status" in error && [404, 409].includes(Number(error.status)));
  const pending = confirm.isPending || cancel.isPending;
  const abandon = () => cancel.mutate(undefined, {onSuccess: result => onClose(result.cleanup_pending), onError: error => {if ("status" in error && Number(error.status) === 404) onClose();}});
  return <div className="space-y-3">
    <h2 className="text-h3">Confirm candidate mailbox</h2>
    <p>{candidate.fullName} · {candidate.email} · {candidate.primaryRole}</p>
    {details.isPending ? <p role="status">Loading Google address…</p> : null}
    {details.data ? <p>Selected Google address: {details.data.address}</p> : null}
    <p>Confirm this is the intended mailbox for this candidate. The profile email may differ. You confirm the account owner authorized this connection.</p>
    {details.error || confirm.error || cancel.error ? <p role="alert">{(cancel.error ?? confirm.error ?? details.error)?.message}</p> : null}
    <div className="flex flex-wrap gap-2">
      {expired ? <Button disabled={pending} onClick={abandon}>Connect again</Button> : <Button disabled={!details.data || pending} onClick={() => confirm.mutate(undefined, {onSuccess: () => onClose()})}>Confirm mailbox</Button>}
      <Button variant="secondary" disabled={pending} onClick={abandon}>{cancel.isPending ? "Cancelling…" : "Cancel"}</Button>
      {details.error && !expired ? <Button variant="secondary" onClick={() => void details.refetch()}>Retry</Button> : null}
    </div>
  </div>;
}
