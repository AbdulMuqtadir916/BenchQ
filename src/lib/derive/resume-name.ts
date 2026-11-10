/**
 * How BenchQ names a résumé (decided 2026-11-05; docs/04 §4.3). Derived from what is stored, never stored itself:
 *
 *   base       <Candidate> · <Role> · Base 2          the role is the base's headline, else the candidate's "Marketed as"
 *   version    <Candidate> · <Role> · Base 2 · v3
 *   tailored   <Candidate> · <Company> – <Job title> · v2
 *   PDF file   Candidate-Name_Role_Base2_v3
 */

/** The name the backend gives every résumé row: not a role. */
const DEFAULT_NAME = "Base";

const named = (parts: Array<string | null | undefined>) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ");

/**
 * The role a base is named by: its own name (the headline), else the candidate's primary role. A headline listing
 * several things ("Senior BI Developer | Power BI | Analytics") is named by the first.
 */
export function roleOf(resumeName: string | null | undefined, primaryRole: string | null | undefined): string | null {
  const first = (text: string | null | undefined) => text?.split("|")[0]?.trim();
  const own = first(resumeName);
  return (own && own !== DEFAULT_NAME ? own : first(primaryRole)) || null;
}

export function baseName(candidate: string | null | undefined, role: string | null | undefined, number: number): string {
  return named([candidate, role, `Base ${number}`]);
}

export function tailoredName(candidate: string | null | undefined, job: { company: string; title: string } | null): string {
  const target = job ? [job.company, job.title].map((p) => p.trim()).filter(Boolean).join(" – ") : "";
  return named([candidate, target || "A job"]);
}

export function versionName(name: string, version: number): string {
  return `${name} · v${version}`;
}

/** A name as a file name: each part's words joined by "-", the parts by "_", "Base 2" as "Base2"; ASCII only. */
export function resumeFileName(name: string): string {
  const parts = name
    .split(/\s+[·–]\s+/)
    .map((part) =>
      part
        .trim()
        .replace(/^Base (\d+)$/, "Base$1")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
  return parts.join("_") || "Resume";
}
