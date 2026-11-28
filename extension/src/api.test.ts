import { afterEach, describe, expect, it, vi } from "vitest";
import { addJob, getSavedApplications, getSession } from "./api";

/** The backend's RFC 9457 error bodies (step 4b): `failureOf` shows `detail` for a refused request and its own words
 * for a 5xx. */
const problem = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/problem+json" },
}));

async function failure(status: number, body: object): Promise<Error & { status?: number }> {
  vi.stubGlobal("fetch", problem(status, body));
  return getSession().then(() => { throw new Error("expected the request to fail"); }, (error: Error) => error);
}

afterEach(() => { vi.unstubAllGlobals(); });

it("says on every request to BenchQ that it comes from the extension", async () => {
  const send = vi.fn(async () => Response.json({ principal: null }));
  vi.stubGlobal("fetch", send);
  await getSession();
  const [, init] = send.mock.calls[0]! as unknown as [string, RequestInit];
  expect(init.headers).toMatchObject({ "X-BenchQ-Client": "extension", "Content-Type": "application/json" });
});

it("restores a captured logo only on the corresponding saved application", async () => {
  const local: Record<string, unknown> = {};
  vi.stubGlobal("chrome", { storage: { local: { set: async (items: object) => Object.assign(local, items), get: async () => local } } });
  const saved = { id: "a1", title: "Engineer", company: "Acme", status: "saved" };
  const send = vi.fn().mockResolvedValueOnce(Response.json(saved))
    .mockResolvedValueOnce(Response.json({ applications: [saved, { ...saved, id: "a2" }] }))
    .mockResolvedValueOnce(Response.json({ applications: [] }));
  vi.stubGlobal("fetch", send);
  const logoUrl = "https://acme.example/logo.svg";
  const job = { ...saved, url: "https://jobs.example/42", isJobPage: true, description: "Build things.", location: null, logoUrl };
  expect((await addJob("c1", job)).logoUrl).toBe(logoUrl);
  expect(JSON.parse(send.mock.calls[0]![1].body).job).not.toHaveProperty("logoUrl");
  expect((await getSavedApplications("c1")).map(app => app.logoUrl)).toEqual([logoUrl, undefined]);
});

describe("reading the backend's error body", () => {
  it("shows the detail of a 422 problem, not its field errors", async () => {
    const detail = "BenchQ couldn't take this as it was sent. Refresh the page and try again.";
    const error = await failure(422, {
      type: "about:blank", title: "Unprocessable Content", status: 422, detail, code: "VALIDATION_FAILED", request_id: "r1",
      errors: [{ loc: ["body", "x"], msg: "Field required", type: "missing" }],
    });
    expect(error.message).toBe(detail);
    expect(error.status).toBe(422);
  });

  it("shows the detail of a 409 problem that carries extras", async () => {
    const error = await failure(409, {
      type: "about:blank", title: "Conflict", status: 409, detail: "This résumé is already Base 2.", code: "DUPLICATE_RESUME",
      request_id: "r2", base_resume_id: "base-2",
    });
    expect(error.message).toBe("This résumé is already Base 2.");
  });

  it("ignores the body of a 5xx", async () => {
    const error = await failure(500, {
      type: "about:blank", title: "Internal Server Error", status: 500, detail: "Something went wrong.", code: "INTERNAL", request_id: "r3",
    });
    expect(error.message).toBe("BenchQ had a problem on its side. Try again in a moment.");
  });

  it("still reports a 401 as an expired session", async () => {
    const error = await failure(401, {
      type: "about:blank", title: "Unauthorized", status: 401, detail: "Sign in again.", code: "SESSION_EXPIRED", request_id: "r4",
    });
    expect(error.message).toBe("SESSION_EXPIRED");
  });
});
