import { matchesSearch } from "@/lib/search";

const GROUPS = ["Actions", "Recent", "Candidates", "Jobs", "Firms", "Navigation"] as const;
export type PaletteGroup = (typeof GROUPS)[number];

type PaletteEntry = { id: string; group: PaletteGroup; label: string; keywords?: string };

export function paletteResults<T extends PaletteEntry>(entries: readonly T[], query: string, recentIds: readonly string[]) {
  const searched = entries.filter((entry) => matchesSearch([entry.label, entry.keywords], query));
  const recent = query.trim() ? [] : recentIds.flatMap((id) => {
    const entry = searched.find((candidate) => candidate.id === id);
    return entry ? [{ ...entry, group: "Recent" as const }] : [];
  });
  const recentSet = new Set(recent.map(({ id }) => id));
  return GROUPS.flatMap((group) => {
    if (group === "Recent") return recent;
    const matches = searched.filter((entry) => entry.group === group && (group === "Actions" || !recentSet.has(entry.id)));
    return group === "Candidates" || group === "Jobs" ? matches.slice(0, query.trim() ? 25 : 8) : matches;
  });
}
