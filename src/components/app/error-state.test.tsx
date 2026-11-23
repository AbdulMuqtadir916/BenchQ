import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@/lib/api/client";
import { ErrorState } from "./error-state";
import { ErrorNote } from "./error-note";
import { describeError } from "@/lib/api/error-text";

/** The page error card and the inline note (docs/team/uzair.md step 4b: system text, the reference with a copy button). */

const crash = (requestId: string | null) =>
  new ApiError("Something went wrong on BenchQ's side.", "HTTP_500", 500, null, { backendCode: requestId ? "INTERNAL" : null, requestId });

describe("ErrorState", () => {
  it("an unexpected error: the system title and words, the reference and a copy button", () => {
    const html = renderToStaticMarkup(<ErrorState error={crash("req-42")} onRetry={() => undefined} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("send support the reference below");
    expect(html).toContain("Reference: <code");
    expect(html).toContain("req-42");
    expect(html).toContain('aria-label="Copy reference"');
    // The copy result is announced from a live region at the end of <body> (client only), never nested in this alert.
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Retry");
  });

  it("no reference line without a request id", () => {
    const html = renderToStaticMarkup(<ErrorState error={new ApiError("Request failed with status 500.", "INTERNAL", 500)} />);
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("Reference:");
    expect(html).not.toContain("Copy reference");
  });

  it("the backend's words under the load heading for any other code", () => {
    const html = renderToStaticMarkup(<ErrorState error={new ApiError("Ten jobs added today.", "RATE_LIMITED", 429, null, { backendCode: "DAILY_LIMIT", requestId: "req-1" })} />);
    expect(html).toContain("Something didn’t load");
    expect(html).toContain("Ten jobs added today.");
    expect(html).not.toContain("Reference:");
  });

  it("an out-of-date page offers Refresh, not Retry", () => {
    const html = renderToStaticMarkup(<ErrorState error={new ApiError("bad shape", "SCHEMA_MISMATCH", 200)} onRetry={() => undefined} />);
    expect(html).toContain("BenchQ needs a refresh");
    expect(html).toContain("Refresh page");
    expect(html).not.toContain("Retry");
  });

  it("busy: the frontend's words, not the backend's", () => {
    const html = renderToStaticMarkup(<ErrorState error={new ApiError("pool drained", "UNAVAILABLE", 503, null, { backendCode: "UNAVAILABLE" })} />);
    expect(html).toContain("BenchQ is busy");
    expect(html).toContain("BenchQ is handling a lot right now. Try again in a few seconds.");
    expect(html).not.toContain("pool drained");
  });
});

describe("ErrorNote", () => {
  it("an alert with the words and, for an unexpected error, the reference", () => {
    const html = renderToStaticMarkup(<ErrorNote text={describeError(crash("req-9"))} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("req-9");
    expect(html).toContain("Copy reference");
  });

  it("nothing for no error; a screen's string as is", () => {
    expect(renderToStaticMarkup(<ErrorNote text={null} />)).toBe("");
    expect(renderToStaticMarkup(<ErrorNote text="Passwords do not match." />)).toContain("Passwords do not match.");
  });
});
