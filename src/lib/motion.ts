/** Motion language adapted from beUI's purpose-led motion guide. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

/** Immediate, weighted acknowledgement for pressable controls. */
export const SPRING_PRESS = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
  mass: 0.6,
};

/** Continuous movement for a surface whose footprint changes. */
export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 360,
  damping: 32,
  mass: 0.6,
};

/** Larger panels settle without an elastic overshoot. */
export const SPRING_PANEL = {
  type: "spring" as const,
  stiffness: 420,
  damping: 40,
  mass: 0.5,
};

export const SPRING_GENTLE = {
  type: "spring" as const,
  stiffness: 260,
  damping: 30,
};

export const POPOVER_TRANSITION = { duration: 0.18, ease: EASE_OUT } as const;
export const CONTENT_ENTER = { duration: 0.18, ease: EASE_OUT } as const;
export const CONTENT_EXIT = { duration: 0.12, ease: EASE_OUT } as const;

/* Compatibility aliases for existing components. */
export const spring = SPRING_PANEL;
export const springGentle = SPRING_GENTLE;
export const easeOut = EASE_OUT;
export const easeInOut = EASE_IN_OUT;
export const easeSpring = [0.16, 1, 0.3, 1] as const;

export const durations = {
  instant: 0.1,
  fast: 0.15,
  base: 0.2,
  slow: 0.28,
} as const;
