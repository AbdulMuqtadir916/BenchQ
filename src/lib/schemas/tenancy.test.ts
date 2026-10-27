import { describe, expect, it } from "vitest";
import { UserSchema } from "./session";
import { InviteBaseSchema, InviteSchema, PrincipalSchema, RESERVED_SLUGS, SlugSchema } from "./tenancy";

describe("SlugSchema (A7)", () => {
  it.each(["acme", "a1b", "hyderabad-tech-staffing", "a-b-c", "x".repeat(32)])("accepts %s", (slug) => {
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ["ab", "shorter than 3"],
    ["x".repeat(33), "longer than 32"],
    ["1abc", "starts with a digit"],
    ["-abc", "leading hyphen"],
    ["abc-", "trailing hyphen"],
    ["ab--c", "double hyphen"],
    ["Acme", "uppercase"],
    ["ac me", "space"],
    ["ac_me", "underscore"],
    ["héllo", "non-ASCII"],
  ])("rejects %s (%s)", (slug) => {
    expect(SlugSchema.safeParse(slug).success).toBe(false);
  });

  it("rejects every reserved word that would otherwise pass the pattern", () => {
    const patternValid = RESERVED_SLUGS.filter((word) => /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/.test(word));
    expect(patternValid.length).toBeGreaterThan(10);
    for (const word of patternValid) expect(SlugSchema.safeParse(word).success, word).toBe(false);
  });
});

describe("InviteSchema (A11: firmId null ⇔ role PLATFORM_ADMIN)", () => {
  const base = {
    id: "inv_x",
    email: "new@firm.com",
    inviteeName: null,
    invitedByUserId: "user_owner",
    managerId: null,
    status: "PENDING" as const,
    expiresAt: "2026-10-25T00:00:00.000Z",
    createdAt: "2026-10-18T00:00:00.000Z",
  };

  it("accepts a firm invite with a firm role, and a platform invite with no firm", () => {
    expect(InviteSchema.safeParse({ ...base, firmId: "firm_a", role: "BDE" }).success).toBe(true);
    expect(InviteSchema.safeParse({ ...base, firmId: "firm_a", role: "OWNER" }).success).toBe(true);
    expect(InviteSchema.safeParse({ ...base, firmId: null, role: "PLATFORM_ADMIN" }).success).toBe(true);
  });

  it("rejects a platform role inside a firm, and a firm role with no firm", () => {
    const platformInFirm = InviteSchema.safeParse({ ...base, firmId: "firm_a", role: "PLATFORM_ADMIN" });
    const firmRoleNoFirm = InviteSchema.safeParse({ ...base, firmId: null, role: "MANAGER" });
    expect(platformInFirm.success).toBe(false);
    expect(firmRoleNoFirm.success).toBe(false);
    expect(platformInFirm.error?.issues[0]?.path).toEqual(["firmId"]);
  });

  it("07 Q40, Q51: only a BDE invite names a manager; an older BDE invite may have none", () => {
    expect(InviteSchema.safeParse({ ...base, firmId: "firm_a", role: "BDE", managerId: "user_mgr" }).success).toBe(true);
    expect(InviteSchema.safeParse({ ...base, firmId: "firm_a", role: "BDE", managerId: null }).success).toBe(true);
    for (const role of ["OWNER", "MANAGER", "VIEWER"] as const) {
      const result = InviteSchema.safeParse({ ...base, firmId: "firm_a", role, managerId: "user_mgr" });
      expect(result.success, role).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join(".")), role).toEqual(["managerId"]);
    }
  });

  it("keeps the base object extendable: .extend and .pick work, the refinement is not lost on InviteSchema", () => {
    const WithToken = InviteBaseSchema.extend({ tokenHint: InviteBaseSchema.shape.email });
    const OnlyStatus = InviteBaseSchema.pick({ status: true, expiresAt: true });
    expect(Object.keys(WithToken.shape)).toContain("tokenHint");
    expect(OnlyStatus.safeParse({ status: "PENDING", expiresAt: base.expiresAt }).success).toBe(true);
    // the base alone does not enforce A11; the exported InviteSchema does
    expect(InviteBaseSchema.safeParse({ ...base, firmId: null, role: "BDE" }).success).toBe(true);
    expect(InviteSchema.safeParse({ ...base, firmId: null, role: "BDE" }).success).toBe(false);
  });
});

describe("PrincipalSchema", () => {
  it("is a firm user or a platform admin, never a mix", () => {
    expect(PrincipalSchema.safeParse({ kind: "firm", userId: "u", firmId: "f", role: "VIEWER" }).success).toBe(true);
    expect(PrincipalSchema.safeParse({ kind: "platform", userId: "p", role: "PLATFORM_ADMIN", support: null }).success).toBe(true);
    expect(PrincipalSchema.safeParse({ kind: "firm", userId: "u", firmId: "f", role: "PLATFORM_ADMIN" }).success).toBe(false);
    expect(PrincipalSchema.safeParse({ kind: "platform", userId: "p", role: "OWNER", support: null }).success).toBe(false);
  });

  it("requires a reason of at least 10 characters on a support view (07 §4)", () => {
    const view = { id: "sv", firmId: "f", startedAt: "2026-10-18T10:00:00.000Z", expiresAt: "2026-10-18T11:00:00.000Z" };
    expect(PrincipalSchema.safeParse({ kind: "platform", userId: "p", role: "PLATFORM_ADMIN", support: { ...view, reason: "short" } }).success).toBe(false);
    expect(PrincipalSchema.safeParse({ kind: "platform", userId: "p", role: "PLATFORM_ADMIN", support: { ...view, reason: "Checking a reported export bug" } }).success).toBe(true);
  });
});

describe("UserSchema (07 Q40, Q51)", () => {
  const user = { id: "u", firmId: "f", name: "U", email: "u@firm.com", avatarUrl: null, isActive: true, lastActiveAt: null };

  it("a BDE has a manager, or none yet (a BDE from before the hierarchy); nobody else has one", () => {
    expect(UserSchema.safeParse({ ...user, role: "BDE", managerId: "user_mgr" }).success).toBe(true);
    expect(UserSchema.safeParse({ ...user, role: "BDE", managerId: null }).success).toBe(true);
    for (const role of ["OWNER", "MANAGER", "VIEWER"] as const) {
      expect(UserSchema.safeParse({ ...user, role, managerId: null }).success, role).toBe(true);
      expect(UserSchema.safeParse({ ...user, role, managerId: "user_mgr" }).success, role).toBe(false);
    }
  });
});
