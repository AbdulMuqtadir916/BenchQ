import { describe, expect, it } from "vitest";
import { NO_MANAGER_REASON, newCandidateBlockReason } from "./platform";

/**
 * Why "New candidate" is off, shared by the button and its `n` shortcut (BUG-017) so they can never disagree.
 * 07 Q40: every candidate has a manager, so a firm with no active manager can't add one. 07 Q45: the plan's candidate limit
 * never blocks adding a candidate, only assigning a BDE (in the wizard's last step), so it is not part of this rule.
 */
const member = (role: "OWNER" | "MANAGER" | "BDE" | "VIEWER", isActive = true) => ({ role, isActive });

describe("newCandidateBlockReason", () => {
  it("is not blocked while the team is still loading", () => {
    expect(newCandidateBlockReason(undefined)).toBeNull();
  });

  it("is not blocked when the firm has an active manager", () => {
    expect(newCandidateBlockReason([member("OWNER"), member("MANAGER"), member("BDE")])).toBeNull();
  });

  it("is blocked, with the Q40 reason, when there is no active manager", () => {
    expect(newCandidateBlockReason([])).toBe(NO_MANAGER_REASON);
    expect(newCandidateBlockReason([member("OWNER"), member("BDE"), member("VIEWER")])).toBe(NO_MANAGER_REASON);
    expect(newCandidateBlockReason([member("OWNER"), member("MANAGER", false)])).toBe(NO_MANAGER_REASON);
  });

  it("one active manager among inactive ones is enough", () => {
    expect(newCandidateBlockReason([member("MANAGER", false), member("MANAGER", true)])).toBeNull();
  });
});
