# Classroom LMS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing classroom LMS to a public GitHub repository named `classroom-lms`, create a new container-bound Google Sheet/Apps Script project, secure teacher mutations with server-side sessions, and deploy a publicly readable Web App.

**Architecture:** GitHub stores sanitized source and documentation while Google Apps Script HTML Service hosts the application. A container-bound Google Sheet stores the seven application tables; public functions serve the scoreboard and minigame, while teacher reads and every mutation require a short-lived token stored server-side in CacheService.

**Tech Stack:** Google Apps Script V8, Google Sheets, Google Drive, HTML/CSS/JavaScript, `google.script.run`, `clasp`, Git/GitHub CLI, Node.js static tests

**Spec:** `docs/superpowers/specs/2026-09-03-classroom-lms-deployment-design.md`

## Global Constraints

- GitHub repository name is exactly `classroom-lms`, visibility `public`, default branch `main`.
- Web App access is `ANYONE_ANONYMOUS` and executes as the deploying user.
- Spreadsheet and Apps Script project are newly created and container-bound.
- Timezone is exactly `Asia/Bangkok`; runtime is V8.
- Never commit `.clasp.json`, `.clasprc.json`, passwords, tokens, student data, or exported spreadsheets.
- Never pass a teacher password or session token in a URL.
- Store only a salted password hash in Script Properties; session tokens live in CacheService and browser `sessionStorage`.
- Public access is limited to scoreboard data and the required minigame flow.
- Every teacher-only read and every mutation validates a server-side session token.
- The Google Sheet contains exactly the seven application sheets defined in the spec, plus no sample student data.

---

### Task 1: Initialize and sanitize the local repository

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `appsscript.json`
- Create: `tests/security-contract.test.js`
- Modify: none

**Interfaces:**
- Consumes: existing `code.gs`, `index.html`, `teacher.html`, `style.html`, `script.html`, `SYSTEM_OVERVIEW.md`
- Produces: a local `main` branch, a safe ignore policy, Apps Script manifest, and executable security-contract test

- [ ] **Step 1: Initialize Git and create the main branch**

Run:

```powershell
git init -b main
git status --short
```

Expected: Git initializes successfully and lists the existing source as untracked.

- [ ] **Step 2: Create `.gitignore`**

Create the exact rules:

```gitignore
.clasp.json
.clasprc.json
.env
.env.*
!.env.example
node_modules/
coverage/
*.log
*.xlsx
*.xls
*.csv
*.tsv
student_photos/
```

- [ ] **Step 3: Create `appsscript.json`**

Use this manifest:

