import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PlatformGate } from "@/components/routes/platform-gate";
import { isLive } from "@/lib/api/config";
import { enforcePlatform } from "@/lib/server/principal";
import { SupportDialogHost } from "@/features/admin/support-dialog";

/**
 * docs/07 §2.3 / P2: the platform tier. PLATFORM_ADMIN only; the same frosted shell with the admin nav.
 * With the live session the server decides first (Phase D): sign-in, or a real 404 for anyone else.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (isLive("session")) await enforcePlatform();
  return (
    <PlatformGate>
      <AppShell variant="admin">
        {children}
        <SupportDialogHost />
      </AppShell>
    </PlatformGate>
  );
}
