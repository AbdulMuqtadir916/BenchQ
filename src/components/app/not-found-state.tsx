"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { useHref } from "@/lib/routes/use-href";
import { useSession } from "@/lib/stores/session-store";

/** Unknown URL, or a record that doesn't exist or is outside the user's scope. */
export function NotFoundState({
  title = "Page not found",
  description = "This page doesn't exist, or the link is out of date.",
  backHref,
  backLabel,
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const toHref = useHref();
  // The way back is the principal's own home: a Super Admin's is the admin overview.
  const isPlatformAdmin = useSession((s) => s.principal?.kind === "platform");
  const home = isPlatformAdmin ? { href: toHref("admin"), label: "Go to the overview" } : { href: toHref("dashboard"), label: "Go to dashboard" };
  return (
    <div className="bq-page">
      <EmptyState
        icon={SearchX}
        variant="filtered"
        title={title}
        description={description}
        action={
          <Button asChild variant="secondary">
            <Link href={backHref ?? home.href}>{backLabel ?? home.label}</Link>
          </Button>
        }
      />
    </div>
  );
}
