export const PROFILE_LINK_ERROR = "Enter an HTTP or HTTPS link.";

export function isProfileLinkField(key: string): boolean {
  return key === "linkedin" || key === "github";
}

/** An empty field is valid. Null indicates an invalid link. */
export function normalizeProfileLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const link = /^(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s]/i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;
  if (link.length > 500 || !/^https?:\/\/[^/\\]/i.test(link) || /[\s\\]/.test(link)) return null;
  return URL.canParse(link) ? link : null;
}
