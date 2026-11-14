import type { PageApi } from "../autofill/types";
import { createFiller } from "./fill";
import { addEntry } from "./entries";
import { readJob } from "./job";
import { readFields, scanDocument, waitForQuiet, type Registry } from "./scan";

/** Injected into a connected tab's frames, in the extension's isolated world: the page's own scripts can't see it.
 * It runs again on every scan, so it installs itself once per build: a tab left open across an update still has the
 * old script in its world, and the panel can't read that one's answers. It must not import shared runtime code
 * (vite.config.ts). */
const scope = globalThis as typeof globalThis & { __benchqAutofill?: PageApi };

if (scope.__benchqAutofill?.version !== __PAGE_BUILD__) {
  let registry: Registry | null = null;
  let scans = 0;

  scope.__benchqAutofill = {
    version: __PAGE_BUILD__,
    async scan() {
      await waitForQuiet(document);
      scans += 1;
      const result = scanDocument(document, scans, window === window.top);
      registry = result.registry;
      return result.scan;
    },
    read: () => (registry ? readFields(document, registry) : null),
    readJob: () => readJob(document),
    addEntry: (kind) => addEntry(document, kind),
    ...createFiller(() => registry),
  };
}
