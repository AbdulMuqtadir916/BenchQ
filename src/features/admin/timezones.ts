/** Timezones offered for a firm (docs/04 §14.4): the firm's own, and its US clients'. */
export const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST) · Asia/Kolkata" },
  { value: "America/New_York", label: "US Eastern · America/New_York" },
  { value: "America/Chicago", label: "US Central · America/Chicago" },
  { value: "America/Denver", label: "US Mountain · America/Denver" },
  { value: "America/Phoenix", label: "US Arizona · America/Phoenix" },
  { value: "America/Los_Angeles", label: "US Pacific · America/Los_Angeles" },
  { value: "Europe/London", label: "UK · Europe/London" },
  { value: "Asia/Dubai", label: "UAE · Asia/Dubai" },
  { value: "Asia/Singapore", label: "Singapore · Asia/Singapore" },
] as const;

/** A firm's stored timezone may be one we don't list: keep it selectable. */
export function timezoneOptions(current?: string) {
  return current && !TIMEZONES.some((zone) => zone.value === current) ? [...TIMEZONES, { value: current, label: current }] : TIMEZONES;
}
