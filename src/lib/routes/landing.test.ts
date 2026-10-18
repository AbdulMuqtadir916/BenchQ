import { afterEach, describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { DEFAULT_SESSION } from "@/lib/stores/session-store";
import { allUsers, firms } from "@/mocks/team";
import { landingHref, safeReturnTo } from "./landing";
import { matchRoute } from "./registry";

afterEach(async () => {
  await sessionApi.devSignInAs(DEFAULT_SESSION.user.id);
});

describe("landing per principal (docs/07 §2.1, T7)", () => {
  it("sends every fixture firm user to a route in their own firm", async () => {
    for (const user of allUsers.filter((item) => item.isActive)) {
      const session = await sessionApi.devSignInAs(user.id);
      const href = landingHref(session);
      const slug = firms.find((firm) => firm.id === user.firmId)!.slug;
      expect(href.startsWith(`/${slug}/`), `${user.id} → ${href}`).toBe(true);
      expect(matchRoute(href)?.id, user.id).toBe("dashboard");
    }
  });

  it("opens welcome for an OWNER who has never been active (first run), the dashboard otherwise", () => {
    const owner = { ...DEFAULT_SESSION, principal: { ...DEFAULT_SESSION.principal, role: "OWNER" as const }, user: { ...DEFAULT_SESSION.user, role: "OWNER" as const } };
    expect(landingHref({ ...owner, user: { ...owner.user, lastActiveAt: null } })).toBe("/hyderabad-tech-staffing/welcome");
    expect(landingHref(owner)).toBe("/hyderabad-tech-staffing/dashboard");
    expect(landingHref({ ...DEFAULT_SESSION, user: { ...DEFAULT_SESSION.user, lastActiveAt: null } })).toBe("/hyderabad-tech-staffing/dashboard");
  });
});

describe("returnTo (docs/07 §2.1: same-origin paths only)", () => {
  it("keeps a same-origin path with its query and hash", () => {
    expect(safeReturnTo("/hyderabad-tech-staffing/candidates?status=ON_BENCH#top")).toBe("/hyderabad-tech-staffing/candidates?status=ON_BENCH#top");
  });

  it.each([null, "", "candidates", "https://evil.example/x", "//evil.example/x", "/\\evil.example", "/x\\y", "javascript:alert(1)", "/sign-in", "/sign-in?returnTo=/x"])("drops %j", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});
