# BenchQ Apply: Chrome Web Store submission

Everything the store asks for, drafted, plus the one-time setup the pipeline needs. The pipeline itself is
`.github/workflows/extension-publish.yml` (see `docs/team/arbaz.md`). **The drafts below are for the owner to read and
correct. The privacy text in particular needs a person who is responsible for it to approve it before it is published.**

## 0. Order of work (the first release)

1. **The app's address.** The extension signs in and calls `/api/*` on `https://app.benchq.io`, the BenchQ app.
   `www.benchq.io` is the marketing site, with no sign-in and no `/api`: on 2026-11-21 its `/sign-in` and
   `/api/auth/me` returned 404, while `app.benchq.io/api/auth/me` returned the backend's 401. `npm run build:store`
   builds for `storeOrigin` in `extension/hosts.json` and nothing else.
2. **Developer account** ($5, one time) at the Chrome Web Store developer dashboard, on a company-owned Google account
   with 2-Step Verification: the item stays with the account that publishes it. Google also verifies the publisher
   before it can publish: an organization needs proof of business registration or a D-U-N-S number (which can take 30+
   days); an individual needs a government ID and a document showing their name and address. A trader account's name,
   address and phone are shown to users in the EU. An item published from an individual's account can move to the
   company's own account later, through the Chrome Web Store support form (the company account registers first; the
   move takes up to 7 days).
3. **Build the store package:** `npm run build:store` in `extension/`, then zip the contents of `extension/dist` (not
   the folder itself, and without `*.map` files).
4. **First upload by hand, as a draft** (Items, New item). This creates the item and its permanent ID. Nothing is
   reviewed until Submit for review, and the package can be replaced until then, so any store build will do here.
   Visibility: **Unlisted**.
5. Put `chrome-extension://<the item's ID>` in the production backend's `ALLOWED_ORIGINS`, next to
   `https://app.benchq.io`, **before submitting**: the reviewer marks a job applied, and without it every write the
   extension makes (Mark applied, Add job, saving an answer, tailoring) is refused with 403 "Cross-origin request
   refused" (`backend/auth/access.py`). Never `chrome-extension://*`. Exactly the 32-letter ID, lower-case, no
   trailing slash: production refuses to start with any other shape (`backend/startup_checks.py`).
