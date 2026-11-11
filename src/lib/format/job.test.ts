import { describe, expect, it } from "vitest";
import { jobLocation } from "./job";

describe("jobLocation", () => {
  it("prints a city and state, a backend job's location text, remote, or says it isn't given", () => {
    expect(jobLocation({ city: "Dallas", state: "TX", remoteMode: "HYBRID" })).toBe("Dallas, TX");
    expect(jobLocation({ city: "Dallas", state: "TX", remoteMode: "REMOTE" })).toBe("Remote");
    expect(jobLocation({ city: "Austin, TX (Hybrid)", state: null, remoteMode: "ONSITE" })).toBe("Austin, TX (Hybrid)");
    expect(jobLocation({ city: null, state: null, remoteMode: "REMOTE" })).toBe("Remote");
    expect(jobLocation({ city: null, state: null, remoteMode: "ONSITE" })).toBe("Location not given");
  });
});
