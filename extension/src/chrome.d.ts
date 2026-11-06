declare const chrome: {
  runtime: { onInstalled: { addListener(callback: () => void): void } };
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  tabs: { create(options: { url: string }): Promise<unknown> };
};
declare const __BENCHQ_URL__: string;
