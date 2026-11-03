import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PlatformGate } from "@/components/routes/platform-gate";
import { devRoutesEnabled } from "@/lib/routes/registry";
import { enforcePlatform } from "@/lib/server/principal";

/**
 * Dev-only routes (docs/07 §2.4): not-found unless `devRoutesEnabled()` (NEXT_PUBLIC_SHOW_DEV_ROUTES=true), and only
 * for a Super Admin, gated as `/admin` is: the server decides first (sign-in, or a real 404 for anyone else), then
 * PlatformGate. They sit outside `[firm]`, so they render in the admin shell.
 */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  await enforcePlatform();
  return (
    <PlatformGate>
      <AppShell variant="admin">{children}</AppShell>
    </PlatformGate>
  );
}
