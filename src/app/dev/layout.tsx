import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SignedInGate } from "@/components/routes/signed-in-gate";
import { devRoutesEnabled } from "@/lib/routes/registry";

/**
 * Dev-only routes (docs/07 §2.4): not-found unless `devRoutesEnabled()`. They sit outside `[firm]`, so
 * they have no firm: the shell's links go to the signed-in user's own firm (useHref) and the palette
 * offers navigation only.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return (
    <SignedInGate>
      <AppShell>{children}</AppShell>
    </SignedInGate>
  );
}
