import { vi } from "vitest";

type Listener = (...args: never[]) => unknown;

/** A `chrome.*` event a test can fire. */
export class FakeEvent {
  listeners = new Set<Listener>();
  addListener = (listener: Listener) => { this.listeners.add(listener); };
  removeListener = (listener: Listener) => { this.listeners.delete(listener); };
  fire(...args: unknown[]) {
    return [...this.listeners].map((listener) => (listener as (...values: unknown[]) => unknown)(...args));
  }
}

/** The parts of `chrome.*` the extension uses, with real session storage and tabs a test can open and close. */
export function fakeChrome() {
  const session = new Map<string, unknown>();
  const tabs = new Set<number>();
  let nextTab = 100;

  return {
    session,
    tabs_open: tabs,
    runtime: {
      id: "extension-id", onInstalled: new FakeEvent(), onMessage: new FakeEvent(),
      sendMessage: vi.fn(async () => ({ ok: true })), reload: vi.fn(),
    },
    sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    tabs: {
      create: vi.fn(async () => {
        nextTab += 1;
        tabs.add(nextTab);
        return { id: nextTab, windowId: 1 };
      }),
      query: vi.fn(async () => [{ id: 7, windowId: 1, url: "https://jobs.example.test/" }]),
      update: vi.fn(async (tabId: number) => {
        if (!tabs.has(tabId)) throw new Error("No tab with that id");
        return { id: tabId, windowId: 1 };
      }),
      onActivated: new FakeEvent(), onUpdated: new FakeEvent(), onRemoved: new FakeEvent(), onReplaced: new FakeEvent(),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => undefined) },
    scripting: { executeScript: vi.fn(async (): Promise<unknown[]> => []) },
    storage: {
      session: {
        get: vi.fn(async (key: string | null) => (key === null
          ? Object.fromEntries(session)
          : session.has(key) ? { [key]: session.get(key) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([key, value]) => session.set(key, value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          [keys].flat().forEach((key) => session.delete(key));
        }),
      },
      onChanged: new FakeEvent(),
    },
    webNavigation: {
      getAllFrames: vi.fn(async (): Promise<{ frameId: number; url: string }[] | null> => []),
      onCreatedNavigationTarget: new FakeEvent(), onCommitted: new FakeEvent(), onCompleted: new FakeEvent(),
      onHistoryStateUpdated: new FakeEvent(),
    },
  };
}

export type FakeChrome = ReturnType<typeof fakeChrome>;
