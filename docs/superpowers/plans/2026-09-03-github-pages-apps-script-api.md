# GitHub Pages + Apps Script API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve both the public scoreboard and teacher console from GitHub Pages while using the existing Google Apps Script project as an authenticated JSON API backed by the existing Google Sheet.

**Architecture:** Static HTML/CSS/JavaScript is published from a dedicated `site/` artifact to GitHub Pages. A thin frontend API client sends simple GET and text/plain POST requests to an allowlisted Apps Script router; Apps Script validates teacher sessions and delegates to the existing data operations.

**Tech Stack:** HTML5, CSS, browser JavaScript, Fetch API, Node.js test runner, Google Apps Script V8, Google Sheets, Google Drive, GitHub Actions, GitHub Pages, clasp

**Spec:** `docs/superpowers/specs/2026-09-03-github-pages-apps-script-api-design.md`

## Global Constraints

- Production frontend URL is exactly `https://krutrit.github.io/classroom-lms/`.
- Both public and teacher pages are served by GitHub Pages.
- Google Apps Script remains container-bound to Spreadsheet `1Gy79zRiPikUgw9L909C7FBkkVOaIkIjeSpfg5OFeuPY`.
- Never send passwords or tokens in a URL.
- POST uses `Content-Type: text/plain;charset=utf-8` and JSON string body to avoid preflight.
- Apps Script accepts only explicitly allowlisted actions.
- Every teacher read and mutation validates a server-side session before touching storage.
- No credential, password, token, `.clasp.json`, student record, or exported report enters Git.
- Keep the existing Apps Script HTML deployment available as fallback until GitHub Pages passes live smoke tests.
- Do not alter the existing seven-sheet schema destructively.

---

### Task 1: Establish the migration branch and static site boundary

**Files:**
- Create: `site/assets/css/style.css`
- Create: `site/assets/css/teacher.css`
- Create: `site/assets/js/config.js`
- Create: `site/assets/js/common.js`
- Create: `site/assets/js/index.js`
- Create: `site/assets/js/teacher.js`
- Create: `site/index.html`
- Create: `site/teacher.html`
- Create: `tests/site-structure.test.js`
- Modify: `.claspignore`

**Interfaces:**
- Consumes: current `index.html`, `teacher.html`, `style.html`, `script.html`
- Produces: self-contained `site/` directory with no Apps Script template syntax

- [ ] **Step 1: Create an isolated feature branch**

Run:

```powershell
git switch -c feat/github-pages-api
git status --short
```

Expected: current branch is `feat/github-pages-api` and the tree contains only the plan file as an uncommitted change.

- [ ] **Step 2: Write a failing static-site structure test**

Create `tests/site-structure.test.js` with `node:test`. Read both `site/index.html` and `site/teacher.html` and assert:

```js
assert.equal(index.includes('<?'), false);
assert.equal(teacher.includes('<?'), false);
assert.equal(index.includes('google.script.run'), false);
assert.equal(teacher.includes('google.script.run'), false);
assert.match(index, /assets\/js\/api\.js/);
assert.match(index, /assets\/js\/index\.js/);
assert.match(teacher, /assets\/js\/api\.js/);
assert.match(teacher, /assets\/js\/teacher\.js/);
```