```json
{
  "timeZone": "Asia/Bangkok",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

- [ ] **Step 4: Write the initial security-contract test**

Create `tests/security-contract.test.js` using `node:test`. It must read `code.gs`, `index.html`, and `teacher.html`, then assert:

```js
assert.equal(/\?page=teacher&pw=/.test(indexHtml), false);
assert.match(server, /function createTeacherSession\(password\)/);
assert.match(server, /function requireTeacherSession\(token\)/);
assert.match(server, /function logoutTeacher\(token\)/);
assert.equal(/teacher_password/.test(server), false);
assert.match(teacherHtml, /sessionStorage\.setItem\('teacher_session'/);
assert.equal(/[?&]pw=/.test(teacherHtml), false);
```

Also define a mutation list containing `updateSetting`, `addStudent`, `updateStudent`, `deleteStudent`, `restoreStudent`, `importStudents`, `addAssignment`, `updateAssignment`, `deleteAssignment`, `restoreAssignment`, `saveScore`, `saveAllScores`, `uploadStudentPhoto`, `addIndicator`, `updateIndicator`, `deleteIndicator`, `addMinigameQuestion`, `updateMinigameQuestion`, `toggleMinigameQuestion`, `deleteMinigameQuestion`, `unblockMinigame`, and `resetMinigameQuestion`. For every name, extract its function body and assert that it calls `requireTeacherSession(token)`.

- [ ] **Step 5: Run the test and confirm the expected failure**

Run:

```powershell
node --test tests/security-contract.test.js
```

Expected: FAIL because the old password-in-URL flow and unprotected mutations still exist.

- [ ] **Step 6: Draft `README.md` without live URLs**

Document the architecture, features, seven sheet schemas, privacy warning, prerequisites (`git`, `gh`, `clasp`), local update commands, and placeholders expressed as labels—not fake URLs—for “GitHub repository,” “Spreadsheet,” “Apps Script editor,” and “Web App.” State that `.clasp.json` stays local.

- [ ] **Step 7: Commit the baseline and deployment design**

Run:

```powershell
git add .gitignore README.md appsscript.json tests/security-contract.test.js code.gs index.html teacher.html style.html script.html SYSTEM_OVERVIEW.md docs
git commit -m "chore: prepare classroom LMS deployment"
```

Expected: one commit on `main`, with `.clasp.json` absent.

---

### Task 2: Add server-side teacher authentication

**Files:**
- Modify: `code.gs`
- Modify: `tests/security-contract.test.js`

**Interfaces:**
- Consumes: `CacheService`, `PropertiesService`, `Utilities.computeDigest`, `Utilities.getUuid`
- Produces: `setupTeacherPassword(password): {success:boolean}`, `createTeacherSession(password): {success:boolean, token?:string, expires_in?:number, reason?:string}`, `requireTeacherSession(token): true`, `logoutTeacher(token): {success:boolean}`

- [ ] **Step 1: Extend the failing tests for secrets and rate limiting**

Add assertions that `code.gs` contains:

```js
assert.match(server, /TEACHER_PASSWORD_HASH/);
assert.match(server, /TEACHER_PASSWORD_SALT/);
assert.match(server, /LOGIN_ATTEMPTS_/);
assert.match(server, /Utilities\.computeDigest/);
assert.match(server, /CacheService\.getScriptCache/);
```

Run `node --test tests/security-contract.test.js` and confirm these assertions fail.

- [ ] **Step 2: Implement password hashing and session helpers**

Add constants and helpers to `code.gs`:

```js
var AUTH_SESSION_TTL_SECONDS = 21600;
var AUTH_MAX_ATTEMPTS = 5;
var AUTH_ATTEMPT_WINDOW_SECONDS = 300;

function hashTeacherPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function setupTeacherPassword(password) {
  if (!password || String(password).length < 10) {
    return { success: false, reason: 'PASSWORD_TOO_SHORT' };
  }
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid() + Utilities.getUuid();
  props.setProperties({
    TEACHER_PASSWORD_SALT: salt,
    TEACHER_PASSWORD_HASH: hashTeacherPassword_(password, salt)
  }, false);
  return { success: true };
}
```

Implement `createTeacherSession(password)` to enforce five attempts per five minutes, compare hashes in constant-shape string iteration, generate a UUID-based token, cache `teacher_session_<token>` for 21,600 seconds, and return `{success:true, token:token, expires_in:21600}`. Implement `requireTeacherSession(token)` to throw `Error('UNAUTHORIZED')` when the cache key is absent. Implement `logoutTeacher(token)` to remove the cache key.

- [ ] **Step 3: Protect teacher-only aggregate reads**

Change signatures and require the token at the beginning:

```js
function getTeacherDataFast(token)
function getMinigameData(token)
function getTeacherData(token)
function exportScoresByIndicator(token, filterClass)
```

Each function must call `requireTeacherSession(token)` before reading data.

- [ ] **Step 4: Protect every mutation**

Add `token` as the first parameter to every mutation listed in Task 1 and call `requireTeacherSession(token)` as its first executable statement. Internal calls must pass the already validated token, including `saveAllScores(token, scoresArray)` calling `saveScore(token, ...)`.

- [ ] **Step 5: Add locks and truthful batch results**

Wrap ID allocation plus append operations with `LockService.getScriptLock()`. Change `saveAllScores` and `importStudents` to validate arrays, collect item results, return `{success:false, results:[...]}` if any item fails, and release locks in `finally` blocks.

- [ ] **Step 6: Remove legacy password storage**

Delete `checkTeacherPassword`. Reject `updateSetting(token, 'teacher_password', value)` with `{success:false, reason:'PROTECTED_SETTING'}`. Keep `setupTeacherPassword` as a manual owner-only setup function and document that it must not be exposed in the UI.

- [ ] **Step 7: Run the security contract**

Run:

```powershell
node --test tests/security-contract.test.js
```

Expected: PASS with zero failed tests.

- [ ] **Step 8: Commit server authentication**

Run:

```powershell
git add code.gs tests/security-contract.test.js
git commit -m "feat: secure teacher operations with server sessions"
```

---

### Task 3: Update both frontends for token authentication

**Files:**
- Modify: `index.html`
- Modify: `teacher.html`
- Modify: `script.html`
- Modify: `tests/security-contract.test.js`

**Interfaces:**
- Consumes: `createTeacherSession(password)`, `logoutTeacher(token)`, token-first protected backend functions
- Produces: `getTeacherToken(): string`, `handleUnauthorized(error): boolean`, URL-safe teacher navigation, authenticated `google.script.run` calls

- [ ] **Step 1: Add failing frontend contract assertions**

Assert that:

```js
assert.match(indexHtml, /createTeacherSession\(pw\)/);
assert.match(indexHtml, /\?page=teacher/);
assert.equal(/\?page=teacher&pw=/.test(indexHtml), false);
assert.match(teacherHtml, /function getTeacherToken\(\)/);
assert.match(teacherHtml, /function handleUnauthorized\(err\)/);
assert.equal(/checkTeacherPassword/.test(indexHtml + teacherHtml), false);
```

Run the test and confirm failure before editing the pages.

- [ ] **Step 2: Replace the public-page login flow**

Change `doLogin()` in `index.html` to call `createTeacherSession(pw)`. On success, store `res.token` in `sessionStorage` under `teacher_session`, clear the password input, and navigate only to `<?= webAppUrl ?>?page=teacher`.

- [ ] **Step 3: Replace teacher-page startup authentication**

Remove all reading of `pw` from `google.script.url.getLocation`. On load, read `sessionStorage.getItem('teacher_session')`; if absent show the auth form. If present, call `getTeacherDataFast(token)` and show the auth form when the server returns `UNAUTHORIZED`.

- [ ] **Step 4: Add shared frontend auth helpers**

Add to `script.html`:

```js
function getTeacherToken() {
  return sessionStorage.getItem('teacher_session') || '';
}

function clearTeacherToken() {
  sessionStorage.removeItem('teacher_session');
}

function handleUnauthorized(err) {
  if (String(err && err.message || err).includes('UNAUTHORIZED')) {
    clearTeacherToken();
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Pass the token to all protected calls**

Update every teacher-side `google.script.run` call to pass `getTeacherToken()` as the first argument. Ensure dynamic calls such as `google.script.run[fn](...)` also receive the token. On authorization failure, clear the token and reopen the login overlay.

- [ ] **Step 6: Replace password-change settings**

Remove the `teacher_password` call through `updateSetting`. Add a protected backend function `changeTeacherPassword(token, currentPassword, newPassword)` that verifies the current password, requires at least 10 characters for the new password, rotates salt/hash, invalidates the current session, and returns `{success:true, requires_login:true}`. Update the settings UI to request current and new passwords and return to login after success.

- [ ] **Step 7: Add logout behavior**

Add a teacher-page logout button that calls `logoutTeacher(getTeacherToken())`, clears session storage, and navigates to the public page even if the server call fails.

- [ ] **Step 8: Run static tests and review every server invocation**

Run:

```powershell
node --test tests/security-contract.test.js
rg -n "google\.script\.run|checkTeacherPassword|[?&]pw=" index.html teacher.html
```

Expected: tests pass; no legacy password call or password query parameter remains; every protected invocation includes the token.

- [ ] **Step 9: Commit frontend authentication**

Run:

```powershell
git add index.html teacher.html script.html code.gs tests/security-contract.test.js
git commit -m "feat: use secure teacher sessions in the web UI"
```

---

### Task 4: Add idempotent database setup and deployment documentation

**Files:**
- Modify: `code.gs`
- Modify: `README.md`
- Create: `tests/schema-contract.test.js`

**Interfaces:**
- Consumes: `getOrCreateSheet(name, headers)`, `updateSetting(key, value)` internal storage behavior
- Produces: `setupDatabase(): {success:boolean, sheets:string[]}`, verified seven-sheet schema, complete operator documentation

- [ ] **Step 1: Write a failing schema-contract test**

Create a Node test that reads `code.gs` and asserts exact header sequences for all seven sheets and the existence of `function setupDatabase()`. Assert the function includes `school_name`, `minigame_enabled`, `mg_interval_days`, and `report_enabled` defaults but not `teacher_password`.

- [ ] **Step 2: Run the schema test and confirm failure**

Run:

```powershell
node --test tests/schema-contract.test.js
```

Expected: FAIL because `setupDatabase()` does not exist.

- [ ] **Step 3: Implement idempotent setup**

Add `setupDatabase()` that calls the existing sheet helpers with the exact schemas from `SYSTEM_OVERVIEW.md`, inserts only missing setting keys, calls `getOrCreatePhotoFolder()`, and returns all created/found sheet names. It must be safe to run repeatedly without duplicating headers or values.

- [ ] **Step 4: Complete README operations guide**

Document these exact operator flows:

```powershell
clasp push
clasp version "describe the release"
clasp deploy --description "describe the release"
```

Also document one-time `setupDatabase()`, one-time `setupTeacherPassword('a-long-password')`, how to revoke/change the password, Web App access/privacy implications, how to find deployment IDs, and how to roll back with `clasp versions` plus a selected deployment version.

- [ ] **Step 5: Run both local test files**

Run:

```powershell
node --test tests/*.test.js
```

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit schema setup and documentation**

Run:

```powershell
git add code.gs README.md tests/schema-contract.test.js
git commit -m "feat: add repeatable classroom database setup"
```

---

### Task 5: Create the Google Sheet and container-bound Apps Script project

**Files:**
- Create locally but ignore: `.clasp.json`
- Modify remotely: new Google Spreadsheet and Apps Script project

**Interfaces:**
- Consumes: authenticated `clasp`, local Apps Script source and manifest
- Produces: local script binding, Spreadsheet URL, Apps Script project URL

- [ ] **Step 1: Verify Google authentication without printing credentials**

Run:

```powershell
clasp login --status
```

Expected: logged-in account is reported. If authorization is required, run `clasp login` and let the user approve in Google.

- [ ] **Step 2: Create the Sheet-bound project**

Run from the project directory:

```powershell
clasp create --type sheets --title "classroom-lms" --rootDir .
```

Expected: Google creates a new Spreadsheet and bound Apps Script project; `.clasp.json` contains the script ID locally.

- [ ] **Step 3: Verify the binding is ignored and inspect project metadata safely**

Run:

```powershell
git check-ignore .clasp.json
clasp open --webapp
```

Expected: Git reports `.clasp.json` ignored. If no Web App exists yet, use `clasp open` to confirm the Apps Script project instead.

- [ ] **Step 4: Push source to Apps Script**

Run:

```powershell
clasp push --force
clasp status
```

Expected: all six Apps Script files upload, while README, tests, docs, Git metadata, and local config do not become Apps Script source. If `rootDir .` exposes non-script files, add a `.claspignore` containing explicit exclusions before repeating the push.

- [ ] **Step 5: Run setup functions in the Apps Script editor**

Open the project, run `setupDatabase()`, approve Spreadsheet/Drive scopes, then run `setupTeacherPassword()` with a user-provided password of at least 10 characters. Never paste or record that password in source, terminal output, README, plan, or Git.

- [ ] **Step 6: Verify the remote database**

Open the Spreadsheet and confirm all seven sheets, exact headers, four non-secret settings, no sample students, and the `student_photos` folder. Record the Spreadsheet and Apps Script editor URLs for handoff without committing owner-only URLs if the user prefers them private.

---

### Task 6: Deploy and test the Apps Script Web App

**Files:**
- Modify remotely: Apps Script version and deployment
- Modify: `README.md` only for the public Web App URL

**Interfaces:**
- Consumes: pushed Apps Script project and initialized database
- Produces: versioned public Web App deployment URL

- [ ] **Step 1: Create a version and deployment**

Run:

```powershell
clasp version "Initial secure classroom LMS deployment"
clasp deploy --description "Initial public classroom LMS"
clasp deployments
```

Expected: a deployment ID and `/exec` Web App URL are reported.

- [ ] **Step 2: Verify anonymous public access**

Open the `/exec` URL in a signed-out/incognito browser. Confirm HTTP success, the scoreboard loads, and no Google login is required.

- [ ] **Step 3: Verify unauthorized mutation rejection**

From the app context, attempt one protected call with an empty token, such as `getTeacherDataFast('')`. Expected: `UNAUTHORIZED`, no student or setting data changes.

- [ ] **Step 4: Verify the teacher workflow**

Log in with the configured password, change `school_name`, add one temporary student and one assignment, save a score, and confirm the values in Google Sheets and on the public page.

- [ ] **Step 5: Verify cleanup behavior**

Deactivate the temporary student and assignment through the UI; confirm historical score rows remain while public active lists omit the records. Do not delete unrelated data.

- [ ] **Step 6: Verify minigame and reports**

Create a temporary minigame question, open the minigame/report tabs, export one XLSX report, and confirm no authorization failure. Delete the temporary question and local exported XLSX after verification.

- [ ] **Step 7: Record the public URL**

Replace the README “Web App” label with the actual `/exec` URL. Do not add passwords, tokens, Script Properties, `.clasp.json`, or student records.

- [ ] **Step 8: Commit the verified deployment URL**

Run:

```powershell
git add README.md
git commit -m "docs: add deployed classroom LMS URL"
```

---

### Task 7: Publish to GitHub and perform final audit

**Files:**
- Inspect: all tracked files and Git history
- Modify remotely: GitHub repository `classroom-lms`

**Interfaces:**
- Consumes: verified local `main` branch, GitHub CLI authentication
- Produces: public GitHub repository URL and final verification report

- [ ] **Step 1: Audit tracked files and likely secrets**

Run:

```powershell
git status --short
git ls-files
git grep -n -I -E "(scriptId|TEACHER_PASSWORD_HASH|TEACHER_PASSWORD_SALT|teacher_password|AIza|ya29\.|ghp_|github_pat_)"
```

Expected: working tree is clean; `.clasp.json` and credentials are absent; matches are limited to non-secret documentation/test references that do not contain values.

- [ ] **Step 2: Run the complete local verification suite**

Run:

```powershell
node --test tests/*.test.js
git diff --check
```

Expected: all tests pass and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Authenticate GitHub**

Run:

```powershell
gh auth status
```

If not logged in, run `gh auth login --web --git-protocol https` and let the user approve the browser authorization.

- [ ] **Step 4: Create and push the public repository**

Run:

```powershell
gh repo create classroom-lms --public --source . --remote origin --push
```

Expected: GitHub creates the repository under the authenticated account and pushes `main`.

- [ ] **Step 5: Verify GitHub visibility and remote state**

Run:

```powershell
gh repo view --json nameWithOwner,visibility,url,defaultBranchRef
git remote -v
git status --short
```

Expected: name ends with `/classroom-lms`, visibility is `PUBLIC`, default branch is `main`, origin points to the new repository, and the worktree is clean.

- [ ] **Step 6: Perform final live smoke test**

Open the README repository link and the Web App `/exec` link. Confirm repository files render, anonymous scoreboard access works, teacher login works, and the Spreadsheet contains the saved verification data only as expected.

- [ ] **Step 7: Deliver the resources and evidence**

Provide the GitHub URL, Spreadsheet URL, Apps Script editor URL, Web App URL, test counts, deployed version/deployment ID, privacy warning, and exact command for future updates. Do not include the teacher password or any token.

