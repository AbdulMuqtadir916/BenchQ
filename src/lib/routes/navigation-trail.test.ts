import { afterEach, describe, expect, it } from "vitest";
import { cameFromInsideApp, forgetTrail, recordPath } from "./navigation-trail";

const isStudio = (pathname: string) => /^\/acme\/resumes\/[^/]+(\/autofill)?$/.test(pathname);

describe("navigation trail", () => {
  afterEach(forgetTrail);

  it("knows the studio was opened from a page of BenchQ's, across its tabs and saves", () => {
    for (const path of ["/acme/resumes", "/acme/resumes/v1", "/acme/resumes/v1/autofill", "/acme/resumes/v2"]) recordPath(path);
    expect(cameFromInsideApp(isStudio)).toBe(true);
  });

  it("knows a studio opened directly has nothing of BenchQ's behind it, even after switching tabs", () => {
    for (const path of ["/acme/resumes/v1", "/acme/resumes/v1/autofill", "/acme/resumes/v1"]) recordPath(path);
    expect(cameFromInsideApp(isStudio)).toBe(false);
  });

  it("records a pathname once however often it is reported", () => {
    recordPath("/acme/resumes/v1");
    recordPath("/acme/resumes/v1");
    expect(cameFromInsideApp(isStudio)).toBe(false);
  });
});