The test must also verify that every local `src` and `href` in each page resolves to a file under `site/`.

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test tests/site-structure.test.js
```

Expected: FAIL with missing `site/index.html`.

- [ ] **Step 4: Extract the shared CSS and JavaScript**

Move the contents inside `<style>` from `style.html` to `site/assets/css/style.css`. Move shared helpers from `script.html` to `site/assets/js/common.js`, retaining `showToast`, `closeModal`, `fixDriveUrl`, `getTeacherToken`, `clearTeacherToken`, and `handleUnauthorized` without surrounding `<script>` tags.

- [ ] **Step 5: Create static public and teacher pages**

Copy the markup from the current pages, replace `<?!= include('style'); ?>` with stylesheet links, remove Apps Script template expressions, and replace the inline application scripts with:

```html
<script src="assets/js/config.js"></script>
<script src="assets/js/api.js"></script>
<script src="assets/js/common.js"></script>
<script src="assets/js/index.js"></script>
```

Use `teacher.js` instead of `index.js` on the teacher page. Keep Chart.js and xlsx-js-style CDN dependencies on the teacher page.

- [ ] **Step 6: Extract teacher-only CSS and page logic**

Move teacher-specific `<style>` contents to `site/assets/css/teacher.css`. Move public inline script to `site/assets/js/index.js` and teacher inline script to `site/assets/js/teacher.js`. At this stage preserve the call sites exactly; the test remains RED because `google.script.run` still exists.

- [ ] **Step 7: Protect Apps Script upload boundaries**

Update `.claspignore` so `site/`, `.github/`, `tests/`, `docs/`, README files, and Git metadata are excluded while the Apps Script files remain included.

- [ ] **Step 8: Commit the structural extraction**

Run:

```powershell
git add site .claspignore tests/site-structure.test.js docs/superpowers/plans/2026-09-03-github-pages-apps-script-api.md
git commit -m "refactor: extract static GitHub Pages frontend"
```

---

### Task 2: Implement the Apps Script JSON router

**Files:**
- Create: `Api.gs`
- Modify: `code.gs`
- Create: `tests/api-router.test.js`
- Modify: `.claspignore`

**Interfaces:**
- Consumes: existing backend functions such as `getAllData()`, `createTeacherSession(password)`, and token-first teacher operations
- Produces: `doGet(e): TextOutput`, `doPost(e): TextOutput`, `routeApiRequest_(method, request): ApiEnvelope`, `jsonResponse_(envelope): TextOutput`

- [ ] **Step 1: Write failing router behavior tests**

Build a VM test harness with fake `ContentService.createTextOutput()` returning an object that records text and MIME type. Assert literal results for:

```js
routeApiRequest_('GET', { action: 'health' })
// { ok: true, data: { service: 'classroom-lms-api', version: 1 } }

routeApiRequest_('GET', { action: 'unknown' })
// { ok: false, error: { code: 'NOT_FOUND', message: 'ไม่พบ API action' } }
```

Stub public and teacher delegates and assert the router passes only the expected payload/token arguments. Assert malformed POST JSON returns `INVALID_JSON` and an unexpected method returns `METHOD_NOT_ALLOWED`.

- [ ] **Step 2: Run router tests and verify RED**

Run:

```powershell
node --test tests/api-router.test.js
```

Expected: FAIL because `routeApiRequest_` does not exist.

- [ ] **Step 3: Implement the response envelope helpers**

Add:

```js
function apiSuccess_(data) {
  return { ok: true, data: data === undefined ? null : data };
}

