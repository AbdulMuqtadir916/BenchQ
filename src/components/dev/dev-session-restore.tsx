"use client";

import { useEffect, useLayoutEffect } from "react";
import { sessionApi } from "@/lib/api/session";
import { useSession } from "@/lib/stores/session-store";

/**
 * DEV ONLY (rendered only when NODE_ENV is "development"): remembers the dev switcher's principal in
 * sessionStorage, so a full page load (a typed URL, an unknown route, a reload) keeps who you were
 * signed in as. Mock data still resets on reload; a remembered principal the fresh mock data doesn't
 * have (e.g. a dev-accepted invite's user) is dropped and the default user stays. This tab only.
 */
const KEY = "benchq.dev.principal";

function read(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(userId: string | null): void {
  try {
    if (userId) window.sessionStorage.setItem(KEY, userId);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable (private mode, blocked): nothing to remember
  }
}

export function DevSessionRestore() {
  // Before the first paint after hydration: hold the gates (restoring) while we sign back in.
  useLayoutEffect(() => {
    const remembered = read();
    const current = useSession.getState().principal?.userId ?? null;
    if (!remembered || remembered === current) return;
    useSession.getState().setRestoring(true);
    sessionApi
      .devSignInAs(remembered)
      .then((session) => useSession.getState().setSession(session))
      .catch(() => write(null))
      .finally(() => useSession.getState().setRestoring(false));
  }, []);

  // Remember every later change of principal (switcher, sign-in, sign-out → forget).
  useEffect(
    () =>
      useSession.subscribe((state, previous) => {
        if (state.restoring || state.principal?.userId === previous.principal?.userId) return;
        write(state.principal?.userId ?? null);
      }),
    [],
  );

  return null;
}
