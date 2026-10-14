"use client";

import { useSession } from "@/lib/stores/session-store";
import { BdeDashboard } from "@/features/dashboard/bde-dashboard";
import { ManagerDashboard } from "@/features/dashboard/manager-dashboard";
import { OwnerDashboard } from "@/features/dashboard/owner-dashboard";

/**
 * /dashboard — one route, four compositions by role (docs/04 §3).
 * VIEWER sees the manager floor with every action stripped from the DOM.
 */
export default function DashboardPage() {
  const role = useSession((s) => s.user.role);

  if (role === "BDE") return <BdeDashboard />;
  if (role === "OWNER") return <OwnerDashboard />;
  return <ManagerDashboard role={role === "VIEWER" ? "VIEWER" : "MANAGER"} />;
}
