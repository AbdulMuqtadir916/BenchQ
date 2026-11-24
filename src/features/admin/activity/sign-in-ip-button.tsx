"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSignInIp } from "@/lib/hooks/use-admin-activity";

/** A failed sign-in's IP, on request: the log's lists never carry it. */
export function SignInIpButton({ entryId }: { entryId: string }) {
  const [isShown, setIsShown] = useState(false);
  const ip = useSignInIp(entryId, { isEnabled: isShown });

  if (isShown && ip.isSuccess) return <span aria-live="polite" className="shrink-0 whitespace-nowrap text-mono-sm text-[var(--color-text-2)]">{ip.data ?? "Not recorded"}</span>;
  return (
    <Button variant="secondary" size="sm" className="shrink-0" disabled={isShown && ip.isFetching} onClick={() => (ip.isError ? void ip.refetch() : setIsShown(true))}>
      {ip.isError ? "Try again" : "Show IP"}
    </Button>
  );
}
