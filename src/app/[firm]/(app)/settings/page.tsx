"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { navFor } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { SkeletonCard } from "@/components/app/skeleton-card";

/** /settings has no content of its own: it opens the first section the role may see. */
export default function SettingsIndexPage() {
  const router = useRouter();
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const section = navFor(principal, "settings")[0];
  const first = section ? toHref(section) : toHref("settings.preferences");

  useEffect(() => {
    router.replace(first);
  }, [first, router]);

  return <SkeletonCard aria-label="Opening settings" />;
}
