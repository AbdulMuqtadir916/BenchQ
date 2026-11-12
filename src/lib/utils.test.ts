import { describe, expect, it } from "vitest"
import { newCommandId } from "./utils"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

describe("newCommandId", () => {
  it("uses crypto.randomUUID when the page is secure", () => {
    expect(newCommandId({ randomUUID: () => "from-random-uuid", getRandomValues })).toBe("from-random-uuid")
  })

  it("builds a v4 UUID on plain HTTP, where randomUUID is missing", () => {
    expect(newCommandId({ getRandomValues })).toMatch(UUID_V4)
  })
})
