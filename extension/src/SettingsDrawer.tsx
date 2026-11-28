import { useLayoutEffect, useRef } from "react";
import type { Session } from "./api";
import { CROSS_ICON, LOGOUT_ICON } from "./autofill/icons";
import { ICON_BUTTON_QUIET, MOTION } from "./ui";

type SettingsDrawerProps = {
  isOpen: boolean;
  session: Session;
  isPreviewOn: boolean;
  isDark: boolean;
  onTogglePreview: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onClose: () => void;
};

/** The drawer, in from the panel's right edge over the rest, which waits behind it. */
const DRAWER = "fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(20rem,88vw)] max-w-none border-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] shadow-[var(--shadow-lg)] backdrop:bg-[var(--color-overlay)] backdrop:backdrop-blur-[var(--blur-overlay)] open:motion-safe:animate-drawer-in";
/** Who's signed in: initials, name, role and firm on one card. */
const USER_CARD = "flex min-w-0 items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4";
const AVATAR = "grid size-12 flex-none place-items-center rounded-[var(--radius-lg)] bg-[var(--color-primary-subtle)] text-h3 text-[var(--color-primary-subtle-fg)]";
/** A setting's slide switch: blue and to the right when on. */
const SWITCH = "group inline-flex flex-none items-center rounded-full";
const TRACK = `inline-flex h-5 w-9 flex-none items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] transition-[background,border-color] ${MOTION} group-aria-checked:border-[var(--color-primary)] group-aria-checked:bg-[var(--color-primary)]`;
const THUMB = `size-3.5 translate-x-0.5 rounded-full bg-[var(--color-surface)] shadow-[var(--shadow-xs)] transition-transform ${MOTION} group-aria-checked:translate-x-4.5`;
const SIGN_OUT = `flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-sm font-[650] text-[var(--color-danger-fg)] transition-[background] ${MOTION} hover:bg-[var(--color-danger-bg)] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;

/** "Priya Shah" is "PS"; one name is its first letter. */
export const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((word) => word[0]!)
  .filter((letter, index, all) => index === 0 || index === all.length - 1).join("").toUpperCase() || "?";

function Setting({ title, text, label, isOn, onToggle }: { title: string; text: string; label: string; isOn: boolean; onToggle: () => void }) {
  return <div className="flex items-center justify-between gap-3">
    <div className="grid min-w-0 gap-0.5">
      <p className="text-sm font-[650]">{title}</p>
      <p className="text-caption text-[var(--color-text-3)]">{text}</p>
    </div>
    <button type="button" role="switch" className={SWITCH} aria-checked={isOn} aria-label={label} onClick={onToggle}>
      <span className={TRACK} aria-hidden="true"><span className={THUMB} /></span>
    </button>
  </div>;
}

/** Account and settings, behind the user button in the top bar: who's signed in, the LinkedIn preview, the theme, and
 * Sign out. A modal drawer: Esc, the close button or a click beside it closes it, and focus goes back to the button. */
export default function SettingsDrawer({ isOpen, session, isPreviewOn, isDark, onTogglePreview, onToggleTheme, onSignOut, onClose }: SettingsDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (isOpen && !element.open) element.showModal();
    if (!isOpen && element.open) element.close();
  }, [isOpen]);
  const name = session.user?.name || "BDE";
  const firm = session.firm?.name || session.firm?.slug || "BenchQ";
  return <dialog ref={dialog} data-slot="settings" className={DRAWER} aria-labelledby="settings-title" onClose={onClose}
    // A click on the backdrop lands on the dialog itself: beside the drawer, it closes it.
    onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    {isOpen && <div className="flex h-full flex-col gap-6 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="settings-title" className="text-h3">Settings</h2>
        <button type="button" className={ICON_BUTTON_QUIET} aria-label="Close settings" onClick={() => dialog.current?.close()}>{CROSS_ICON}</button>
      </div>
      <div data-slot="settings-user" className={USER_CARD}>
        <span className={AVATAR} aria-hidden="true">{initialsOf(name)}</span>
        <div className="grid min-w-0">
          <p className="truncate text-sm font-[650]">{name}</p>
          <p className="truncate text-caption text-[var(--color-text-3)]">{session.principal.role}</p>
          <p className="truncate text-caption font-[600] text-[var(--color-primary)]">{firm}</p>
        </div>
      </div>
      <div className="grid gap-5">
        <Setting title="LinkedIn preview" text="Show LinkedIn postings inside BenchQ" label="LinkedIn posting preview" isOn={isPreviewOn} onToggle={onTogglePreview} />
        <Setting title="Dark mode" text="Use the dark navy theme" label="Dark mode" isOn={isDark} onToggle={onToggleTheme} />
      </div>
      <div className="mt-auto border-t border-[var(--color-border)] pt-4">
        <button type="button" data-slot="sign-out" className={SIGN_OUT} onClick={onSignOut}>{LOGOUT_ICON}Sign out</button>
      </div>
    </div>}
  </dialog>;
}
