(() => {
  if (globalThis.__benchqDetector) { globalThis.__benchqDetector(); return; }
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const button = document.createElement("button");
  button.textContent = "Open BenchQ Autofill Apply";
  host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647";
  button.style.cssText = "background:#183b53;color:white;padding:10px 16px;border:0;border-radius:8px;cursor:pointer;font:14px system-ui";
  shadow.append(button);
  button.onclick = (event) => {
    if (event.isTrusted) chrome.runtime.sendMessage({ type: "assistant-open" }).then(opened => { if (opened) host.remove(); });
  };
  let timer, relevant = false, revision = 0;
  async function refresh() {
    const current = ++revision;
    if (document.hidden) { host.remove(); return; }
    const job = globalThis.__benchqAutofill?.readJob();
    const application = document.querySelector("form") && /apply|application/i.test(location.pathname + " " + document.title)
      && document.querySelector("input[type=file], input[autocomplete=email], input[type=email]");
    relevant = Boolean(job?.isJobPage || application);
    if (!relevant) { host.remove(); return; }
    const visible = await chrome.runtime.sendMessage({ type: "assistant-visible" }).catch(() => true);
    if (current !== revision || document.hidden) return;
    if (visible) host.remove();
    else if (!host.isConnected) document.body?.append(host);
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, 400);
  }
  globalThis.__benchqDetector = schedule;
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("focus", schedule);
  // Chrome also opens/closes the panel from its toolbar, independently of page navigation.
  setInterval(async () => {
    if (document.hidden || !relevant) return;
    const open = await chrome.runtime.sendMessage({ type: "assistant-visible" }).catch(() => true);
    if (open) host.remove();
    else if (!host.isConnected) schedule();
  }, 1500);
  schedule();
})();
