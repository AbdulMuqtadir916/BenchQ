import { describe, expect, it } from "vitest";
import { holdsSensitiveNumber, neverFillReason } from "./never-fill";
import type { ScannedField } from "./types";

const field = (label: string, overrides: Partial<ScannedField> = {}): ScannedField => ({
  id: "f0", kind: "text", label, hints: "", autocomplete: "", required: false, current: "", options: [], maxLength: null,
  inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
  ...overrides,
});

const reason = (label: string, overrides?: Partial<ScannedField>) => neverFillReason(field(label, overrides));

describe("neverFillReason", () => {
  it.each([
    ["Date of birth", "Date of birth"], ["DOB", "Date of birth"], ["Birthdate", "Date of birth"], ["How old are you?", "Date of birth"],
    ["Social Security Number", "Government"], ["SSN", "Government"], ["Passport number", "Government"],
    ["Driver's license", "Government"], ["Tax ID", "Government"], ["Visa number", "Government"],
    ["Credit card number", "Payment"], ["Bank account", "Payment"], ["Routing number", "Payment"],
    ["Create a password", "Account"], ["Username", "Account"], ["Security question", "Account"], ["Verification code", "Account"],
    ["I agree to the terms and conditions", "Consent"], ["I acknowledge the above", "Consent"], ["Privacy policy", "Consent"],
    ["I certify that this is true", "Consent"], ["I authorize a background check", "Consent"],
    ["Signature", "Signature"], ["Type your e-signature", "Signature"], ["Your initials", "Signature"],
    ["reCAPTCHA", "CAPTCHA"], ["I am not a robot", "CAPTCHA"],
  ])("keeps %s manual (%s)", (label, expected) => {
    expect(reason(label)).toContain(expected);
  });

  it.each([
    "Are you authorized to work in the US?", "Will you require visa sponsorship?", "Do you need a visa transfer?",
    "Expected salary", "Hourly rate", "Are you willing to relocate?", "Notice period", "Years of experience",
    "Which languages do you speak?", "Have you managed a package upgrade?", "Describe a trace you debugged",
    "Essex office preference", "Why this company?", "Current employer", "Email", "Phone number", "City",
    "Gender", "Race", "Are you a protected veteran?", "Do you have a disability?", "Are you Hispanic or Latino?",
  ])("lets %s through", (label) => {
    expect(reason(label)).toBeNull();
  });

  it("goes by the control as well as the words", () => {
    expect(reason("Anything", { kind: "password" })).toBe("Password");
    expect(reason("Anything", { kind: "file" })).toBe("File upload");
  });

  it("leaves a whole sign-in or sign-up form alone", () => {
    expect(reason("Email", { inAccountForm: true })).toBe("Account sign-in or sign-up form");
  });

  it("reads the field's name and id too", () => {
    expect(reason("Please complete", { hints: "ssn_field" })).toContain("Government");
    expect(reason("Please complete", { hints: "dateOfBirth" })).toContain("Date of birth");
  });
});

describe("a sensitive number in any field, kept out of the saved form", () => {
  it("finds a Social Security number or a payment card's number, however it's written", () => {
    for (const value of ["123-45-6789", "123 45 6789", "123456789", "My SSN is 123-45-6789", "My SSN is 123456789", "SSN: 123456789.", "SSN: 123.45.6789", "4111.1111.1111.1111", "4111 1111 1111 1111",
      "4111-1111-1111-1111", "5555555555554444", "378282246310005"]) {
      expect(holdsSensitiveNumber(value), value).toBe(true);
    }
  });

  it("leaves phone numbers, ZIP codes, dates, rates and links alone", () => {
    for (const value of ["+1 555 010 0100", "(555) 010-0100", "75001-1234", "12/01/2026", "$85/hr", "000-12-3456",
      "4111 1111 1111 1112", "https://linkedin.com/in/ravi-123456789"]) {
      expect(holdsSensitiveNumber(value), value).toBe(false);
    }
  });
});
