import { Tag, type TagTone } from "@/components/ui/tag";
import type { LedgerEntry } from "@/lib/schemas/analytics";

/** Ledger action and actor tags, shared by the firm ledger and the admin audit views. */
export const ACTION_TONE: Record<LedgerEntry["action"], TagTone> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  STATE_CHANGE: "violet",
  AI_GENERATE: "amber",
  AI_BLOCK: "red",
  AI_OVERRIDE: "amber",
  EXPORT: "teal",
  LOGIN: "neutral",
  ADMIN_ACCESS: "neutral",
  ADMIN_ACCESS_END: "neutral",
  FIRM_CREATED: "green",
  FIRM_SUSPENDED: "red",
  FIRM_REACTIVATED: "green",
  PLAN_CHANGED: "blue",
  INVITE_SENT: "blue",
  INVITE_ACCEPTED: "green",
  INVITE_REVOKED: "amber",
  ASSIGN: "teal",
};

export const ACTOR_TONE: Record<LedgerEntry["actorType"], TagTone> = {
  USER: "blue",
  SYSTEM: "neutral",
  AGENT: "amber",
  PLATFORM_ADMIN: "violet",
};

export const actionLabel = (action: LedgerEntry["action"]) => action.replaceAll("_", " ").toLowerCase();

export function ActionTag({ action }: { action: LedgerEntry["action"] }) {
  return <Tag tone={ACTION_TONE[action]}>{actionLabel(action)}</Tag>;
}

export function ActorTag({ type }: { type: LedgerEntry["actorType"] }) {
  return <Tag tone={ACTOR_TONE[type]}>{type.replaceAll("_", " ").toLowerCase()}</Tag>;
}
