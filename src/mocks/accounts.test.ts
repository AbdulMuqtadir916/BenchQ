import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { sessionApi } from "@/lib/api/session";
import { landingHref } from "@/lib/routes/landing";
import { firmOutcome } from "@/lib/tenancy/firm-outcome";
import { DEMO_PASSWORD } from "./auth";
import { allUsers, firms } from "./team";
import { invites, platformUsers } from "./tenancy";

/**
 * docs/07 Phase L (L1, L6) against docs/03 §3.2: every seeded account signs in through the real path
 * and lands where the table says; any failed sign-in is the same error.
 */

afterEach(async () => {
  await sessionApi.signOut();
});

const slugOf = (firmId: string) => firms.find((firm) => firm.id === firmId)!.slug;

/** docs/03 §3.2, the "Lands on" column. */
const EXPECTED_LANDING: Record<string, string> = Object.fromEntries([
  ...allUsers.map((user) => [user.email, `/${slugOf(user.firmId)}/dashboard`]),
  ["sana@admin.benchq.test", "/admin"],
]);

describe("seeded accounts (docs/03 §3.2)", () => {
  it("are the 14 fixture firm users and the Super Admin, every one active", () => {
    expect(allUsers).toHaveLength(14);
    expect(platformUsers.map((admin) => admin.email)).toEqual(["sana@admin.benchq.test"]);
    expect([...allUsers, ...platformUsers].every((account) => account.isActive)).toBe(true);
    expect(new Set(allUsers.map((user) => user.role))).toEqual(new Set(["OWNER", "MANAGER", "BDE", "VIEWER"]));
  });

  it("follow one email pattern: firstname@<firm-slug>.benchq.test, the Super Admin on the reserved admin slug", () => {
    for (const user of allUsers) expect(user.email, user.id).toBe(`${user.name.split(" ")[0]!.toLowerCase()}@${slugOf(user.firmId)}.benchq.test`);
    for (const invite of invites) expect(invite.email, invite.id).toMatch(new RegExp(`^[a-z.]+@${invite.firmId ? slugOf(invite.firmId) : "admin"}\\.benchq\\.test$`));
  });

  it.each(Object.entries(EXPECTED_LANDING))("%s signs in with the demo password and lands on %s", async (email, landing) => {
    const session = await sessionApi.signIn(email, DEMO_PASSWORD);
    expect(landingHref(session)).toBe(landing);
    expect((await sessionApi.current())?.principal.userId).toBe(session.principal.userId);
  });

  it("CBW (suspended) users sign in and get the suspended screen, not a refusal", async () => {
    for (const user of allUsers.filter((item) => item.firmId === "firm_cbw")) {
      const { principal } = await sessionApi.signIn(user.email, DEMO_PASSWORD);
      const firm = await sessionApi.firmBySlug("cyberabad-bench");
      expect(firmOutcome(principal, { status: "success", firm }).kind, user.id).toBe("suspended");
    }
  });

  it("matches the email case- and whitespace-insensitively", async () => {
    const session = await sessionApi.signIn("  Imran@Hyderabad-Tech-Staffing.BenchQ.test ", DEMO_PASSWORD);
    expect(session.principal.userId).toBe("user_imran");
  });

  it("replaces the signed-in account when someone else signs in", async () => {
    await sessionApi.signIn("rohan@hyderabad-tech-staffing.benchq.test", DEMO_PASSWORD);
    await sessionApi.signIn("sana@admin.benchq.test", DEMO_PASSWORD);
    expect((await sessionApi.current())?.principal).toMatchObject({ kind: "platform", userId: "padm_sana" });
  });
});

describe("a failed sign-in never says which emails exist (docs/07 L1)", () => {
  const failure = (email: string, password: string) =>
    sessionApi.signIn(email, password).then(
      () => "signed in",
      (error: unknown) => (error instanceof ApiError ? [error.status, error.code, error.message] : String(error)),
    );

  it("answers a wrong password, an unknown email, an empty form and a deactivated account identically, and signs nobody in", async () => {
    const rohan = allUsers.find((user) => user.id === "user_rohan")!;
    const answers = [
      await failure("rohan@hyderabad-tech-staffing.benchq.test", "wrong-password"),
      await failure("nobody@hyderabad-tech-staffing.benchq.test", DEMO_PASSWORD),
      await failure("nobody@example.com", "anything"),
      await failure("", ""),
    ];
    rohan.isActive = false;
    try {
      answers.push(await failure(rohan.email, DEMO_PASSWORD));
    } finally {
      rohan.isActive = true;
    }
    expect(answers[0]).toEqual([401, "INVALID_CREDENTIALS", "Email or password is incorrect."]);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(await sessionApi.current()).toBeNull();
  });

  it("ends a session whose account was deactivated since (a stale cookie is refused)", async () => {
    const rohan = allUsers.find((user) => user.id === "user_rohan")!;
    await sessionApi.signIn(rohan.email, DEMO_PASSWORD);
    rohan.isActive = false;
    try {
      expect(await sessionApi.current()).toBeNull();
    } finally {
      rohan.isActive = true;
    }
  });
});
