import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * docs/07 L4 / Q27: the session is kept in localStorage like a cookie: it survives a reload (a fresh
 * module instance reading the same storage) and other tabs hear about changes through the `storage`
 * event. A stub window stands in for the browser; own file so the stub can't leak into other tests.
 */

class StubStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const stubWindow = Object.assign(new EventTarget(), { localStorage: new StubStorage() });
const otherTabWrites = (key: string | null) => stubWindow.dispatchEvent(Object.assign(new Event("storage"), { key }));
type AuthModule = typeof import("./auth");
const freshAuth = async (): Promise<AuthModule> => {
  vi.resetModules();
  return import("./auth");
};

beforeAll(() => {
  (globalThis as { window?: unknown }).window = stubWindow;
});
afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("session survives a reload and is shared by tabs", () => {
  it("a reload (fresh mock backend, same storage) keeps you signed in; sign-out clears it", async () => {
    const before = await freshAuth();
    before.signInWithPassword("meena@secunderabad-talent.benchq.test", before.DEMO_PASSWORD);
    const after = await freshAuth(); // the page reloaded: module state is gone, storage is not
    expect(after.currentPrincipal()).toMatchObject({ kind: "firm", userId: "user_meena", firmId: "firm_stl" });
    after.signOut();
    const again = await freshAuth();
    expect(again.isSignedIn()).toBe(false);
  });

  it("a stored id the fresh mock data doesn't have is dropped (e.g. a user created in a previous page life)", async () => {
    stubWindow.localStorage.setItem("benchq.session", "user_from_a_previous_page");
    const auth = await freshAuth();
    expect(auth.isSignedIn()).toBe(false);
    expect(stubWindow.localStorage.getItem("benchq.session")).toBeNull();
  });

  it("another tab signing out, or in as someone else, reaches this tab", async () => {
    const auth = await freshAuth();
    auth.signInWithPassword("rohan@hyderabad-tech-staffing.benchq.test", auth.DEMO_PASSWORD);
    const heard: string[] = [];
    const stop = auth.watchSession(() => heard.push(auth.isSignedIn() ? auth.currentPrincipal().userId : "signed out"));

    stubWindow.localStorage.removeItem("benchq.session"); // the other tab signed out
    otherTabWrites("benchq.session");
    stubWindow.localStorage.setItem("benchq.session", "padm_sana"); // the other tab signed in as Sana
    otherTabWrites("benchq.session");
    otherTabWrites("benchq.unrelated"); // other keys are ignored
    stop();
    otherTabWrites("benchq.session"); // after unsubscribing: nothing

    expect(heard).toEqual(["signed out", "padm_sana"]);
  });
});
