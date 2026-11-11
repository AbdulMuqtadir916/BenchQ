import { describe, expect, it } from "vitest";
import { describeJob } from "./job-description";

// Made-up postings in the shapes real ones arrive in (no real posting in the repo).
const PLAIN_PARAGRAPHS = [
  "Hybrid Role || Java Full Stack Developer || Austin, TX - Local Only",
  "Job Title: Java Full Stack Developer",
  "Location: Austin, TX (Hybrid)",
  "Duration: 12-month contract (with possible extension)",
  "Job Description:",
  "We are looking for an experienced Java developer to lead the design, development and delivery of enterprise applications across a team of engineers, working closely with product owners, architects and quality engineers on a modern cloud platform every day.",
  "Required Skills:",
  "10+ years of Java development.",
  "Strong experience with Spring Boot and REST APIs.",
  "Hands-on experience with React and TypeScript.",
].join("\n");

describe("describeJob: the structure a plain-paragraph posting already has", () => {
  it("makes the leading 'Label: value' lines facts, short ':' lines headings, and the short lines under them bullets", () => {
    expect(describeJob(PLAIN_PARAGRAPHS)).toEqual([
      { kind: "paragraph", text: "Hybrid Role || Java Full Stack Developer || Austin, TX - Local Only" },
      { kind: "facts", items: [
        { label: "Job Title", value: "Java Full Stack Developer" },
        { label: "Location", value: "Austin, TX (Hybrid)" },
        { label: "Duration", value: "12-month contract (with possible extension)" },
      ] },
      { kind: "heading", text: "Job Description" },
      { kind: "paragraph", text: expect.stringMatching(/^We are looking for an experienced Java developer/) },
      { kind: "heading", text: "Required Skills" },
      { kind: "bullets", items: ["10+ years of Java development.", "Strong experience with Spring Boot and REST APIs.", "Hands-on experience with React and TypeScript."] },
    ]);
  });

  it("keeps lines that are already list items, whatever their marker", () => {
    expect(describeJob("Responsibilities:\n- Build APIs\n• Review code\n* Mentor\n1. Ship\n2) Support")).toEqual([
      { kind: "heading", text: "Responsibilities" },
      { kind: "bullets", items: ["Build APIs", "Review code", "Mentor", "Ship", "Support"] },
    ]);
  });

  it("reads a 'Label: value' line under a heading as an item, not a fact", () => {
    expect(describeJob("Benefits:\nHealth: medical and dental\nLeave: 20 days a year")).toEqual([
      { kind: "heading", text: "Benefits" },
      { kind: "bullets", items: ["Health: medical and dental", "Leave: 20 days a year"] },
    ]);
  });

  it("leaves a description with no structure as its paragraphs, and an empty one empty", () => {
    expect(describeJob("One paragraph about the role, with no headings at all and nothing to list.\n\nAnother one.")).toEqual([
      { kind: "paragraph", text: "One paragraph about the role, with no headings at all and nothing to list." },
      { kind: "paragraph", text: "Another one." },
    ]);
    expect(describeJob("")).toEqual([]);
  });

  it("reads headings written without a colon, and the longer items under them, as a list", () => {
    const text = [
      "Job Title: Java Developer",
      "Role Overview",
      "We are looking for a developer to design, build and run the services our finance teams rely on, working with product, operations and data teams every day to deliver new features, improve reliability and keep the platform secure, observable and fast for every user, with a strong focus on quality.",
      "Key Responsibilities",
      "Design, develop, and deploy scalable Java backend services using Spring Boot to support financial operations, including transaction processing, reporting engines, and secure APIs for internal and external integrations.",
      "Lead code reviews.",
      "Desired Skills",
      "Experience in financial services",
      "Remote",
      "Contract",
    ].join("\n");
    expect(describeJob(text).map((block) => [block.kind, block.kind === "heading" ? block.text : block.kind === "bullets" ? block.items.length : ""])).toEqual([
      ["facts", ""], ["heading", "Role Overview"], ["paragraph", ""], ["heading", "Key Responsibilities"], ["bullets", 2],
      ["heading", "Desired Skills"], ["bullets", 3],
    ]);
  });
});
