type ChromeEvent<Listener> = { addListener(listener: Listener): void; removeListener(listener: Listener): void };

type ChromeTab = { id?: number; url?: string; windowId: number };

type InjectionTarget = { tabId: number; allFrames?: boolean; frameIds?: number[] };

type InjectionResult = { frameId: number; result?: unknown };

type FrameDetails = { tabId: number; frameId: number };

declare const chrome: {
  runtime: {
    id: string;
    onInstalled: ChromeEvent<() => void>;
    onMessage: ChromeEvent<(
      message: unknown,
      sender: { id?: string; tab?: ChromeTab },
      sendResponse: (response: unknown) => void,
    ) => boolean>;
    sendMessage(message: unknown): Promise<unknown>;
    reload(): void;
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    open(options: { windowId: number }): Promise<void>;
  };
  commands: { onCommand: ChromeEvent<(command: string, tab?: ChromeTab) => void> };
  tabs: {
    create(options: { url: string }): Promise<ChromeTab>;
    query(info: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]>;
    update(tabId: number, options: { active: boolean }): Promise<ChromeTab>;
    onActivated: ChromeEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated: ChromeEvent<(tabId: number, change: { url?: string }) => void>;
    onRemoved: ChromeEvent<(tabId: number) => void>;
    onReplaced: ChromeEvent<(addedTabId: number, removedTabId: number) => void>;
  };
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
  windows: {
    getCurrent(): Promise<{ id?: number }>;
    update(windowId: number, options: { focused: boolean }): Promise<unknown>;
  };
  scripting: {
    executeScript(injection: {
      target: InjectionTarget;
      files?: string[];
      func?: (...args: never[]) => unknown;
      args?: unknown[];
    }): Promise<InjectionResult[]>;
  };
  storage: {
    session: {
      get(keys: string | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: ChromeEvent<(changes: Record<string, unknown>, area: string) => void>;
  };
  webNavigation: {
    getAllFrames(details: { tabId: number }): Promise<{ frameId: number; url: string }[] | null>;
    onCreatedNavigationTarget: ChromeEvent<(details: { sourceTabId: number; tabId: number }) => void>;
    onCommitted: ChromeEvent<(details: FrameDetails & { url: string; transitionType: string }) => void>;
    onCompleted: ChromeEvent<(details: FrameDetails) => void>;
    onHistoryStateUpdated: ChromeEvent<(details: FrameDetails) => void>;
    onReferenceFragmentUpdated: ChromeEvent<(details: FrameDetails) => void>;
  };
};
declare const __BENCHQ_URL__: string;
declare const __PAGE_BUILD__: string;
