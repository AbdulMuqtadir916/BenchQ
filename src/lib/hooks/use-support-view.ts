"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { sessionApi } from "@/lib/api/session";
import { hrefFor } from "@/lib/routes/registry";
import type { Firm } from "@/lib/schemas/session";
import { useSession } from "@/lib/stores/session-store";

/**
 * The read-only support view on the client (07 §4, docs/04 §14.10). A view changes the principal
 * (`support`), so each change goes like a sign-in: navigate first, then commit the session once that URL
 * is in place (useCommitPendingSession), which clears the cache and remounts the app — no data from
 * outside the view is ever on screen inside it, and none from inside it after.
 */

/** Start: then the firm's dashboard. */
export function useStartSupportView(firm: Pick<Firm, "id" | "slug">) {
  const router = useRouter();
  const setPending = useSession((s) => s.setPending);
  return useMutation({
    mutationFn: (reason: string) => sessionApi.startSupportView(firm.id, reason),
    onSuccess: (session) => {
      const path = hrefFor("dashboard", { firm: firm.slug });
      setPending({ session, path });
      router.push(path);
    },
  });
}

/** Exit: back to the firm in the admin area. */
export function useExitSupportView() {
  const router = useRouter();
  const setPending = useSession((s) => s.setPending);
  return useMutation({
    mutationFn: () => sessionApi.exitSupportView(),
    onSuccess: ({ session, firmId }) => {
      const path = firmId ? hrefFor("admin.firms.detail", { firmId }) : hrefFor("admin");
      setPending({ session, path });
      router.push(path);
    },
  });
}

/** The 60 minutes are up: the backend has ended the view; go back to the firm in admin, saying so. */
export function useExpireSupportView(firmId: string) {
  const router = useRouter();
  const setPending = useSession((s) => s.setPending);
  return useCallback(async () => {
    const session = await sessionApi.current();
    const path = hrefFor("admin.firms.detail", { firmId }, { supportEnded: "expired" });
    if (session) setPending({ session, path });
    router.replace(path);
  }, [firmId, router, setPending]);
}
