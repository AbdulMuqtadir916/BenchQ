/** SmartRecruiters changes the visible posting number to a publication UUID on its application.
 * Compare against the posting's own application link or its published one-click configuration. */
export function smartApplication(posting: string, application: string | null): URL | null {
  if (!application) return null;
  try {
    const source = new URL(posting);
    const target = new URL(application);
    return source.origin === "https://jobs.smartrecruiters.com" && target.origin === source.origin
      && /^\/[^/]+\/\d+(?:-[^/]*)?\/?$/.test(source.pathname)
      && /^\/oneclick-ui\/company\/[^/]+\/publication\/[\da-f-]{36}\/?$/i.test(target.pathname) ? target : null;
  } catch {
    return null;
  }
}

export async function confirmsSmartApplication(posting: string, target: URL, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(posting, { credentials: "omit", redirect: "error", signal });
  if (!response.ok) return false;
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  if (Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[data-sr-track='apply'][href]")).some(link => {
    const url = new URL(link.getAttribute("href")!, posting);
    return url.origin === target.origin && url.pathname === target.pathname;
  })) return true;
  const config = Array.from(doc.scripts).map(script => /window\.ONECLICKDATA\s*=\s*\{([^}]+)\}/.exec(script.textContent ?? "")?.[1]).find(Boolean);
  if (!config) return false;
  const uuid = /\bpuuid:\s*'([\da-f-]{36})'/i.exec(config)?.[1];
  const company = /\bcident:\s*'([\w.-]+)'/.exec(config)?.[1];
  return Boolean(uuid && company && target.pathname.replace(/\/$/, "") === `/oneclick-ui/company/${company}/publication/${uuid}`);
}
