import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { newText } from "@/lib/resume-doc/build";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import type { StudioTab } from "./studio-store";
import { StudioTopbar } from "./studio-topbar";

/**
 * BUG-013: the studio offered "Tailor with AI" to anyone who may edit. Decision Q55: before a BDE is assigned the OWNER and
 * the candidate's MANAGER may edit and save, but tailoring (like upload and delete) is only the assigned BDE's. The bar takes
 * the two answers separately: `canEdit` (policy `canChangeResume`) for Save, `canTailor` (`canManageResume`) for Tailor.
 * The two rules themselves are tested in src/lib/auth/permissions.test.ts; this pins what the bar does with them.
 */
const doc: ResumeDocument = {
  resumeId: "resume_1", candidateId: "cand_01", name: "Base", isMaster: true, templateId: "template_modern",
  fullName: "", title: "",
  header: { city: "", state: "", country: "", email: "", phone: "", linkedin: "", github: "", workAuthorization: "" },
  summary: newText(), experience: [], skills: [], education: [], certifications: [], awards: [], projects: [],
};

function bar(access: { canEdit: boolean; canTailor: boolean }, tab: StudioTab = "build"): string {
  return renderToStaticMarkup(createElement(StudioTopbar, {
    doc, name: "Base", subtitle: "", isTailoring: false, onSave: () => undefined, onClose: () => undefined,
    onTailor: () => undefined, onExport: () => undefined, tab, onTab: () => undefined, hasAutofill: true, ...access,
  }));
}

describe("the studio top bar", () => {
  it("an owner or manager on an unassigned candidate can save but is not offered Tailor with AI", () => {
    const markup = bar({ canEdit: true, canTailor: false });
    expect(markup).toContain("Save");
    expect(markup).not.toContain("Tailor with AI");
    expect(markup).toContain("Export PDF");
  });

  it("the candidate's own BDE can save and tailor", () => {
    const markup = bar({ canEdit: true, canTailor: true });
    expect(markup).toContain("Save");
    expect(markup).toContain("Tailor with AI");
  });

  it("on the Autofill tab the BDE keeps Save, and Tailor and Export stay with the page tabs", () => {
    const markup = bar({ canEdit: true, canTailor: true }, "autofill");
    expect(markup).toContain("Save");
    expect(markup).not.toContain("Tailor with AI");
    expect(markup).not.toContain("Export PDF");
  });

  it("someone who may only view gets neither Save nor Tailor, and can still export", () => {
    const markup = bar({ canEdit: false, canTailor: false });
    expect(markup).not.toContain("Save");
    expect(markup).not.toContain("Tailor with AI");
    expect(markup).toContain("Export PDF");
  });
});
