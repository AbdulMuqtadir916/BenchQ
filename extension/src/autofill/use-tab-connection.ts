import { useEffect, useState } from "react";
import { connectionKey } from "./connection-store";
import { hasAutofillPermissions } from "./manifest-check";
import { pageUrlOf } from "./site-access";
import type { Connection } from "./types";

type ActiveTab = { id: number; url: string };

/** The tab the BDE is looking at in this window, and the job it's connected to. Each tab keeps its own connection;
 * a connection made under another account doesn't count. */
export function useTabConnection(userId: string | null) {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [stored, setStored] = useState<Connection | null>(null);
  const tabId = tab?.id ?? null;

  useEffect(() => {
    let mounted = true;
    let windowId: number | undefined;
    let shownTab: number | undefined;
    // Refreshes overlap (a page's address can take a moment to look up): only the latest one says which tab shows.
    let latest = 0;
    const refresh = async () => {
      const request = ++latest;
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Chrome hides the address of a page on a site BenchQ can't read yet (#126): its navigation still says it.
      const url = current?.id === undefined ? "" : current.url ?? await pageUrlOf(current.id).catch(() => "");
      if (request !== latest) return;
      shownTab = current?.id;
      if (mounted) setTab(current?.id === undefined ? null : { id: current.id, url });
    };
    const onActivated = (info: { windowId: number }) => {
      if (info.windowId === windowId) void refresh();
    };
    const onUpdated = (_tabId: number, change: { url?: string }) => {
      if (change.url) void refresh();
    };
    // A page on such a site moves on without a `url` in onUpdated: its own navigation tells.
    const onCommitted = (details: { tabId: number; frameId: number }) => {
      if (details.frameId === 0 && details.tabId === shownTab) void refresh();
    };
    void chrome.windows.getCurrent().then((current) => { windowId = current.id; });
    void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    return () => {
      mounted = false;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
    };
  }, []);

  useEffect(() => {
    if (tabId === null || !hasAutofillPermissions()) return;
    let mounted = true;
    const key = connectionKey(tabId);
    const read = async () => {
      const items = await chrome.storage.session.get(key);
      if (mounted) setStored((items[key] as Connection | undefined) ?? null);
    };
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && key in changes) void read();
    };
    void read();
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [tabId]);

  const connection = stored && stored.tabId === tabId && stored.userId === userId ? stored : null;
  return { tab, connection };
}
