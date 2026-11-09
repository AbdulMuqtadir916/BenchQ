import { z } from "zod";

/** Dashboard tabs, time window and activity drill-down are shareable URL state. */
export const DashboardSearch = z.object({
  view: z.enum(["finance", "activity"]).catch("finance"),
  period: z.enum(["7d", "30d", "90d"]).catch("30d"),
  manager: z.string().catch(""),
  bde: z.string().catch(""),
});

export type DashboardSearchState = z.infer<typeof DashboardSearch>;
