import { TriangleAlert } from "lucide-react";
import type { WorkAuth } from "@/lib/schemas/enums";
import { Tag } from "@/components/ui/tag";
import { NEEDS_SPONSOR } from "@/lib/constants/work-auth";
import { daysBetween } from "@/lib/derive/dates";

export const WORK_AUTH_LABEL: Record<WorkAuth, string> = {
  H1B: "H-1B",
  H4_EAD: "H4 EAD",
  OPT: "OPT",
  CPT: "CPT",
  GC: "Green Card",
  GC_EAD: "GC EAD",
  USC: "US Citizen",
  TN: "TN",
  OTHER: "Other",
};

/** WorkAuthChip — work authorization with an amber warning when expiring soon. */
export function WorkAuthChip({
  workAuth,
  expiry,
}: {
  workAuth: WorkAuth;
  expiry?: string | null;
}) {
  const expiringSoon =
    expiry != null &&
    new Date(expiry) > new Date() &&
    daysBetween(new Date().toISOString(), expiry) < 90;

  const tone = expiringSoon
    ? "amber"
    : NEEDS_SPONSOR.includes(workAuth)
      ? "blue"
      : "green";

  const days = expiry ? daysBetween(new Date().toISOString(), expiry) : null;

  return (
    <Tag tone={tone}>
      {expiringSoon ? <TriangleAlert size={11} aria-hidden /> : null}
      {WORK_AUTH_LABEL[workAuth]}
      {expiringSoon && days !== null ? <span className="tabular"> · {days}d</span> : null}
    </Tag>
  );
}
