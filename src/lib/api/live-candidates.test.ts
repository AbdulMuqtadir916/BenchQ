import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCandidateBody } from "@/mocks/create-candidate-body";
import sample from "./dto/__samples__/candidates.json";
import demoIds from "./dto/demo-ids.json";

/**
 * Candidates on the live backend (docs/candidate-onboarding/07-go-live.md): with `candidates` in
 * NEXT_PUBLIC_LIVE_MODULES the adapters call backend/api/routes_candidates.py by the backend's ids and map the
 * answers; without it they stay on the mocks (the mock-backed tests in src/mocks/ cover that path).
 */
const before = process.env.NEXT_PUBLIC_LIVE_MODULES;
process.env.NEXT_PUBLIC_LIVE_MODULES = "candidates";
vi.resetModules();
const { candidatesApi } = await import("./candidates");
const { resumeParseApi } = await import("./resume-parse");
afterAll(() => {
  process.env.NEXT_PUBLIC_LIVE_MODULES = before;
  vi.resetModules();
});

const HTS = demoIds.firm_hts;
const BASE = `/api/firms/${HTS}/candidates`;
const parseAnswer = {
  parse_id: "9b2f0000-0000-4000-8000-000000000001", file_name: "Asha.pdf",
  parse: { header: { name: "Asha Rao", email: "asha@example.com", phone: "", location: "", linkedin: "", headline: "Data Engineer" }, summary: "", work_experience: [], education: [], skills: [], certifications: [] },
};

let answer: { status: number; body: unknown };
const calls: { url: string; method: string; body: unknown; contentType: string | null }[] = [];

beforeEach(() => {
  calls.length = 0;
  answer = { status: 200, body: sample.list };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? "GET", body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined, contentType: headers.get("Content-Type") });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("candidates on the live backend", () => {
  it("lists the firm's candidates by its backend id, mapped to fixture ids", async () => {
    const list = await candidatesApi.list("firm_hts");
    expect(calls.map((call) => call.url)).toEqual([BASE]);
    expect(list.map((candidate) => candidate.managerId)).toEqual(["user_fatima", "user_fatima"]);
  });

  it("reads one by its backend id", async () => {
    answer.body = sample.list[1];
    const candidate = await candidatesApi.byId("firm_hts", "cand_01");
    expect(calls[0]!.url).toBe(`${BASE}/${demoIds.cand_01}`);
    expect(candidate.id).toBe("cand_01");
  });

  it("creates, edits and reassigns with snake_case bodies", async () => {
    answer.body = sample.list[0];
    await candidatesApi.create("firm_hts", createCandidateBody({ bdeId: "user_adnan" }));
    await candidatesApi.update("firm_hts", "cand_01", { rateTarget: 90 });
    await candidatesApi.reassign("firm_hts", "cand_01", { managerId: "user_priya", bdeId: null, note: "Over to you." });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${BASE}`, `PATCH ${BASE}/${demoIds.cand_01}`, `POST ${BASE}/${demoIds.cand_01}/assign`]);
    expect(calls[0]!.body).toMatchObject({ manager_id: demoIds.user_fatima, bde_id: demoIds.user_adnan });
    expect(calls[1]!.body).toEqual({ rate_target: 90 });
    expect(calls[2]!.body).toEqual({ manager_id: demoIds.user_priya, bde_id: null, note: "Over to you." });
  });

  it("a backend refusal rejects with its message, for the screen's error", async () => {
    answer = { status: 409, body: { detail: "Your plan allows 1 assigned candidate; 1 is assigned. Hand this candidate to a manager instead, or free a slot." } };
    await expect(candidatesApi.create("firm_hts", createCandidateBody({ bdeId: "user_adnan" }))).rejects.toThrow(/Your plan allows 1/);
  });

  it("the BDE-follows-manager move is the backend's: the adapter does nothing", async () => {
    await expect(candidatesApi.followBde("firm_hts", "user_adnan", "user_priya")).resolves.toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("the résumé parser on the live backend", () => {
  it("uploads the file as multipart and maps the answer; no samples are offered", async () => {
    answer.body = parseAnswer;
    const draft = await resumeParseApi.parse("firm_hts", new File(["%PDF-1.4"], "Asha.pdf", { type: "application/pdf" }));
    expect(calls[0]).toMatchObject({ url: `${BASE}/parse-resume`, method: "POST", contentType: null });
    expect((calls[0]!.body as FormData).get("file")).toBeInstanceOf(File);
    expect(draft).toMatchObject({ parseId: parseAnswer.parse_id, fileName: "Asha.pdf", fullName: "Asha Rao", email: "asha@example.com" });
    await expect(resumeParseApi.sampleNames()).resolves.toEqual([]);
  });
});
