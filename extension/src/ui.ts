/** Class lists that more than one part of the panel shares. Every value comes from a token in style.css, written the way
 * the website writes its own. */

export const MOTION = "duration-[var(--duration-fast)] ease-[var(--ease-out)]";

const BUTTON_SIZES = {
  regular: "min-h-[var(--control-height)] px-3 py-1 text-body-strong",
  small: "min-h-[var(--control-height)] px-2.5 py-1 text-sm font-[550]",
  large: "min-h-[var(--control-lg)] px-3 py-1 text-body-strong",
  compact: "min-h-[var(--control-sm)] px-2 py-0.5 text-sm font-[550]",
};

/** The website's raised primary and neutral secondary buttons, which also style a link. */
export const button = (look: "primary" | "secondary", size: keyof typeof BUTTON_SIZES = "regular") =>
  `bq-${look} inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] no-underline transition-[background,border-color,box-shadow,transform] ${MOTION} disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none ${BUTTON_SIZES[size]}`;

const ICON_BUTTON = `grid size-[var(--control-height)] flex-none place-items-center rounded-[var(--radius-sm)] border text-[var(--color-text-2)] transition-[color,background,border-color] ${MOTION} hover:text-[var(--color-text)] [&_svg]:size-[var(--icon-md)] [&_svg]:flex-none`;
export const ICON_BUTTON_RAISED = `${ICON_BUTTON} border-[var(--color-border-strong)] bg-[image:var(--gradient-neutral)] shadow-[var(--shadow-control)] hover:bg-[image:var(--gradient-neutral-hover)]`;
export const ICON_BUTTON_QUIET = `${ICON_BUTTON} border-transparent hover:bg-[var(--color-surface-2)]`;

export const TEXT_BUTTON = "block pt-2 pb-0.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-primary)]";

/** Equal widths side by side, one per row when the panel is too narrow, and a lone button takes the whole row. */
export const FITTED_BUTTONS = "grid grid-cols-[repeat(auto-fit,minmax(var(--action-min-width),1fr))] gap-1.5";

/** One hairline and a contact shadow. */
export const CARD = "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)]";

export const ALERT = "rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-danger-fg)_24%,transparent)] bg-[var(--color-danger-bg)] px-2.5 py-2 text-sm text-[var(--color-danger-fg)]";
export const WARNING = "rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warning-fg)_26%,transparent)] bg-[var(--color-warning-bg)] px-2.5 py-2 text-sm text-[var(--color-warning-fg)]";

/** The scroll margin of what a finished run scrolls to ("Autofill complete", or the run's note): it stops just under the
 * panel's sticky top bar, clear of the Mark applied bar at the bottom. */
export const BELOW_TOP_BAR = "scroll-mt-[calc(var(--topbar-height)+var(--spacing)*3)]";

export const SOFT_TEXT = "text-sm text-[var(--color-text-2)]";
export const MUTED_TEXT = "text-sm text-[var(--color-text-3)]";
export const EYEBROW = "text-mono-sm text-[var(--color-text-3)]";
