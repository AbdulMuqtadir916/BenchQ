/** The structure the decision needs of the signed-in principal (`Principal` in the session store). */
type LivePrincipal = { kind: "platform"; support?: { id: string } | null } | { kind: "firm" } | null;

export type ForbiddenBannerState =
  /** The session is still being read: mount nothing, so an ended view cannot trigger its expiry redirect. */
  | "wait"
  | "show"
  /** The server rendered a banner for a support view that is no longer the live one: hide it and refresh the server view. */
  | "stale"
  | "none";

/**
 * Whether the 403 screen shows the server's support banner (PR #128 review). A session that could not be read (`null` once
 * bootstrapping ends) is unknown, not a different view, so the server's banner stays and its Exit stays reachable.
 */
export function forbiddenBannerState({ bootstrapping, principal, serverViewId }: { bootstrapping: boolean; principal: LivePrincipal; serverViewId: string | undefined }): ForbiddenBannerState {
  if (bootstrapping) return "wait";
  if (principal === null) return serverViewId ? "show" : "none";
  const liveViewId = principal.kind === "platform" ? principal.support?.id : undefined;
  if (liveViewId !== serverViewId) return "stale";
  return serverViewId ? "show" : "none";
}
