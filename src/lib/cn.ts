import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, taught the design system's type scale (design.md; `.text-*` in globals.css). Without
 * it, `text-body` / `text-caption` / … look like colours to tailwind-merge, so a component's text colour
 * (`text-[var(--color-…)]`) was silently dropped whenever a size class came after it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "body-strong", "caption", "label", "mono", "mono-sm"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
