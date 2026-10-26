import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";
import { liveSession, rememberLiveSession, watchLiveSession } from "./live-session";

/**
 * F6: the session is the backend's cookie; the only thing shared between tabs is a ping on a BroadcastChannel,
 * after which a tab asks `current()` again. A second `BroadcastChannel` here stands in for the other tab (a
 * channel never hears its own messages).
 */

const CHANNEL = "benchq.session";
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function otherTab() {
  const channel = new BroadcastChannel(CHANNEL);
  const heard: unknown[] = [];
  channel.onmessage = (event) => heard.push(event.data);
  return { channel, heard };
}

afterEach(() => {
  signOutForTest();
  vi.unstubAllGlobals();
});

describe("signing out in one tab signs out the others", () => {
  it("sessionApi.signOut pings the other tabs, which then ask the backend who is signed in", async () => {
    await signInAs("user_imran");
    const tab = otherTab();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await sessionApi.signOut();
    await tick();

    expect(liveSession()).toBeNull();
    expect(tab.heard).toEqual(["changed"]);
    tab.channel.close();
  });

  it("another tab's ping reaches this tab's watcher", async () => {
    const onChange = vi.fn();
    const stop = watchLiveSession(onChange);
    const tab = otherTab();

    tab.channel.postMessage("changed");
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    tab.channel.postMessage("changed");
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    tab.channel.close();
  });

  it("a sign-in as someone else pings; the same principal again does not", async () => {
    const imran = await signInAs("user_imran");
    const adnan = await signInAs("user_adnan");
    signOutForTest();
    const tab = otherTab();
    rememberLiveSession(imran);
    rememberLiveSession(imran); // unchanged: no ping
    rememberLiveSession(adnan);
    await tick();
    expect(tab.heard).toEqual(["changed", "changed"]);
    tab.channel.close();
  });
});

describe("no mock session store", () => {
  const SRC = fileURLToPath(new URL("../..", import.meta.url));
  const files = (dir = SRC): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });

  it("nothing stores the session or a password in the browser, and nothing but the live session talks on its channel", () => {
    const offenders = files().flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const where = relative(SRC, file).split(sep).join("/");
      const stores = /(?:local|session)Storage[^;\n]*(?:benchq\.session|password|credentials)/i.test(text);
      const channel = where !== "lib/api/live-session.ts" && text.includes(`"${CHANNEL}"`);
      return stores || channel ? [where] : [];
    });
    expect(offenders).toEqual([]);
  });
});
