import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PlatformGate } from "@/components/routes/platform-gate";
import { devRoutesEnabled } from "@/lib/routes/registry";

/**
 * Dev-only routes (docs/07 §2.4): not-found unless `devRoutesEnabled()` (NEXT_PUBLIC_SHOW_DEV_ROUTES=true), and only
 * for a Super Admin: anyone else gets not-found, as for `/admin` (PlatformGate). They sit outside `[firm]`, so they
 * have no firm, and the palette offers navigation only.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return (
    <PlatformGate>
      <AppShell>{children}</AppShell>
    </PlatformGate>
  );
}
