/** The panel's answer to "is BenchQ open in this window?", which the job page's launcher asks (assistant.ts,
 * `assistant-visible`). Chrome's getContexts reports a side panel's window as -1, so the panel answers for itself. A
 * panel in another window stays silent: the first answer wins, so a "no" from it could hide this window's own panel. */
export function answerPanelWindow() {
  let panelWindow: number | undefined;
  // index.html opened as a tab is not the side panel.
  void Promise.all([chrome.windows.getCurrent(), chrome.tabs.getCurrent()])
    .then(([window, tab]) => { panelWindow = tab ? undefined : window.id; }, () => undefined);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !message || typeof message !== "object") return false;
    const query = message as { type?: unknown; windowId?: unknown };
    if (query.type === "panel-window" && panelWindow !== undefined && query.windowId === panelWindow) respond(true);
    return false;
  });
}
