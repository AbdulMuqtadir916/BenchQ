import { ApiError } from "@/lib/api/client";
import { ENTITY } from "@/lib/derive/platform";
import { SUPPORT_VIEW_MINUTES, type PlatformUser } from "@/lib/schemas/tenancy";
import { currentPlatformUser } from "./auth";
import { changed } from "./db";
import { allLedger } from "./ledger";
import { activeSupportView, supportViews, type StoredSupportView } from "./support-data";
import { firms } from "./team-data";
import { platformUsers } from "./tenancy";

/**
 * The read-only support view on the mock backend (07 §4, Q10, A12): start (a reason of 10+ characters,
 * 60 minutes, no extension), one at a time (starting another ends the open one), and ended by exit,
 * expiry or sign-out. Every start and end is in the firm's own ledger (`ADMIN_ACCESS`,
 * `ADMIN_ACCESS_END`, entity `support_view`), so the firm sees who looked, when and why — the admin's
 * name and the reason as written, never their email (A12).
 */

const MIN_REASON = 10;
const END_SUMMARY: Record<NonNullable<StoredSupportView["endReason"]>, string> = {
  EXIT: "Support view ended",
  EXPIRED: `Support view ended after ${SUPPORT_VIEW_MINUTES} minutes`,
  SIGN_OUT: "Support view ended: signed out",
  REPLACED: "Support view ended: another support view started",
};

let sequence = 0;
const newId = (now: Date) => `sv_${now.getTime().toString(36)}${(sequence++).toString(36)}`;

function log(view: StoredSupportView, admin: Pick<PlatformUser, "id" | "name">, action: "ADMIN_ACCESS" | "ADMIN_ACCESS_END", summary: string, at: Date): void {
  const firm = firms.find((item) => item.id === view.firmId);
  allLedger.unshift({
    id: `ledger_${view.id}_${action === "ADMIN_ACCESS" ? "start" : "end"}`,
    firmId: view.firmId,
    actorUserId: admin.id,
    actorType: "PLATFORM_ADMIN",
    actorName: admin.name,
    entityType: ENTITY.supportView,
    entityId: view.id,
    entityLabel: firm?.name ?? view.firmId,
    action,
    summary,
    modelId: null,
    promptVersion: null,
    evidenceIds: [],
    claimState: null,
    createdAt: at.toISOString(),
  });
}

function end(view: StoredSupportView, reason: NonNullable<StoredSupportView["endReason"]>, at: Date): void {
  const index = supportViews.findIndex((item) => item.id === view.id);
  // An expired view ended at its expiry, whenever it is noticed.
  const endedAt = reason === "EXPIRED" ? new Date(view.expiresAt) : at;
  supportViews[index] = { ...view, endedAt: endedAt.toISOString(), endReason: reason };
  const admin = platformUsers.find((user) => user.id === view.adminUserId) ?? { id: view.adminUserId, name: "Super Admin" };
  log(view, admin, "ADMIN_ACCESS_END", END_SUMMARY[reason], endedAt);
  changed("supportViews", "ledger");
}

/** Log the end of every view that ran out (lazily: whenever the session is read). */
export function settleExpiredSupportViews(now = new Date()): void {
  for (const view of [...supportViews]) {
    if (view.endedAt === null && now.getTime() >= new Date(view.expiresAt).getTime()) end(view, "EXPIRED", now);
  }
}

/** On sign-out: the admin's open view ends with them (07 §4). */
export function endSupportViewOnSignOut(adminUserId: string, now = new Date()): void {
  settleExpiredSupportViews(now);
  const view = activeSupportView(adminUserId, now);
  if (view) end(view, "SIGN_OUT", now);
}

/** Start a view of a firm. Any open view of another (or the same) firm ends first, both logged. */
export function startSupportView(firmId: string, reason: string, now = new Date()): StoredSupportView {
  const admin = currentPlatformUser();
  const firm = firms.find((item) => item.id === firmId);
  if (!firm) throw new ApiError("Not found.", "NOT_FOUND", 404);
  const text = reason.trim();
  if (text.length < MIN_REASON) throw new ApiError(`Give a reason of at least ${MIN_REASON} characters.`, "INVALID", 400);
  settleExpiredSupportViews(now);
  const open = activeSupportView(admin.id, now);
  if (open) end(open, "REPLACED", now);
  const view: StoredSupportView = {
    id: newId(now),
    firmId,
    reason: text,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SUPPORT_VIEW_MINUTES * 60_000).toISOString(),
    adminUserId: admin.id,
    endedAt: null,
    endReason: null,
  };
  supportViews.push(view);
  log(view, admin, "ADMIN_ACCESS", `Support view started: ${text}`, now);
  changed("supportViews", "ledger");
  return view;
}

/** Exit the open view; returns its firm (for the way back to /admin/firms/[firmId]), or null if none was open. */
export function exitSupportView(now = new Date()): string | null {
  const admin = currentPlatformUser();
  settleExpiredSupportViews(now);
  const view = activeSupportView(admin.id, now);
  if (!view) return null;
  end(view, "EXIT", now);
  return view.firmId;
}
