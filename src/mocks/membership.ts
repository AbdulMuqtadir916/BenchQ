import { ApiError } from "@/lib/api/client";
import { currentPrincipal } from "./auth";

/**
 * The mock backend's tenancy check (docs/07 T8), what a real server does on every firm-scoped call:
 * the signed-in principal must belong to the firm the call names. Signed out → 401; another firm →
 * 404, the same answer as a record that doesn't exist, so a firm id never confirms anything
 * (principle 4). The client's firm gate and URL firm are UX; this is the layer a request can't skip.
 * Phase P widens it for a platform admin's read-only support view.
 */
export function requireMember(firmId: string): void {
  const principal = currentPrincipal();
  // A platform admin isn't a member of any firm; reading one needs a support view (P4).
  if (principal.kind !== "firm" || principal.firmId !== firmId) throw new ApiError("Not found.", "NOT_FOUND", 404);
}

/**
 * DEV ONLY: make chosen mock calls fail, to see the error state and its retry without a backend.
 * In the browser console: `window.__BENCHQ_MOCK_FAIL__ = ["candidates.list"]` (or `["*"]`); clear it
 * to recover. Inert in production builds.
 */
export function injectedFailure(call: string): void {
  if (process.env.NODE_ENV === "production") return;
  const failing = (globalThis as { __BENCHQ_MOCK_FAIL__?: unknown }).__BENCHQ_MOCK_FAIL__;
  if (Array.isArray(failing) && (failing.includes(call) || failing.includes("*"))) {
    throw new ApiError(`The service didn't respond (${call}).`, "INJECTED_FAILURE", 503);
  }
}

type FirmMethod = (firmId: string, ...args: never[]) => Promise<unknown>;

/** A firm-scoped mock: every method takes the firm id first and runs only for that firm's members. */
export function firmScoped<M extends Record<string, FirmMethod>>(resource: string, methods: M): M {
  const scoped: Record<string, FirmMethod> = {};
  for (const [name, method] of Object.entries(methods)) {
    scoped[name] = async (firmId, ...args) => {
      requireMember(firmId);
      injectedFailure(`${resource}.${name}`);
      return method(firmId, ...args);
    };
  }
  return scoped as M;
}

/** Every firm-scoped mock's name, for the isolation test to check it covers them all. */
export const FIRM_SCOPED_RESOURCES = ["candidates", "jobs", "applications", "followups", "resumes", "records", "documents", "inbox", "ledger", "team", "agents"] as const;
