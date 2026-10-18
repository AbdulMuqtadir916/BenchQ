import { describe, expect, it } from "vitest";
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

/**
 * Firm isolation at the adapter boundary (docs/07 T5): what a firm asks for is all it gets, and a
 * record of another firm answers 404, exactly like a missing one. Through the real adapters, so the
 * same test holds when a module goes live.
 */

const A = "firm_hts";
const B = "firm_stl";
const onlyFirm = (rows: readonly { firmId: string | null }[], firmId: string) => rows.length > 0 && rows.every((row) => row.firmId === firmId);
const is404 = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  return error instanceof ApiError && error.status === 404;
};

describe.each([[A, B], [B, A]])("firm %s never sees firm %s", (mine, other) => {
  it("lists: candidates, jobs, applications, follow-ups, resumes, ledger, team", async () => {
    expect(onlyFirm(await candidatesApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await jobsApi.list(mine, { limit: 1000 }), mine)).toBe(true);
    expect(onlyFirm(await applicationsApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await followupsApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await resumesApi.list(mine), mine)).toBe(true);
    expect(onlyFirm(await ledgerApi.list(mine, { limit: 1000 }), mine)).toBe(true);
    expect(onlyFirm(await teamApi.list(mine), mine)).toBe(true);
  });

  it("reads by id or candidate: the other firm's records are 404", async () => {
    const theirCandidate = (await candidatesApi.list(other))[0]!;
    const theirJob = (await jobsApi.list(other))[0]!;
    const theirApplication = (await applicationsApi.list(other))[0]!;
    const theirResume = (await resumesApi.list(other))[0]!;
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
    const theirCandidate = (await candidatesApi.list(other))[0]!;
    const theirApplication = (await applicationsApi.list(other))[0]!;
    expect(await is404(candidatesApi.update(mine, theirCandidate.id, { notes: "x" } as never))).toBe(true);
    expect(await is404(applicationsApi.updateStatus(mine, theirApplication.id, { status: "WITHDRAWN", note: null }))).toBe(true);
    expect(await is404(documentsApi.upload(mine, theirCandidate.id, { kind: "OTHER", title: "x", fileName: "x.pdf", mimeType: "application/pdf", sizeKb: 1, expiresAt: null } as never))).toBe(true);
    expect(await is404(inboxApi.connect(mine, theirCandidate.id))).toBe(true);
    const theirDocuments = await documentsApi.byCandidate(other, theirCandidate.id);
    if (theirDocuments[0]) expect(await is404(documentsApi.remove(mine, theirDocuments[0].id))).toBe(true);
    // still untouched for its own firm
    expect((await applicationsApi.byId(other, theirApplication.id)).status).toBe(theirApplication.status);
  });
});

it("keeps platform-only ledger events (firmId null) out of every firm's ledger", async () => {
  for (const firmId of [A, B, "firm_cbw", "firm_gsc"]) {
    const entries = await ledgerApi.list(firmId, { limit: 1000 });
    expect(entries.some((entry) => entry.firmId === null)).toBe(false);
  }
});
