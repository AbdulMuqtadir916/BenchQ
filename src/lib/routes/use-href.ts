import { hrefFor } from "./registry";

/**
 * Link builder for components. Today it is `hrefFor`. Phase T (docs/07) makes it fill the `[firm]`
 * segment from the current URL, so components keep calling `toHref("candidates.detail", { id })` and
 * never learn about firms. Use `hrefFor` directly only where hooks can't run (server redirects).
 */
export function useHref(): typeof hrefFor {
  return hrefFor;
}
