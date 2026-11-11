import { z } from "zod";
import { LedgerEntrySchema } from "@/lib/schemas/analytics";

export const LEDGER_SORT_COLUMNS = ["when", "actor", "action"] as const;
const sortValues = LEDGER_SORT_COLUMNS.flatMap((column) => [column, `-${column}`]);

export const LedgerListQuery = z.object({
  actor: z.enum(["ALL", ...LedgerEntrySchema.shape.actorType.options]).catch("ALL"),
  q: z.string().catch(""),
  sort: z.string().refine((value) => sortValues.includes(value)).catch(""),
  page: z.coerce.number().int().min(1).catch(1),
});
