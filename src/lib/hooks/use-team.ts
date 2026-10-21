"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamApi, type InviteMemberInput } from "@/lib/api/team";
import { useCan } from "@/lib/auth/permissions";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useTeam() {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.team.list(firmId),
    queryFn: () => teamApi.list(firmId),
  });
}

/** The firm's invites (docs/07 Phase M): OWNER and MANAGER only (`team.view`), so others never ask. */
export function useMemberInvites() {
  const firmId = useFirmId();
  const canView = useCan("team.view");
  return useQuery({
    queryKey: queryKeys.team.invites(firmId),
    queryFn: () => teamApi.invites(firmId),
    enabled: canView,
  });
}

/** Every member-invite write refreshes the team: an accepted or revoked invite moves seats. */
function useTeamMutation<TInput, TResult>(mutationFn: (firmId: string, input: TInput) => Promise<TResult>) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => mutationFn(firmId, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all(firmId) }),
  });
}

export const useInviteMember = () => useTeamMutation((firmId, input: InviteMemberInput) => teamApi.invite(firmId, input));
export const useResendMemberInvite = () => useTeamMutation((firmId, inviteId: string) => teamApi.resendInvite(firmId, inviteId));
export const useRevokeMemberInvite = () => useTeamMutation((firmId, inviteId: string) => teamApi.revokeInvite(firmId, inviteId));
