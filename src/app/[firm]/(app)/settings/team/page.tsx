"use client";

import { ROLE_TONE } from "@/lib/auth/roles";
import { Users } from "lucide-react";
import { useTeam } from "@/lib/hooks/use-team";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { useCan } from "@/lib/auth/permissions";
import { TeamInvitesSection } from "@/features/team/member-invites";

/**
 * /settings/team (docs/04 §10, 07 Q15). The route lets OWNER and MANAGER in (`team.view`); what each may
 * do is the policy: only the OWNER manages members (`member.*`), a MANAGER reads the team. Invites (Phase M,
 * 07 Q38) are below the members: invite, resend, revoke. Remove, deactivate and change role come later and
 * render under `member.*`; candidate assignment under `candidate.assign`.
 */
export default function TeamSettingsPage() {
  const teamQuery = useTeam();
  const canManageMembers = useCan("member.invite");

  if (teamQuery.isLoading) return <SkeletonCard aria-label="Loading team" />;
  if (teamQuery.error) return <ErrorState error={teamQuery.error} onRetry={() => void teamQuery.refetch()} />;

  const members = teamQuery.data ?? [];
  if (members.length === 0) {
    return <EmptyState icon={Users} title="No team members yet" description="Members you invite appear here with their role and status." />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-0">
        <CardHeader className="flex-col items-start gap-1 p-4">
          <CardTitle>Members</CardTitle>
          <p className="text-caption text-[var(--color-text-3)]">
            {canManageMembers ? "You manage the team. Removing members and changing roles come later." : "Read-only: only the firm's owner manages members."}
          </p>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-3)] text-left text-caption text-[var(--color-text-3)]">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {members.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 text-body-strong">{u.name}</td>
                <td className="px-4 py-3 text-[var(--color-text-3)]">{u.email}</td>
                <td className="px-4 py-3"><Tag tone={ROLE_TONE[u.role]}>{u.role}</Tag></td>
                <td className="px-4 py-3">{u.isActive ? <Tag tone="green">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <TeamInvitesSection />
    </div>
  );
}
