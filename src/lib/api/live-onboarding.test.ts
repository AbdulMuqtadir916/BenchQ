import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demoIds from "./dto/demo-ids.json";

/**
 * The onboarding adapters on the live backend (NEXT_PUBLIC_LIVE_MODULES=session, 07 Q38): the wire shapes
 * of backend/auth/serialize.py, the demo id translation at the edge, and the modules still on mocks reading
 * the live principal.
 */
vi.mock("@/lib/api/config", () => ({ isLive: (module: string) => module === "session" }));

const { sessionApi } = await import("./session");
const { invitesApi } = await import("./invites");
const { teamApi } = await import("./team");
const { platformApi } = await import("./platform");
const { rememberLiveSession } = await import("./live-session");
const { currentPrincipal, currentUser, firmById } = await import("@/mocks/auth");
const { requireMember } = await import("@/mocks/membership");

const HTS = demoIds.firm_hts;
const IMRAN = demoIds.user_imran;
const STARTER = demoIds.plan_starter;
const NEW_FIRM = "0b9c6c1e-1111-4000-8000-000000000001";
const NEW_USER = "0b9c6c1e-2222-4000-8000-000000000002";

const firmDto = (id: string, slug: string) => ({
  id, name: "Hyderabad Tech Staffing", slug, logo_url: null, primary_timezone: "Asia/Kolkata",
  client_timezone: "America/New_York", truth_guard_mode: "BALANCED", application_expiry_days: 30, status: "ACTIVE",
  plan_id: STARTER, seat_limit: 10, candidate_limit: 100, contact_phone: null, created_at: "2026-10-01T09:00:00+00:00",
});
const userDto = (id: string, firmId: string, role = "OWNER") => ({
  id, firm_id: firmId, name: "Imran", email: "imran@hyderabad-tech-staffing.benchq.test", role, avatar_url: null,
  is_active: true, last_active_at: "2026-10-20T10:00:00", // zone-less, as Postgres can hand it back
});
const firmSessionDto = (userId: string, firmId: string, slug = "hyderabad-tech-staffing") => ({
  principal: { kind: "firm", user_id: userId, firm_id: firmId, role: "OWNER" },
  user: userDto(userId, firmId),
  firm: firmDto(firmId, slug),
});
const inviteDto = (over: Record<string, unknown> = {}) => ({
  id: demoIds.inv_gsc_owner, firm_id: demoIds.firm_gsc, email: "gia@gachibowli.test", invitee_name: "Gia", role: "OWNER",
  invited_by_user_id: demoIds.padm_sana, status: "PENDING", expires_at: "2026-10-28T12:00:00+00:00",
  created_at: "2026-10-21T12:00:00+00:00", ...over,
});

type Route = (url: string, init: RequestInit) => { status: number; body?: unknown } | undefined;
let routes: Route[] = [];
const calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  routes = [];
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    for (const route of routes) {
      const answer = route(url, init);
      if (answer) return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), { status: answer.status });
    }
    return new Response(JSON.stringify({ detail: `no route for ${url}` }), { status: 599 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  rememberLiveSession(null, { broadcast: false });
});

const on = (method: string, path: string, status: number, body?: unknown): Route => (url, init) =>
  (init.method ?? "GET") === method && url === path ? { status, body } : undefined;

