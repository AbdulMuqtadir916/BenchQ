import { connectionKey } from "./autofill/connection-store";
import { hostOf } from "./autofill/job-check";
import type { Connection, NewConnection, PanelMessage, PanelReply, ShortcutCommand, ShortcutMessage } from "./autofill/types";

/** The one writer of tab connections. It keeps them in session storage, because Chrome can stop this worker at any
 * time, and every listener is registered at the top level so an event can wake it. */

const READ_ALL = null;

async function readConnection(tabId: number): Promise<Connection | undefined> {
  const key = connectionKey(tabId);
  return (await chrome.storage.session.get(key))[key] as Connection | undefined;
}

async function allConnections(): Promise<Connection[]> {
  return Object.values(await chrome.storage.session.get(READ_ALL)) as Connection[];
}

const saveConnection = (connection: Connection) =>
  chrome.storage.session.set({ [connectionKey(connection.tabId)]: connection });

const removeConnection = (tabId: number) => chrome.storage.session.remove(connectionKey(tabId));

async function focusTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}

async function openJob(connection: NewConnection): Promise<number | undefined> {
  const existing = (await allConnections()).find((item) =>
    item.applicationId === connection.applicationId && item.userId === connection.userId);
  if (existing) {
    if (await focusTab(existing.tabId)) return existing.tabId;
    await removeConnection(existing.tabId);
  }
  const tab = await chrome.tabs.create({ url: connection.job.url });
  if (tab.id !== undefined) await saveConnection({ ...connection, tabId: tab.id, confirmedHosts: [] });
  return tab.id;
}

async function handle(message: PanelMessage): Promise<PanelReply> {
  switch (message.type) {
    case "open-job":
      return { ok: true, tabId: await openJob(message.connection) };
    case "connect-tab": {
      // One tab per application: a tab connected to it before lets go.
      const before = (await allConnections()).filter((item) => item.applicationId === message.connection.applicationId
        && item.userId === message.connection.userId && item.tabId !== message.tabId);
      await chrome.storage.session.remove(before.map(({ tabId }) => connectionKey(tabId)));
      await saveConnection({ ...message.connection, tabId: message.tabId, confirmedHosts: [] });
      return { ok: true, tabId: message.tabId };
    }
    case "disconnect-tab":
      await removeConnection(message.tabId);
      return { ok: true };
    case "disconnect-job": {
      const connected = (await allConnections()).filter(({ applicationId }) => applicationId === message.applicationId);
      await chrome.storage.session.remove(connected.map(({ tabId }) => connectionKey(tabId)));
      return { ok: true };
    }
    case "confirm-host": {
      const connection = await readConnection(message.tabId);
      if (connection) {
        await saveConnection({ ...connection, confirmedHosts: [...connection.confirmedHosts, message.host] });
      }
      return { ok: true };
    }
    case "clear-connections":
      await chrome.storage.session.remove((await allConnections()).map(({ tabId }) => connectionKey(tabId)));
      return { ok: true };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Only the side panel talks to this worker. A page script never sends anything, so a tab's message is refused.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  handle(message as PanelMessage).then(sendResponse, () => sendResponse({ ok: false } satisfies PanelReply));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => void removeConnection(tabId));

const SHORTCUTS = new Set<string>(["run-autofill", "mark-applied"] satisfies ShortcutCommand[]);

// The keyboard shortcuts (manifest `commands`): the panel opens on the first press, here and before anything is
// awaited, since Chrome lets it open only in answer to the key; then the panel hears which key, for which tab.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!SHORTCUTS.has(command)) return;
  if (tab) void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  const message: ShortcutMessage = { type: "shortcut", command: command as ShortcutCommand, tabId: tab?.id };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void readConnection(removedTabId).then(async (connection) => {
    if (!connection) return;
    await removeConnection(removedTabId);
    await saveConnection({ ...connection, tabId: addedTabId });
  });
});

// An employer's Apply button that opens a new tab: the job's connection goes with it.
chrome.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId }) => {
  void readConnection(sourceTabId).then((connection) => {
    if (connection) void saveConnection({ ...connection, tabId });
  });
});

// A BDE who types an address or opens a bookmark has reused the tab for something else. A link they followed stays
// connected: the job check looks at where it landed before anything is filled.
const REUSED_TAB = new Set(["typed", "auto_bookmark", "generated", "keyword", "keyword_generated", "start_page"]);

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, transitionType }) => {
  if (frameId !== 0 || !REUSED_TAB.has(transitionType)) return;
  void readConnection(tabId).then((connection) => {
    if (!connection) return;
    const host = hostOf(url);
    if (host !== hostOf(connection.job.url) && !connection.confirmedHosts.includes(host)) void removeConnection(tabId);
  });
});
