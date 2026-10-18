"use client";

import { useCallback } from "react";
import { useCurrentSession } from "@/lib/hooks/use-session";
import { useOptionalFirm } from "@/lib/tenancy/firm-context";
import { hrefFor, routeById } from "./registry";

/**
 * Link builder for components (docs/07 §5): `toHref("candidates.detail", { id })`. Fills `[firm]` with
 * the firm of the page you are on, so components never learn about firms. Off a firm page (/dev, the
 * not-found of a slug you can't open) it uses the signed-in user's own firm, so a link never points
 * into a firm you weren't let into. Until that is known (or when signed out) a firm link goes to `/`,
 * which lands you in the right place. Use `hrefFor` directly only where hooks can't run.
 */
export function useHref(): typeof hrefFor {
  const urlFirm = useOptionalFirm();
  const session = useCurrentSession();
  const slug = urlFirm?.slug ?? session.data?.firm.slug ?? null;

  return useCallback<typeof hrefFor>(
    (target, params = {}, query) => {
      const route = typeof target === "string" ? routeById(target) : target;
      if (route.area !== "firm" || params.firm !== undefined) return hrefFor(route, params, query);
      if (!slug) return hrefFor("root");
      return hrefFor(route, { ...params, firm: slug }, query);
    },
    [slug],
  );
}
