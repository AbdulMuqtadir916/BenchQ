"use client";

import { Users } from "lucide-react";
import { useTeam } from "@/lib/hooks/use-team";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { hasTeamScope, scopeTeam, useCan } from "@/lib/auth/permissions";
import { TeamInvitesSection } from "@/features/team/member-invites";
import { MembersTable } from "@/features/team/members-table";

/**
 * /settings/team (docs/04 §10, 07 Q15). The route lets OWNER and MANAGER in (`team.view`); what each may
 * do is the policy: only the OWNER manages members (`member.*`), a MANAGER reads the team. Invites (Phase M,
 * 07 Q38) are below the members: invite, resend, revoke. Remove, deactivate and change role come later and
 * render under `member.*`; candidate assignment under `candidate.assign`. A MANAGER sees their own team only (07 Q47):
 * themself and the BDEs who report to them. Their invites list is not narrowed yet: invites carry no manager until the
 * backend sends `manager_id` (docs/candidate-onboarding/06-backend.md PR 1).
 */
export default function TeamSettingsPage() {
  const principal = useSignedInPrincipal();
  const isTeamScope = hasTeamScope(principal);
  const teamQuery = useTeam();
  const candidatesQuery = useCandidates();
  const canManageMembers = useCan("member.invite");

  if (teamQuery.isLoading || (isTeamScope && candidatesQuery.isLoading)) return <SkeletonCard aria-label="Loading team" />;
  const loadError = teamQuery.error ?? (isTeamScope ? candidatesQuery.error : null);
  if (loadError) return <ErrorState error={loadError} onRetry={() => { void teamQuery.refetch(); if (isTeamScope) void candidatesQuery.refetch(); }} />;

  const members = scopeTeam(principal, teamQuery.data ?? [], candidatesQuery.data ?? []);
  if (members.length === 0) {
    return <EmptyState icon={Users} title="No team members yet" description="Members you invite appear here with their role and status." />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-0">
        <CardHeader className="flex-col items-start gap-1 p-4">
          <CardTitle>Members</CardTitle>
          <p className="text-caption text-[var(--color-text-3)]">
            {canManageMembers ? "You manage the team. Removing members and changing roles come later." : isTeamScope ? "Your team, read-only: only the firm's owner manages members." : "Read-only: only the firm's owner manages members."}
          </p>
        </CardHeader>
        <MembersTable members={members} allMembers={teamQuery.data ?? []} />
      </Card>
      <TeamInvitesSection />
    </div>
  );
}
