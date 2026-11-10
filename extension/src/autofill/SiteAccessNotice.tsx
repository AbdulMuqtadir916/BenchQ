import { ALERT, button, MUTED_TEXT, SOFT_TEXT } from "../ui";
import type { SiteAccess } from "./site-access";

/** BenchQ can't read a site until Chrome has been told it may. This says why it's asking before Chrome does, in the
 * words of this site, and what BenchQ will and won't do with it. The Allow button is the click Chrome needs. */
export function SiteAccessNotice({ access, isDenied, isAsking, onAllow }: { access: SiteAccess; isDenied: boolean; isAsking: boolean; onAllow: () => void }) {
  return (
    <div data-slot="site-access" role="region" aria-label={`Allow BenchQ on ${access.host}`} className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] p-2.5">
      <h3 className="text-sm font-[550]">Allow BenchQ on {access.host}?</h3>
      <p className={SOFT_TEXT}>
        To fill this application, BenchQ has to read the form on <strong>{access.host}</strong>. Chrome only lets an extension do that on a
        site you have allowed, and this site isn&apos;t one of the job boards or application systems BenchQ already knows, so Chrome will ask you once.
      </p>
      <ul className={`list-disc pl-4 ${MUTED_TEXT}`}>
        <li>BenchQ reads this tab&apos;s form to fill it, and to record what was filled when you mark the job applied.</li>
        <li>It reads nothing on other sites, and only acts when you open this job from BenchQ.</li>
        <li>You can take the permission away any time: chrome://extensions, BenchQ, Details, Site access.</li>
      </ul>
      {isDenied && <p role="alert" className={ALERT}>Not allowed. BenchQ can&apos;t read {access.host} without it, so you can still fill the form yourself.</p>}
      <button type="button" data-slot="site-access-allow" className={button("primary", "large")} disabled={isAsking} onClick={onAllow}>
        {isDenied ? "Ask again" : `Allow on ${access.host}`}
      </button>
    </div>
  );
}
