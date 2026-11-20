import { describe, expect, it } from "vitest";
import type { AutofillEntry } from "@/lib/schemas/resume-autofill";
import { autofillSections, builderSectionOf, displayAnswer, matchesSearch, recordLines, SELF_ID_SUGGESTIONS, sourceOf, statusOf, summarize, topicOf } from "./autofill-view";

const fixed = (key: string, answer: AutofillEntry["answer"], extra: Partial<AutofillEntry> = {}): AutofillEntry => ({
  question: `Question ${key}?`, answer, kind: "FIXED", key, type: "text", also: [], ...extra,
});
const custom = (question: string, answer: string): AutofillEntry => ({ question, answer, kind: "CUSTOM", key: null, type: null, also: [] });

const entries: AutofillEntry[] = [
  fixed("full-name", "Lakshmi Narayanan"),
  fixed("address-city", "Atlanta"),
  fixed("github-url", null),
  fixed("visa-sponsorship", true, { type: "boolean" }),
  fixed("pay-rate", 85, { type: "number", kind: "EDITED", built: 80 }),
  fixed("address-region", "GA", { replaced: "Georgia" }),
  fixed("brand-new-key", "Something"),
  custom("Why do you want to work here?", "The team."),
];

describe("the Autofill tab's reading", () => {
  it("files each question under its topic, with replaced edits and the user's own questions apart", () => {
    expect(entries.map(topicOf)).toEqual(["contact", "location", "contact", "authorization", "preferences", "review", "other", "custom"]);
    expect(["gender", "race", "veteran-status", "disability-status"].map((key) => topicOf(fixed(key, null)))).toEqual(["self-id", "self-id", "self-id", "self-id"]);
  });

  it("says self-identification is the candidate's own, never the résumé's or the profile's", () => {
    expect(sourceOf(fixed("race", null))).toBe("self-id");
    expect(SELF_ID_SUGGESTIONS.race).toContain("Two or More Races");
  });

  it("files the personal and screening questions the BDE answers, and citizenship as the profile's", () => {
    expect(["over-18", "criminal-history", "security-clearance"].map((key) => [topicOf(fixed(key, null)), sourceOf(fixed(key, null))]))
      .toEqual([["screening", "ask"], ["screening", "ask"], ["screening", "ask"]]);
    expect([topicOf(fixed("address-postal", null)), sourceOf(fixed("citizenship", true))]).toEqual(["location", "profile"]);
  });

  it("names each status", () => {
    expect(entries.map(statusOf)).toEqual(["answered", "answered", "missing", "answered", "edited", "review", "answered", "custom"]);
  });

  it("counts from the entries", () => {
    expect(summarize(entries)).toEqual({ total: 8, answered: 7, missing: 1, review: 1, yours: 2 });
  });

  it("says where BenchQ's answer comes from", () => {
    expect([sourceOf(entries[0]!), sourceOf(entries[3]!), sourceOf(entries[7]!)]).toEqual(["resume", "profile", null]);
    const years = fixed("years-experience", 8);
    expect(sourceOf(years, [fixed("work-history", [{ title: "QA", start: "2019-03" }])])).toBe("work-history");
    expect(sourceOf(years, [fixed("work-history", [{ title: "QA", start: "" }])])).toBe("profile");
    expect(sourceOf(years, [])).toBe("profile");
  });

  it("writes an answer as the extension fills it", () => {
    expect(displayAnswer("visa-sponsorship", false)).toBe("No");
    expect(displayAnswer("pay-rate", 85)).toBe("$85/hr");
    expect(displayAnswer("notice-period-days", 0)).toBe("Immediately");
    expect(displayAnswer("notice-period-days", 14)).toBe("14 days");
    expect(displayAnswer("start-date", "2026-12-01")).toBe("12/01/2026");
    expect(displayAnswer("preferred-locations", ["Dallas, TX", "Austin, TX"])).toBe("Dallas, TX; Austin, TX");
    expect(displayAnswer("github-url", null)).toBeNull();
  });

  it("reads a record as what it is, then where and when", () => {
    expect(recordLines("work-history", { title: "QA Lead", company: "Acme", location: "Atlanta, GA", dates: "Mar 2021 – Present", current: true }))
      .toEqual(["QA Lead · Acme", "Atlanta, GA · Mar 2021 – Present"]);
    expect(recordLines("work-history", { title: "QA Lead", company: "Acme", current: true })).toEqual(["QA Lead · Acme", "Current"]);
    expect(recordLines("education-history", { degree: "B.Tech in CSE", school: "JNTU", graduation_date: "2017", grade: "8.2" }))
      .toEqual(["B.Tech in CSE · JNTU", "2017 · 8.2"]);
    expect(builderSectionOf(fixed("education-history", []))).toBe("education");
  });

  it("finds a question by the start of any word of it, its other wordings or its answer", () => {
    expect(matchesSearch(entries[3]!, "relocat")).toBe(false);
    expect(matchesSearch({ ...entries[3]!, question: "Will you require visa sponsorship?" }, "visa spons")).toBe(true);
    expect(matchesSearch(entries[1]!, "atl")).toBe(true);
    expect(matchesSearch({ ...entries[7]!, also: ["Why us?"] }, "us")).toBe(true);
  });

  it("shows the sections a filter leaves, keeping Your questions on the open list for Add a question", () => {
    expect(autofillSections(entries, "all", "").map(({ id }) => id))
      .toEqual(["review", "contact", "location", "authorization", "preferences", "other", "custom"]);
    expect(autofillSections(entries, "missing", "").map(({ id, entries: shown }) => [id, shown.length])).toEqual([["contact", 1]]);
    expect(autofillSections(entries.slice(0, 7), "all", "").at(-1)?.id).toBe("custom");
    expect(autofillSections(entries.slice(0, 7), "all", "atlanta").map(({ id }) => id)).toEqual(["location"]);
  });
});
