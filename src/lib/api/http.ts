import type { ZodType } from "zod";
import { ApiError } from "./client";

/**
 * The only place the frontend talks to the network. Paths are relative
 * (`/api/...`); next.config.ts proxies them to BACKEND_URL so requests are
 * same-origin and the backend's HTTP-only `bq_session` cookie just works.
 */

type QueryValue = string | number | boolean | null | undefined;

/**
 * Where a client sends its requests. The default is the browser's: relative paths, the same origin, the
 * `bq_session` cookie attached by `credentials: "include"`. A server render (src/lib/server/) has no
 * origin and no cookie jar, so it passes the backend's own URL and the incoming request's cookie.
 */
export interface HttpTarget {
  baseUrl?: string;
  headers?: Record<string, string>;
}

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  502: "UPSTREAM_FAILED",
  503: "UNAVAILABLE",
};

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** FastAPI errors are `{"detail": "..."}`, or `{"detail": [{loc, msg}]}` for 422s. */
async function toApiError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}.`;
  try {
    const payload: unknown = await response.json();
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail)) {
      message = detail
        .map((item: { loc?: unknown[]; msg?: string }) => `${(item.loc ?? []).join(".")}: ${item.msg ?? "invalid"}`)
        .join("; ");
    }
  } catch {
    // Non-JSON error body; keep the status message.
  }
  return new ApiError(message, STATUS_CODES[response.status] ?? `HTTP_${response.status}`, response.status);
}

async function request<T>(target: HttpTarget, method: string, path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    const headers = { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...target.headers };
    response = await fetch(`${target.baseUrl ?? ""}${buildUrl(path, options.query)}`, {
      method,
      credentials: "include",
      // A server read is never cached: it is somebody's session.
      cache: target.baseUrl ? "no-store" : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Can't reach the BenchQ backend. Check that it is running.", "NETWORK", 0);
  }

  if (!response.ok) throw await toApiError(response);

  const payload: unknown = response.status === 204 ? undefined : await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[api] ${method} ${path} returned an unexpected shape`, parsed.error.issues);
    }
    throw new ApiError(`${method} ${path} returned data the app doesn't understand.`, "SCHEMA_MISMATCH", response.status);
  }
  return parsed.data;
}

export function createHttp(target: HttpTarget = {}) {
  return {
    get: <T>(path: string, schema: ZodType<T>, options?: Omit<RequestOptions, "body">) => request(target, "GET", path, schema, options),
    post: <T>(path: string, schema: ZodType<T>, options?: RequestOptions) => request(target, "POST", path, schema, options),
    patch: <T>(path: string, schema: ZodType<T>, options?: RequestOptions) => request(target, "PATCH", path, schema, options),
    delete: <T>(path: string, schema: ZodType<T>, options?: Omit<RequestOptions, "body">) => request(target, "DELETE", path, schema, options),
  };
}

export const http = createHttp();
