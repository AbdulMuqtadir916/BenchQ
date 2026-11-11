import { describe, expect, it } from "vitest";
import { baseName, resumeFileName, roleOf, tailoredName, versionName } from "./resume-name";

describe("résumé names", () => {
  it("names a base by candidate, role and number, and a version after its base", () => {
    expect(baseName("Candidate", "Java Developer", 2)).toBe("Candidate · Java Developer · Base 2");
    expect(versionName(baseName("Candidate", "Java Developer", 2), 3)).toBe("Candidate · Java Developer · Base 2 · v3");
  });

  it("takes the role from the base's headline, else the candidate's primary role, else leaves it out", () => {
    expect(roleOf("Java Developer", "QA Engineer")).toBe("Java Developer");
    expect(roleOf("Base", "QA Engineer")).toBe("QA Engineer");
    expect(roleOf("Senior BI Developer | Power BI | Analytics", null)).toBe("Senior BI Developer");
    expect(roleOf("Base", "Senior BI Developer | Power BI")).toBe("Senior BI Developer");
    expect(roleOf("  ", null)).toBeNull();
    expect(baseName("Candidate", null, 1)).toBe("Candidate · Base 1");
  });

  it("names a tailored copy by its job's company and title", () => {
    expect(versionName(tailoredName("Candidate", { company: "Acme", title: "Backend Engineer" }), 2)).toBe("Candidate · Acme – Backend Engineer · v2");
    expect(tailoredName("Candidate", null)).toBe("Candidate · A job");
  });

  it("turns a name into a file name", () => {
    expect(resumeFileName("Candidate Name · Java Developer · Base 2 · v3")).toBe("Candidate-Name_Java-Developer_Base2_v3");
    expect(resumeFileName("Candidate · Acme, Inc. – Sr. C++ Engineer · v2")).toBe("Candidate_Acme-Inc_Sr-C-Engineer_v2");
    expect(resumeFileName("José · Base 1")).toBe("Jose_Base1");
    expect(resumeFileName("")).toBe("Resume");
  });
});
