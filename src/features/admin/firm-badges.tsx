import { CircleAlert, CircleCheck, CirclePause, CircleDashed, SlidersHorizontal } from "lucide-react";
import { Tag, type TagTone } from "@/components/ui/tag";
import type { FirmStatus } from "@/lib/schemas/tenancy";

/** Firm status: label + icon + colour, never colour alone. */
const STATUS: Record<FirmStatus, { label: string; tone: TagTone; Icon: typeof CircleCheck }> = {
  ACTIVE: { label: "Active", tone: "green", Icon: CircleCheck },
  ONBOARDING: { label: "Onboarding", tone: "amber", Icon: CircleDashed },
  SUSPENDED: { label: "Suspended", tone: "red", Icon: CirclePause },
};

export const FIRM_STATUS_LABEL: Record<FirmStatus, string> = { ACTIVE: "Active", ONBOARDING: "Onboarding", SUSPENDED: "Suspended" };

export function FirmStatusBadge({ status }: { status: FirmStatus }) {
  const { label, tone, Icon } = STATUS[status];
  return (
    <Tag tone={tone}>
      <Icon size={12} aria-hidden />
      {label}
    </Tag>
  );
}

/** docs/02 A4: shown when usage is over (not at) a limit. */
export function OverLimitBadge() {
  return (
    <Tag tone="red">
      <CircleAlert size={12} aria-hidden />
      Over limit
    </Tag>
  );
}

/** 07 Q30: the firm's limits were adjusted away from its plan's. */
export function CustomLimitsBadge() {
  return (
    <Tag tone="violet">
      <SlidersHorizontal size={12} aria-hidden />
      Custom limits
    </Tag>
  );
}
