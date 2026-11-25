(() => {
  if (globalThis.__benchqDetector) { globalThis.__benchqDetector(); return; }
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const button = document.createElement("button");
  button.title = "Open BenchQ Autofill Apply";
  button.setAttribute("aria-label", button.title);
  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("icons/icon48.png");
  logo.alt = "";
  logo.width = logo.height = 28;
  const label = document.createElement("span");
  button.append(logo, label);
  host.style.cssText = "position:fixed;top:40vh;right:12px;z-index:2147483647";
  button.style.cssText = "display:flex;align-items:center;gap:7px;background:#fff;color:#17213a;font:600 13px/1.3 system-ui;padding:5px 11px 5px 5px;border:1px solid #d4d9e3;border-radius:12px;box-shadow:0 2px 8px #10182826;cursor:pointer";
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
    relevant = Boolean((job?.isJobPage && job.title) || application);
    label.textContent = job?.title ? "Review job" : "Open BenchQ";
    button.title = job?.title ? `Review ${job.title} in BenchQ` : "Open BenchQ Autofill Apply";
    button.setAttribute("aria-label", button.title);
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
