import { describe, expect, it } from "vitest";
import { emailLink, phoneLink, profileLink, projectLink, toE164 } from "./paper-links";

describe("résumé links", () => {
  it("links an email with mailto:", () => {
    expect(emailLink(" asha@example.com ")).toEqual({ href: "mailto:asha@example.com", label: "asha@example.com", isExternal: false });
    expect(emailLink("not an email")).toBeNull();
    expect(emailLink("a@b.co?bcc=x@evil.test")).toBeNull();
    expect(emailLink("a@b.co,x@evil.test")).toBeNull();
  });

  describe("phone numbers in E.164", () => {
    it.each([
      ["8897437444", "India", "+918897437444"],
      ["088974 37444", "IN", "+918897437444"],
      ["91 88974 37444", "india", "+918897437444"],
      ["(555) 010-2030", "US", "+15550102030"],
      ["1-555-010-2030", "United States", "+15550102030"],
      ["07700 900123", "UK", "+447700900123"],
      ["+1 (555) 010-2030", "India", "+15550102030"],
      ["+91 93989 16410", "US", "+919398916410"],
      ["0091 93989 16410", "", "+919398916410"],
    ])("%s in %s → %s", (phone, country, e164) => expect(toE164(phone, country)).toBe(e164));

    it.each([["8897437444", "Narnia"], ["555-0102", "US"], ["call me", "US"], ["+12", ""], ["+00000000", ""]])("refuses %s in %s", (phone, country) => {
      expect(toE164(phone, country)).toBeNull();
    });

    it("links tel: in E.164 and prints the number as typed", () => {
      expect(phoneLink("88974 37444", "India")).toEqual({ href: "tel:+918897437444", label: "88974 37444", isExternal: false });
    });

    it("doesn't link a number it can't put in E.164", () => {
      expect(phoneLink("88974 37444", "")).toBeNull();
      expect(phoneLink("call me", "")).toBeNull();
    });

    it("keeps a ten-digit Indian number that starts with 91", () => {
      expect(toE164("9123456789", "India")).toBe("+919123456789");
    });
  });

  it.each([
    ["linkedin", "linkedin.com/in/asha-rao", "https://linkedin.com/in/asha-rao", "linkedin.com/in/asha-rao"],
    ["linkedin", "http://www.linkedin.com/in/asha-rao/?trk=x", "https://www.linkedin.com/in/asha-rao/?trk=x", "linkedin.com/in/asha-rao"],
    ["github", "github.com/asha", "https://github.com/asha", "github.com/asha"],
    ["github", "http://github.com/asha/repo", "https://github.com/asha/repo", "github.com/asha"],
  ] as const)("normalizes %s %s to https", (kind, value, href, label) => {
    expect(profileLink(kind, value)).toEqual({ href, label, isExternal: true });
  });

  it("gives a LinkedIn label only to LinkedIn itself", () => {
    expect(profileLink("linkedin", "https://evil-linkedin.com/in/asha/x")?.label).toBe("evil-linkedin.com/in/asha/x");
    expect(profileLink("linkedin", "https://in.linkedin.com/in/asha")?.label).toBe("linkedin.com/in/asha");
  });

  it("labels project links with something readable on paper", () => {
    expect(projectLink("github.com/asha/quiz")).toEqual({ href: "https://github.com/asha/quiz", label: "github.com/asha/quiz", isExternal: true });
    expect(projectLink("http://clipgenie-5wrj.onrender.com/")).toEqual({ href: "https://clipgenie-5wrj.onrender.com/", label: "clipgenie-5wrj.onrender.com", isExternal: true });
    expect(projectLink("https://www.example.app/demo/")?.label).toBe("example.app");
  });

  it.each(["javascript:alert(1)", "ftp://example.com", "localhost", "two words.com", ""])("refuses %s", (value) => {
    expect(projectLink(value)).toBeNull();
    expect(profileLink("github", value)).toBeNull();
  });
});
