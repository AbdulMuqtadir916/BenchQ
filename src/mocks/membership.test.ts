import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { applicationsApi } from "@/lib/api/applications";
import { recordsApi } from "@/lib/api/records";
import { documentsApi } from "@/lib/api/documents";
import { inboxApi } from "@/lib/api/inbox";
import { stubCandidateReads } from "./fixture-backend";
import { fixtureCandidates as allCandidates } from "@/test/fixtures/candidates";
import { allJobMarks, jobMarksMock } from "./job-marks";
import { jobMarksApi } from "@/lib/api/job-marks";
import { allApplications, applicationsMock } from "./applications";
import { recordsMock } from "./records";
import { allDocuments, documentsMock } from "./documents";
import { allMessages, inboxMock } from "./inbox";
import { FIRM_SCOPED_RESOURCES } from "./membership";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";

/**
 * docs/07 T8: a firm-A principal can't read or change firm-B data through any hook. Every hook calls
 * one of these adapter methods with the URL's firm id; here each one is called as a firm-A member
 * with firm B's id and firm B's OWN valid record ids, so the only thing that can refuse it is the
 * mock backend's membership check (not the per-firm filtering, which isolation.test.ts covers). The
 * modules that moved to the backend (team, invites, ledger, candidates, résumés, jobs) are covered by
 * backend/tests/test_isolation.py.
 */

const A = "firm_hts";
const B = "firm_stl";
const of = <T extends { firmId: string | null }>(rows: readonly T[], firmId: string) => rows.find((row) => row.firmId === firmId)!;
/** Valid records of a firm, so a call naming that firm would succeed for its own members. */
const idsOf = (firmId: string) => {
  const candidate = of(allCandidates, firmId);
  return {
    candidate: candidate.id,
    job: "job_001", // jobs are the backend's (no jobs mock): marks take any id
    application: of(allApplications, firmId).id,
    document: of(allDocuments, firmId).id,
    message: of(allMessages, firmId).id,
  };
};
type Ids = ReturnType<typeof idsOf>;

/** Every firm-scoped adapter method: [resource, method, call, isWrite]. */
const CALLS: ReadonlyArray<readonly [string, string, (firmId: string, ids: Ids) => Promise<unknown>, boolean]> = [
  ["applications", "list", (f) => applicationsApi.list(f), false],
  ["applications", "byId", (f, i) => applicationsApi.byId(f, i.application), false],
  ["applications", "updateStatus", (f, i) => applicationsApi.updateStatus(f, i.application, { status: "WITHDRAWN", note: null }), true],
  ["records", "byCandidate", (f, i) => recordsApi.byCandidate(f, i.candidate), false],
  ["documents", "byCandidate", (f, i) => documentsApi.byCandidate(f, i.candidate), false],
  ["documents", "upload", (f, i) => documentsApi.upload(f, i.candidate, { kind: "OTHER", title: "x", fileName: "x.pdf", mimeType: "application/pdf", sizeKb: 1, expiresAt: null } as never), true],
  ["documents", "remove", (f, i) => documentsApi.remove(f, i.document), true],
  ["inbox", "byCandidate", (f, i) => inboxApi.byCandidate(f, i.candidate), false],
  ["inbox", "connect", (f, i) => inboxApi.connect(f, i.candidate), true],
  ["inbox", "disconnect", (f, i) => inboxApi.disconnect(f, i.candidate), true],
  ["inbox", "markRead", (f, i) => inboxApi.markRead(f, i.candidate, i.message), true],
  ["jobMarks", "list", (f) => jobMarksApi.list(f), false],
  ["jobMarks", "mark", (f, i) => jobMarksApi.mark(f, i.job, "SAVED"), true],
  ["jobMarks", "unmark", (f, i) => jobMarksApi.unmark(f, i.job, "SAVED"), true],
];

const MOCKS: Record<(typeof FIRM_SCOPED_RESOURCES)[number], object> = {
  applications: applicationsMock,
  records: recordsMock, documents: documentsMock, inbox: inboxMock, jobMarks: jobMarksMock,
};

const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: unknown) => (error instanceof ApiError ? error.status : -1));

// Candidates are the backend's: the mocks that check one (documents, the inbox) read the test fixture.
beforeAll(() => {
  stubCandidateReads();
});

afterEach(() => {
  signOutForTest();
});

describe("membership: a firm-A principal can't reach firm B through any adapter a hook calls (docs/07 T8)", () => {
  it("covers every method of every firm-scoped mock", () => {
    const methods = Object.entries(MOCKS).flatMap(([resource, mock]) => Object.keys(mock).map((name) => `${resource}.${name}`));
    expect(CALLS.map(([resource, name]) => `${resource}.${name}`).sort()).toEqual(methods.sort());
  });

  it.each(CALLS.map(([resource, name, call, isWrite]) => [`${resource}.${name}`, call, isWrite] as const))("%s: firm A member → firm B is 404; firm B's own member gets through", async (_name, call, isWrite) => {
    const ids = idsOf(B);
    await signInAs("user_imran"); // OWNER of firm A: the widest firm-A role
    expect(await status(call(B, ids))).toBe(404);
    if (isWrite) return; // writes aren't replayed for real; their "nothing changed" is checked below
    await signInAs("user_lakshmi"); // OWNER of firm B
    expect(await status(call(B, ids))).toBe(200);
  });

  it("leaves firm B's records untouched after every refused write", async () => {
    const before = JSON.stringify([allCandidates, allApplications, allDocuments, allMessages, allJobMarks].map((rows) => rows.filter((row) => row.firmId === B)));
    await signInAs("user_imran");
    for (const [, , call, isWrite] of CALLS) if (isWrite) await status(call(B, idsOf(B)));
    expect(JSON.stringify([allCandidates, allApplications, allDocuments, allMessages, allJobMarks].map((rows) => rows.filter((row) => row.firmId === B)))).toBe(before);
  });

  it("answers another firm exactly like a firm that doesn't exist", async () => {
    await signInAs("user_imran");
    const errors = await Promise.all([B, "firm_nope"].map((firmId) => applicationsApi.list(firmId).catch((error: ApiError) => [error.status, error.code, error.message])));
    expect(errors[0]).toEqual(errors[1]);
  });

  it("refuses every call while signed out (401)", async () => {
    signOutForTest();
    for (const [, , call] of CALLS) expect(await status(call(A, idsOf(A)))).toBe(401);
  });
});
