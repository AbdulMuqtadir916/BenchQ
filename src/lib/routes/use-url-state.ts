"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { z } from "zod";

/**
 * Filters, sort, tabs and page in the URL, parsed with Zod (CLAUDE.md). `schema` gives every key a
 * default (`.catch()`), so a hand-edited or stale URL falls back instead of breaking the page. `set`
 * replaces the query (no new history entry per keystroke) and drops keys back at their defaults, so
 * the default view has a clean URL.
 */
export function useUrlState<S extends z.ZodObject>(schema: S): [z.infer<S>, (patch: Partial<z.infer<S>>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params.toString();

  const state = useMemo(() => schema.parse(Object.fromEntries(new URLSearchParams(query))) as z.infer<S>, [schema, query]);

  const set = useCallback(
    (patch: Partial<z.infer<S>>) => {
      const defaults = schema.parse({}) as Record<string, unknown>;
      const merged = { ...(schema.parse(Object.fromEntries(new URLSearchParams(query))) as Record<string, unknown>), ...patch };
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(merged)) {
        if (value === undefined || value === "" || value === defaults[key]) continue;
        search.set(key, String(value));
      }
      const next = search.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [schema, query, router, pathname],
  );

  return [state, set];
}
