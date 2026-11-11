import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORK_AUTH_LABEL } from "@/lib/constants/work-auth";
import type { AutofillChange } from "@/lib/schemas/resume-autofill";
import { allCandidates } from "./candidates";
import { resumesMock } from "./resumes";
import { MOCK_QUESTIONS } from "./resume-autofill";
import { signInAs, signOutForTest } from "./sign-in-as";

const FIRM = "firm_hts";
const VERSION = "rv_cand_03_1";
const nothing: AutofillChange = { edit: {}, built: {}, reset: [], add: {}, remove: [], onlyThis: false };

beforeAll(async () => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
  await signInAs("user_adnan"); // cand_03's BDE
});
afterAll(() => signOutForTest());

describe("the résumé mock's Autofill screen (docs/02 §8.3)", () => {
  it("lists every fixed question once, in the backend's order, with its type", async () => {
    const { candidateId, entries } = await resumesMock.autofill(FIRM, VERSION);
    expect(candidateId).toBe("cand_03");
    expect(entries.map(({ key }) => key)).toEqual(MOCK_QUESTIONS.map(([key]) => key));
    expect(entries.find(({ key }) => key === "full-name")).toMatchObject({ kind: "FIXED", type: "text" });
  });

  it("answers the profile's questions from the candidate, as the backend does", async () => {
    const candidate = allCandidates.find(({ id }) => id === "cand_03")!;
    const { entries } = await resumesMock.autofill(FIRM, VERSION);
    const answer = (key: string) => entries.find((entry) => entry.key === key)?.answer;
    expect(answer("work-auth-status")).toBe(WORK_AUTH_LABEL[candidate.workAuth]);
    expect(answer("visa-sponsorship")).toBe(candidate.needsSponsorship);
    expect(answer("visa-transfer")).toBe(candidate.needsTransfer);
    expect(answer("relocation-willing")).toBe(candidate.willingToRelocate);
    expect(answer("pay-rate")).toBe(candidate.rateTarget);
    expect(answer("notice-period-days")).toBe(candidate.noticePeriodDays);
  });

  it("keeps an edit over the built answer it was shown, and refuses one over another", async () => {
    const { entries } = await resumesMock.autofill(FIRM, VERSION);
    const shown = entries.find(({ key }) => key === "address-city")!.answer;
    const saved = await resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, edit: { "address-city": "Austin" }, built: { "address-city": shown } });
    expect(saved.autofill.entries.find(({ key }) => key === "address-city")).toMatchObject({ kind: "EDITED", answer: "Austin", built: shown });
    await expect(resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, edit: { "address-city": "Dallas" }, built: { "address-city": "Somewhere else" } }))
      .rejects.toMatchObject({ status: 409 });
    const reset = await resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, reset: ["address-city"] });
    expect(reset.autofill.entries.find(({ key }) => key === "address-city")).toMatchObject({ kind: "FIXED", answer: shown });
  });

  it("adds a question of the user's own, answers it again in other capitals, and removes it", async () => {
    await resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, add: { "Why us?": "Payments." } });
    const again = await resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, add: { "WHY US": "Fintech." } });
    expect(again.autofill.entries.filter(({ kind }) => kind === "CUSTOM")).toEqual([
      { question: "Why us?", answer: "Fintech.", kind: "CUSTOM", key: null, type: null, also: [] },
    ]);
    await expect(resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, add: { "what is your full name": "Someone" } })).rejects.toMatchObject({ status: 400 });
    const removed = await resumesMock.saveAutofill(FIRM, VERSION, { ...nothing, remove: ["why us?"] });
    expect(removed.autofill.entries.some(({ kind }) => kind === "CUSTOM")).toBe(false);
  });
});
