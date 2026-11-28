import { useState } from "react";
import { initialOf } from "./job-details";

/** A company's mark, in the sizes the panel shows it: beside a name (`sm`), on the connected job's bar (`md`), on a
 * job card (`lg`), on the card that adds a job (`xl`), heading the job's details (`2xl`). */
export type LogoSize = "sm" | "md" | "base" | "lg" | "xl" | "2xl";

const SIZES: Record<LogoSize, string> = {
  sm: "size-5 rounded-[var(--radius-sm)] text-caption",
  md: "size-7 rounded-[var(--radius-md)] text-caption",
  base: "size-9 rounded-[var(--radius-md)] text-sm",
  lg: "size-10 rounded-[var(--radius-lg)] text-sm",
  xl: "size-12 rounded-[var(--radius-lg)] text-body-strong",
  "2xl": "size-14 rounded-[var(--radius-xl)] text-h3",
};
/** A logo sits on a quiet tile; a company with none shows its initial in the primary tint. */
const TILE = "grid flex-none place-items-center overflow-hidden border border-[var(--color-border)] font-[700]";
const WITH_LOGO = "bg-[var(--color-surface-2)]";
const INITIAL = "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]";

/** The company's logo from its posting, else its initial on a tile. */
export function CompanyLogo({ url, company, size = "base" }: { url?: string; company: string; size?: LogoSize }) {
  const [failed, setFailed] = useState<string>();
  const isLogo = Boolean(url?.startsWith("https://") && url !== failed);
  return <span aria-hidden="true" data-slot="company-logo" className={`${TILE} ${SIZES[size]} ${isLogo ? WITH_LOGO : INITIAL}`}>
    {isLogo
      // eslint-disable-next-line @next/next/no-img-element -- the extension isn't a Next.js app
      ? <img className="size-full object-contain p-1" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
      : initialOf(company)}
  </span>;
}
