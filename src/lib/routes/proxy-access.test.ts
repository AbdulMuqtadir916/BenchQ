import { describe, expect, it } from "vitest";
import { ROUTES, hrefFor } from "./registry";
import { signedOutRedirect } from "./proxy-access";

const live = { devRoutes: false };
const signedOut = (path: string, search = "", options = live) => signedOutRedirect(path, search, false, options);

describe("signedOutRedirect", () => {
  it("sends signed-out visitors on firm and admin routes to sign-in, remembering where they were", () => {
    expect(signedOut("/gsc/dashboard")).toBe("/sign-in?returnTo=%2Fgsc%2Fdashboard");
    expect(signedOut("/gsc/jobs", "?tab=saved")).toBe("/sign-in?returnTo=%2Fgsc%2Fjobs%3Ftab%3Dsaved");
    expect(signedOut("/admin/firms")).toBe("/sign-in?returnTo=%2Fadmin%2Ffirms");
  });

  it("treats every firm and platform route in the registry as closed", () => {
    for (const route of ROUTES.filter((r) => r.area === "firm" || r.area === "platform")) {
      const path = route.path.replace(/\[[^\]]+\]/g, "x");
      expect(signedOut(path), route.id).not.toBeNull();
    }
  });

  it("leaves public routes open", () => {
    for (const route of ROUTES.filter((r) => r.area === "public")) {
      const path = route.path.replace(/\[[^\]]+\]/g, "x");
      expect(signedOut(path), route.id).toBeNull();
    }
    expect(signedOut(hrefFor("invite", { token: "abc" }))).toBeNull();
  });

  it("redirects a path the registry doesn't know, so existence is never confirmed", () => {
    expect(signedOut("/no-such-firm/anything")).not.toBeNull();
    expect(signedOut("/gsc/not-a-page")).not.toBeNull();
  });

  it("opens /dev only where dev routes are served", () => {
    expect(signedOut("/dev/design-system")).not.toBeNull();
    expect(signedOut("/dev/design-system", "", { devRoutes: true })).toBeNull();
  });

  it("lets a request with a session cookie through", () => {
    expect(signedOutRedirect("/gsc/dashboard", "", true, live)).toBeNull();
  });
});
