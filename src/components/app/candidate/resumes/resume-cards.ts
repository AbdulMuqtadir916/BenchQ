import type { TreeBase, TreeTailored, TreeVersion } from "@/lib/derive/resume-tree";
import { roleOf } from "@/lib/derive/resume-name";

/**
 * The candidate's Résumés tab in a recruiter's words: one card per résumé, titled by its role, the main one first.
 * Internal terms (base, version numbers as "v2", tailored, active) never reach the screen; they're mapped here.
 */
export interface ResumeCard {
  node: TreeBase;
  /** The role, e.g. "Artificial Intelligence Engineer"; "(2)" after it when two résumés share a role. */
  title: string;
  isMain: boolean;
  latest: TreeVersion | null;
  /** Older versions, newest first. */
  older: TreeVersion[];
}

/** "Artificial Intelligence engineer" → "Artificial Intelligence Engineer"; acronyms and other casing are kept. */
export function titleCase(text: string): string {
  return text.replace(/\b([a-z])([a-z]*)/g, (word, first: string, rest: string) => (["and", "of", "for", "the", "in", "to", "a", "an", "or"].includes(word) ? word : first.toUpperCase() + rest));
}

/** The cards in order: the main résumé first, then the rest as they were made. */
export function resumeCards(bases: readonly TreeBase[], primaryRole: string | null | undefined): ResumeCard[] {
  const titles = bases.map((node) => titleCase(roleOf(node.resume?.name, primaryRole) ?? "Résumé"));
  const seen = new Map<string, number>();
  const cards = bases.map((node, i) => {
    const base = titles[i]!;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const [latest = null, ...older] = node.versions;
    return { node, title: n > 1 ? `${base} (${n})` : base, isMain: node.base.isActive, latest, older };
  });
  return [...cards.filter((c) => c.isMain), ...cards.filter((c) => !c.isMain)];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Updated 4 minutes ago by Ben · 2 versions". */
export function updatedLine(when: string, by: string | null, versions: number): string {
  return [`Updated ${when}${by ? ` by ${by}` : ""}`, plural(versions, "version")].join(" · ");
}

/** "Version 2 · current · Ben · 4 minutes ago"; the first version says where it came from. */
export function versionLine(version: TreeVersion, by: string | null, when: string, source: "UPLOAD" | "PROMOTED"): string {
  const origin = version.number === 1 ? (source === "UPLOAD" ? "uploaded file" : "copied from another résumé") : null;
  return [`Version ${version.number}`, version.isLatest ? "current" : null, origin, by, when].filter(Boolean).join(" · ");
}

/** A job copy's title: "Acme Corp – Data Engineer", or "A job" when the job isn't known here. */
export function copyTitle(job: { company: string; title: string } | null): string {
  return (job ? [job.company, job.title].map((p) => p.trim()).filter(Boolean).join(" – ") : "") || "A job";
}

export function copyCount(copies: readonly TreeTailored[]): string {
  return `Copies made for specific jobs (${copies.length})`;
}

export { plural };
