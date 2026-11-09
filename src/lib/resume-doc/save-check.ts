import type { ResumeDocument } from "@/lib/schemas/resume-document";

/** What the backend refuses to save (422), said before sending: the header's name and email (resume-versioning §4.3). */
export function missingForSave(doc: ResumeDocument): Array<"fullName" | "email"> {
  return [!doc.fullName.trim() ? ("fullName" as const) : null, !doc.header.email.trim() ? ("email" as const) : null].filter((f): f is "fullName" | "email" => f !== null);
}
