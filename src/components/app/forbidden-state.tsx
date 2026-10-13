"use client";

import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { landingFor } from "@/lib/routes/registry";
import type { FirmRole } from "@/lib/stores/session-store";

const ROLE_LABEL: Record<FirmRole, string> = { OWNER: "Owner", MANAGER: "Manager", BDE: "BDE", VIEWER: "Viewer" };

/** Shown in place of a page the current role can't open (docs/04 §12: no redirect). */
export function ForbiddenState({ role, pageTitle }: { role: FirmRole; pageTitle: string }) {
  return (
    <div className="bq-page">
      <EmptyState
        icon={ShieldX}
        variant="filtered"
        title="You don't have access to this page"
        description={`${pageTitle} isn't available to the ${ROLE_LABEL[role]} role. If you need it, ask your firm's owner.`}
        action={
          <Button asChild variant="secondary">
            <Link href={landingFor(role)}>Go to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
