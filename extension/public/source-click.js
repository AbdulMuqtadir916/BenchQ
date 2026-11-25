document.addEventListener("click", (event) => {
  if (!event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element && event.target.closest("a[data-benchq-job]");
  if (!link || !/^https?:$/.test(link.protocol) || link.origin === location.origin || !chrome.runtime.id) return;
  event.preventDefault();
  chrome.runtime.sendMessage({ type: "source-click", url: link.href, jobId: link.dataset.benchqJob, candidateId: link.dataset.candidate })
    .then((opened) => { if (!opened) location.assign(link.href); }, () => location.assign(link.href));
}, true);
