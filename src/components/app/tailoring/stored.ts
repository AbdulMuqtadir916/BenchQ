import type { z } from "zod";

/**
 * A per-viewer convenience kept in this browser (the panel's dismissed rows, whether it is folded). Storage can be
 * missing, refuse, or hold something else (a private window, blocked site data, an older shape): the panel then
 * works from the schema's fallback (`.catch()`).
 */
export function readStored<S extends z.ZodType>(key: string, schema: S): z.infer<S> {
  let raw: string | null = null;
  try {
    raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  let value: unknown = undefined;
  try {
    value = raw === null ? undefined : JSON.parse(raw);
  } catch {
    value = undefined;
  }
  return schema.parse(value);
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: the panel still works for this page's life.
  }
}
