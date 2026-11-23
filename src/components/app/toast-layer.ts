/**
 * The stacking layer every toast sits on: above every overlay, so a failure started from inside a drawer, dialog or
 * the ⌘K palette is seen while it is open. The theme has no z-index tokens yet; the overlays use this scale (a token
 * set is proposed for design.md): 10–40 sticky headers, menus and the support banner, 50 the drawer, dialogs, the
 * palette and the résumé studio, 60 the tailoring panel, 70 the studio's selection toolbar, 80 toasts.
 * `toast-layer.test.ts` fails if any other overlay reaches this layer.
 *
 * A native modal `<dialog>` (`showModal()`) sits in the browser's top layer, above every z-index, and makes the rest
 * of the page inert: a toast raised while one is open is neither seen nor reachable until it closes.
 */
export const TOAST_LAYER = "z-[80]";
