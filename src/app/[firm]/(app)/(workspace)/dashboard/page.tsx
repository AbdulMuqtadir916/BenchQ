"use client";

import { dashboardFor } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { BdeDashboard } from "@/features/dashboard/bde-dashboard";
import { ManagerDashboard } from "@/features/dashboard/manager-dashboard";
import { OwnerDashboard } from "@/features/dashboard/owner-dashboard";

/**
 * /dashboard — one route, four compositions by role (docs/04 §3). VIEWER sees the manager floor with
 * every action stripped from the DOM; a support view sees the owner's whole-firm view, read-only (07 §4).
 */
export default function DashboardPage() {
  const composition = dashboardFor(useSignedInPrincipal());

  if (composition === "BDE") return <BdeDashboard />;
  if (composition === "OWNER") return <OwnerDashboard />;
  return <ManagerDashboard role={composition === "VIEWER" ? "VIEWER" : "MANAGER"} />;
}
