import { TriangleAlert } from "lucide-react";
import type { WorkAuth } from "@/lib/schemas/enums";
import { Tag } from "@/components/ui/tag";
import { NEEDS_SPONSOR, WORK_AUTH_LABEL } from "@/lib/constants/work-auth";

export { WORK_AUTH_LABEL };
import { daysBetween } from "@/lib/derive/dates";

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
