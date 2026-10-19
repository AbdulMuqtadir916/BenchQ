import { Suspense, type ReactNode } from "react";
import { FirmShell } from "@/features/admin/firm/firm-shell";

/** /admin/firms/[firmId]/… (docs/04 §14.5): the firm's header and tabs around each tab. */
export default function AdminFirmLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <FirmShell>{children}</FirmShell>
    </Suspense>
  );
}
