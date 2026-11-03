"use client";

import { useMutation } from "@tanstack/react-query";
import { passwordRecoveryApi } from "@/lib/api/password-recovery";

/** /forgot-password: always the same answer, whatever the email (07 Q54). */
export function useRequestPasswordReset() {
  return useMutation({ mutationFn: (email: string) => passwordRecoveryApi.request(email) });
}

/** /reset-password: the one-use token from the link's fragment and the new password. */
export function useCompletePasswordReset() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) => passwordRecoveryApi.complete(token, password),
  });
}
