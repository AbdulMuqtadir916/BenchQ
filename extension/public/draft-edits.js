// Track which Workable draft controls the user edited during this document's lifetime.
// Store element references only. The form values stay on the page.
(() => {
  const edits = new WeakSet();
  globalThis.__benchqDraftEdits = edits;
  document.addEventListener("input", event => {
    const control = event.composedPath()[0];
    if (event.isTrusted && control instanceof HTMLInputElement && !control.matches(":autofill")) edits.add(control);
  }, true);
})();
