import { ApiError } from "@/lib/api/client";
import { can, type Action, type FirmAction, type TeamAction } from "@/lib/auth/policy";
import { currentPrincipal } from "./auth";

/**
 * The mock backend's tenancy check (docs/07 T8, §4), what a real server does on every firm-scoped call:
 * the signed-in principal must belong to the firm the call names. Signed out → 401; another firm →
 * 404, the same answer as a record that doesn't exist, so a firm id never confirms anything
 * (principle 4). The client's firm gate and URL firm are UX; this is the layer a request can't skip.
 * A platform admin passes only inside an active support view of that firm, and only to read (07 §4).
 */
export function requireMember(firmId: string, access: "read" | "write" = "read"): void {
  const principal = currentPrincipal();
  if (principal.kind === "firm") {
    if (principal.firmId !== firmId) throw new ApiError("Not found.", "NOT_FOUND", 404);
    return;
  }
  // A platform admin isn't a member of any firm: they read one only inside an active support view of it
  // (07 §4), and never write (Q10). Any other firm stays a 404.
  if (principal.support?.firmId !== firmId) throw new ApiError("Not found.", "NOT_FOUND", 404);
  if (access === "write") throw new ApiError("A support view is read-only.", "SUPPORT_READ_ONLY", 403);
}

/** The firm-scoped methods that only read; every other method of a firm-scoped mock writes. */
const READ_METHODS = new Set(["list", "byId", "byCandidate"]);
export const isReadMethod = (name: string): boolean => READ_METHODS.has(name);

/**
 * May the signed-in principal take this action? The same table the UI reads (src/lib/auth/policy.ts):
 * a VIEWER, a support view or a platform admin is refused with 403 — the UI never offers them the
 * control, and this is the layer a request can't skip.
 */
export function requireAction(action: Action): void {
  if (!can(currentPrincipal(), action)) throw new ApiError("Your role can't do that here.", "FORBIDDEN", 403);
}

/** Every firm-scoped write and the action it needs, by resource (the write-authorization test walks it). */
export const WRITE_ACTIONS: Record<string, Record<string, FirmAction | TeamAction>> = {};

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

/**
 * A firm-scoped mock: every method takes the firm id first and runs only for that firm's members.
 * Reads (`list`, `byId`, `byCandidate`) need membership — or a support view of the firm. Every other
 * method is a write and must name its action in `writes`: it then needs membership *and* `can(action)`,
 * so a VIEWER and a support view are refused (403). A write without an action fails at load time.
 */
export function firmScoped<M extends Record<string, FirmMethod>>(resource: string, methods: M, writes: Partial<Record<keyof M & string, FirmAction | TeamAction>> = {}): M {
  const scoped: Record<string, FirmMethod> = {};
  for (const [name, method] of Object.entries(methods)) {
    const action = (writes as Record<string, FirmAction | TeamAction | undefined>)[name];
    if (!READ_METHODS.has(name)) {
      if (!action) throw new Error(`firmScoped("${resource}"): the write "${name}" must name the action it needs`);
      (WRITE_ACTIONS[resource] ??= {})[name] = action;
    }
    scoped[name] = async (firmId, ...args) => {
      requireMember(firmId, action ? "write" : "read");
      if (action) requireAction(action);
      injectedFailure(`${resource}.${name}`);
      return method(firmId, ...args);
    };
  }
  return scoped as M;
}

/** Every firm-scoped mock's name, for the isolation test to check it covers them all. */
export const FIRM_SCOPED_RESOURCES = ["candidates", "jobs", "applications", "followups", "resumes", "records", "documents", "inbox", "agents", "jobMarks"] as const;
