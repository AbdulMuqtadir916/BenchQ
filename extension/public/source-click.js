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
    chrome.runtime.sendMessage({ type: "source-click", url: link.href, jobId: link.dataset.benchqJob, candidateId })
      .then((opened) => { if (!opened) location.assign(link.href); }, () => location.assign(link.href));
  }, true);
})();
