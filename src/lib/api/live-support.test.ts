import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSchema } from "@/lib/schemas/session";
import demoIds from "./dto/demo-ids.json";

/**
 * The read-only support view on the live backend (07 §4, issue #56): start and
 * exit call backend/api/routes_support.py with the backend's firm id, map its session back to fixture ids, and the
 * modules still on mocks then read the viewed firm, and only it.
 */

const { sessionApi } = await import("./session");
const { rememberLiveSession } = await import("./live-session");
const { requireMember } = await import("@/mocks/membership");

const HTS = demoIds.firm_hts;
const SANA = demoIds.padm_sana;
const VIEW = "5e1f0000-0000-4000-8000-000000000001";
const REASON = "Customer reported a missing application";

const firmDto = { id: HTS, name: "Hyderabad Tech Staffing", slug: "hyderabad-tech-staffing", logo_url: null,
  primary_timezone: "Asia/Kolkata", client_timezone: "America/New_York", truth_guard_mode: "BALANCED",
  application_expiry_days: 30, status: "ACTIVE", plan_id: demoIds.plan_starter, seat_limit: 10, candidate_limit: 100,
  contact_phone: null, created_at: "2026-10-01T09:00:00+00:00" };
const platformSessionDto = (support: Record<string, unknown> | null) => ({
  principal: { kind: "platform", user_id: SANA, role: "PLATFORM_ADMIN", support },
  platform_user: { id: SANA, name: "Sana Mirza", email: "sana@admin.benchq.test", role: "PLATFORM_ADMIN", is_active: true,
    last_active_at: null },
  firm: support ? firmDto : null,
});
const viewDto = { id: VIEW, firm_id: HTS, reason: REASON, started_at: "2026-10-24T09:00:00+00:00",
  expires_at: "2026-10-24T10:00:00+00:00" };

let answer: { status: number; body: unknown };
const calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answer = { status: 200, body: platformSessionDto(viewDto) };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  rememberLiveSession(null, { broadcast: false });
});

describe("the support view on the live backend", () => {
  it("starts with the backend's firm id and maps the session's view back to fixture ids", async () => {
    const session = await sessionApi.startSupportView("firm_hts", REASON);
    expect(calls).toEqual([{ method: "POST", url: "/api/support-views", body: { firm_id: HTS, reason: REASON } }]);
    expect(SessionSchema.parse(session)).toEqual(session);
    expect(session.principal).toEqual({
      kind: "platform", userId: "padm_sana", role: "PLATFORM_ADMIN",
      support: { id: VIEW, firmId: "firm_hts", reason: REASON, startedAt: "2026-10-24T09:00:00.000Z",
        expiresAt: "2026-10-24T10:00:00.000Z" },
    });
    expect("firm" in session && session.firm?.id).toBe("firm_hts");
  });

  it("opens the viewed firm to the modules still on mocks, and no other firm", async () => {
    await sessionApi.startSupportView("firm_hts", REASON);
    expect(() => requireMember("firm_hts")).not.toThrow();
    expect(() => requireMember("firm_stl")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("exits, returning the firm to go back to as its fixture id", async () => {
    answer.body = { session: platformSessionDto(null), firm_id: HTS };
    const { session, firmId } = await sessionApi.exitSupportView();
    expect(calls).toEqual([{ method: "DELETE", url: "/api/support-views/current", body: undefined }]);
    expect(firmId).toBe("firm_hts");
    expect(session.principal).toMatchObject({ kind: "platform", support: null });
    expect(() => requireMember("firm_hts")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("exit with no view open is not an error", async () => {
    answer.body = { session: platformSessionDto(null), firm_id: null };
    await expect(sessionApi.exitSupportView()).resolves.toMatchObject({ firmId: null });
  });

  it("passes the backend's refusals through for the dialog to show", async () => {
    answer = { status: 400, body: { detail: "Give a reason of at least 10 characters." } };
    await expect(sessionApi.startSupportView("firm_hts", "too short")).rejects.toMatchObject({
      status: 400, message: "Give a reason of at least 10 characters." });
    answer = { status: 404, body: { detail: "Not found." } };
    await expect(sessionApi.startSupportView("firm_nope", REASON)).rejects.toMatchObject({ status: 404 });
  });

  it("tells the other tabs, which share the cookie and so the view", async () => {
    const otherTab = new BroadcastChannel("benchq.session");
    const heard: string[] = [];
    otherTab.onmessage = (event) => heard.push(String(event.data));
    await sessionApi.startSupportView("firm_hts", REASON);
    await vi.waitFor(() => expect(heard).toEqual(["changed"]));
    otherTab.close();
  });
});
