import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { FirmDto, SessionDto, toFirm, toSession } from "@/lib/api/dto/session";
import { createHttp } from "@/lib/api/http";
import { SESSION_COOKIE } from "@/lib/routes/proxy-access";
import { hrefFor } from "@/lib/routes/registry";
import type { Session } from "@/lib/schemas/session";
import type { FirmLookup } from "@/lib/tenancy/firm-outcome";
import { firmGate, platformGate, type ServerGate } from "./gate";
import { PATH_HEADER } from "./path-header";

/**
 * The principal on the server (docs/07 Phase D items 2–4, F6). Reads the backend's session cookie off
 * the incoming request and asks the backend who it is, through the one `http` module. `cache()` makes a
 * layout and the pages under it share one answer per request.
 */

const serverHttp = async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return createHttp({ baseUrl: process.env.BACKEND_URL, headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined });
};

/** Who is signed in, or null when there is no session or the backend no longer knows it. */
const readSession = cache(async (): Promise<Session | null> => {
  if (!(await cookies()).has(SESSION_COOKIE)) return null;
  try {
    return toSession(await (await serverHttp()).get("/api/auth/me", SessionDto));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
});

const readFirm = cache(async (slug: string): Promise<FirmLookup> => {
  try {
    return { status: "success", firm: toFirm(await (await serverHttp()).get(`/api/firms/by-slug/${encodeURIComponent(slug)}`, FirmDto)) };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error : new Error(String(error)) };
  }
});

const currentPath = async () => (await headers()).get(PATH_HEADER);

function apply(gate: ServerGate, path: string | null): void {
  if (gate.kind === "sign-in") redirect(hrefFor("sign-in", {}, path ? { returnTo: path } : undefined));
  if (gate.kind === "not-found") notFound();
  if (gate.kind === "forbidden") forbidden();
}

/** The `/[firm]/…` layout's check: a real redirect, 404 or 403 before any page renders. */
export async function enforceFirm(slug: string): Promise<void> {
  const path = await currentPath();
  const session = await readSession();
  // No session: skip the firm lookup, the answer is the sign-in redirect whatever the slug is.
  const lookup: FirmLookup = session ? await readFirm(slug) : { status: "pending" };
  apply(firmGate(session, lookup, path ? path.split(/[?#]/)[0]! : null), path);
}

/** The `/admin/…` layout's check: sign-in when signed out, a real 404 for anyone but a platform admin. */
export async function enforcePlatform(): Promise<void> {
  const path = await currentPath();
  apply(platformGate(await readSession(), path ? path.split(/[?#]/)[0]! : null), path);
}
