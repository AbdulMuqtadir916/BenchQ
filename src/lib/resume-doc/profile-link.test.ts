import { describe, expect, it } from "vitest";
import { normalizeProfileLink } from "./profile-link";

describe("résumé profile links", () => {
  it.each([
    ["", ""], ["  ", ""], [" http://example.com/qa ", "http://example.com/qa"],
    ["linkedin.com/in/qa", "https://linkedin.com/in/qa"],
    ["www.github.com/qa", "https://www.github.com/qa"],
  ])("normalizes %s", (input, output) => expect(normalizeProfileLink(input)).toBe(output));

  it.each(["LinkedIn", "aghajrgng;knga", "ftp://github.com/qa", "javascript:alert(1)", "https:///example.com", "https://bad host"])
    ("refuses %s", (value) => expect(normalizeProfileLink(value)).toBeNull());
});
