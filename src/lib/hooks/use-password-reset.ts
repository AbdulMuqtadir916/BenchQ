"use client";

import { useMutation } from "@tanstack/react-query";
import { passwordResetApi } from "@/lib/api/password-reset";

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: (email: string) => passwordResetApi.request(email) });
}

export function useCompletePasswordReset() {
  return useMutation({ mutationFn: passwordResetApi.complete });
}
