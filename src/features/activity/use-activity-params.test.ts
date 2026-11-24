import { describe, expect, it } from "vitest";
import { toBackendId } from "@/lib/api/dto/demo-ids";
import { parseActivityParams } from "./use-activity-params";

const parse = (query: string) => parseActivityParams(new URLSearchParams(query));

describe("Activity URL ids (issue #155)", () => {
  it("keeps a seeded person's fixture id, which the people list uses", () => {
    expect(parse("person=user_adnan&team=user_adnan").person).toBe("user_adnan");
    expect(parse("team=user_adnan").team).toBe("user_adnan");
  });

  it("turns a seeded UUID typed by hand into its fixture id, so it matches the list", () => {
    expect(parse(`person=${toBackendId("user_adnan")}`).person).toBe("user_adnan");
  });

  it("keeps any other UUID and drops what is neither", () => {
    const live = "0b6f7c1e-3d2a-4c55-9a8e-1f2d3c4b5a69";
    expect(parse(`candidate=${live}`).candidate).toBe(live);
    expect(parse("person=user_nobody").person).toBeUndefined();
    expect(parse("person=not-an-id").person).toBeUndefined();
  });
});
