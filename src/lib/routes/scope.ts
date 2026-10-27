import type { Access } from "./registry";

export interface ScopedRecord {
  /** The candidate's one BDE (docs/02 §3.4). */
  bdeId?: string | null;
  /** The candidate's manager (docs/02 §3.4): what a MANAGER's `team` access checks. */
  managerId?: string | null;
  ownerUserId?: string | null;
}

/** Whether a record is visible at the given access level. Out-of-scope records render as not found. */
export function isInScope(access: Access, userId: string, record: ScopedRecord): boolean {
  switch (access) {
    case "full":
    case "read":
      return true;
    case "team":
      return record.managerId === userId;
    case "assigned":
      return record.bdeId === userId;
    case "own":
      return record.ownerUserId === userId;
    case "none":
      return false;
  }
}
