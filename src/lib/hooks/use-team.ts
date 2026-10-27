"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { candidatesApi } from "@/lib/api/candidates";
import { sessionApi } from "@/lib/api/session";
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

/**
 * OWNER only: move a BDE to another manager, or give a BDE without one a manager (07 Q40, Q51). Their candidates follow
 * (Q43): the backend moves its own; the mock's are moved here until candidates go live (onboarding 07).
 */
export function useChangeManager() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, managerId }: { userId: string; managerId: string }) => {
      const user = await teamApi.changeManager(firmId, userId, managerId);
      await candidatesApi.followBde(firmId, userId, managerId);
      return user;
    },
    onSettled: () => {
      for (const key of [queryKeys.team.all(firmId), queryKeys.candidates.all(firmId), queryKeys.ledger.all(firmId)]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** OWNER only (`firmSettings.edit`, 07 Q46): the firm's BDE capacity. Refreshes the firm the URL resolved. */
export function useUpdateFirmSettings() {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: { bdeCapacity: number }) => sessionApi.updateFirmSettings(firmId, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ledger.all(firmId) });
    },
  });
}
