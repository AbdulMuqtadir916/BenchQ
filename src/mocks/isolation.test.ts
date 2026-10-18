import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { candidatesApi } from "@/lib/api/candidates";
import { jobsApi } from "@/lib/api/jobs";
import { applicationsApi, followupsApi } from "@/lib/api/applications";
import { resumesApi } from "@/lib/api/resumes";
import { recordsApi } from "@/lib/api/records";
import { documentsApi } from "@/lib/api/documents";
import { inboxApi } from "@/lib/api/inbox";
import { ledgerApi } from "@/lib/api/analytics";
import { teamApi } from "@/lib/api/team";
import { sessionApi } from "@/lib/api/session";
import { DEFAULT_SESSION } from "@/lib/stores/session-store";
import { allLedger } from "./ledger";
import { inFirm } from "./_shared";

/**
 * Firm isolation at the adapter boundary (docs/07 T5): what a firm asks for is all it gets, and a
 * record of another firm answers 404, exactly like a missing one. Through the real adapters, so the
 * same test holds when a module goes live. Each call is made by a member of the firm it names (the
 * mock backend checks membership since T8, see membership.test.ts).
 */

const A = "firm_hts";
const B = "firm_stl";
/** Sign the mock backend in as an OWNER of the firm, so calls naming it pass the membership check. */
const MEMBER: Record<string, string> = { firm_hts: "user_imran", firm_stl: "user_lakshmi", firm_cbw: "user_naveen" };
const as = (firmId: string) => sessionApi.devSignInAs(MEMBER[firmId]!);
afterEach(async () => {
  await sessionApi.devSignInAs(DEFAULT_SESSION.user.id);
});
const onlyFirm = (rows: readonly { firmId: string | null }[], firmId: string) => rows.length > 0 && rows.every((row) => row.firmId === firmId);
const is404 = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  return error instanceof ApiError && error.status === 404;
};

describe.each([[A, B], [B, A]])("firm %s never sees firm %s", (mine, other) => {
  it("lists: candidates, jobs, applications, follow-ups, resumes, ledger, team", async () => {
    await as(mine);
    expect(onlyFirm(await candidatesApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await jobsApi.list(mine, { limit: 1000 }), mine)).toBe(true);
    expect(onlyFirm(await applicationsApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await followupsApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await resumesApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await ledgerApi.list(mine, { limit: 1000 }), mine)).toBe(true);
    expect(onlyFirm(await teamApi.list(mine), mine)).toBe(true);
  });

  it("reads by id or candidate: the other firm's records are 404", async () => {
    await as(other);
    const theirCandidate = (await candidatesApi.list(other))[0]!;
    const theirJob = (await jobsApi.list(other))[0]!;
    const theirApplication = (await applicationsApi.list(other))[0]!;
    const theirResume = (await resumesApi.list(other))[0]!;
    await as(mine);
    expect(await is404(candidatesApi.byId(mine, theirCandidate.id))).toBe(true);
    expect(await is404(jobsApi.byId(mine, theirJob.id))).toBe(true);
    expect(await is404(applicationsApi.byId(mine, theirApplication.id))).toBe(true);
    expect(await is404(resumesApi.byId(mine, theirResume.id))).toBe(true);
    expect(await is404(recordsApi.byCandidate(mine, theirCandidate.id))).toBe(true);
    expect(await is404(inboxApi.byCandidate(mine, theirCandidate.id))).toBe(true);
    expect(await resumesApi.byCandidate(mine, theirCandidate.id)).toEqual([]);
    expect(await documentsApi.byCandidate(mine, theirCandidate.id)).toEqual([]);
    expect((await applicationsApi.list(mine, { candidateId: theirCandidate.id }))).toEqual([]);
  });

  it("writes: the other firm's records can't be changed through mine", async () => {
    await as(other);
    const theirCandidate = (await candidatesApi.list(other))[0]!;
    const theirApplication = (await applicationsApi.list(other))[0]!;
    const theirDocuments = await documentsApi.byCandidate(other, theirCandidate.id);
    await as(mine);
    expect(await is404(candidatesApi.update(mine, theirCandidate.id, { notes: "x" } as never))).toBe(true);
    expect(await is404(applicationsApi.updateStatus(mine, theirApplication.id, { status: "WITHDRAWN", note: null }))).toBe(true);
    expect(await is404(documentsApi.upload(mine, theirCandidate.id, { kind: "OTHER", title: "x", fileName: "x.pdf", mimeType: "application/pdf", sizeKb: 1, expiresAt: null } as never))).toBe(true);
    expect(await is404(inboxApi.connect(mine, theirCandidate.id))).toBe(true);
    if (theirDocuments[0]) expect(await is404(documentsApi.remove(mine, theirDocuments[0].id))).toBe(true);
    // still untouched for its own firm
    await as(other);
    expect((await applicationsApi.byId(other, theirApplication.id)).status).toBe(theirApplication.status);
  });
});

it("keeps platform-only ledger events (firmId null) out of every firm's ledger", async () => {
  for (const firmId of [A, B, "firm_cbw"]) {
    await as(firmId);
    const entries = await ledgerApi.list(firmId, { limit: 1000 });
    expect(entries.some((entry) => entry.firmId === null)).toBe(false);
  }
  // GSC has no member to sign in as until its OWNER accepts: check the filter itself.
  expect(inFirm(allLedger, "firm_gsc").some((entry) => entry.firmId === null)).toBe(false);
});
