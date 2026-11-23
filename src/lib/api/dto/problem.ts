import { z } from "zod";

/**
 * A backend error body → what `ApiError` carries (docs/02-DATA-CONTRACTS.md §12; docs/team/uzair.md step 4b).
 *
 * Two shapes arrive during the switch:
 * - the new one, RFC 9457 `application/problem+json`: `{type, title, status, detail: string, code, request_id,
 *   errors?: [{loc, msg, type}], …extension members at the top level}`;
 * - the old FastAPI one, kept by the JobNavigator leftovers: `{"detail": "..."}`, `{"detail": [{loc, msg}]}` for a
 *   422, or `{"detail": {message, …}}` when the backend names what the request clashed with.
 *
 * `message` is the backend's text: a new body's `detail` (a validation 422's one actionable sentence, decided by Uzair
 * 2026-11-20), or an old list `detail` joined as before. A 422's `errors` are kept as `fieldErrors`, shown nowhere. The
 * body's `code` and `request_id` are stored, and src/lib/api/error-text.ts picks what the user reads from them (the
 * frontend's own words for the system codes). `null` message: keep the status text.
 */
export interface ParsedErrorBody {
  message: string | null;
  /** The known extension members (new shape) or the known members of an object `detail` (old shape), camelCased
   * (`EXTENSION_MEMBERS`), e.g. the duplicate résumé's `baseResumeId` and `hidden`. Read only by the adapter that asked
   * (src/lib/api/resumes.ts). */
  details: Record<string, unknown> | null;
  backendCode: string | null;
  requestId: string | null;
  /** A validation 422's `errors`: each field's place (`body.email`) and message. Never the submitted value. */
  fieldErrors: FieldError[] | null;
}

export interface FieldError {
  loc: string;
  msg: string;
}

const NOTHING: ParsedErrorBody = { message: null, details: null, backendCode: null, requestId: null, fieldErrors: null };

/**
 * The extension members the frontend reads, backend name → frontend name (CLAUDE.md: no snake_case shape leaves
 * src/lib/api/dto/). Only these pass into `ApiError.details`; an adapter that needs another member adds it here.
 * Every one the backend sends today: the duplicate résumé's 409 (backend/candidates/versions.py).
 */
const EXTENSION_MEMBERS: Readonly<Record<string, string>> = {
  base_resume_id: "baseResumeId",
  hidden: "hidden",
};

/** The known members of `source`, under their frontend names; null when it has none. */
function knownMembers(source: Record<string, unknown>): Record<string, unknown> | null {
  const known = Object.entries(source).flatMap(([name, value]) => {
    const mapped = Object.hasOwn(EXTENSION_MEMBERS, name) ? EXTENSION_MEMBERS[name] : undefined;
    return mapped ? [[mapped, value] as const] : [];
  });
  return known.length > 0 ? Object.fromEntries(known) : null;
}

const ProblemDto = z.object({
  detail: z.string(),
  code: z.string(),
  request_id: z.string().nullish(),
});

const ValidationItem = z.object({ loc: z.array(z.unknown()).optional(), msg: z.string().optional() });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldErrorsOf(items: unknown[]): FieldError[] {
  return items.map((item) => {
    const parsed = ValidationItem.safeParse(item);
    const { loc, msg } = parsed.success ? parsed.data : { loc: undefined, msg: undefined };
    return { loc: (loc ?? []).join("."), msg: msg ?? "invalid" };
  });
}

/** An old list `detail` (JobNavigator leftovers): each field's place and message, joined as it was always shown. */
const validationText = (items: unknown[]): string => fieldErrorsOf(items).map(({ loc, msg }) => `${loc}: ${msg}`).join("; ");

function fromProblem(body: Record<string, unknown>, problem: z.infer<typeof ProblemDto>): ParsedErrorBody {
  const errors = Array.isArray(body.errors) && body.errors.length > 0 ? body.errors : null;
  return {
    message: problem.detail,
    // The extension members sit at the top level, beside the members every problem body has.
    details: knownMembers(body),
    backendCode: problem.code,
    requestId: problem.request_id ?? null,
    fieldErrors: errors ? fieldErrorsOf(errors) : null,
  };
}

function fromOldShape(detail: unknown): ParsedErrorBody {
  if (typeof detail === "string") return { ...NOTHING, message: detail };
  if (Array.isArray(detail)) return { ...NOTHING, message: validationText(detail), fieldErrors: fieldErrorsOf(detail) };
  if (isRecord(detail)) return { ...NOTHING, message: typeof detail.message === "string" ? detail.message : null, details: knownMembers(detail) };
  return NOTHING;
}

export function fromErrorBody(payload: unknown): ParsedErrorBody {
  if (!isRecord(payload)) return NOTHING;
  const problem = ProblemDto.safeParse(payload);
  return problem.success ? fromProblem(payload, problem.data) : fromOldShape(payload.detail);
}
