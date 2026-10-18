import { describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { applicationsApi } from "@/lib/api/applications";
import { allUsers, firms } from "@/mocks/team";
import { ApiError } from "@/lib/api/client";
import { DEFAULT_SESSION } from "./session-store";

describe("client session defaults", () => {
  it("match the fixture user and firm exactly", () => {
    expect(DEFAULT_SESSION.user).toEqual(allUsers.find((user) => user.id === DEFAULT_SESSION.user.id));
    expect(DEFAULT_SESSION.firm).toEqual(firms.find((firm) => firm.id === DEFAULT_SESSION.firm.id));
    expect(DEFAULT_SESSION.principal).toEqual({ kind: "firm", userId: "user_adnan", firmId: "firm_hts", role: "BDE" });
  });
});

describe("dev principals and sign-in (docs/07 T4)", () => {
  it("lists every fixture firm user, grouped by firm, plus the platform admin as not yet available", async () => {
    const options = await sessionApi.devPrincipals();
    expect(options.filter((option) => option.kind === "firm").map((option) => option.id).sort()).toEqual(allUsers.map((user) => user.id).sort());
    const firmOrder = [...new Set(options.filter((o) => o.firmId).map((o) => o.firmId))];
    expect(firmOrder).toEqual(["firm_hts", "firm_stl", "firm_cbw"]); // firm_gsc has no users yet
    const admin = options.find((option) => option.kind === "platform");
    expect(admin).toMatchObject({ role: "PLATFORM_ADMIN", available: false });
  });

  it("signs the mock backend in as another firm user: the session, its firm and the actor of a mutation follow", async () => {
    const session = await sessionApi.devSignInAs("user_lakshmi");
    expect(session.principal).toEqual({ kind: "firm", userId: "user_lakshmi", firmId: "firm_stl", role: "OWNER" });
    expect(session.firm.id).toBe("firm_stl");
    expect((await sessionApi.current()).user.id).toBe("user_lakshmi");

    const app = (await applicationsApi.list("firm_stl"))[0]!;
    const moved = await applicationsApi.updateStatus("firm_stl", app.id, { status: "WITHDRAWN", note: null });
    expect(moved.events.at(-1)?.actorUserId).toBe("user_lakshmi");

    await sessionApi.devSignInAs(DEFAULT_SESSION.user.id);
    expect((await sessionApi.current()).user.id).toBe("user_adnan");
  });

  it("refuses a platform sign-in until Phase P", async () => {
    await expect(sessionApi.devSignInAs("padm_sana")).rejects.toBeInstanceOf(ApiError);
    expect((await sessionApi.current()).user.id).toBe("user_adnan");
  });
});
