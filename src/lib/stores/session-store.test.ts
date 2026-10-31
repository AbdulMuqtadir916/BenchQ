import { liveSession } from "@/lib/api/live-session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { http } from "@/lib/api/http";
import { applySession, checkSession } from "@/lib/hooks/use-session";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";
import { useSession } from "./session-store";

/** The client session store (docs/07 §3, Phase L): who is signed in, never which firm a page shows. */

afterEach(async () => {
  vi.restoreAllMocks();
  useSession.getState().reset();
  signOutForTest();
});

const state = () => useSession.getState();

describe("session store", () => {
  it("holds no firm: only who is signed in, plus the sign-in in flight and the start-up flag", () => {
    const fields = Object.entries(state()).filter(([, value]) => typeof value !== "function").map(([key]) => key).sort();
    expect(fields).toEqual(["bootstrapping", "pending", "platformUser", "principal", "user"]);
  });

  it("starts signed out and bootstrapping (no default user; docs/07 L2)", () => {
    const initial = useSession.getInitialState();
    expect([initial.principal, initial.user, initial.platformUser, initial.bootstrapping]).toEqual([null, null, null, true]);
  });

  it("keeps a firm user's or a platform admin's session, and signs out to nobody", async () => {
    state().setSession(await signInAs("user_lakshmi"));
    expect([state().principal?.kind, state().user?.id, state().platformUser]).toEqual(["firm", "user_lakshmi", null]);
    state().setSession(await signInAs("padm_sana"));
    expect([state().principal?.kind, state().user, state().platformUser?.id]).toEqual(["platform", null, "padm_sana"]);
    state().signOut();
    expect([state().principal, state().user, state().platformUser]).toEqual([null, null, null]);
  });

  it("keeps the current principal while a sign-in is pending, and commits it with setSession", async () => {
    state().setSession(await signInAs("user_adnan"));
    const next = await signInAs("user_lakshmi");
    state().setPending({ session: next, path: "/secunderabad-talent/dashboard" });
    expect(state().principal?.userId).toBe("user_adnan");
    state().setSession(next);
    expect(state().principal?.userId).toBe("user_lakshmi");
    expect(state().pending).toBeNull();
  });
});

describe("applySession: start-up and other tabs (docs/07 L4, Q27)", () => {
  it("bootstraps signed out when the session layer has nobody", () => {
    useSession.setState({ bootstrapping: true });
    applySession(null);
    expect([state().principal, state().bootstrapping]).toEqual([null, false]);
  });

  it("bootstraps into the stored session", async () => {
    useSession.setState({ bootstrapping: true });
    applySession(await signInAs("user_rohan"));
    expect([state().principal?.userId, state().bootstrapping]).toEqual(["user_rohan", false]);
  });

  it("signs this tab out when another tab signed out", async () => {
    state().setSession(await signInAs("user_rohan"));
    applySession(null);
    expect(state().principal).toBeNull();
  });

  it("follows another tab's sign-in as someone else through setSession (so the cache boundary applies)", async () => {
    state().setSession(await signInAs("user_rohan"));
    const commits: string[] = [];
    const stop = useSession.subscribe((next, previous) => {
      if (next.principal?.userId !== previous.principal?.userId) commits.push(next.principal?.userId ?? "signed out");
    });
    applySession(await signInAs("padm_sana"));
    applySession(liveSession()); // the same principal again: no change
    stop();
    expect(commits).toEqual(["padm_sana"]);
  });
});

describe("checkSession: the refresh on start-up, another tab's change and a demo-data change (useSessionSync, useDemoDataSync)", () => {
  /** /api/auth/me answers with this failure, through the real session adapter. */
  const meFails = (error: Error) => vi.spyOn(http, "get").mockRejectedValue(error);

  it.each([
    ["a 429 from the rate limit", new ApiError("Too many attempts. Try again in a few minutes.", "RATE_LIMITED", 429)],
    ["a 503 from a busy database", new ApiError("Database is busy, retry shortly", "UNAVAILABLE", 503)],
    ["the network", new ApiError("Can't reach the BenchQ backend. Check that it is running.", "NETWORK", 0)],
  ])("keeps the signed-in user through %s: it says nothing about the session", async (_, error) => {
    state().setSession(await signInAs("user_adnan"));
    meFails(error);
    await checkSession();
    expect([state().principal?.userId, state().bootstrapping]).toEqual(["user_adnan", false]);
  });

  it("still signs this tab out on a 401: the session is gone", async () => {
    state().setSession(await signInAs("user_adnan"));
    meFails(new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401));
    await checkSession();
    expect(state().principal).toBeNull();
  });

  it("finishes start-up on a failed check rather than waiting forever", async () => {
    useSession.setState({ bootstrapping: true });
    meFails(new ApiError("Too many attempts. Try again in a few minutes.", "RATE_LIMITED", 429));
    await checkSession();
    expect(state().bootstrapping).toBe(false);
  });

  it("drops a late answer once its caller is gone", async () => {
    state().setSession(await signInAs("user_adnan"));
    meFails(new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401));
    await checkSession(() => false);
    expect(state().principal?.userId).toBe("user_adnan");
  });
});
