import { currentPlatformUser } from "./auth";
import { resetDemoData, watchDemoData, watchStorageFull } from "./db";
import { mockResult } from "./_shared";

/** The demo data's own controls (docs/03 §3.3). */
export const demoDataMock = {
  /** Wipe every change in this browser and reseed from the fixtures. Super Admin only (403 otherwise). */
  reset: async (): Promise<null> => {
    currentPlatformUser();
    resetDemoData();
    return mockResult(null);
  },

  watch: (onChange: () => void): (() => void) => watchDemoData(onChange),

  watchStorageFull: (onChange: (full: boolean) => void): (() => void) => watchStorageFull(onChange),
};
