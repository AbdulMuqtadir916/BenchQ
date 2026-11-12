"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  platformApi, type CreateFirmInput, type FirmProfileInput, type PeriodEditInput, type PlanInput, type SeatsInput, type StartPeriodInput,
} from "@/lib/api/platform";
import { queryKeys } from "@/lib/query/keys";

/**
 * The Super Admin area's data (docs/04 §14), PLATFORM_ADMIN only. Every write refreshes the whole
 * platform cache: one admin action changes several views at once (a plan change moves the firm's
 * usage, its plan history and the audit log).
 */

const k = queryKeys.platform;

export const usePlatformFirms = (options: { enabled?: boolean } = {}) => useQuery({ queryKey: k.firms(), queryFn: () => platformApi.firms.list(), enabled: options.enabled ?? true });
export const usePlatformFirm = (firmId: string) => useQuery({ queryKey: k.firm(firmId), queryFn: () => platformApi.firms.get(firmId), retry: (count, error) => !isNotFound(error) && count < 2 });
export const usePlatformUsers = (firmId?: string) => useQuery({ queryKey: k.users(firmId), queryFn: () => platformApi.users.list(firmId) });
export const usePlatformInvites = (firmId?: string | null) => useQuery({ queryKey: k.invites(firmId), queryFn: () => platformApi.invites.list(firmId) });
export const usePlans = () => useQuery({ queryKey: k.plans(), queryFn: () => platformApi.plans.list() });
export const useBillingPeriods = (firmId?: string) => useQuery({ queryKey: k.billing(firmId), queryFn: () => platformApi.billing.list(firmId) });
export const useAudit = () => useQuery({ queryKey: k.audit(), queryFn: () => platformApi.audit.list() });
export const usePlatformTeam = () => useQuery({ queryKey: k.team(), queryFn: () => platformApi.team.list() });
export const useCandidateUsage = () => useQuery({ queryKey: k.candidateUsage(), queryFn: () => platformApi.candidates.usage() });

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status: unknown }).status === 404;
}

function usePlatformMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: k.all() }),
  });
}

export const useCreateFirm = () => usePlatformMutation((input: CreateFirmInput) => platformApi.firms.create(input));
export const useUpdateFirm = (firmId: string) => usePlatformMutation((input: FirmProfileInput) => platformApi.firms.update(firmId, input));
export const useChangeSlug = (firmId: string) => usePlatformMutation((slug: string) => platformApi.firms.changeSlug(firmId, slug));
export const useSuspendFirm = (firmId: string) => usePlatformMutation((reason: string) => platformApi.firms.suspend(firmId, reason));
export const useReactivateFirm = (firmId: string) => usePlatformMutation(() => platformApi.firms.reactivate(firmId));
export const useSetSeats = (firmId: string) => usePlatformMutation((input: SeatsInput) => platformApi.firms.setSeats(firmId, input));
export const useStartPeriod = (firmId: string) => usePlatformMutation((input: StartPeriodInput) => platformApi.billing.start(firmId, input));
export const useEditPeriod = (periodId: string) => usePlatformMutation((input: PeriodEditInput) => platformApi.billing.edit(periodId, input));
export const useDeactivateUser = () => usePlatformMutation((userId: string) => platformApi.users.deactivate(userId));
export const useReactivateUser = () => usePlatformMutation((userId: string) => platformApi.users.reactivate(userId));
export const useResendInvite = () => usePlatformMutation((inviteId: string) => platformApi.invites.resend(inviteId));
/** Not a write: reads the invite's live token for "Copy invite link". */
export const useInviteLink = () => useMutation({ mutationFn: (inviteId: string) => platformApi.invites.link(inviteId) });
export const useRevokeInvite = () => usePlatformMutation((inviteId: string) => platformApi.invites.revoke(inviteId));
export const useUpdatePlan = (planId: string) => usePlatformMutation((input: PlanInput) => platformApi.plans.update(planId, input));
export const useInviteStaff = () => usePlatformMutation((email: string) => platformApi.team.invite(email));
export const useDeactivateStaff = () => usePlatformMutation((userId: string) => platformApi.team.deactivate(userId));
