import { afterEach, describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { allUsers, firms } from "@/mocks/team";
import { landingHref, safeReturnTo, signInTarget } from "./landing";
import { matchRoute } from "./registry";
import { signInAs, signInAsFirmUser } from "@/mocks/sign-in-as";

afterEach(async () => {
  await sessionApi.signOut();
});

describe("landing per principal (docs/07 §2.1, T7)", () => {
  it("sends every fixture firm user to a route in their own firm", async () => {
    for (const user of allUsers.filter((item) => item.isActive)) {
      const session = await signInAs(user.id);
      const href = landingHref(session);
      const slug = firms.find((firm) => firm.id === user.firmId)!.slug;
      expect(href.startsWith(`/${slug}/`), `${user.id} → ${href}`).toBe(true);
      expect(matchRoute(href)?.id, user.id).toBe("dashboard");
    }
  });

  it("opens welcome for an OWNER who has never been active (first run), the dashboard otherwise", async () => {
    const base = await signInAsFirmUser("user_adnan");
    const owner = { ...base, principal: { ...base.principal, role: "OWNER" as const }, user: { ...base.user, role: "OWNER" as const } };
    expect(landingHref({ ...owner, user: { ...owner.user, lastActiveAt: null } })).toBe("/hyderabad-tech-staffing/welcome");
    expect(landingHref(owner)).toBe("/hyderabad-tech-staffing/dashboard");
    expect(landingHref({ ...base, user: { ...base.user, lastActiveAt: null } })).toBe("/hyderabad-tech-staffing/dashboard");
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

describe("sign-in target: returnTo only if the new account can open it", () => {
  it("returns a firm user to a page of their own firm they can open", async () => {
    const owner = await signInAs("user_imran");
    expect(signInTarget(owner, "/hyderabad-tech-staffing/candidates/cand_01?tab=inbox")).toBe("/hyderabad-tech-staffing/candidates/cand_01?tab=inbox");
    expect(signInTarget(owner, null)).toBe("/hyderabad-tech-staffing/dashboard");
  });

  it("sends someone from another firm, a role without access, or an admin to their own landing instead of a not-found", async () => {
    const kiran = await signInAs("user_kiran"); // STL BDE, after a firm A user signed out on this screen
    expect(signInTarget(kiran, "/hyderabad-tech-staffing/dashboard")).toBe("/secunderabad-talent/dashboard");
    const bde = await signInAs("user_adnan");
    expect(signInTarget(bde, "/hyderabad-tech-staffing/analytics")).toBe("/hyderabad-tech-staffing/dashboard"); // BDE: none
    const sana = await signInAs("padm_sana");
    expect(signInTarget(sana, "/hyderabad-tech-staffing/dashboard")).toBe("/admin");
    expect(signInTarget(sana, "/admin")).toBe("/admin");
    const rohan = await signInAs("user_rohan");
    expect(signInTarget(rohan, "/admin")).toBe("/hyderabad-tech-staffing/dashboard");
    expect(signInTarget(rohan, "/hyderabad-tech-staffing/nope")).toBe("/hyderabad-tech-staffing/dashboard");
  });
});
