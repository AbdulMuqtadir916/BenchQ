import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { applicationsApi } from "@/lib/api/applications";
import { signInAs, signOutForTest } from "./sign-in-as";
import { allApplications } from "./applications";

/**
 * Moving an application is a real write (docs/07 §2.2, applications.detail): the mock backend refuses
 * a VIEWER (403: known, not allowed) and a BDE on someone else's application (404, like a missing one,
 * principle 4). The UI hides the controls too (application-board.test.ts); this is the layer a request
 * can't skip until Phase D's backend.
 */

afterEach(async () => {
  signOutForTest();
});

const statusOf = (id: string) => allApplications.find((app) => app.id === id)!.status;
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => "allowed",
    (error: unknown) => (error instanceof ApiError ? { status: error.status, code: error.code } : String(error)),
  );
const move = (id: string) => applicationsApi.updateStatus("firm_hts", id, { status: "WITHDRAWN", note: null });

describe("who may move an application (mock backend)", () => {
  it("refuses a VIEWER with 403 and changes nothing", async () => {
    await signInAs("user_rohan");
    const before = statusOf("app_001");
    expect(await failure(move("app_001"))).toEqual({ status: 403, code: "FORBIDDEN" });
    expect(statusOf("app_001")).toBe(before);
  });

  it("answers a BDE moving someone else's application exactly like a missing one (404), and changes nothing", async () => {
    await signInAs("user_adnan");
    const sneha = allApplications.find((app) => app.firmId === "firm_hts" && app.submittedByUserId === "user_sneha")!;
    const before = sneha.status;
    const others = await failure(move(sneha.id));
    const missing = await failure(move("app_does_not_exist"));
    expect(others).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(others).toEqual(missing);
    expect(statusOf(sneha.id)).toBe(before);
  });

  it("lets a BDE move their own, and a MANAGER or OWNER move anyone's", async () => {
    const adnans = allApplications.filter((app) => app.firmId === "firm_hts" && app.submittedByUserId === "user_adnan" && app.status === "APPLIED");
    const snehas = allApplications.filter((app) => app.firmId === "firm_hts" && app.submittedByUserId === "user_sneha" && app.status === "APPLIED");
    await signInAs("user_adnan");
    expect(await failure(move(adnans[0]!.id))).toBe("allowed");
    await signInAs("user_fatima");
    expect(await failure(move(snehas[0]!.id))).toBe("allowed");
    await signInAs("user_imran");
    expect(await failure(move(adnans[1]!.id))).toBe("allowed");
  });

  it("refuses a platform admin without a support view (not a member: 404)", async () => {
    await signInAs("padm_sana");
    expect(await failure(move("app_001"))).toEqual({ status: 404, code: "NOT_FOUND" });
  });
});
