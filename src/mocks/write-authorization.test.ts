import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { can } from "@/lib/auth/policy";
import { agentsMock } from "./agents";
import { applicationsMock, followupsMock } from "./applications";
import { candidatesMock } from "./candidates";
import { documentsMock } from "./documents";
import { inboxMock } from "./inbox";
import { jobsMock } from "./jobs";
import { jobMarksMock } from "./job-marks";
import { ledgerMock } from "./ledger";
import { FIRM_SCOPED_RESOURCES, WRITE_ACTIONS, isReadMethod } from "./membership";
import { recordsMock } from "./records";
import { resumesMock } from "./resumes";
import { signInAs } from "./sign-in-as";
import { teamMock } from "./team";

/**
 * The mock backend refuses every write from a principal the UI never offers it to (07 §4, Q32): a
 * VIEWER and a read-only support view get 403 on **every** firm-scoped write method, decided by the same
 * table the UI reads (src/lib/auth/policy.ts). Walks the methods, so a new write is covered by default —
 * and a write that doesn't name its action fails at load (firmScoped).
 */

type AnyMethod = (firmId: string, ...args: unknown[]) => Promise<unknown>;
const MOCKS: Record<string, Record<string, AnyMethod>> = {
  candidates: candidatesMock, jobs: jobsMock, applications: applicationsMock, followups: followupsMock, resumes: resumesMock, records: recordsMock,
  documents: documentsMock, inbox: inboxMock, ledger: ledgerMock, team: teamMock, agents: { tailorResume: agentsMock.tailorResume } as Record<string, AnyMethod>, jobMarks: jobMarksMock,
} as unknown as Record<string, Record<string, AnyMethod>>;

const FIRM = "firm_hts";
/** Arguments that would make each write succeed for a member who may act (so a refusal can only be the policy). */
const ARGS: Record<string, unknown[]> = {
  "applications.updateStatus": ["app_001", { status: "WITHDRAWN", note: null }],
  "candidates.update": ["cand_01", { headline: "Senior Java Developer" }],
  "candidates.create": [{ fullName: "Policy Check", primaryRole: "QA", email: null, phone: null, workAuth: "USC", needsSponsorship: false, needsTransfer: false, assignedUserId: null }],
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
  await sessionApi.signOut();
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
      "agents.tailorResume", "applications.updateStatus", "candidates.create", "candidates.update", "documents.remove", "documents.upload", "inbox.connect", "inbox.disconnect", "inbox.markRead", "jobMarks.mark", "jobMarks.unmark", "jobs.capture",
    ]);
  });

  it("the Phase B writes name their own actions (fix PRs 1, 2)", () => {
    expect(WRITE_ACTIONS.candidates?.create).toBe("candidate.create");
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
    await signInAs("padm_sana");
    await sessionApi.startSupportView(FIRM, "Checking every write is refused");
  });
  afterAll(async () => {
    await sessionApi.exitSupportView();
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

describe("ledger scope (07 §2.2: BDE `own`)", () => {
  it("a BDE gets only the entries they made; OWNER, MANAGER and VIEWER the whole firm's", async () => {
    await signInAs("user_adnan"); // BDE, firm_hts
    const mine = await ledgerMock.list(FIRM, { limit: 1000 });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((entry) => entry.actorUserId === "user_adnan")).toBe(true);
    for (const userId of ["user_imran", "user_fatima", "user_rohan"]) {
      await signInAs(userId);
      const all = await ledgerMock.list(FIRM, { limit: 1000 });
      expect(all.some((entry) => entry.actorUserId !== "user_adnan"), userId).toBe(true);
      expect(all.length, userId).toBeGreaterThan(mine.length);
    }
  });
});

describe("platform writes (07 Phase C): every one names its platform action; a firm user is refused", () => {
  it("the inventory: every platform method is a read or a declared write", async () => {
    const { platformMock, PLATFORM_WRITE_ACTIONS } = await import("./platform");
    for (const [resource, methods] of Object.entries(platformMock)) {
      for (const name of Object.keys(methods)) {
        const isRead = ["list", "get", "usage"].includes(name);
        expect(isRead || Boolean(PLATFORM_WRITE_ACTIONS[resource]?.[name]), `${resource}.${name}`).toBe(true);
      }
    }
  });

  it("an OWNER is refused (403) on every platform write; a Super Admin is not refused by the policy", async () => {
    const { platformMock, PLATFORM_WRITE_ACTIONS } = await import("./platform");
    const writesList = Object.entries(PLATFORM_WRITE_ACTIONS).flatMap(([resource, methods]) => Object.keys(methods).map((name) => [resource, name] as const));
    expect(writesList.length).toBe(17);
    const callPlatform = (resource: string, name: string) => (platformMock as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[resource]![name]!("nope", "nope");
    await signInAs("user_imran");
    for (const [resource, name] of writesList) await expect(callPlatform(resource, name), `${resource}.${name}`).rejects.toMatchObject({ status: 403 });
    await signInAs("padm_sana");
    for (const [resource, name] of writesList) {
      const outcome = await callPlatform(resource, name).then(() => "ok", (error: { status?: number }) => error.status);
      expect(outcome, `${resource}.${name}`).not.toBe(403);
    }
  });
});
