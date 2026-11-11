// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChrome, type FakeChrome } from "../test/fake-chrome";
import { connectionFor } from "./connection-store";
import { hasAutofillPermissions, reloadIfManifestIsStale } from "./manifest-check";
import type { Application } from "../api";

let fake: FakeChrome;

/** What Chrome gives a panel whose loaded manifest hasn't got the new permissions. */
const stale = () => vi.stubGlobal("chrome", { ...fake, storage: undefined });

beforeEach(() => {
  fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hasAutofillPermissions", () => {
  it("is true with storage, scripting and webNavigation", () => {
    expect(hasAutofillPermissions()).toBe(true);
  });

  it.each(["storage", "webNavigation"])("is false without %s", (api) => {
    vi.stubGlobal("chrome", { ...fake, [api]: undefined });
    expect(hasAutofillPermissions()).toBe(false);
  });
});

describe("reloadIfManifestIsStale", () => {
  it("leaves a healthy extension alone", () => {
    reloadIfManifestIsStale();
    expect(fake.runtime.reload).not.toHaveBeenCalled();
  });

  it("reloads the extension when its permissions are behind its code", () => {
    stale();
    reloadIfManifestIsStale();
    expect(fake.runtime.reload).toHaveBeenCalledTimes(1);
  });

  it("doesn't loop if a reload doesn't help", () => {
    stale();
    reloadIfManifestIsStale();
    reloadIfManifestIsStale();
    expect(fake.runtime.reload).toHaveBeenCalledTimes(1);
  });

  it("tries again after a minute", () => {
    vi.useFakeTimers();
    stale();
    reloadIfManifestIsStale();
    vi.advanceTimersByTime(61_000);
    reloadIfManifestIsStale();
    expect(fake.runtime.reload).toHaveBeenCalledTimes(2);
  });
});

describe("connectionFor", () => {
  const job = { id: "app-1", candidate_id: "cand-1", title: "Dev", company: "Acme", url: "https://a.test/1" } as Application;

  it("connects a job with a URL and a candidate", () => {
    expect(connectionFor(job, "user-1")).toEqual({
      applicationId: "app-1", candidateId: "cand-1", userId: "user-1",
      job: { title: "Dev", company: "Acme", url: "https://a.test/1" },
    });
  });

  it("won't connect a job without a URL or a candidate", () => {
    expect(connectionFor({ ...job, url: null }, "user-1")).toBeNull();
    expect(connectionFor({ ...job, candidate_id: null }, "user-1")).toBeNull();
  });
});
