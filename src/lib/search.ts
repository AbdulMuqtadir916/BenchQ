/**
 * Whether a row matches the search a person typed, for tables that keep the search text in the URL and so filter their
 * rows themselves (see `DataTable`'s `search`). Every word must be found, ignoring case, in at least one of the row's
 * fields, so "krishnan salesforce" finds a name and a role together. A blank search matches everything.
 */
export function matchesSearch(fields: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter((field): field is string => Boolean(field)).map((field) => field.toLowerCase());
  return words.every((word) => haystack.some((field) => field.includes(word)));
}
