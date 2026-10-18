"use client";

import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { landingFor } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import type { Principal } from "@/lib/schemas/tenancy";

const ROLE_LABEL = { OWNER: "Owner", MANAGER: "Manager", BDE: "BDE", VIEWER: "Viewer" } as const;

/** Who the page is closed to, in the words the screen uses. */
const audience = (principal: Principal) => (principal.kind === "firm" ? `the ${ROLE_LABEL[principal.role]} role` : principal.support ? "a support view" : "a Super Admin");

/** Shown in place of a page the current role can't open (docs/04 §12: no redirect). */
export function ForbiddenState({ principal, pageTitle }: { principal: Principal; pageTitle: string }) {
  const toHref = useHref();
  return (
    <div className="bq-page">
      <EmptyState
        icon={ShieldX}
        variant="filtered"
        title="You don't have access to this page"
        description={`${pageTitle} isn't available to ${audience(principal)}. If you need it, ask your firm's owner.`}
        action={
          <Button asChild variant="secondary">
            <Link href={toHref(landingFor(principal))}>Go to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
