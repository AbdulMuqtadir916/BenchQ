import { useState } from "react";
import { initialOf } from "./job-details";

const TILE = "grid flex-none place-items-center overflow-hidden border border-[var(--color-border)] bg-[var(--color-primary-subtle)] font-[700] text-[var(--color-primary-subtle-fg)]";

/** The company's logo from its posting, else its initial on a tile. `isSmall`: a small mark beside the company's name on
 * a list card, rather than the job card's tile. */
export function CompanyLogo({ url, company, isSmall = false }: { url?: string; company: string; isSmall?: boolean }) {
  const [failed, setFailed] = useState<string>();
  const size = isSmall ? "size-5 rounded-[var(--radius-sm)] text-caption" : "size-9 rounded-[var(--radius-md)] text-sm";
  return <span aria-hidden="true" className={`${TILE} ${size}`}>
    {url?.startsWith("https://") && url !== failed
      // eslint-disable-next-line @next/next/no-img-element -- the extension isn't a Next.js app
      ? <img className="size-full object-contain" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
      : initialOf(company)}
  </span>;
}
