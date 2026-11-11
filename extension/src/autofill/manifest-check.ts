const RELOAD_KEY = "benchq-manifest-reload-at";
const RETRY_AFTER_MS = 60_000;

/** Chrome serves a rebuilt panel straight away but applies a changed manifest only when the extension reloads, so a
 * panel can run without the permissions its code needs. */
export function hasAutofillPermissions(): boolean {
  return Boolean(chrome.storage && chrome.scripting && chrome.webNavigation);
}

/** Reloads the extension once when its permissions are behind its code. Chrome closes the panel; the next one has
 * them. The retry limit stops a loop if something else, such as a browser policy, is holding a permission back. */
export function reloadIfManifestIsStale() {
  if (hasAutofillPermissions()) return;
  const lastTry = Number(localStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - lastTry < RETRY_AFTER_MS) return;
  localStorage.setItem(RELOAD_KEY, String(Date.now()));
  chrome.runtime.reload();
}
