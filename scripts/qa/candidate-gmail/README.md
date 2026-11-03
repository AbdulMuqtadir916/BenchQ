# Candidate Gmail acceptance

This local harness imports the real Inbox hook and components. The verifier intercepts API requests with synthetic
mail and blocks external traffic; Google consent is a stub page, not a real account. It checks unclassified imports,
source-account display, local read failure/retry, manual sync, retained messages after disconnect, read-only controls,
OAuth navigation, loading/error/empty states and both themes at 1440/1024/390 with keyboard and axe checks.

From the repository root, run `QA_HOST=0.0.0.0 node scripts/qa/candidate-gmail/serve.mjs` (port 4185). Run
`python scripts/qa/candidate-gmail/verify.py` in a Playwright/Chromium runtime with access to that port and the
repository mounted at `/app`; `QA_URL` defaults to `http://host.docker.internal:4185`. The existing backend test image
has Playwright. Node dependencies are reused from the normal install; no product route or dependency is added.

When node_modules is a symlink outside the checkout, mount the installed `axe-core/axe.min.js` into the runner
separately and set `QA_AXE_PATH` to that file. The verifier never downloads axe from the internet.
