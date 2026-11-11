import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import type { CompanyVerification } from "@/lib/schemas/company";
import { Tag } from "@/components/ui/tag";

/**
 * VerificationBadge — names the fired rule, never a bare verdict.
 * VERIFIED / CAUTION / REJECTED / UNKNOWN with the reason on non-verified. No verification is nothing at all: a
 * company nobody checked isn't "Unverified" (decided 2026-11-11; searched jobs carry no company check).
 */
export function VerificationBadge({ verification }: { verification: CompanyVerification | null }) {
  if (!verification) return null;
  if (verification.verdict === "VERIFIED") {
    return <Tag tone="green"><ShieldCheck size={11} aria-hidden />Verified</Tag>;
  }
  const rule = verification.rules.find((r) => r.rule === verification.firedRule);
  const label = rule?.label ?? verification.firedRule ?? verification.verdict;
  if (verification.verdict === "REJECTED") {
    return <Tag tone="red"><ShieldX size={11} aria-hidden />{label}</Tag>;
  }
  return <Tag tone="amber"><ShieldAlert size={11} aria-hidden />{label}</Tag>;
}