6. **Production backend up to date:** redeploy it from `main`, with its migrations, so every route the extension calls
   is there, including `GET /api/firms/{firm_id}/candidates/{candidate_id}/resumes/{resume_id}/file` (a résumé as a
   file, which the extension attaches to a form; PR #148). A reviewer who meets a missing route sees a broken extension.
7. The reviewer's demo account (section 5), and the privacy policy live at `https://app.benchq.io/privacy`
   (section 4), which goes out with the website once #148 is merged and the website is deployed.
8. Replace the draft's package with a store build from `main`, fill in the listing (sections 1 to 5 below) and submit
   for review.
9. Add the five GitHub secrets (section 6). Then, **after the first version is approved**, turn on automatic uploads:
   the workflow starts as manual-only (Actions, Publish extension, Run workflow, from `main`), and the comment at the
   top of `.github/workflows/extension-publish.yml` shows the `push` trigger to add. From then on a push to `main` that
   changes `extension/**` uploads the next version by itself.

### Before the store approves it: a copy to load unpacked

The store reviews a new extension before anyone can install it, which can take days. Until then BDEs can run the same
build loaded unpacked:

1. In the dashboard, open the item's Package page and choose View public key. Copy the key: the text between the
   `BEGIN` and `END` lines, joined into one line. It is public, not a secret.
2. Build the store package (step 3), add `"key": "<that key>"` to `extension/dist/manifest.json`, and zip `dist`. With
   the key, Chrome gives the unpacked copy the store item's ID, so the `ALLOWED_ORIGINS` entry from step 5 covers it too.
3. Each BDE unzips it, opens `chrome://extensions`, turns on Developer mode, and chooses Load unpacked on the folder.
4. That copy never updates itself, and a company-managed Chrome may not allow Developer mode. Once the store approves
   the extension, each BDE removes the unpacked copy and installs it from the store link.

Never upload a package with a `key` to the store: the store owns the ID.

## 1. Listing

- **Name:** BenchQ Apply (12 characters; the store allows 75).
- **Summary (limit 132):** Fill job application forms from a candidate's BenchQ answers, and track each application.
- **Category:** Productivity. **Language:** English.
- **Single purpose** (the store requires one): *Fills a job application form in the open tab with the answers saved for the
  chosen candidate in BenchQ, and records the application in BenchQ.*
- **Description:**
  > BenchQ Apply is for recruiting teams that use BenchQ. Open a saved job from BenchQ, and the side panel connects to the
  > employer's application page. BenchQ Apply shows which fields it can fill from the candidate's saved answers, fills them
  > and attaches the candidate's résumé when you press Autofill, lets you undo, and records the application in BenchQ when
  > you mark it applied. You always review and submit the form yourself. Found a job on a board or an employer's site?
  > Add it to the candidate's jobs in BenchQ from the panel.
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
| `scripting` | Reads the application form in the connected tab and writes the chosen answers and the résumé file into it, in that tab only. To add a job, reads the job posting in the tab the user is on. |
| `storage` | Keeps which tab is connected to which job, for the browser session only (`storage.session`). |
| `webNavigation` | Notices when the connected tab moves to the next page of an application, to scan it again, and to drop the connection when the tab is reused for something else. |
| Host: BenchQ's address (`https://app.benchq.io`) | Signs in and calls BenchQ's own API with the user's session. |
| Host: job boards and application systems | Where the forms to fill are. Listed by name in `extension/hosts.json`: no all-sites access is requested. |
| Optional host: `https://*/*` | An employer's own careers page can be any site. BenchQ never reads one until the user clicks Allow for that site, after a notice that says why. Each site can be removed in `chrome://extensions`. |

**Remote code:** No. All code is in the package; nothing is fetched and run. (Checked 2026-11-10: no `eval` or
`new Function` in the build, no external scripts, fonts are bundled.)

**Licences:** the third-party notices ship in the package under `licenses/`, from `extension/public/licenses/`, where
`THIRD-PARTY-NOTICES.txt` lists each one. The MPL-2.0 files (form autofill heuristics ported from Mozilla) also ship as
source, in `licenses/mpl-2.0-source/`, which the build adds (`vite.config.ts`).

## 3. Data use (the dashboard's privacy tab)

Draft answers, to be confirmed by the owner:

- **Collects:** *Personally identifiable information* (the candidate's details from their BenchQ résumé: name, email,
  phone, address, work history and saved answers, which Autofill puts into the form, and the résumé file it attaches,
  or a file the user picks from their own computer instead). That includes answers a candidate has saved to
  self-identification questions (gender, race or ethnicity, veteran status, disability) and to pay questions (salary or
  rate expectations). It also collects *website content* (the text of the form fields on a connected application page,
  to fill them and to record what was submitted, and a job posting's title, company, location, description, pay and
  address when the user adds that job to BenchQ) and *authentication information* (the user's BenchQ session, kept by
  the browser as a cookie and sent only to BenchQ). An answer the user types and chooses to keep for next time is saved
  with the candidate's answers in BenchQ. Answers to questions the extension recognises as self-identification (gender,
  race or ethnicity, veteran status, disability, sexual orientation) are filled into the form but left out of the form
  recorded with the application, and a Social Security or card number is never recorded. Everything else filled or
  typed on the page is recorded (for a file, its name, not the file), including salary and rate answers, accommodation
  questions, and any self-identification question worded in a way the extension does not recognise, so
  **health-related answers can be recorded** when a question like that is filled.
- **Not collected:** financial account details, location, web history (beyond the address of the connected tab, or of
  a job page the user adds), user activity such as keystrokes or clicks, or personal communications.
- **Certify:** data is not sold; not used for anything unrelated to the single purpose; not used for creditworthiness or
  lending.
- **Where it goes:** to the user's own BenchQ account (app.benchq.io), and, when the user presses Autofill, picks a
  different résumé for the job (which fills the form again from that résumé, and attaches its file), picks a file of
  their own to attach instead, or uses a field's Replace, Replace all or Use button (which writes a saved answer into
  that field), into the employer's application page in the connected tab. That page can read the filled answers and
  any attached file, and may save or upload them before the user submits. A file the user picks goes only into that
  page: it is never sent to BenchQ, and the panel holds it in memory only, never in storage. Nothing is sent anywhere
  else.
- **Privacy policy URL:** `https://app.benchq.io/privacy` (section 4).

## 4. Privacy policy

