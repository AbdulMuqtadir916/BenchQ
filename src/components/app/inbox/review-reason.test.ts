import { describe, expect, it } from "vitest";
import { ApplicationStatus } from "@/lib/schemas/enums";
import { EmailCategory } from "@/lib/schemas/inbox";
import { categoryStatus, emailCategoryLabel, reviewReasonLabel } from "./review-reason";

describe("review reasons and categories", () => {
  it("turns every known reason code into a sentence and never shows a raw code", () => {
    for (const code of ["UNMATCHED", "LOW_CONFIDENCE", "SENDER_UNVERIFIED", "AUTO_STATUS_DISABLED", "FORWARDED_EMAIL",
      "INSUFFICIENT_CONTENT", "CONFIDENCE_DISAGREEMENT", "EMAIL_ALREADY_APPLIED", "AUTOMATIC_CHANGE_UNDONE"]) {
      expect(reviewReasonLabel(code)).not.toMatch(/[A-Z]{2,}_/);
    }
    expect(reviewReasonLabel("SOMETHING_NEW")).toBe("This email needs a decision");
  });

  it("maps every job category to a selectable status, and Other to none", () => {
    for (const category of EmailCategory.options) {
      expect(emailCategoryLabel(category)).toBeTruthy();
      const status = categoryStatus(category);
      if (category === "other") expect(status).toBeNull();
      else expect(ApplicationStatus.safeParse(status).success).toBe(true);
    }
  });
});
