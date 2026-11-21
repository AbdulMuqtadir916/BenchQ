import { afterEach, describe, expect, it, vi } from "vitest";
import { fromBackendId } from "./dto/demo-ids";
import { DuplicateUploadError, resumesApi } from "./resumes";

/**
 * The duplicate résumé's 409 (backend/candidates/versions.py `already_uploaded`) names the base it matches. Its fields
 * move from an object `detail` to the top level of the problem body (docs/team/uzair.md step 4b, decision 6): the
 * upload reads both shapes during the switch.
 */

const BASE = "7d3c1f9e-0000-4000-8000-000000000002";

function answer(body: unknown) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 409 }));
}

async function uploadFailure(): Promise<unknown> {
  try {
    await resumesApi.upload("firm_hts", "cand_1", new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));
  } catch (error) {
    return error;
  }
  throw new Error("expected the upload to fail");
}

afterEach(() => vi.unstubAllGlobals());

describe("a duplicate résumé upload", () => {
  it("reads the new problem body's top-level members", async () => {
    answer({ type: "about:blank", title: "Conflict", status: 409, detail: "This résumé is Base 2 (hidden). Show it again?", code: "DUPLICATE_RESUME", request_id: "req-1", base_resume_id: BASE, hidden: true });
    const error = await uploadFailure();
    expect(error).toBeInstanceOf(DuplicateUploadError);
    const duplicate = error as DuplicateUploadError;
    expect(duplicate.message).toBe("This résumé is Base 2 (hidden). Show it again?");
    expect(duplicate.baseId).toBe(fromBackendId(BASE));
    expect(duplicate.isHidden).toBe(true);
  });

  it("still reads the old object detail", async () => {
    answer({ detail: { message: "This résumé is already Base 2.", base_resume_id: BASE, hidden: false } });
    const error = await uploadFailure();
    expect(error).toBeInstanceOf(DuplicateUploadError);
    const duplicate = error as DuplicateUploadError;
    expect(duplicate.message).toBe("This résumé is already Base 2.");
    expect(duplicate.baseId).toBe(fromBackendId(BASE));
    expect(duplicate.isHidden).toBe(false);
  });

  it("any other 409 stays a plain ApiError", async () => {
    answer({ type: "about:blank", title: "Conflict", status: 409, detail: "Somebody else changed this.", code: "CONFLICT", request_id: "req-2" });
    const error = await uploadFailure();
    expect(error).not.toBeInstanceOf(DuplicateUploadError);
    expect((error as Error).message).toBe("Somebody else changed this.");
  });
});
