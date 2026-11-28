/** Only load a publisher's explicitly identified employer logo over HTTPS. */
export function companyLogo(root: Element, organization: unknown, company: string, pageUrl: string): string | undefined {
  if (!company) return;
  const safeUrl = (raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim() || raw.length > 4096) return;
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch { /* Ignore malformed publisher metadata. */ }
  };
  const org = organization as { logo?: string | { contentUrl?: string; url?: string } } | null;
  const logo = org?.logo;
  const structured = typeof logo === "string" ? safeUrl(logo) : safeUrl(logo?.contentUrl) ?? safeUrl(logo?.url);
  if (structured) return structured;
  const name = company.trim().toLowerCase();
  // Some ATS pages publish the employer and its logo as schema.org microdata.
  for (const employer of root.querySelectorAll('[itemprop~="hiringOrganization"]')) {
    if (employer.closest("aside, footer, nav, [hidden], [aria-hidden='true']")) continue;
    const label = employer.querySelector('[itemprop~="name"]');
    if ((label?.getAttribute("content") || label?.textContent)?.trim().toLowerCase() !== name) continue;
    const mark = employer.querySelector('[itemprop~="logo"]');
    const url = safeUrl(mark?.getAttribute("content") || mark?.getAttribute("src") || mark?.getAttribute("href"));
    if (url) return url;
  }
  for (const image of root.querySelectorAll<HTMLImageElement>("img[alt]")) {
    if (image.closest("aside, footer, nav, [hidden], [aria-hidden='true']")) continue;
    const alt = image.alt.trim().toLowerCase().replace(/\s+/g, " ");
    if (alt === name + " logo" || alt === "logo of " + name) {
      const url = safeUrl(image.currentSrc || image.getAttribute("src"));
      if (url) return url;
    }
  }
}
