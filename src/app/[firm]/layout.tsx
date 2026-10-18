import type { ReactNode } from "react";
import { FirmGate } from "@/components/routes/firm-gate";

/** docs/07 §2.5: every `/[firm]/…` page renders through the firm gate, which resolves the slug first. */
export default async function FirmLayout({ children, params }: { children: ReactNode; params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  return <FirmGate slug={firm}>{children}</FirmGate>;
}