Published at `https://app.benchq.io/privacy` (`src/app/privacy/page.tsx`), open to everyone, signed in or not. That
page is the policy, and it goes out with the website. When the extension starts reading, sending or keeping something
new, change the page and section 3 together, and move the page's date. Its contact line gives hello@benchq.io, and sends
questions about a firm's own data to that firm's owner.

## 5. Instructions for the reviewer

The extension needs a BenchQ sign-in, so a reviewer who cannot sign in will reject it. Put this in "Test instructions",
with a **demo account on an environment Google can reach** (app.benchq.io, with the backend up to date as in section 0):

> Sign in at https://app.benchq.io/sign-in with **[demo email]** / **[demo password]**. Open the extension's side panel
> (toolbar icon). Pick a saved job and open it. On a Greenhouse or Lever job the panel reads the form straight away.
> Press Autofill to fill it from the demo candidate's answers. Nothing is submitted. On any other site, such as
> usijobs.deloitte.com, the panel first explains why it needs access and shows an Allow button; Chrome then asks once.

Use a demo account that holds only made-up candidates.

## 6. The five GitHub secrets (one-time)

The workflow reads `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and
`CHROME_REFRESH_TOKEN`, and uploads only when all five are set. The build runs in one job with no secrets and hands over
only the zip; the upload runs in a second job, on a fresh runner that never installed the project's code, and only it sees
the secrets. It uses the Chrome Web Store API V2 (`chrome-webstore-upload-cli` 4.x): Google supported V1 only until
2026-10-15. A manual run publishes from `main` only.

**Store the five as secrets of the `chrome-web-store` environment, not as repository secrets.** A repository secret can be
read by any workflow someone with write access runs on their own branch, which would bypass the `main` check and the
reviewer gate. In GitHub, Settings, **Environments**, create `chrome-web-store`, then:
- **Deployment branches and tags:** Selected branches and tags, add `main` only. A run from any other branch can then
  neither start the job nor read the secrets.
- **Required reviewers:** add the people who approve each upload (turn off "Allow administrators to bypass" if you
  want no exceptions).
- **Environment secrets:** add the five values here (Add environment secret). Do not add them under Settings, Secrets and
  variables, Actions, Repository secrets; if they exist there, delete them.

1. **Extension ID:** the 32-letter ID on the item in the dashboard (after the first upload).
   **Publisher ID:** your developer account's ID (not the extension's), in the dashboard's address when signed in. V2
   needs it.
2. In Google Cloud Console, create a project and **enable the Chrome Web Store API**.
3. OAuth consent screen: External, then set its publishing status to **In production**, not Testing. In Testing, Google
   makes the refresh token expire after 7 days, so uploads would start failing a week later with every secret still set.
   Google's API page says an unverified app can still use this API; expect an "unverified app" warning when you sign in
   to create the token. If you keep it in Testing instead, create a new refresh token and update `CHROME_REFRESH_TOKEN`
   every week. Then Credentials, Create OAuth client ID, type **Desktop app**. The client ID and secret are
   `CHROME_CLIENT_ID` and `CHROME_CLIENT_SECRET`.
4. Get a **refresh token** for the scope `https://www.googleapis.com/auth/chromewebstore` by signing in with the Google
   account that owns the developer account (the upload tool's own README describes the steps). That is
   `CHROME_REFRESH_TOKEN`.
5. Treat all five as secrets. Never put them in `extension/.env.store` or any committed file.

## 7. After approval

**If an upload goes wrong part way.** The workflow uploads the zip and then submits it for review as two steps, so the
run says which one failed.
- *Upload failed:* run the workflow again ("Re-run all jobs", or a new Run workflow from `main`); nothing reached the store.
- *Upload succeeded but Submit failed:* the store already holds the new version as a draft. Press Submit for review on it in
  the Developer Dashboard. Do not use "Re-run failed jobs": it uploads the same version again and is refused before it
  reaches the submit step. A new Run workflow from `main` also works, but it uploads a higher version and replaces the draft.

The first approved version goes live to people who have the unlisted link; later versions update their browsers by
themselves. If an upload is refused for a version number, note that the workflow already stamps
`major.minor.<run number>.<attempt>`, so a re-run gets its own version, **but only if you choose "Re-run all jobs"**: the
stamp is made in the build job, and "Re-run failed jobs" repeats only the publish job with the same zip and so the same
version; raise `major.minor` in `extension/manifest.base.json` for a bigger release.
