(() => {
  if (globalThis.__benchqSourceClick) return;
  globalThis.__benchqSourceClick = true;
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element && event.target.closest("a[href]");
    if (!link || !/^https?:$/.test(link.protocol) || link.origin === location.origin || !chrome.runtime.id) return;
    const candidatePage = /^\/[^/]+\/candidates\/([^/]+)\/?$/.exec(location.pathname);
    if (!link.hasAttribute("data-benchq-job")) {
      // Older BenchQ frontends render these same actions without candidate/job data attributes.
      if (!candidatePage && !/^\/[^/]+\/jobs\/?$/.test(location.pathname)) return;
      if (link.target !== "_blank" || !/^(Open source|Open original|Open on LinkedIn|Open in new tab)$/.test(link.textContent.trim())) return;
    }
    event.preventDefault();
    const candidateId = link.dataset.candidate || candidatePage?.[1] || new URLSearchParams(location.search).get("candidate") || undefined;
    // If the extension can't open it, open the link as the page meant to without leaving BenchQ: in a new tab while the
    // click still allows one, otherwise in this tab.
    const fallback = () => link.target === "_blank" && globalThis.navigator?.userActivation?.isActive !== false
      ? window.open(link.href, "_blank", "noopener,noreferrer") : location.assign(link.href);
    chrome.runtime.sendMessage({ type: "source-click", url: link.href, jobId: link.dataset.benchqJob, candidateId })
      .then((opened) => { if (!opened) fallback(); }, fallback);
  }, true);
})();
