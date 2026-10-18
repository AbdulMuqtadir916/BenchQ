"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/stores/session-store";
import { navFor } from "@/lib/routes/registry";
import { SkeletonCard } from "@/components/app/skeleton-card";

/** /settings has no content of its own: it opens the first section the role may see. */
export default function SettingsIndexPage() {
  const router = useRouter();
  const role = useSession((s) => s.user.role);
  const first = navFor(role, "settings")[0]?.path ?? "/settings/preferences";

  useEffect(() => {
    router.replace(first);
  }, [first, router]);

  return <SkeletonCard aria-label="Opening settings" />;
}