describe("the session on the live backend", () => {
  it("keeps a seeded account's fixture ids, so the mocked modules find its rows", async () => {
    routes.push(on("POST", "/api/auth/sign-in", 200, firmSessionDto(IMRAN, HTS)));
    const session = await sessionApi.signIn("imran@hyderabad-tech-staffing.benchq.test", "benchq-demo-2026");
    expect(session.principal).toEqual({ kind: "firm", userId: "user_imran", firmId: "firm_hts", role: "OWNER" });
    expect("firm" in session && session.firm?.planId).toBe("plan_starter");
    expect("user" in session && session.user.lastActiveAt).toBe("2026-10-20T10:00:00.000Z");
    expect(calls[0].body).toEqual({ email: "imran@hyderabad-tech-staffing.benchq.test", password: "benchq-demo-2026" });
    // The mock layer now answers as that user: its own firm passes, another firm is still a 404.
    expect(currentPrincipal()).toEqual(session.principal);
    expect(currentUser().id).toBe("user_imran");
    expect(() => requireMember("firm_hts")).not.toThrow();
    expect(() => requireMember("firm_stl")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("passes a firm created on the backend through with its own ids", async () => {
    routes.push(on("GET", "/api/auth/me", 200, firmSessionDto(NEW_USER, NEW_FIRM, "northwind")));
    const session = await sessionApi.current();
    expect(session?.principal).toMatchObject({ userId: NEW_USER, firmId: NEW_FIRM });
    expect(() => requireMember(NEW_FIRM)).not.toThrow();
    expect(firmById(NEW_FIRM).slug).toBe("northwind"); // the mocked modules find the firm the fixtures don't have
  });

  it("is signed out on a 401, for the mocks too", async () => {
    routes.push(on("GET", "/api/auth/me", 401, { detail: "Sign in to continue." }));
    expect(await sessionApi.current()).toBeNull();
    expect(() => currentPrincipal()).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("shows other errors instead of signing out", async () => {
    routes.push(on("GET", "/api/auth/me", 503, { detail: "Database unavailable" }));
    await expect(sessionApi.current()).rejects.toMatchObject({ status: 503 });
  });

  it("signs out on the backend and forgets the session", async () => {
    rememberLiveSession(null, { broadcast: false });
    routes.push(on("POST", "/api/auth/sign-in", 200, firmSessionDto(IMRAN, HTS)), on("POST", "/api/auth/sign-out", 204));
    await sessionApi.signIn("imran@hyderabad-tech-staffing.benchq.test", "x");
    expect(await sessionApi.signOut()).toBeNull();
    expect(() => currentPrincipal()).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("reads a firm by slug and finishes the first run", async () => {
    routes.push(
      on("GET", "/api/firms/by-slug/hyderabad-tech-staffing", 200, firmDto(HTS, "hyderabad-tech-staffing")),
      on("POST", "/api/auth/first-run-done", 200, firmSessionDto(IMRAN, HTS)),
    );
    expect((await sessionApi.firmBySlug("hyderabad-tech-staffing")).id).toBe("firm_hts");
    expect((await sessionApi.finishFirstRun()).user.id).toBe("user_imran");
  });

  it("tells the other tabs when it changes, not this one (Q27)", async () => {
    const otherTab = new BroadcastChannel("benchq.session");
    const heard: string[] = [];
    otherTab.onmessage = (event) => heard.push(String(event.data));
    const thisTab = vi.fn();
    const stop = sessionApi.watch(thisTab);
    routes.push(on("POST", "/api/auth/sign-in", 200, firmSessionDto(IMRAN, HTS)));
    await sessionApi.signIn("imran@hyderabad-tech-staffing.benchq.test", "x");
    await vi.waitFor(() => expect(heard).toEqual(["changed"]));
    expect(thisTab).not.toHaveBeenCalled();
    otherTab.postMessage("changed"); // the other tab signs out
    await vi.waitFor(() => expect(thisTab).toHaveBeenCalledTimes(1));
    stop();
    otherTab.close();
  });

  it("says a support view isn't on the live backend yet", async () => {
    await expect(sessionApi.startSupportView("firm_hts", "Checking a reported issue")).rejects.toMatchObject({ status: 501, code: "NOT_AVAILABLE" });
    expect(calls).toEqual([]);
  });
});

describe("invite links on the live backend", () => {
  it("looks a link up", async () => {
    routes.push(on("GET", "/api/invites/tok%2Fen", 200, {
      status: "VALID", firm_name: "Northwind", email: "nora@northwind.test", invitee_name: "Nora", role: "OWNER", expires_at: "2026-10-28T12:00:00+00:00",
    }));
    expect(await invitesApi.lookup("tok/en")).toEqual({
      status: "VALID", firmName: "Northwind", email: "nora@northwind.test", inviteeName: "Nora", role: "OWNER", expiresAt: "2026-10-28T12:00:00.000Z",
    });
  });

  it("shows nothing for an invalid link", async () => {
    routes.push(on("GET", "/api/invites/nope", 200, { status: "INVALID" }));
    expect(await invitesApi.lookup("nope")).toEqual({ status: "INVALID" });
  });

  it("accepting signs the new account in, for the mocks too", async () => {
    routes.push(on("POST", "/api/invites/tok/accept", 200, firmSessionDto(NEW_USER, NEW_FIRM, "northwind")));
    const session = await invitesApi.accept("tok", { name: "Nora", password: "nora-pass-1" });
    expect(calls[0].body).toEqual({ name: "Nora", password: "nora-pass-1" });
    expect(currentPrincipal()).toEqual(session.principal);
  });
});

describe("the team and /admin on the live backend", () => {
  it("lists a seeded firm's members by its backend id", async () => {
    routes.push(on("GET", `/api/firms/${HTS}/members`, 200, [userDto(IMRAN, HTS), userDto(demoIds.user_lakshmi, HTS, "MANAGER")]));
    const members = await teamApi.list("firm_hts");
    expect(members.map((user) => [user.id, user.firmId, user.role])).toEqual([["user_imran", "firm_hts", "OWNER"], ["user_lakshmi", "firm_hts", "MANAGER"]]);
  });

  it("creates a firm with the plan's backend id and returns the firm", async () => {
    routes.push(on("POST", "/api/admin/firms", 201, { firm: firmDto(NEW_FIRM, "northwind"), invite: inviteDto({ firm_id: NEW_FIRM, id: NEW_USER }), invite_token: "t" }));
    const firm = await platformApi.firms.create({
      name: "Northwind", slug: "northwind", planId: "plan_starter", primaryTimezone: "Asia/Kolkata", clientTimezone: "America/New_York",
      contactPhone: null, ownerName: "Nora North", ownerEmail: "nora@northwind.test",
    });
    expect(firm.id).toBe(NEW_FIRM);
    expect(calls[0].body).toEqual({
      name: "Northwind", slug: "northwind", plan_id: STARTER, primary_timezone: "Asia/Kolkata", client_timezone: "America/New_York",
      contact_phone: null, owner_name: "Nora North", owner_email: "nora@northwind.test",
    });
  });

  it("copies a link by resending: the old link stops (07 Q38)", async () => {
    routes.push(on("POST", `/api/admin/invites/${demoIds.inv_gsc_owner}/resend`, 200, { invite: inviteDto(), invite_token: "fresh-token" }));
    expect(await platformApi.invites.link("inv_gsc_owner")).toEqual({ token: "fresh-token" });
  });

  it("maps invites, and keeps only the platform team's for null", async () => {
    const platformInvite = inviteDto({ id: NEW_USER, firm_id: null, role: "PLATFORM_ADMIN", invitee_name: null });
    routes.push((url) => (url.startsWith("/api/admin/invites") ? { status: 200, body: [inviteDto(), platformInvite] } : undefined));
    const all = await platformApi.invites.list();
    expect(all[0]).toMatchObject({ id: "inv_gsc_owner", firmId: "firm_gsc", invitedByUserId: "padm_sana", inviteeName: "Gia" });
    expect((await platformApi.invites.list(null)).map((invite) => invite.id)).toEqual([NEW_USER]);
    await platformApi.invites.list("firm_gsc");
    expect(calls.at(-1)?.url).toBe(`/api/admin/invites?firm_id=${demoIds.firm_gsc}`);
  });

  it("reads users, plans, the team and the audit log", async () => {
    routes.push(
      on("GET", `/api/admin/users?firm_id=${HTS}`, 200, [userDto(IMRAN, HTS)]),
      on("GET", "/api/admin/plans", 200, [{ id: STARTER, name: "Starter", seat_limit: 5, candidate_limit: 50, features: [], is_active: true }]),
      on("GET", "/api/admin/team", 200, [{ id: demoIds.padm_sana, name: "Sana", email: "sana@admin.benchq.test", role: "PLATFORM_ADMIN", is_active: true, last_active_at: null }]),
      on("GET", "/api/admin/audit", 200, [{
        id: "le1", firm_id: HTS, actor_user_id: demoIds.padm_sana, actor_type: "PLATFORM_ADMIN", actor_name: "Sana", entity_type: "firm",
        entity_id: HTS, entity_label: "HTS", action: "FIRM_CREATED", summary: "Created", model_id: null, prompt_version: null,
        evidence_ids: [], claim_state: null, created_at: "2026-10-21T12:00:00+00:00",
      }]),
    );
    expect((await platformApi.users.list("firm_hts"))[0].id).toBe("user_imran");
    expect((await platformApi.plans.list())[0].id).toBe("plan_starter");
    expect((await platformApi.team.list())[0].id).toBe("padm_sana");
    expect(await platformApi.audit.list()).toEqual([expect.objectContaining({ firmId: "firm_hts", entityId: "firm_hts", actorUserId: "padm_sana" })]);
  });

  it("says what the backend can't do yet, without calling it", async () => {
    await expect(platformApi.firms.suspend("firm_hts", "Unpaid")).rejects.toMatchObject({ status: 501 });
    await expect(platformApi.plans.create({ name: "X", seatLimit: 1, candidateLimit: 1, features: [] })).rejects.toMatchObject({ status: 501 });
    await expect(platformApi.team.invite("x@benchq.test")).rejects.toMatchObject({ status: 501 });
    expect(calls).toEqual([]);
  });

  it("fails loudly when the backend's shape drifts", async () => {
    routes.push(on("GET", "/api/admin/plans", 200, [{ id: STARTER, name: "Starter" }]));
    await expect(platformApi.plans.list()).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
  });
});
