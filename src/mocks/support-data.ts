import { z } from "zod";
import { SupportViewSchema, type SupportView } from "@/lib/schemas/tenancy";
import { table } from "./db";

/**
 * Support views as the mock backend stores them (07 §4, A12): the `SupportView` contract plus who
 * opened it and when it ended. Kept apart from support.ts (which writes the ledger) so the mock auth
 * layer can read the active view without an import cycle (auth → ledger → membership → auth).
 */
export const StoredSupportViewSchema = SupportViewSchema.extend({
  adminUserId: z.string(),
  endedAt: z.string().datetime().nullable(),
  endReason: z.enum(["EXIT", "EXPIRED", "SIGN_OUT", "REPLACED"]).nullable(),
});
export type StoredSupportView = z.infer<typeof StoredSupportViewSchema>;

export const supportViews: StoredSupportView[] = table("supportViews", StoredSupportViewSchema, () => []);

/** The admin's open view: not ended and not past its 60 minutes. An expired one is no longer active even before it is logged. */
export function activeSupportView(adminUserId: string, now: Date): StoredSupportView | null {
  return supportViews.find((view) => view.adminUserId === adminUserId && view.endedAt === null && now.getTime() < new Date(view.expiresAt).getTime()) ?? null;
}

export const asContract = (view: StoredSupportView): SupportView => SupportViewSchema.parse(view);
