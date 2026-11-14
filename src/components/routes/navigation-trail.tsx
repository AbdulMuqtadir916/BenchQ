"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordPath } from "@/lib/routes/navigation-trail";

/** Keeps the trail of pages this load of BenchQ has shown (src/lib/routes/navigation-trail.ts). Rendered once, in the
 * root layout. */
export function NavigationTrail() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordPath(pathname);
  }, [pathname]);
  return null;
}
