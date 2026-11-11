export interface SortValue {
  id: string;
  desc: boolean;
}

/**
 * A list's sort as one URL value (CLAUDE.md: sort lives in the URL): the column id, with a leading `-` for descending,
 * so `?sort=-apps` is "Apps, high to low". A column the list does not have, or anything malformed, is no sort, so a stale
 * or hand-typed URL never breaks the list.
 */
export function parseSort(raw: string, allowed: readonly string[]): SortValue | null {
  const desc = raw.startsWith("-");
  const id = desc ? raw.slice(1) : raw;
  return id !== "" && allowed.includes(id) ? { id, desc } : null;
}

/** The URL value for a sort; no sort is an empty string, which the URL helper leaves out. */
export function formatSort(sort: SortValue | null): string {
  return sort ? `${sort.desc ? "-" : ""}${sort.id}` : "";
}
