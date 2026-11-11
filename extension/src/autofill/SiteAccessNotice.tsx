import { ALERT, button, MUTED_TEXT } from "../ui";
import { CLICK_ICON, EYE_ICON, SHIELD_CHECK_ICON, UNDO_ICON } from "./icons";
import type { SiteAccess } from "./site-access";

const REASSURANCES = [
  { icon: EYE_ICON, title: "Reads only this tab's form", detail: "To fill it for you, and to record what was filled when you mark the job applied." },
  { icon: CLICK_ICON, title: "Asks once for this site", detail: "Chrome remembers your answer, so you won't see this again here." },
  { icon: UNDO_ICON, title: "Yours to take back", detail: "Remove it any time in chrome://extensions, under BenchQ Apply, Site access." },
];

/** BenchQ can't read a site until Chrome has been told it may. This says why before Chrome asks, in plain words and at the top
 * of the panel where the BDE is already looking, and what BenchQ will and won't do. The Allow button is the click Chrome needs. */
export function SiteAccessNotice({ access, isDenied, isAsking, onAllow }: { access: SiteAccess; isDenied: boolean; isAsking: boolean; onAllow: () => void }) {
  return (
    <section data-slot="site-access" aria-labelledby="site-access-title"
      className="animate-rise-in overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-primary)] bg-[var(--color-surface)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-primary)_14%,transparent),var(--shadow-sm)]">
      <div className="flex items-start gap-2.5 bg-[var(--color-primary-subtle)] px-3 pt-3 pb-2.5">
        <span className="grid size-9 flex-none place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] shadow-[var(--shadow-primary)] [&_svg]:size-5">
          {SHIELD_CHECK_ICON}
        </span>
        <div className="min-w-0">
          <p className="text-label uppercase text-[var(--color-primary-subtle-fg)]">Permission needed</p>
          <h3 id="site-access-title" className="text-h3 text-[var(--color-text)]">Allow BenchQ to work on this site?</h3>
          <p data-slot="site-access-host" className="mt-1 inline-block max-w-full truncate rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 text-mono-sm text-[var(--color-text)]">
            {access.host}
          </p>
        </div>
      </div>

      <div className="grid gap-3 px-3 pt-3 pb-3">
        <p className="text-body text-[var(--color-text-2)]">
          To fill this application, BenchQ needs to read the form on this page. Chrome only allows that on sites you approve, and this one isn&apos;t on BenchQ&apos;s list yet.
        </p>

        <ul className="grid gap-2.5">
          {REASSURANCES.map(({ icon, title, detail }) => (
            <li key={title} className="flex items-start gap-2.5">
              <span className="grid size-7 flex-none place-items-center rounded-[var(--radius-md)] bg-[var(--color-surface-3)] text-[var(--color-text-2)] [&_svg]:size-[var(--icon-md)]">{icon}</span>
              <span className="min-w-0">
                <span className="block text-body-strong text-[var(--color-text)]">{title}</span>
                <span className={`block text-caption ${MUTED_TEXT}`}>{detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {isDenied && <p role="alert" className={ALERT}>Not allowed. BenchQ can&apos;t read {access.host} without it, so you can still fill the form in yourself.</p>}

        <div className="grid gap-1.5">
          <button type="button" data-slot="site-access-allow" className={button("primary", "large")} disabled={isAsking} onClick={onAllow}>
            {isDenied ? "Ask again" : `Allow on ${access.host}`}
          </button>
          <p className="text-center text-caption text-[var(--color-text-3)]">Chrome will ask you to confirm. Choose <strong className="font-[550] text-[var(--color-text-2)]">Allow</strong>.</p>
        </div>
      </div>
    </section>
  );
}
