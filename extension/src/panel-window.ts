/** The panel's answer to "is BenchQ open in this window?", which the job page's launcher asks (assistant.ts,
 * `assistant-visible`). Chrome's getContexts reports a side panel's window as -1, so the panel answers for itself. A
 * panel in another window stays silent: the first answer wins, so a "no" from it could hide this window's own panel. */
export function answerPanelWindow() {
  let panelWindow: number | undefined;
  let isKnown = false;
  // index.html opened as a tab is not the side panel.
  const known = Promise.all([chrome.windows.getCurrent(), chrome.tabs.getCurrent()])
    .then(([window, tab]) => { panelWindow = tab ? undefined : window.id; }, () => undefined)
    .then(() => { isKnown = true; });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !message || typeof message !== "object") return false;
    const query = message as { type?: unknown; windowId?: unknown };
    if (query.type !== "panel-window") return false;
    if (isKnown) {
      if (query.windowId === panelWindow) respond(true);
      return false;
    }
    // Asked while still finding its window, as it opens: answer once it knows, so the launcher isn't left showing.
    void known.then(() => respond(query.windowId === panelWindow));
    return true;
  });
}