function apiError_(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 4: Implement explicit public and teacher route maps**

Create two object literals whose values are functions, not user-controlled names. Public GET includes `health`, `publicData`, and `dailyMinigame`. Public POST includes `login` and `claimMinigame`. Teacher POST contains every action listed in the approved spec and calls `requireTeacherSession(token)` before its delegate.

- [ ] **Step 5: Implement `doGet` and `doPost`**

`doGet(e)` normalizes `e.parameter`, while `doPost(e)` parses `e.postData.contents`. Both call `routeApiRequest_` inside `try/catch`. Map `UNAUTHORIZED` to the safe Thai message and map all other exceptions to `INTERNAL_ERROR` without exposing `e.stack` or `e.message` to the client.

- [ ] **Step 6: Remove HTML routing from production `doGet`**

Rename the former HTML handler to `renderLegacyHtml_(e)` and do not expose it through the new API route. Keep its implementation in source only for rollback until the Pages deployment is verified.

- [ ] **Step 7: Run router and existing tests**

Run:

```powershell
node --test tests/*.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit the API router**

Run:

```powershell
git add Api.gs code.gs .claspignore tests/api-router.test.js
git commit -m "feat: expose allowlisted Apps Script JSON API"
```

---

### Task 3: Build the browser API client

**Files:**
- Create: `site/assets/js/api.js`
- Modify: `site/assets/js/config.js`
- Create: `tests/browser-api.test.js`

**Interfaces:**
- Consumes: `window.APP_CONFIG.API_URL`, browser `fetch`, `sessionStorage`
- Produces: `window.classroomApi` with `get(action, params)`, `post(action, payload, options)`, `getPublicData()`, `getDailyMinigame()`, `login(password)`, `teacher(action, payload)`, `claimMinigame(payload)`, and `logout()`

- [ ] **Step 1: Write failing API client tests**

Execute `api.js` in a VM with a real fake `fetch` function that captures URL/options and returns controlled Response-like objects. Test:

- GET adds `action` and public parameters but never a token.
- POST uses exact header `Content-Type: text/plain;charset=utf-8`.
- POST body is JSON containing `action`, `payload`, and token only for teacher calls.
- A `{ok:false}` response throws an error carrying its API code.
- Timeout aborts the fetch and returns code `TIMEOUT`.
- Non-JSON response returns code `INVALID_RESPONSE`.

- [ ] **Step 2: Run the client tests and verify RED**

Run:

```powershell
node --test tests/browser-api.test.js
```

Expected: FAIL because `site/assets/js/api.js` does not yet implement the API.

- [ ] **Step 3: Implement config and request core**

Set `window.APP_CONFIG` with the current Apps Script `/exec` API URL and a 25,000 ms timeout. Implement one private request function using `AbortController`, `redirect: 'follow'`, JSON parsing, and normalized errors.

- [ ] **Step 4: Implement named API methods**

Expose only the named methods in the interface block. `teacher()` reads `teacher_session` from `sessionStorage`, rejects locally if missing, and never places the token in a query string.

- [ ] **Step 5: Run client tests and verify GREEN**

Run:

```powershell
node --test tests/browser-api.test.js
```

Expected: all browser API tests pass.

- [ ] **Step 6: Commit the API client**

Run:

```powershell
git add site/assets/js/config.js site/assets/js/api.js tests/browser-api.test.js
git commit -m "feat: add GitHub Pages API client"
```

---

### Task 4: Migrate the public scoreboard to HTTP API

**Files:**
- Modify: `site/assets/js/index.js`
- Modify: `site/index.html`
- Create: `tests/public-page.test.js`

**Interfaces:**
- Consumes: `classroomApi.getPublicData()`, `classroomApi.getDailyMinigame()`, `classroomApi.claimMinigame(payload)`, `classroomApi.login(password)`
- Produces: public scoreboard and minigame behavior without Apps Script globals

- [ ] **Step 1: Write failing public-page integration tests**

Run `index.js` in JSDOM or a minimal DOM fixture with a fake `classroomApi`. Assert `init()` renders supplied students, API rejection renders the retry state, login stores only the returned token, and the minigame claim passes `{questionId, chosenAnswer, studentCode}`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test tests/public-page.test.js
```

Expected: FAIL because the script still references `google.script.run`.

- [ ] **Step 3: Replace public data loading**

Convert `init()` to `async`, call `classroomApi.getPublicData()`, preserve the existing 25-second failure UI, and call existing `renderPage(data)` with the API `data` payload.

- [ ] **Step 4: Replace login and navigation**

Call `classroomApi.login(password)`, store the returned token through the API client, and navigate with `new URL('teacher.html', window.location.href)`. Do not use Apps Script URL helpers.

- [ ] **Step 5: Replace minigame calls**

Use the named API methods for daily question and claim. Preserve the current busy, claimed, wrong-answer, and student-not-found messages by mapping API error codes.

- [ ] **Step 6: Add safe DOM rendering**

Route every student, assignment, school, class, and minigame string through `escapeHtml()` when constructing HTML. Keep URLs out of `innerHTML` attributes unless normalized by an allowlisted `https:` URL helper.

- [ ] **Step 7: Run tests and verify no Apps Script dependency remains**

Run:

```powershell
node --test tests/public-page.test.js tests/site-structure.test.js
rg -n "google\.script|<\?" site/index.html site/assets/js/index.js
```

Expected: tests pass and ripgrep returns no matches.

- [ ] **Step 8: Commit the public migration**

Run:

```powershell
git add site/index.html site/assets/js/index.js tests/public-page.test.js tests/site-structure.test.js
git commit -m "feat: migrate public scoreboard to HTTP API"
```

---

### Task 5: Migrate the teacher console to HTTP API

**Files:**
- Modify: `site/assets/js/teacher.js`
- Modify: `site/teacher.html`
- Create: `tests/teacher-page.test.js`

**Interfaces:**
- Consumes: `classroomApi.login`, `classroomApi.teacher`, `classroomApi.logout`
- Produces: all six teacher tabs using authenticated HTTP actions

- [ ] **Step 1: Write failing teacher auth tests**

With a DOM fixture and fake `classroomApi`, assert login hides the overlay after success, a stored token triggers `teacherDataFast`, `UNAUTHORIZED` clears the token and restores the overlay, and logout clears browser/server session before navigating to `index.html`.

- [ ] **Step 2: Run auth tests and verify RED**

Run:

```powershell
node --test tests/teacher-page.test.js
```

Expected: FAIL because teacher logic still uses `google.script.run`.

- [ ] **Step 3: Replace authentication and aggregate reads**

Convert `doAuth`, startup restore, `loadTeacherData`, `loadMinigameData`, and `reloadFullData` to async functions using named API methods. Centralize `UNAUTHORIZED` handling in one function.

- [ ] **Step 4: Replace score and student actions**

Replace save score, student CRUD, import, restore, deactivate, and photo upload calls with `classroomApi.teacher(action, payload)`. Preserve button loading states and reload only the affected data.

- [ ] **Step 5: Replace assignment and indicator actions**

Replace assignment CRUD, indicator CRUD, and indicator export fetches. Use explicit action strings selected by existing edit/add state; never pass a client-generated function name to the backend.

- [ ] **Step 6: Replace minigame and settings actions**

Replace question CRUD, toggle, reset, unblock, report refresh, and each setting write. Implement `changeTeacherPassword` so success logs out and returns the user to the login overlay.

- [ ] **Step 7: Add behavioral tests for representative mutations**

Assert literal request payloads for one student add, one score batch, one assignment update, one indicator delete, one minigame reset, and one setting update. A wrong action or missing field must make the corresponding test fail.

- [ ] **Step 8: Run tests and source audit**

Run:

```powershell
node --test tests/teacher-page.test.js tests/site-structure.test.js
rg -n "google\.script|<\?|webAppUrl" site/teacher.html site/assets/js/teacher.js
```

Expected: tests pass and ripgrep returns no matches.

- [ ] **Step 9: Commit the teacher migration**

Run:

```powershell
git add site/teacher.html site/assets/js/teacher.js tests/teacher-page.test.js
git commit -m "feat: migrate teacher console to HTTP API"
```

---

### Task 6: Harden API validation and write concurrency

**Files:**
- Create: `Validation.gs`
- Modify: `Api.gs`
- Modify: `code.gs`
- Create: `tests/validation.test.js`

**Interfaces:**
- Consumes: normalized API payloads and existing Sheet operations
- Produces: `validateStudent_`, `validateAssignment_`, `validateScore_`, `validateImport_`, `validatePhoto_`, locked batch writes, safe public DTOs

- [ ] **Step 1: Write failing validation tests**

Use literal fixtures to test empty/oversized names, duplicate student code, non-finite/negative/over-max scores, nonexistent relation IDs, imports over 500 rows, invalid Base64 size, and disallowed photo MIME types. Test that public student DTOs exclude internal fields and full student codes.

- [ ] **Step 2: Run validation tests and verify RED**

Run:

```powershell
node --test tests/validation.test.js
```

Expected: FAIL because validation helpers do not exist.

- [ ] **Step 3: Implement validators**

Return `{ok:true, value}` or `{ok:false, code, message}` from each validator. Limits are: names 100 characters, class 50, assignment title 200, description 2,000, minigame question 1,000, import 500 rows, and decoded photo 5 MB.

- [ ] **Step 4: Enforce validation in routes before delegates**

Each route validates and normalizes payloads before calling data operations. Reject unknown object keys for auth and destructive actions. Validate relation IDs against current Sheets before write.

- [ ] **Step 5: Lock ID allocation and batch writes**

Use `LockService.getScriptLock().tryLock(10000)` with `finally { lock.releaseLock(); }` around ID plus append, score batch, import, and minigame claim. Return `BUSY` on lock timeout and per-item results for batch failures.

- [ ] **Step 6: Restrict public DTOs**

Return only fields required by the public UI. Replace `student_code` with a masked form outside the claim endpoint and omit internal status/timestamps that the page does not render.

- [ ] **Step 7: Run the complete local suite**

Run:

```powershell
node --test tests/*.test.js
```

Expected: all tests pass with zero failures.

- [ ] **Step 8: Commit API hardening**

Run:

```powershell
git add Validation.gs Api.gs code.gs tests/validation.test.js
git commit -m "feat: validate and lock classroom API writes"
```

---

### Task 7: Deploy the API and prove cross-origin transport

**Files:**
- Modify: `site/assets/js/config.js`
- Modify: `README.md`
- Modify remotely: Apps Script version and deployment

**Interfaces:**
- Consumes: tested Apps Script source and browser API client
- Produces: versioned `/exec` API URL verified from a non-Google origin

- [ ] **Step 1: Run pre-deploy verification**

Run:

```powershell
node --test tests/*.test.js
clasp -u krutrit status
git diff --check
```

Expected: all tests pass; clasp tracks only Apps Script files; no whitespace errors.

- [ ] **Step 2: Push and create an immutable version**

Run:

```powershell
clasp -u krutrit push --force
clasp -u krutrit version "GitHub Pages JSON API"
clasp -u krutrit deploy --description "GitHub Pages JSON API"
clasp -u krutrit deployments
```

Record the new deployment ID and construct its `/exec` URL.

- [ ] **Step 3: Test public API responses**

From an unauthenticated HTTP client, request `?action=health`, `?action=publicData`, and `?action=dailyMinigame`. Assert status 200, JSON MIME-compatible content, `ok:true`, and no password/token fields.

- [ ] **Step 4: Test simple POST and redirect behavior from a browser origin**

Serve `site/` locally with `npx http-server site` or the bundled Node equivalent, open the local page, and call `login` with an invalid password. Expected: browser receives a readable JSON `INVALID_CREDENTIALS` response rather than a CORS or parse error.

- [ ] **Step 5: Update frontend configuration**

Set `APP_CONFIG.API_URL` to the verified new `/exec` URL and document it in README. Never include a session token or password.

- [ ] **Step 6: Commit verified API configuration**

Run:

```powershell
git add site/assets/js/config.js README.md
git commit -m "chore: configure production Apps Script API"
```

---

### Task 8: Configure and deploy GitHub Pages

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`
- Modify remotely: GitHub Pages settings/environment

**Interfaces:**
- Consumes: self-contained `site/` and public repository `krutrit/classroom-lms`
- Produces: `https://krutrit.github.io/classroom-lms/`

- [ ] **Step 1: Create the Pages workflow**

Use `actions/checkout@v6`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v4`, and `actions/deploy-pages@v4`. Set permissions `contents: read`, `pages: write`, and `id-token: write`. Upload only `site/`.

- [ ] **Step 2: Validate workflow and artifact boundary**

Parse the YAML and assert upload path is exactly `site`. Verify no `.clasp.json`, Apps Script source, tests, docs, or credentials exist below `site/`.

- [ ] **Step 3: Run all local tests**

Run:

```powershell
node --test tests/*.test.js
git diff --check
```

Expected: all tests pass and no whitespace errors.

- [ ] **Step 4: Commit and push the feature branch**

Run:

```powershell
git add .github/workflows/pages.yml README.md
git commit -m "ci: deploy classroom LMS to GitHub Pages"
git push -u origin feat/github-pages-api
```

- [ ] **Step 5: Review and merge into main**

Inspect the branch diff, confirm no secret/config leak, then merge the reviewed branch into `main` and push. Do not force-push.

- [ ] **Step 6: Enable GitHub Pages with Actions**

Use GitHub repository settings or `gh api` to select GitHub Actions as the Pages source. Wait for the workflow with:

```powershell
gh run list --workflow pages.yml --limit 1
gh run watch --exit-status
```

Expected: workflow completes successfully and exposes `https://krutrit.github.io/classroom-lms/`.

- [ ] **Step 7: Update README with the Pages URL**

Make GitHub Pages the primary “เปิดระบบ” link and label the old Apps Script HTML URL as fallback. Commit and push the documentation update.

---

### Task 9: Perform live end-to-end verification and handoff

**Files:**
- Inspect: deployed GitHub Pages, Apps Script API, Google Sheet, GitHub Actions
- Modify: `README.md` only if verification reveals documentation corrections

**Interfaces:**
- Consumes: live Pages URL, live API URL, owner access to Sheet
- Produces: verified production links and rollback evidence

- [ ] **Step 1: Verify anonymous public page**

Open `https://krutrit.github.io/classroom-lms/` in a signed-out context. Confirm HTTP 200, school title, student empty/data state, class filter, search, and minigame status render without CORS errors.

- [ ] **Step 2: Verify teacher authentication**

Set the initial password through the owner-only setup flow if it is not set. Open `teacher.html`, verify invalid password rejection, valid login, refresh persistence, logout, and expired/invalid token recovery.

- [ ] **Step 3: Verify representative writes**

Create one uniquely named verification student, assignment, indicator, score, and minigame question. Confirm each record appears in the correct Sheet and frontend view.

- [ ] **Step 4: Verify reports and media**

Open report tab, export XLSX, open PDF print view, and upload a small permitted test image. Confirm links and generated files work from the GitHub Pages origin.

- [ ] **Step 5: Verify mobile layout**

Test public and teacher pages at 390×844. Confirm navigation, score table, dialogs, login, forms, and floating controls remain usable without horizontal page loss.

- [ ] **Step 6: Clean verification records safely**

Deactivate only the verification student and assignment using their exact IDs. Delete only the verification indicator/question when no linked active record remains. Do not modify pre-existing data.

- [ ] **Step 7: Verify repository and deployment state**

Run:

```powershell
node --test tests/*.test.js
git status --short
git log -1 --oneline
gh repo view --json nameWithOwner,visibility,url,defaultBranchRef
gh run list --workflow pages.yml --limit 1
clasp -u krutrit deployments
```

Expected: zero failed tests, clean tree, public repository on `main`, successful Pages workflow, and both API plus fallback deployments listed.

- [ ] **Step 8: Deliver links and rollback instructions**

Provide the GitHub Pages public URL, teacher URL, GitHub repository, Spreadsheet, Apps Script editor, API endpoint, passing test count, workflow run, Apps Script deployment ID, and the exact rollback commands. Never include the teacher password or session token.

