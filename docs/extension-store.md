# BenchQ Apply: Chrome Web Store submission

Everything the store asks for, drafted, plus the one-time setup the pipeline needs. The pipeline itself is
`.github/workflows/extension-publish.yml` (see `docs/team/arbaz.md`). **The drafts below are for the owner to read and
correct. The privacy text in particular needs a person who is responsible for it to approve it before it is published.**

## 0. Order of work (the first release)

1. **Production backend reachable through the website.** `https://www.benchq.io/api/*` must reach the backend. On
   2026-11-10 `/api/auth/me` there returned 404: `next.config.ts` only proxies `/api` when `BACKEND_URL` is set for the
   Vercel project. Without it the extension cannot sign in, and a reviewer cannot test it.
2. Developer account ($5, one time) at the Chrome Web Store developer dashboard.
3. Build the store package: `npm run build:store` in `extension/`, then zip the contents of `extension/dist`.
4. **First upload by hand** (Items, New item). This creates the item and its permanent ID. Visibility: **Unlisted**.
5. Put `chrome-extension://<the item's ID>` in the production backend's `ALLOWED_ORIGINS`, next to the website's own
   address, **before submitting**: the reviewer marks a job applied, and without it every write the extension makes is
   refused with 403 "Cross-origin request refused" (`backend/auth/access.py`). Never `chrome-extension://*`.
6. Fill in the listing (sections 1 to 5 below) and submit for review.
7. Add the five GitHub secrets (section 6). From then on a push to `main` that changes `extension/**` uploads the next
   version by itself.

A pinned `"key"` is **not** needed for the store: the store owns the ID. It only keeps the ID the same for people who load
the folder unpacked: in the dashboard, Package, View public key, and put it in `extension/manifest.base.json` for dev
builds only. Do not ship a `key` in the store package.

## 1. Listing

- **Name:** BenchQ Apply (12 characters; the store allows 75).
- **Summary (limit 132):** Fill job application forms from a candidate's BenchQ answers, and track each application.
- **Category:** Productivity. **Language:** English.
- **Single purpose** (the store requires one): *Fills a job application form in the open tab with the answers saved for the
  chosen candidate in BenchQ, and records the application in BenchQ.*
- **Description:**
  > BenchQ Apply is for recruiting teams that use BenchQ. Open a saved job from BenchQ, and the side panel connects to the
  > employer's application page. BenchQ Apply shows which fields it can fill from the candidate's saved answers, fills them
  > when you press Autofill, lets you undo, and records the application in BenchQ when you mark it applied. You always
  > review and submit the form yourself.
  >
  > It works on the job boards and application systems BenchQ knows (LinkedIn, Indeed, Greenhouse, Lever, Workday and
  > others). On any other site it asks you first, once per site, and explains why.
  >
  > A BenchQ account is required.
- **Screenshots (you capture these in Chrome):** 1280x800 or 640x400, up to 5, at least 1. Suggested: the job list in the
  panel; the review of a form before filling; the form after Autofill; the "Allow BenchQ on this site?" notice.
- **Small promo tile (optional):** 440x280.

## 2. Permission justifications (the dashboard asks for each)

| Permission | Why |
|---|---|
| `sidePanel` | The whole interface is the side panel next to the employer's page. |
| `scripting` | Reads the application form in the connected tab and writes the chosen answers into it, in that tab only. |
| `storage` | Keeps which tab is connected to which job, for the browser session only (`storage.session`). |
| `webNavigation` | Notices when the connected tab moves to the next page of an application, to scan it again, and to drop the connection when the tab is reused for something else. |
| Host: BenchQ's address | Signs in and calls BenchQ's own API with the user's session. |
| Host: job boards and application systems | Where the forms to fill are. Listed by name in `extension/hosts.json`: no all-sites access is requested. |
| Optional host: `https://*/*` | An employer's own careers page can be any site. BenchQ never reads one until the user clicks Allow for that site, after a notice that says why. Each site can be removed in `chrome://extensions`. |

**Remote code:** No. All code is in the package; nothing is fetched and run. (Checked 2026-11-10: no `eval` or
`new Function` in the build, no external scripts, fonts are bundled.)

## 3. Data use (the dashboard's privacy tab)

Draft answers, to be confirmed by the owner:

