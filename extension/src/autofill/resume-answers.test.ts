import { describe, expect, it } from "vitest";
import { LOCATION, WORK_AUTHORIZED } from "./answer-keys";
import { answersFromResume } from "./resume-answers";

const fixed = (key: string, answer: unknown) => ({ question: `Q ${key}`, answer, kind: "FIXED", key });
const answerOf = (entries: unknown[], key: string) => answersFromResume(entries).find((entry) => entry.key === key)?.answer;

describe("a résumé's answers as the matcher reads them", () => {
  it("writes each typed answer the way a form takes it", () => {
    const entries = [
      fixed("visa-sponsorship", true), fixed("relocation-willing", false), fixed("start-date", "2026-12-01"),
      fixed("pay-rate", 85), fixed("notice-period-days", 14), fixed("years-experience", 8),
      fixed("skills", ["Java", "Spring"]), fixed("preferred-locations", ["Dallas, TX", "Austin, TX"]),
    ];
    expect(answerOf(entries, "visa-sponsorship")).toBe("Yes");
    expect(answerOf(entries, "relocation-willing")).toBe("No");
    expect(answerOf(entries, "start-date")).toBe("12/01/2026");
    expect(answerOf(entries, "pay-rate")).toBe("$85/hr");
    expect(answerOf(entries, "notice-period-days")).toBe("14 days");
    expect(answerOf(entries, "years-experience")).toBe("8");
    expect(answerOf(entries, "skills")).toBe("Java, Spring");
    expect(answerOf(entries, "preferred-locations")).toBe("Dallas, TX; Austin, TX");
  });

  it("says Immediately for no notice, and one day for one", () => {
    expect(answerOf([fixed("notice-period-days", 0)], "notice-period-days")).toBe("Immediately");
    expect(answerOf([fixed("notice-period-days", 1)], "notice-period-days")).toBe("1 day");
  });

  it("leaves out lists of jobs or schools, empty answers and anything that isn't a question with an answer", () => {
    const bank = answersFromResume([
      fixed("work-history", [{ company: "Acme" }]), fixed("summary", "  "), { question: "", answer: "x" }, null, "text",
      { question: "Why us?", answer: "Payments.", kind: "CUSTOM" },
    ]);
    expect(bank.map(({ question }) => question)).toEqual(["Why us?"]);
  });

  it("answers each question once", () => {
    const bank = answersFromResume([{ question: "Why us?", answer: "One" }, { question: "Why us?", answer: "Two" }]);
    expect(bank.map(({ answer }) => answer)).toEqual(["One"]);
  });

  it("works out whether the candidate may work in the US, and where they live", () => {
    const bank = answersFromResume([fixed("work-auth-status", "H-1B"), fixed("address-city", "Irving"), fixed("address-region", "TX"), fixed("address-country", "US")]);
    expect(bank.find(({ key }) => key === WORK_AUTHORIZED)?.answer).toBe("Yes");
    expect(bank.find(({ key }) => key === LOCATION)?.answer).toBe("Irving, TX");
  });

  it("names the country of a place outside the US", () => {
    const bank = answersFromResume([fixed("address-city", "Hyderabad"), fixed("address-region", "Telangana"), fixed("address-country", "India")]);
    expect(bank.find(({ key }) => key === LOCATION)?.answer).toBe("Hyderabad, Telangana, India");
  });

  it("answers a saved question's other wordings with the same answer", () => {
    const bank = answersFromResume([{ question: "Willing to work weekends?", also: ["Can you support Saturday/Sunday shifts?", "", 7], answer: "Yes", kind: "CUSTOM" }]);
    expect(bank.map(({ question, answer, key }) => [question, answer, key])).toEqual([
      ["Willing to work weekends?", "Yes", undefined], ["Can you support Saturday/Sunday shifts?", "Yes", undefined],
    ]);
  });
});
