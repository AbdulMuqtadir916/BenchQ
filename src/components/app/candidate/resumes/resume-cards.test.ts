import { describe, expect, it } from "vitest";
import sample from "@/lib/api/dto/__samples__/resumes.json";
import { ResumeShelfDto, toResumeShelf } from "@/lib/api/dto/resumes";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { copyCount, copyTitle, resumeCards, titleCase, updatedLine, versionLine } from "./resume-cards";

const shelf = toResumeShelf(ResumeShelfDto.parse(sample.listing), "firm_hts");
const [candidate] = buildResumeTree(shelf);

/** Words the Résumés tab must never show. */
const JARGON = /\b(base|tailored|active|latest|uploaded)\b|\bv\d\b/i;

describe("the Résumés tab's cards", () => {
  const cards = resumeCards(candidate!.bases, "Java Developer");

  it("puts the main résumé first, marked as main", () => {
    expect(cards.map((c) => c.isMain)).toEqual([true, false]);
    expect(cards[0]!.node.base.isActive).toBe(true);
  });

  it("titles a card by its role only, never the candidate's name or a number", () => {
    for (const card of cards) {
      expect(card.title).not.toMatch(JARGON);
      expect(card.title).not.toMatch(/·/);
    }
  });

  it("tells two résumés for the same role apart", () => {
    const same = resumeCards(candidate!.bases.map((b) => ({ ...b, resume: b.resume && { ...b.resume, name: "Base" } })), "Java Developer");
    expect(same.map((c) => c.title)).toEqual(["Java Developer", "Java Developer (2)"]);
    expect(same[0]!.isMain).toBe(true);
  });

  it("splits the newest version from the older ones", () => {
    const card = cards.find((c) => c.node.versions.length > 1)!;
    expect(card.latest?.isLatest).toBe(true);
    expect(card.older.map((v) => v.isLatest)).toEqual(card.older.map(() => false));
  });

  it("capitalises a role without touching acronyms", () => {
    expect(titleCase("Artificial Intelligence engineer")).toBe("Artificial Intelligence Engineer");
    expect(titleCase("AI / ML engineer for the cloud")).toBe("AI / ML Engineer for the Cloud");
  });

  it("says who updated it and when, in plain words", () => {
    expect(updatedLine("4 minutes ago", "Ben", 2)).toBe("Updated 4 minutes ago by Ben · 2 versions");
    expect(updatedLine("5 hours ago", null, 1)).toBe("Updated 5 hours ago · 1 version");
  });

  it("describes versions without internal terms", () => {
    const [newest, first] = [{ id: "a", number: 2, createdAt: "", createdByUserId: "", isLatest: true, madeByLead: false }, { id: "b", number: 1, createdAt: "", createdByUserId: "", isLatest: false, madeByLead: false }];
    expect(versionLine(newest, "Ben", "4 minutes ago", "UPLOAD")).toBe("Version 2 · current · Ben · 4 minutes ago");
    expect(versionLine(first, "Abdul", "5 hours ago", "UPLOAD")).toBe("Version 1 · uploaded file · Abdul · 5 hours ago");
    expect(versionLine(first, null, "5 hours ago", "PROMOTED")).toBe("Version 1 · copied from another résumé · 5 hours ago");
  });

  it("names job copies by the job", () => {
    expect(copyTitle({ company: "Acme Corp", title: "Data Engineer" })).toBe("Acme Corp – Data Engineer");
    expect(copyTitle(null)).toBe("A job");
    expect(copyCount(candidate!.bases[0]!.tailored)).toBe("Copies made for specific jobs (1)");
  });
});
