import { describe, expect, it } from "vitest";
import sample from "./__samples__/resumes.json";
import { ResumeVersionDto, toResumeDocument } from "./resumes";
import { missingForSave } from "@/lib/resume-doc/save-check";
import { toBackendContent } from "./resume-content";

const source = ResumeVersionDto.parse(sample.version);
const doc = toResumeDocument(source);

describe("saving the studio's document over the version as it is now (option 1)", () => {
  it("an untouched document saves the same content, ids and all", () => {
    const body = toBackendContent(doc, source);
    expect(body.experiences).toEqual([{ id: "e-1", job_title: "Senior Developer", company: "A Company", location: "Dallas, TX", dates: "", start: "Jan 2020", end: "", current: true, bullets: [{ id: "b-1", text: "Cut build time <50%>." }] }]);
    expect(body.skills).toEqual([{ id: "k-1", category: "Languages", name: "Java" }, { id: "k-2", category: "Languages", name: "Kotlin" }, { id: "k-3", category: "", name: "Docker" }]);
    expect(body.projects[0]!.bullets.map((b) => b.id)).toEqual(["pb-1", "pb-2"]);
    expect(body.summary).toBe("Nine years of Java & Spring.");
  });

  it("carries over what the studio doesn't edit: languages and work authorization", () => {
    const body = toBackendContent({ ...doc, header: { ...doc.header, workAuthorization: "changed in the page" } }, source);
    expect(body.languages).toEqual([{ id: "l-1", name: "English" }]);
    expect(body.work_authorization).toBe("H-1B");
  });

  it("a new item or bullet goes without an id; a removed one is gone; formatting is dropped", () => {
    const edited = {
      ...doc,
      experience: [{ ...doc.experience[0]!, bullets: [{ id: "b-1", html: "Cut build time <b>in half</b>." }, { id: "text_new", html: "A new line" }] }],
      education: [],
      skills: [{ id: "skills_0", category: "Languages", items: "Java, Go" }],
      awards: [{ id: "award_new", name: "Employee of the Year", issuer: "A Company", date: "2024", detail: "" }, { id: "award_blank", name: " ", issuer: "", date: "", detail: "" }],
    };
    const body = toBackendContent(edited, source);
    expect(body.experiences[0]!.bullets).toEqual([{ id: "b-1", text: "Cut build time in half." }, { id: null, text: "A new line" }]);
    expect(body.educations).toEqual([]);
    expect(body.skills).toEqual([{ id: "k-1", category: "Languages", name: "Java" }, { id: null, category: "Languages", name: "Go" }]);
    expect(body.awards).toEqual([{ id: null, name: "Employee of the Year", issuer: "A Company", date: "2024", detail: "" }]);
  });

  it("an id is used once: a copied bullet goes as new", () => {
    const twice = { ...doc, experience: [{ ...doc.experience[0]!, bullets: [doc.experience[0]!.bullets[0]!, doc.experience[0]!.bullets[0]!] }] };
    expect(toBackendContent(twice, source).experiences[0]!.bullets.map((b) => b.id)).toEqual(["b-1", null]);
  });

  it("names what the backend would refuse: the header's name and email", () => {
    expect(missingForSave(doc)).toEqual([]);
    expect(missingForSave({ ...doc, fullName: " ", header: { ...doc.header, email: "" } })).toEqual(["fullName", "email"]);
  });
});
