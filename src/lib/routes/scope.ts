import type { Access } from "./registry";

export interface ScopedRecord {
  assignedUserIds?: readonly string[];
  ownerUserId?: string | null;
}

/** Whether a record is visible at the given access level. Out-of-scope records render as not found. */
export function isInScope(access: Access, userId: string, record: ScopedRecord): boolean {
  switch (access) {
    case "full":
    case "read":
      return true;
    case "assigned":
      return record.assignedUserIds?.includes(userId) ?? false;
    case "own":
      return record.ownerUserId === userId;
    case "none":
      return false;
  }
}
