const mock = () => import("@/mocks/demo-data").then((m) => m.demoDataMock);

/**
 * The demo data (docs/03 §3.3): persisted in this browser by the mock layer. Phase D's backend has
 * real data and no reset; this adapter goes with the mocks.
 */
export const demoDataApi = {
  /** Wipe every change in this browser and reseed from the fixtures. Super Admin only. */
  reset: async (): Promise<null> => (await mock()).reset(),

  /** Call `onChange` when the data changed underneath this tab: another tab's change, or a reset. */
  watch: (onChange: () => void): (() => void) => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void mock().then((m) => {
      if (!cancelled) stop = m.watch(onChange);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  },
};
