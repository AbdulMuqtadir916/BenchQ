import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { Tag } from "@/components/ui/tag";
import type { BillingState } from "@/lib/derive/billing";

/** A firm's billing state for the Super Admin (07 Q65): label + icon + colour, never colour alone. */
export function BillingBadge({ state }: { state: BillingState }) {
  if (state === "overdue") return <Tag tone="red"><CircleAlert size={12} aria-hidden />Payment overdue</Tag>;
  if (state === "paid") return <Tag tone="green"><CircleCheck size={12} aria-hidden />Paid</Tag>;
  return <Tag tone="neutral"><CircleDashed size={12} aria-hidden />No billing period</Tag>;
}
