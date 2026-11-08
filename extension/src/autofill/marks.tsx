import { MOTION } from "../ui";
import { CHECK } from "./icons";

const TICK = `mt-0.5 grid size-[var(--icon-md)] flex-none place-items-center rounded-[var(--radius-full)] border border-[var(--color-border-strong)] p-0.5 text-[var(--color-surface)] transition-[background,border-color] ${MOTION} data-[filled=true]:border-[var(--color-success-fg)] data-[filled=true]:bg-[var(--color-success-fg)] [&_svg]:size-full [&_svg]:[stroke-width:var(--tick-stroke)]`;

type TickProps = {
  isFilled: boolean;
  slot: string;
  /** Pops in, for a field that has only just been filled. */
  isNew?: boolean;
};

/** A round mark beside a field: empty while it needs filling, a green tick once it holds a value. */
export function Tick({ isFilled, slot, isNew = false }: TickProps) {
  return <span data-slot={slot} className={isNew ? `${TICK} animate-tick-in` : TICK} role="img" aria-label={isFilled ? "Filled" : "Not filled"} data-filled={isFilled}>
    {isFilled && CHECK}
  </span>;
}