- **Collects:** *Website content* (the text of the form fields on a connected application page, to fill them and to record
  what was submitted) and *authentication information* (the user's BenchQ session, kept by the browser as a cookie and sent
  only to BenchQ).
- **Not collected:** health, financial, location, web history (beyond the address of the connected tab), user activity
  such as keystrokes or clicks, or personal communications.
- **Certify:** data is not sold; not used for anything unrelated to the single purpose; not used for creditworthiness or
  lending.
- **Where it goes:** only to the user's own BenchQ account (www.benchq.io). Nothing is sent to anyone else.
- **Privacy policy URL:** required. It must be a public page. Draft in section 4.

## 4. Privacy policy (draft; needs a public page and a responsible person's approval)

> **BenchQ Apply privacy policy.** BenchQ Apply is a browser extension for people who use BenchQ. It acts only on the tab
> you connect to a BenchQ job, and, after you allow it, on sites you approve.
>
> *What it reads.* The form fields on the connected job application page, so it can fill them and so BenchQ can record
> what was filled when you mark the application applied. The address of the connected tab, to check it is the job you meant.
>
> *What it sends, and where.* The résumé answers it uses to fill a form come from your BenchQ account, and the recorded
> form goes back to your BenchQ account, both over HTTPS to www.benchq.io. Your sign-in is the BenchQ session cookie, which
> the browser keeps and the extension never reads. Nothing is sent to anyone else, sold, or used for advertising.
>
> *What it keeps.* Only which tab is connected to which job, for the current browser session. It is erased when the
> browser closes.
>
> *Your control.* You press Autofill and you submit every form yourself. You can remove BenchQ's access to any site in
> chrome://extensions, and uninstall at any time. For BenchQ account data, contact **[support email]**.

Fill in the support email, and publish it at a stable public address, for example `https://www.benchq.io/privacy`. (A page
in the BenchQ app is a product decision and needs a registry entry; a plain page on the marketing site is simpler.)

## 5. Instructions for the reviewer

The extension needs a BenchQ sign-in, so a reviewer who cannot sign in will reject it. Put this in "Test instructions",
with a **demo account on an environment Google can reach** (www.benchq.io with its backend connected):

> Sign in at https://www.benchq.io/sign-in with **[demo email]** / **[demo password]**. Open the extension's side panel
> (toolbar icon). Pick a saved job and open it. On a Greenhouse or Lever job the panel reads the form straight away.
> Press Autofill to fill it from the demo candidate's answers. Nothing is submitted. On any other site, such as
> usijobs.deloitte.com, the panel first explains why it needs access and shows an Allow button; Chrome then asks once.

Use a demo account that holds only made-up candidates.

## 6. The five GitHub secrets (one-time)

The workflow reads `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and
`CHROME_REFRESH_TOKEN` (GitHub, Settings, Secrets and variables, Actions), and uploads only when all five are set. They
reach the upload step only, never install, tests or build. It uses the Chrome Web Store API V2 (`chrome-webstore-upload-cli`
4.x): Google supported V1 only until 2026-10-15. A manual run publishes from `main` only. Create the environment `chrome-web-store` too, with a required
reviewer if you want an approval before each upload.

1. **Extension ID:** the 32-letter ID on the item in the dashboard (after the first upload).
   **Publisher ID:** your developer account's ID (not the extension's), in the dashboard's address when signed in. V2
   needs it.
2. In Google Cloud Console, create a project and **enable the Chrome Web Store API**.
3. OAuth consent screen: External, add yourself as a test user. Credentials, Create OAuth client ID, type **Desktop app**.
   The client ID and secret are `CHROME_CLIENT_ID` and `CHROME_CLIENT_SECRET`.
4. Get a **refresh token** for the scope `https://www.googleapis.com/auth/chromewebstore` by signing in with the Google
   account that owns the developer account (the upload tool's own README describes the steps). That is
   `CHROME_REFRESH_TOKEN`.
5. Treat all five as secrets. Never put them in `extension/.env.store` or any committed file.

## 7. After approval

The first approved version goes live to people who have the unlisted link; later versions update their browsers by
themselves. If an upload is refused for a version number, note that the workflow already stamps
`major.minor.<run number>.<attempt>`, so a re-run gets its own version; raise `major.minor` in `extension/manifest.base.json` for a bigger release.
