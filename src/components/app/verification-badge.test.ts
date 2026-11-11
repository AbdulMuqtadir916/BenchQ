import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerificationBadge } from "./verification-badge";

describe("VerificationBadge", () => {
  it("shows nothing for a company nobody checked (not \"Unverified\")", () => {
    expect(renderToString(createElement(VerificationBadge, { verification: null }))).toBe("");
  });
});
