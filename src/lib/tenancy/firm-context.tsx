"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Firm } from "@/lib/schemas/session";

/**
 * The firm in the URL (docs/07 §1.3, T6). The firm layout resolves the `[firm]` segment and, only once
 * the signed-in principal may see that firm, provides it here. Every firm page and data hook reads the
 * firm from this context, never from the session store.
 */
const FirmContext = createContext<Firm | null>(null);

export function FirmProvider({ firm, children }: { firm: Firm; children: ReactNode }) {
  return <FirmContext.Provider value={firm}>{children}</FirmContext.Provider>;
}

/** The URL's firm, or null outside a firm page (/dev, sign-in, the landing). */
export function useOptionalFirm(): Firm | null {
  return useContext(FirmContext);
}

export function useFirm(): Firm {
  const firm = useContext(FirmContext);
  if (!firm) throw new Error("useFirm() rendered outside a firm page: it needs the firm layout (src/app/[firm]/layout.tsx).");
  return firm;
}

/** The firm whose data the current screen shows: the URL's firm. Every firm-scoped data hook calls this. */
export function useFirmId(): string {
  return useFirm().id;
}
