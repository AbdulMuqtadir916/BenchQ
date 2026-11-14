// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rawLabel } from "./labels";

describe("a labelled component holding several fields (CodeRabbit #129)", () => {
  it("names each field by its own words, and a lone field by the component's label", () => {
    document.body.innerHTML = `<form><label for="home">Home address</label><acme-address id="home"></acme-address>
      <label for="one">Phone</label><acme-phone id="one"></acme-phone></form>`;
    const several = document.querySelector("acme-address")!.attachShadow({ mode: "open" });
    several.innerHTML = `<div><span>City</span><input id="city"></div><div><span>ZIP code</span><input id="zip"></div>`;
    const lone = document.querySelector("acme-phone")!.attachShadow({ mode: "open" });
    lone.innerHTML = `<div><span>Number</span><input id="tel"></div>`;
    expect(rawLabel(several.getElementById("city")!)).toBe("City");
    expect(rawLabel(several.getElementById("zip")!)).toBe("ZIP code");
    expect(rawLabel(lone.getElementById("tel")!)).toBe("Phone");
  });
});
