import { describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { applicationsApi } from "@/lib/api/applications";
import { allUsers, firms } from "@/mocks/team";
import { ApiError } from "@/lib/api/client";
import { DEFAULT_SESSION, useSession } from "./session-store";

describe("client session defaults", () => {
  it("match the fixture user and firm exactly", () => {
    expect(DEFAULT_SESSION.user).toEqual(allUsers.find((user) => user.id === DEFAULT_SESSION.user.id));
    expect(DEFAULT_SESSION.firm).toEqual(firms.find((firm) => firm.id === DEFAULT_SESSION.firm.id));
    expect(DEFAULT_SESSION.principal).toEqual({ kind: "firm", userId: "user_adnan", firmId: "firm_hts", role: "BDE" });
  });
});

describe("dev principals and sign-in (docs/07 T4)", () => {
  it("lists every fixture firm user, grouped by firm, the GSC owner's pending invite, and the platform admin as not yet available", async () => {
    const options = await sessionApi.devPrincipals();
    const firmOptions = options.filter((option) => option.kind === "firm").map((option) => option.id);
    expect(firmOptions.filter((id) => !id.startsWith("inv_")).sort()).toEqual(allUsers.map((user) => user.id).sort());
    expect(firmOptions.filter((id) => id.startsWith("inv_"))).toEqual(["inv_gsc_owner"]); // accept it to test /welcome (T7)
    const firmOrder = [...new Set(options.filter((o) => o.firmId).map((o) => o.firmId))];
    expect(firmOrder).toEqual(["firm_hts", "firm_stl", "firm_cbw", "firm_gsc"]);
    const admin = options.find((option) => option.kind === "platform");
    expect(admin).toMatchObject({ role: "PLATFORM_ADMIN", available: false });
  });

  it("signs the mock backend in as another firm user: the session, its firm and the actor of a mutation follow", async () => {
    const session = await sessionApi.devSignInAs("user_lakshmi");
    expect(session.principal).toEqual({ kind: "firm", userId: "user_lakshmi", firmId: "firm_stl", role: "OWNER" });
    expect(session.firm.id).toBe("firm_stl");
    expect((await sessionApi.current())?.user.id).toBe("user_lakshmi");

    const app = (await applicationsApi.list("firm_stl"))[0]!;
    const moved = await applicationsApi.updateStatus("firm_stl", app.id, { status: "WITHDRAWN", note: null });
    expect(moved.events.at(-1)?.actorUserId).toBe("user_lakshmi");

    await sessionApi.devSignInAs(DEFAULT_SESSION.user.id);
    expect((await sessionApi.current())?.user.id).toBe("user_adnan");
  });

  it("refuses a platform sign-in until Phase P", async () => {
    await expect(sessionApi.devSignInAs("padm_sana")).rejects.toBeInstanceOf(ApiError);
    expect((await sessionApi.current())?.user.id).toBe("user_adnan");
  });
});

describe("session store: signed out, and a switch waiting for its page (docs/07 T6)", () => {
  it("holds no firm: only who is signed in", () => {
    useSession.getState().reset();
    expect(Object.keys(useSession.getState()).filter((key) => typeof useSession.getState()[key as keyof ReturnType<typeof useSession.getState>] !== "function").sort()).toEqual(["pending", "principal", "user"]);
  });

  it("signs out to no principal and no user", () => {
    useSession.getState().signOut();
    expect([useSession.getState().principal, useSession.getState().user]).toEqual([null, null]);
    useSession.getState().reset();
  });

  it("keeps the current principal while a cross-firm switch is pending, and commits it with setSession", async () => {
    useSession.getState().reset();
    const next = await sessionApi.devSignInAs("user_lakshmi");
    useSession.getState().setPending({ session: next, path: "/secunderabad-talent/dashboard" });
    expect(useSession.getState().principal?.userId).toBe("user_adnan");
    useSession.getState().setSession(next);
    expect(useSession.getState().principal?.userId).toBe("user_lakshmi");
    expect(useSession.getState().pending).toBeNull();
    useSession.getState().reset();
    await sessionApi.devSignInAs(DEFAULT_SESSION.user.id);
  });
});
