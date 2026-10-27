import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can } from "@/lib/auth/policy";
import { agentsMock } from "./agents";
import { applicationsMock, followupsMock } from "./applications";
import { candidatesMock } from "./candidates";
import { createCandidateBody } from "./create-candidate-body";
import { documentsMock } from "./documents";
import { inboxMock } from "./inbox";
import { jobsMock } from "./jobs";
import { jobMarksMock } from "./job-marks";
import { FIRM_SCOPED_RESOURCES, WRITE_ACTIONS, isReadMethod } from "./membership";
import { recordsMock } from "./records";
import { resumesMock } from "./resumes";
import { signInAs, signInAsSupportView, signOutForTest } from "./sign-in-as";

/**
 * The mock backend refuses every write from a principal the UI never offers it to (07 §4, Q32): a
 * VIEWER and a read-only support view get 403 on **every** firm-scoped write method, decided by the same
 * table the UI reads (src/lib/auth/policy.ts). Walks the methods, so a new write is covered by default —
 * and a write that doesn't name its action fails at load (firmScoped).
 */

type AnyMethod = (firmId: string, ...args: unknown[]) => Promise<unknown>;
const MOCKS: Record<string, Record<string, AnyMethod>> = {
  candidates: candidatesMock, jobs: jobsMock, applications: applicationsMock, followups: followupsMock, resumes: resumesMock, records: recordsMock,
  documents: documentsMock, inbox: inboxMock, agents: { tailorResume: agentsMock.tailorResume } as Record<string, AnyMethod>, jobMarks: jobMarksMock,
} as unknown as Record<string, Record<string, AnyMethod>>;

const FIRM = "firm_hts";
/** Arguments that would make each write succeed for a member who may act (so a refusal can only be the policy). */
const ARGS: Record<string, unknown[]> = {
  "applications.updateStatus": ["app_001", { status: "WITHDRAWN", note: null }],
  "candidates.update": ["cand_01", { headline: "Senior Java Developer" }],
  "candidates.create": [createCandidateBody({ fullName: "Policy Check", primaryRole: "QA", workAuth: "USC" })],
  "candidates.followBde": ["user_adnan", "user_fatima"],
  "candidates.reassign": ["cand_01", { managerId: "user_priya", bdeId: "user_vikram", note: null }],
  "candidates.parseResume": [{ fileName: "Ravi_Teja_Java_FullStack.pdf", sizeBytes: 1000, mimeType: "application/pdf" }],
  "jobs.capture": [{ sourceUrl: "https://example.com/jobs/policy-check", title: "QA", companyName: "Example", location: "", remoteMode: "REMOTE", employmentType: null, payPeriod: "HOUR", payMin: null, payMax: null, sponsorsVisa: false, excludesC2C: false, experience: "", skills: [], description: "Policy check" }],
  "documents.upload": ["cand_01", { kind: "OTHER", title: "Note", fileName: "note.pdf", sizeBytes: 1000, expiresAt: null }],
  "documents.remove": ["doc_none"],
  "inbox.connect": ["cand_01"],
  "inbox.disconnect": ["cand_01"],
  "inbox.markRead": ["msg_none"],
  "jobMarks.mark": ["job_001", "SAVED"],
  "jobMarks.unmark": ["job_001", "SAVED"],
  "agents.tailorResume": [{ resumeVersionId: "rv", jobId: "job" }],
};

const writes = Object.entries(WRITE_ACTIONS).flatMap(([resource, methods]) => Object.entries(methods).map(([name, action]) => ({ resource, name, action })));
const call = (resource: string, name: string) => MOCKS[resource]![name]!(FIRM, ...(ARGS[`${resource}.${name}`] ?? []));

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
afterAll(async () => {
  signOutForTest();
});

describe("the write inventory", () => {
  it("covers every firm-scoped resource, and every method is a read or a declared write", () => {
    expect(Object.keys(MOCKS).sort()).toEqual([...FIRM_SCOPED_RESOURCES].sort());
    for (const [resource, methods] of Object.entries(MOCKS)) {
      for (const name of Object.keys(methods)) {
        expect(isReadMethod(name) || Boolean(WRITE_ACTIONS[resource]?.[name]), `${resource}.${name}`).toBe(true);
      }
    }
    expect(writes.map((w) => `${w.resource}.${w.name}`).sort()).toEqual([
      "agents.tailorResume", "applications.updateStatus", "candidates.create", "candidates.followBde", "candidates.parseResume", "candidates.reassign", "candidates.update", "documents.remove", "documents.upload", "inbox.connect", "inbox.disconnect", "inbox.markRead", "jobMarks.mark", "jobMarks.unmark", "jobs.capture",
    ]);
  });

  it("the Phase B writes name their own actions (fix PRs 1, 2)", () => {
    expect(WRITE_ACTIONS.candidates?.create).toBe("candidate.create");
    expect(WRITE_ACTIONS.candidates?.parseResume).toBe("candidate.create"); // reading a résumé is part of adding one
    expect(WRITE_ACTIONS.jobs?.capture).toBe("job.capture");
    expect(WRITE_ACTIONS.jobMarks).toEqual({ mark: "job.apply", unmark: "job.apply" });
  });
});

describe("a VIEWER is refused every write (403), with the UI's table", () => {
  beforeAll(async () => {
    await signInAs("user_rohan"); // VIEWER, firm_hts
  });

  it.each(writes)("$resource · $name ($action)", async ({ resource, name, action }) => {
    expect(can({ kind: "firm", userId: "user_rohan", firmId: FIRM, role: "VIEWER" }, action)).toBe(false);
    await expect(call(resource, name)).rejects.toMatchObject({ status: 403 });
  });

  it("agents.rewrite (resume text, no firm) too", async () => {
    await expect(agentsMock.rewrite({ text: "Led a team of five engineers.", action: "TIGHTEN" } as never)).rejects.toMatchObject({ status: 403 });
  });

  it("still reads (the refusal is about writing, not membership)", async () => {
    expect((await candidatesMock.list(FIRM)).length).toBeGreaterThan(0);
  });
});

describe("a support view is refused every write (403)", () => {
  beforeAll(async () => {
    await signInAsSupportView("padm_sana", FIRM);
  });
  afterAll(() => {
    signOutForTest();
  });

  it.each(writes)("$resource · $name", async ({ resource, name }) => {
    await expect(call(resource, name)).rejects.toMatchObject({ status: 403 });
  });

  it("agents.rewrite too", async () => {
    await expect(agentsMock.rewrite({ text: "Led a team of five engineers.", action: "TIGHTEN" } as never)).rejects.toMatchObject({ status: 403 });
  });
});

describe("control: an OWNER is not refused by the policy", () => {
  beforeAll(async () => {
    await signInAs("user_imran");
  });

  it.each(writes)("$resource · $name", async ({ resource, name }) => {
    // It may fail for its own reasons (an id that doesn't exist: 404), never with 403.
    const outcome = await call(resource, name).then(() => "ok", (error: { status?: number }) => error.status);
    expect(outcome).not.toBe(403);
  });
});
