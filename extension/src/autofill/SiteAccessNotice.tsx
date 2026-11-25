import { ALERT, button } from "../ui";
import { SHIELD_CHECK_ICON } from "./icons";
import type { SiteAccess } from "./site-access";

const REASSURANCES = [
  { title: "Reads only this tab's form", detail: "To fill it for you, and to record what was filled when you mark the job applied." },
  { title: "Asks once for this site", detail: "Chrome remembers your answer, so you won't see this again here." },
  { title: "Yours to take back", detail: "Remove it any time in chrome://extensions, under BenchQ Autofill Apply, Site access." },
];

/** BenchQ can't read a site until Chrome has been told it may. This says why before Chrome asks, in plain words and at the
 * top of the panel where the BDE is already looking, in a card no taller than it needs to be: which site, why, and the
 * Allow button Chrome needs the click of. What BenchQ will and won't do waits behind "What BenchQ can see". */
export function SiteAccessNotice({ access, isDenied, isAsking, onAllow }: { access: SiteAccess; isDenied: boolean; isAsking: boolean; onAllow: () => void }) {
  return (
    <section data-slot="site-access" aria-labelledby="site-access-title"
      className="animate-rise-in grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] p-2.5">
      <div className="flex items-start gap-2">
        <span className="grid size-7 flex-none place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] shadow-[var(--shadow-primary)] [&_svg]:size-[var(--icon-md)]">
          {SHIELD_CHECK_ICON}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h3 id="site-access-title" className="text-body-strong text-[var(--color-text)]">Allow BenchQ on this site?</h3>
          <p className="text-caption text-[var(--color-text-2)]">
            BenchQ needs to read the form on <span data-slot="site-access-host" className="font-mono wrap-anywhere text-[var(--color-text)]">{access.host}</span> to fill it. It isn&apos;t on BenchQ&apos;s list yet.
          </p>
        </div>
      </div>

      <details className="text-caption text-[var(--color-text-2)]">
        <summary className="cursor-pointer font-[550] text-[var(--color-primary-subtle-fg)]">What BenchQ can see</summary>
        <ul className="mt-1 grid list-disc gap-1 pl-4">
          {REASSURANCES.map(({ title, detail }) => (
            <li key={title}><span className="font-[550] text-[var(--color-text)]">{title}.</span> {detail}</li>
          ))}
        </ul>
      </details>

      {isDenied && <p role="alert" className={ALERT}>Not allowed. BenchQ can&apos;t read {access.host} without it, so you can still fill the form in yourself.</p>}

      <button type="button" data-slot="site-access-allow" className={`wrap-anywhere ${button("primary")}`} disabled={isAsking} onClick={onAllow}>
        {isDenied ? "Ask again" : `Allow on ${access.host}`}
      </button>
      <p className="-mt-1 text-center text-caption text-[var(--color-text-3)]">Chrome will ask you to confirm: choose <strong className="font-[550] text-[var(--color-text-2)]">Allow</strong>.</p>
    </section>
  );
}
