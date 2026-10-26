import type { ReactNode } from "react";
import { FirmGate } from "@/components/routes/firm-gate";
import { enforceFirm } from "@/lib/server/principal";

/**
 * docs/07 §2.5: every `/[firm]/…` page renders through the firm gate, which resolves the slug first.
 * The server decides first (Phase D): a redirect, 404 or 403 before the page renders. The gate stays for
 * client-side navigation; it is UX, the backend is the enforcement.
 */
export default async function FirmLayout({ children, params }: { children: ReactNode; params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  await enforceFirm(firm);
  return <FirmGate slug={firm}>{children}</FirmGate>;
}
