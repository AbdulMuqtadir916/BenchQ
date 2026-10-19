"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformApi, type CreateFirmInput, type FirmProfileInput, type LimitsInput, type PlanInput } from "@/lib/api/platform";
import { queryKeys } from "@/lib/query/keys";

/**
 * The Super Admin area's data (docs/04 §14), PLATFORM_ADMIN only. Every write refreshes the whole
 * platform cache: one admin action changes several views at once (a plan change moves the firm's
 * usage, its plan history and the audit log).
 */

const k = queryKeys.platform;

export const usePlatformFirms = () => useQuery({ queryKey: k.firms(), queryFn: () => platformApi.firms.list() });
export const usePlatformFirm = (firmId: string) => useQuery({ queryKey: k.firm(firmId), queryFn: () => platformApi.firms.get(firmId), retry: (count, error) => !isNotFound(error) && count < 2 });
export const usePlatformUsers = (firmId?: string) => useQuery({ queryKey: k.users(firmId), queryFn: () => platformApi.users.list(firmId) });
export const usePlatformInvites = (firmId?: string | null) => useQuery({ queryKey: k.invites(firmId), queryFn: () => platformApi.invites.list(firmId) });
export const usePlans = () => useQuery({ queryKey: k.plans(), queryFn: () => platformApi.plans.list() });
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
export const useChangePlan = (firmId: string) => usePlatformMutation((planId: string) => platformApi.firms.changePlan(firmId, planId));
export const useAdjustLimits = (firmId: string) => usePlatformMutation((limits: LimitsInput) => platformApi.firms.adjustLimits(firmId, limits));
export const useDeactivateUser = () => usePlatformMutation((userId: string) => platformApi.users.deactivate(userId));
export const useReactivateUser = () => usePlatformMutation((userId: string) => platformApi.users.reactivate(userId));
export const useResendInvite = () => usePlatformMutation((inviteId: string) => platformApi.invites.resend(inviteId));
export const useRevokeInvite = () => usePlatformMutation((inviteId: string) => platformApi.invites.revoke(inviteId));
export const useCreatePlan = () => usePlatformMutation((input: PlanInput) => platformApi.plans.create(input));
export const useUpdatePlan = (planId: string) => usePlatformMutation((input: PlanInput) => platformApi.plans.update(planId, input));
export const useSetPlanActive = () => usePlatformMutation(({ planId, isActive }: { planId: string; isActive: boolean }) => platformApi.plans.setActive(planId, isActive));
export const useInviteStaff = () => usePlatformMutation((email: string) => platformApi.team.invite(email));
export const useDeactivateStaff = () => usePlatformMutation((userId: string) => platformApi.team.deactivate(userId));
