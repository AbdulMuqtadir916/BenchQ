import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { devRoutesEnabled } from "@/lib/routes/registry";

/**
 * Dev-only routes (docs/07 §2.4): not-found unless `devRoutesEnabled()`. They live outside `(app)`
 * so Phase T can move the firm routes under `[firm]` without taking `/dev` along, and reuse the
 * app shell so they look the same.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return <AppShell>{children}</AppShell>;
}
