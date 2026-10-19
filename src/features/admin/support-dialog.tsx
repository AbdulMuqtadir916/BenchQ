"use client";

import { Button } from "@/components/ui/button";
import { SupportStartForm } from "@/components/app/support/support-start-form";
import { useUiStore } from "@/lib/stores/ui-store";
import type { Firm } from "@/lib/schemas/session";
import { DialogFrame } from "./admin-dialog";

/** "View workspace" (docs/04 §14.10): the support-view form in a dialog; Esc or Cancel closes it. */
export function SupportDialog({ firm, onClose }: { firm: Pick<Firm, "id" | "slug" | "name">; onClose: () => void }) {
  return (
    <DialogFrame title={`View ${firm.name}'s workspace`} onClose={onClose}>
      <SupportStartForm firm={firm} autoFocus secondary={<Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>} />
    </DialogFrame>
  );
}

/** Mounted once in the admin layout: the dialog ⌘K's "View workspace of {firm}" opens (docs/04 §14.1). */
export function SupportDialogHost() {
  const firm = useUiStore((s) => s.supportDialogFirm);
  const close = useUiStore((s) => s.closeSupportDialog);
  return firm ? <SupportDialog key={firm.id} firm={firm} onClose={close} /> : null;
}
