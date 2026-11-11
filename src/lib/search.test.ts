import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

/** The list's own search, for tables that keep the search text in the URL and filter their rows themselves (BUG-019, BUG-018). */
const meera = ["Meera Krishnan", "Salesforce Developer", "USC", "On bench", "Adnan Khan"];

describe("matchesSearch", () => {
  it("an empty or blank search matches everything", () => {
    expect(matchesSearch(meera, "")).toBe(true);
    expect(matchesSearch(meera, "   ")).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchesSearch(meera, "  MEERA ")).toBe(true);
    expect(matchesSearch(meera, "on bench")).toBe(true);
  });

  it("finds the role text, not only the name (BUG-018: \"Developer\" returned nothing)", () => {
    expect(matchesSearch(meera, "developer")).toBe(true);
    expect(matchesSearch(["Priya Raman", "Data Engineer"], "developer")).toBe(false);
  });

  it("every word must be found somewhere, in any field", () => {
    expect(matchesSearch(meera, "krishnan salesforce")).toBe(true);
    expect(matchesSearch(meera, "meera java")).toBe(false);
  });

  it("skips empty fields and never throws on them", () => {
    expect(matchesSearch([null, undefined, "", "Adnan Khan"], "adnan")).toBe(true);
    expect(matchesSearch([null, undefined], "adnan")).toBe(false);
  });
});
