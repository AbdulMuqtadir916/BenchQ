/** jsdom has <dialog> but no modal one: no `showModal()` or `close()`. These open and close it the way a browser does,
 * without the top layer: Esc closes it, and closing fires `close`. */

function closeOnEscape(this: HTMLDialogElement, event: KeyboardEvent) {
  if (event.key === "Escape") this.close();
}

export function installDialog() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.hasAttribute("open")) return;
    this.setAttribute("open", "");
    this.addEventListener("keydown", closeOnEscape);
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.removeEventListener("keydown", closeOnEscape);
    this.dispatchEvent(new Event("close"));
  };
}
