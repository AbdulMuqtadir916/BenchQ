import { describe, expect, it } from "vitest";
import { forbiddenBannerState } from "./banner-state";

// PR #128 review: a stale support banner is hidden only when the live session is known to differ; a session that could not be
// read (null) keeps the server's banner, and nothing mounts while the session is still being read.
const platform = (id?: string) => ({ kind: "platform" as const, support: id ? { id } : undefined });

describe("forbiddenBannerState", () => {
  it("waits while the session is still being read, so an ended view cannot redirect", () => {
    expect(forbiddenBannerState({ bootstrapping: true, principal: platform("a"), serverViewId: "a" })).toBe("wait");
    expect(forbiddenBannerState({ bootstrapping: true, principal: null, serverViewId: "a" })).toBe("wait");
  });

  it("shows the banner when the live view is the server's view", () => {
    expect(forbiddenBannerState({ bootstrapping: false, principal: platform("a"), serverViewId: "a" })).toBe("show");
  });

  it("keeps the banner when the session check failed and nobody is known (so Exit stays reachable)", () => {
    expect(forbiddenBannerState({ bootstrapping: false, principal: null, serverViewId: "a" })).toBe("show");
  });

  it("is stale when another tab started a different view, ended the view, or signed in as a firm user", () => {
    expect(forbiddenBannerState({ bootstrapping: false, principal: platform("b"), serverViewId: "a" })).toBe("stale");
    expect(forbiddenBannerState({ bootstrapping: false, principal: platform(), serverViewId: "a" })).toBe("stale");
    expect(forbiddenBannerState({ bootstrapping: false, principal: { kind: "firm" }, serverViewId: "a" })).toBe("stale");
  });

  it("shows nothing and has nothing to refresh when the server rendered no banner", () => {
    expect(forbiddenBannerState({ bootstrapping: false, principal: null, serverViewId: undefined })).toBe("none");
    expect(forbiddenBannerState({ bootstrapping: false, principal: platform("a"), serverViewId: undefined })).toBe("stale");
  });
});
