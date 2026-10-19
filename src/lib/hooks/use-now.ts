"use client";

import { useEffect, useState } from "react";

/** "Now" for derived, time-dependent values (expired invites, open support views); ticks every minute. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
