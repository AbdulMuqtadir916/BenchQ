import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { newText } from "@/lib/resume-doc/build";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { StudioTopbar } from "./studio-topbar";

/**
 * The studio's top bar: Save for whoever may edit (07 Q55 `canChangeResume`), Export for everyone. It offers no
 * tailoring: a tailoring starts from a job (decided 2026-11-12, tailoring part 3 Q2), on the job screens. BUG-013 (the
 * studio offered "Tailor with AI" to anyone who may edit) is gone with the button.
 */
const doc: ResumeDocument = {
  resumeId: "resume_1", candidateId: "cand_01", name: "Base", isMaster: true, templateId: "template_modern",
  fullName: "", title: "",
  header: { city: "", state: "", country: "", email: "", phone: "", linkedin: "", github: "", workAuthorization: "" },
  summary: newText(), experience: [], skills: [], education: [], certifications: [], awards: [], projects: [],
};

function bar(canEdit: boolean): string {
  return renderToStaticMarkup(createElement(StudioTopbar, {
    doc, name: "Base", subtitle: "", canEdit, onSave: () => undefined, onClose: () => undefined, onExport: () => undefined,
  }));
}

describe("the studio top bar", () => {
  it("whoever may edit can save and export, and is offered no tailoring", () => {
    const markup = bar(true);
    expect(markup).toContain("Save");
    expect(markup).toContain("Export PDF");
    expect(markup).not.toContain("Tailor");
  });

  it("someone who may only view gets no Save, and can still export", () => {
    const markup = bar(false);
    expect(markup).not.toContain("Save");
    expect(markup).toContain("Export PDF");
  });
});
