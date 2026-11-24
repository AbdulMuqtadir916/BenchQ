"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { fromBackendId, isSeededFixtureId } from "@/lib/api/dto/demo-ids";

/** A real calendar day: `2026-02-30` and `2026-99-99` have the shape but are dropped. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value;
});
/**
 * A person, team or candidate in the URL, as the rest of the screen names it: a UUID, or a seeded row's fixture id
 * (`user_adnan`), which the people list uses and the API layer turns back into its UUID (issue #155). A seeded UUID
 * typed by hand becomes its fixture id, so it matches the list. Anything else is dropped.
 */
const id = z.union([z.uuid(), z.string().refine(isSeededFixtureId)]).transform(fromBackendId);

/** Everything the log shows lives in the URL. A value that doesn't parse is dropped rather than an error. */
export const ActivityParamsSchema = z.object({
  team: id.optional().catch(undefined),
  person: id.optional().catch(undefined),
  candidate: id.optional().catch(undefined),
  type: z.enum(["AGENT", "SYSTEM"]).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  q: z.string().min(1).max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  sort: z.enum(["when", "actor", "action"]).catch("when"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});
export type ActivityParams = z.infer<typeof ActivityParamsSchema>;

const DEFAULTS: Partial<ActivityParams> = { page: 1, sort: "when", dir: "desc" };

export function parseActivityParams(search: URLSearchParams): ActivityParams {
  return ActivityParamsSchema.parse({ page: 1, sort: "when", dir: "desc", ...Object.fromEntries(search.entries()) });
}

export function serializeActivityParams(params: ActivityParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== DEFAULTS[key as keyof ActivityParams]) search.set(key, String(value));
  }
  return search.toString();
}

/** The URL's params, and how to change them. Any change but a page turn goes back to page 1. */
export function useActivityParams() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => parseActivityParams(new URLSearchParams(search.toString())), [search]);
  const update = useCallback((changes: Partial<ActivityParams>) => {
    const next = serializeActivityParams({ ...params, page: 1, ...changes });
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  return [params, update] as const;
}
