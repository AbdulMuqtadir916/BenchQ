"use client";

import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { UserMenu } from "@/components/layout/user-menu";
import { hrefFor } from "@/lib/routes/registry";

/**
 * docs/07 §2.5 row 4: a platform admin opening a firm URL without a support view of that firm. P4
 * turns this into the interstitial that starts one (reason required, not a redirect); until then it
 * says so and leads back to the admin area. Nothing of the firm is loaded.
 */
export function SupportRequiredState() {
  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 flex justify-center">
        <UserMenu align="start" />
      </div>
      <EmptyState
        icon={LifeBuoy}
        variant="filtered"
        title="Support view required"
        description="A Super Admin opens a firm's workspace only through a read-only support view with a stated reason. Starting one arrives with the admin area's support flow."
        action={
          <Button asChild variant="secondary">
            <Link href={hrefFor("admin")}>Back to admin</Link>
          </Button>
        }
      />
    </div>
  );
}
