import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PlatformGate } from "@/components/routes/platform-gate";
import { SupportDialogHost } from "@/features/admin/support-dialog";

/** docs/07 §2.3 / P2: the platform tier. PLATFORM_ADMIN only; the same frosted shell with the admin nav. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGate>
      <AppShell variant="admin">
        {children}
        <SupportDialogHost />
      </AppShell>
    </PlatformGate>
  );
}
