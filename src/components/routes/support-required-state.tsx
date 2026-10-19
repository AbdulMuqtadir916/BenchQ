"use client";

import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserMenu } from "@/components/layout/user-menu";
import { SupportStartForm } from "@/components/app/support/support-start-form";
import { hrefFor } from "@/lib/routes/registry";
import type { Firm } from "@/lib/schemas/session";

/**
 * docs/07 §2.5 row 4, docs/04 §14.10: a platform admin opening a firm URL without a support view of
 * that firm. The interstitial starts one (reason required, not a redirect); nothing of the firm loads
 * until it is open. Starting it ends any view of another firm first (one at a time).
 */
export function SupportRequiredState({ firm }: { firm: Firm }) {
  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 flex justify-center">
        <UserMenu align="start" />
      </div>
      <Card className="p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]" aria-hidden>
            <LifeBuoy size={18} />
          </span>
          <div>
            <h1 className="text-h2 text-[var(--color-text)]">Support view of {firm.name}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-2)]">A Super Admin opens a firm&apos;s workspace only through a read-only support view with a stated reason.</p>
          </div>
        </div>
        <SupportStartForm
          firm={firm}
          autoFocus
          secondary={
            <Button asChild variant="secondary">
              <Link href={hrefFor("admin.firms.detail", { firmId: firm.id })}>Back to {firm.name} in admin</Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
