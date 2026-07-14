# Login Identity Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the login identity fields and use active identity-library records to populate the school selector and automatically resolve a student's or teacher's major.

**Architecture:** Add two narrow, read-only queries to `student-store`, expose them through rate-limited public authentication endpoints, and connect the existing login form with abortable dependent lookups. Keep final authentication unchanged: school, major, account number, and phone are still verified by the existing login endpoints.

**Tech Stack:** Node.js 22, CommonJS, native `node:test`, MySQL 8-compatible SQL through `mysql2`, plain JavaScript SPA, existing CSS release-asset workflow.

## Global Constraints

- The field order is school, student number/work number, major, phone.
- Schools come from active identity-library records and are filtered by student/teacher login mode.
- A major lookup returns no name, phone, class, college, role, or internal identifier.
- Existing SMS, password, legal-consent, and guest-login behavior must remain unchanged.
- MySQL and in-memory development modes must expose the same behavior.
- No new runtime dependency is allowed.
- When identity lookup is unavailable, the form must remain usable through manual school and major entry.

---

## File Structure

- Modify `server/student-store.js`: own identity-option database and in-memory queries.
- Modify `server/index.js`: own public API validation, caching, response minimization, and rate limiting.
- Modify `tests/site-smoke.test.js`: verify endpoint behavior and privacy boundaries against the real request handler.
- Modify `tests/asset-contract.test.js`: verify login field order and client-side interaction contracts.
- Modify `public/app.js`: own school loading, major lookup, cancellation, fallback, and role-switch reset behavior.
- Modify `public/assets/styles.css`: style select, lookup status, readonly success, and fallback states.
- Create `public/assets/styles-v157.css`: immutable release copy of the canonical stylesheet.
- Modify `public/index.html`: load release `v157` assets.

### Task 1: Add identity-library option queries

**Files:**
- Modify: `server/student-store.js:166-204`
- Modify: `server/student-store.js:572-592`
- Test: `tests/site-smoke.test.js`

**Interfaces:**
- Produces: `listActiveSchools(identityType: "student" | "teacher"): Promise<string[]>`
- Produces: `findMajorBySchoolAndAccount({ school, studentNo, identityType }): Promise<string>`
- Consumes: existing `initialize()`, `getPool()`, `data.users`, and `normalizeStudent()`.

- [ ] **Step 1: Write a failing store contract fixture**

Add the data import near the top of `tests/site-smoke.test.js`:

```js
const data = require("../server/data");
```

Add a reusable fixture helper below `createTestToken`:

```js
function withIdentityFixtures(t) {
  const fixtures = [
    { id: "lookup-student", name: "联动学生", school: "联动大学", college: "信息学院", major: "软件工程", studentNo: "LOOKUP-S001", phone: "13800000001", status: "active", role: "student", verified: true },
    { id: "lookup-teacher", name: "联动老师", school: "联动大学", college: "信息学院", major: "计算机科学", studentNo: "LOOKUP-T001", phone: "13800000002", status: "active", role: "teacher", verified: true },
    { id: "lookup-disabled", name: "停用学生", school: "停用账号大学", college: "信息学院", major: "数据科学", studentNo: "LOOKUP-D001", phone: "13800000003", status: "disabled", role: "student", verified: true }
  ];
  data.users.push(...fixtures);
  t.after(() => {
    for (const fixture of fixtures) {
      const index = data.users.findIndex((user) => user.id === fixture.id);
      if (index >= 0) data.users.splice(index, 1);
    }
  });
}
```

- [ ] **Step 2: Add a failing direct store contract test**

Also import the store near the top of `tests/site-smoke.test.js`:

```js
const studentStore = require("../server/student-store");
```

Append this test:

```js
test("queries role-scoped schools and majors from the identity store", async (t) => {
  withIdentityFixtures(t);
  const studentSchools = await studentStore.listActiveSchools("student");
  const teacherSchools = await studentStore.listActiveSchools("teacher");
  assert.deepEqual(studentSchools.filter((school) => school.startsWith("联动")), ["联动大学"]);
  assert.ok(teacherSchools.includes("联动大学"));
  assert.equal(studentSchools.includes("停用账号大学"), false);
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "联动大学", studentNo: "LOOKUP-S001", identityType: "student" }), "软件工程");
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "联动大学", studentNo: "LOOKUP-T001", identityType: "student" }), "");
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "停用账号大学", studentNo: "LOOKUP-D001", identityType: "student" }), "");
});
```

- [ ] **Step 3: Run the test and confirm the intended failure**

Run: `node --test --test-name-pattern="queries role-scoped schools" tests/site-smoke.test.js`

Expected: FAIL with `studentStore.listActiveSchools is not a function`.

- [ ] **Step 4: Implement the two store queries**

Add below `findLoginAccount` in `server/student-store.js`:

```js
function matchesIdentityType(user, identityType) {
  if (!user || user.status === "disabled" || user.role === "guest") return false;
  return identityType === "teacher" ? user.role === "teacher" : user.role !== "teacher";
}

async function listActiveSchools(identityType = "student") {
  const normalizedType = identityType === "teacher" ? "teacher" : "student";
  if (!mysqlConfigured) {
    return [...new Set(data.users
      .filter((user) => matchesIdentityType(user, normalizedType))
      .map((user) => String(user.school || "").trim())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
  }
  await initialize();
  const roleCondition = normalizedType === "teacher" ? "role = 'teacher'" : "role <> 'teacher'";
  const [rows] = await getPool().query(
    `SELECT DISTINCT school FROM students WHERE status = 'active' AND ${roleCondition} AND school <> '' ORDER BY school ASC`
  );
  return rows.map((row) => String(row.school || "").trim()).filter(Boolean);
}

async function findMajorBySchoolAndAccount({ school, studentNo, identityType = "student" }) {
  const normalizedSchool = String(school || "").trim();
  const normalizedStudentNo = String(studentNo || "").trim();
  const normalizedType = identityType === "teacher" ? "teacher" : "student";
  if (!normalizedSchool || !normalizedStudentNo) return "";
  if (!mysqlConfigured) {
    const user = data.users.find((item) => (
      matchesIdentityType(item, normalizedType)
      && String(item.school || "").trim() === normalizedSchool
      && String(item.studentNo || "").trim() === normalizedStudentNo
    ));
    return String(user?.major || "").trim();
  }
  await initialize();
  const roleCondition = normalizedType === "teacher" ? "role = 'teacher'" : "role <> 'teacher'";
  const [rows] = await getPool().execute(
    `SELECT major FROM students WHERE school = ? AND student_no = ? AND status = 'active' AND ${roleCondition} LIMIT 1`,
    [normalizedSchool, normalizedStudentNo]
  );
  return String(rows[0]?.major || "").trim();
}
```

Export both functions from `module.exports`.

- [ ] **Step 5: Run syntax and focused tests**

Run: `node --check server/student-store.js && node --test --test-name-pattern="queries role-scoped schools" tests/site-smoke.test.js`

Expected: syntax PASS and focused test PASS.

- [ ] **Step 6: Commit the independently passing store boundary**

```bash
git add server/student-store.js tests/site-smoke.test.js
git commit -m "feat: add login identity option queries"
```

### Task 2: Expose minimal, rate-limited identity endpoints

**Files:**
- Modify: `server/index.js:290-330`
- Modify: `server/index.js:985-1000`
- Modify: `server/index.js:1248-1365`
- Test: `tests/site-smoke.test.js`

**Interfaces:**
- Consumes: `studentStore.listActiveSchools(identityType)` and `studentStore.findMajorBySchoolAndAccount(input)` from Task 1.
- Produces: `GET /api/auth/identity/schools?identityType=student|teacher`.
- Produces: `POST /api/auth/identity/major` with `{ matched: true, major: string }`.

- [ ] **Step 1: Add a failing API, privacy, and throttling test**

Append this separate test to `tests/site-smoke.test.js`:

```js
test("exposes minimal rate-limited login identity endpoints", async (t) => {
  withIdentityFixtures(t);
  const studentSchools = await fetch(`${baseUrl}/api/auth/identity/schools?identityType=student`);
  assert.equal(studentSchools.status, 200);
  assert.deepEqual((await studentSchools.json()).schools.filter((school) => school.startsWith("联动")), ["联动大学"]);

  const teacherSchools = await fetch(`${baseUrl}/api/auth/identity/schools?identityType=teacher`);
  assert.equal(teacherSchools.status, 200);
  assert.ok((await teacherSchools.json()).schools.includes("联动大学"));

  const matched = await fetch(`${baseUrl}/api/auth/identity/major`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.21" },
    body: JSON.stringify({ school: "联动大学", studentNo: "LOOKUP-S001", identityType: "student" })
  });
  assert.equal(matched.status, 200);
  const privacyPayload = await matched.json();
  assert.deepEqual(privacyPayload, { matched: true, major: "软件工程" });
  for (const forbidden of ["name", "phone", "className", "college", "role", "id"]) {
    assert.equal(Object.hasOwn(privacyPayload, forbidden), false, `${forbidden} must not be exposed`);
  }

  const roleMismatch = await fetch(`${baseUrl}/api/auth/identity/major`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.22" },
    body: JSON.stringify({ school: "联动大学", studentNo: "LOOKUP-T001", identityType: "student" })
  });
  assert.equal(roleMismatch.status, 404);

  const disabled = await fetch(`${baseUrl}/api/auth/identity/major`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.23" },
    body: JSON.stringify({ school: "停用账号大学", studentNo: "LOOKUP-D001", identityType: "student" })
  });
  assert.equal(disabled.status, 404);

  let throttledStatus = 0;
  for (let index = 0; index < 13; index += 1) {
    const response = await fetch(`${baseUrl}/api/auth/identity/major`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.24" },
      body: JSON.stringify({ school: "联动大学", studentNo: "LOOKUP-S001", identityType: "student" })
    });
    throttledStatus = response.status;
  }
  assert.equal(throttledStatus, 429);
});
```

- [ ] **Step 2: Run the focused test to verify it still fails**

Run: `node --test --test-name-pattern="minimal rate-limited login identity" tests/site-smoke.test.js`

Expected: FAIL with endpoint `404`.

- [ ] **Step 3: Add cache and normalization helpers**

Near the existing rate-limit stores in `server/index.js`, add:

```js
const identitySchoolCache = new Map();
const IDENTITY_SCHOOL_CACHE_MS = 5 * 60 * 1000;

function normalizeIdentityType(value) {
  return value === "teacher" ? "teacher" : "student";
}

function clearIdentitySchoolCache() {
  identitySchoolCache.clear();
}
```

- [ ] **Step 4: Implement the two routes before SMS send**

Add inside `handleApi`, before `POST /api/auth/sms/send`:

```js
  if (route === "GET /api/auth/identity/schools") {
    const identityType = normalizeIdentityType(url.searchParams.get("identityType"));
    const cached = identitySchoolCache.get(identityType);
    if (cached && cached.expiresAt > Date.now()) {
      sendJson(res, 200, { schools: cached.schools });
      return;
    }
    const schools = await studentStore.listActiveSchools(identityType);
    identitySchoolCache.set(identityType, { schools, expiresAt: Date.now() + IDENTITY_SCHOOL_CACHE_MS });
    sendJson(res, 200, { schools });
    return;
  }

  if (route === "POST /api/auth/identity/major") {
    const body = await parseBody(req);
    const school = String(body.school || "").trim();
    const studentNo = String(body.studentNo || "").trim();
    const identityType = normalizeIdentityType(body.identityType);
    if (school.length < 2 || school.length > 120 || studentNo.length < 2 || studentNo.length > 64) {
      sendError(res, 400, "请填写有效的学校和学号或工号");
      return;
    }
    const lookupDigest = crypto.createHash("sha256").update(`${school}|${studentNo}|${identityType}`).digest("hex").slice(0, 16);
    consumeRateLimit(`${clientIp(req)}:identity-major:${lookupDigest}`, 12, 60 * 1000);
    const major = await studentStore.findMajorBySchoolAndAccount({ school, studentNo, identityType });
    if (!major) {
      sendError(res, 404, "未能匹配校园身份信息，请检查学校和学号或工号");
      return;
    }
    sendJson(res, 200, { matched: true, major });
    return;
  }
```

- [ ] **Step 5: Invalidate school cache after identity mutations**

Call `clearIdentitySchoolCache()` after successful execution of these existing routes:

```js
POST /api/admin/students
PUT /api/admin/students/status
PUT /api/admin/students/role
POST /api/admin/students/import
```

Place the call after the store mutation succeeds and before `sendJson`.

- [ ] **Step 6: Run focused and complete server tests**

Run: `node --check server/index.js && node --test --test-name-pattern="minimal rate-limited login identity" tests/site-smoke.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 7: Commit the endpoint implementation**

```bash
git add server/index.js tests/site-smoke.test.js
git commit -m "feat: expose secure login identity options"
```

### Task 3: Reorder the login form and add dependent lookup behavior

**Files:**
- Modify: `tests/asset-contract.test.js`
- Modify: `public/app.js:2002-2050`
- Modify: `public/app.js:2208-2245`
- Modify: `public/app.js:2305-2340`

**Interfaces:**
- Consumes: `GET /api/auth/identity/schools` and `POST /api/auth/identity/major` from Task 2.
- Produces: form controls `#loginSchool`, `#loginSchoolFallback`, `#loginMajor`, and `#loginMajorStatus`.
- Preserves: submitted form fields `school`, `major`, `studentNo`, `phone`, and `identityType`.

- [ ] **Step 1: Add failing frontend contract tests**

Append to `tests/asset-contract.test.js`:

```js
test("orders login identity fields and wires database-driven autofill", () => {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const schoolIndex = app.indexOf('id="loginSchool"');
  const accountIndex = app.indexOf('name="studentNo"');
  const majorIndex = app.indexOf('id="loginMajor"');
  const phoneIndex = app.indexOf('name="phone"');

  assert.ok(schoolIndex >= 0);
  assert.ok(schoolIndex < accountIndex);
  assert.ok(accountIndex < majorIndex);
  assert.ok(majorIndex < phoneIndex);
  assert.match(app, /\/api\/auth\/identity\/schools/);
  assert.match(app, /\/api\/auth\/identity\/major/);
  assert.match(app, /AbortController/);
  assert.match(app, /identityLookupTimer/);
  assert.match(app, /loginMajorStatus/);
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `node --test --test-name-pattern="orders login identity" tests/asset-contract.test.js`

Expected: FAIL because the new IDs and endpoints are absent.

- [ ] **Step 3: Replace the school, account, and major controls in DOM order**

In the login form template, use:

```html
<label class="field login-field login-field-wide">
  <span>学校</span>
  <select id="loginSchool" name="school" autocomplete="organization" required>
    <option value="">正在加载学校...</option>
  </select>
  <input id="loginSchoolFallback" autocomplete="organization" placeholder="请输入学校" hidden disabled />
</label>
<label class="field login-field">
  <span id="loginAccountLabel">学号</span>
  <input name="studentNo" placeholder="请输入学号" autocomplete="username" required />
</label>
<label class="field login-field">
  <span>专业</span>
  <input id="loginMajor" name="major" autocomplete="organization-title" readonly required />
  <small id="loginMajorStatus" class="login-field-status" aria-live="polite">输入学号后自动匹配</small>
</label>
```

- [ ] **Step 4: Add abortable lookup state and helpers inside `renderLogin`**

After login form elements are available, add these state variables and helpers:

```js
  let identityLookupTimer = null;
  let identityLookupController = null;
  const schoolSelect = document.querySelector("#loginSchool");
  const schoolFallback = document.querySelector("#loginSchoolFallback");
  const majorInput = document.querySelector("#loginMajor");
  const majorStatus = document.querySelector("#loginMajorStatus");

  function currentSchoolValue() {
    return String((schoolFallback.hidden ? schoolSelect.value : schoolFallback.value) || "").trim();
  }

  function setSchoolFallback(enabled) {
    schoolSelect.hidden = enabled;
    schoolSelect.disabled = enabled;
    schoolSelect.name = enabled ? "" : "school";
    schoolFallback.hidden = !enabled;
    schoolFallback.disabled = !enabled;
    schoolFallback.name = enabled ? "school" : "";
  }

  function resetMajorLookup(message = "输入学号后自动匹配", editable = false) {
    if (identityLookupController) identityLookupController.abort();
    clearTimeout(identityLookupTimer);
    majorInput.value = "";
    majorInput.readOnly = !editable;
    majorInput.classList.remove("is-matched");
    majorStatus.textContent = message;
  }
```

- [ ] **Step 5: Load schools with remembered selection and manual fallback**

Add:

```js
  async function loadIdentitySchools() {
    const form = document.querySelector("#loginForm");
    const identityType = form.elements.identityType.value;
    schoolSelect.innerHTML = '<option value="">正在加载学校...</option>';
    setSchoolFallback(false);
    resetMajorLookup();
    try {
      const result = await api(`/api/auth/identity/schools?identityType=${encodeURIComponent(identityType)}`);
      const schools = Array.isArray(result.schools) ? result.schools : [];
      schoolSelect.innerHTML = schools.map((school) => `<option value="${escapeHtml(school)}">${escapeHtml(school)}</option>`).join("");
      const remembered = localStorage.getItem("campus-login-school") || "";
      if (schools.includes(remembered)) schoolSelect.value = remembered;
      if (!schools.length) throw new Error("身份库暂无可选学校");
    } catch (error) {
      setSchoolFallback(true);
      schoolFallback.value = localStorage.getItem("campus-login-school") || "";
      resetMajorLookup("学校列表暂不可用，可手动填写学校和专业", true);
    }
  }
```

- [ ] **Step 6: Implement the debounced major lookup**

Add:

```js
  async function lookupIdentityMajor() {
    const form = document.querySelector("#loginForm");
    const school = currentSchoolValue();
    const studentNo = String(form.elements.studentNo.value || "").trim();
    if (school.length < 2 || studentNo.length < 2) {
      resetMajorLookup();
      return;
    }
    if (identityLookupController) identityLookupController.abort();
    identityLookupController = new AbortController();
    majorInput.readOnly = true;
    majorStatus.textContent = "正在匹配校园身份...";
    try {
      const result = await api("/api/auth/identity/major", {
        method: "POST",
        signal: identityLookupController.signal,
        body: JSON.stringify({ school, studentNo, identityType: form.elements.identityType.value })
      });
      majorInput.value = result.major;
      majorInput.readOnly = true;
      majorInput.classList.add("is-matched");
      majorStatus.textContent = "已从校园身份库匹配";
      localStorage.setItem("campus-login-school", school);
    } catch (error) {
      if (error.name === "AbortError") return;
      const unmatched = error.message.includes("未能匹配");
      majorInput.value = "";
      majorInput.readOnly = unmatched;
      majorInput.classList.remove("is-matched");
      majorStatus.textContent = unmatched
        ? "未匹配到身份信息，请检查学校和学号或工号"
        : "身份联动暂不可用，可手动填写专业";
    }
  }

  function scheduleIdentityMajorLookup() {
    clearTimeout(identityLookupTimer);
    resetMajorLookup("正在等待学号或工号输入...");
    identityLookupTimer = setTimeout(lookupIdentityMajor, 350);
  }
```

Ensure `api()` preserves `options.signal`, which it already does through the options spread.

- [ ] **Step 7: Wire field and role events**

Add listeners:

```js
  schoolSelect.addEventListener("change", () => {
    localStorage.setItem("campus-login-school", schoolSelect.value);
    resetMajorLookup();
    scheduleIdentityMajorLookup();
  });
  schoolFallback.addEventListener("input", scheduleIdentityMajorLookup);
  formElement.elements.studentNo.addEventListener("input", scheduleIdentityMajorLookup);
  formElement.elements.studentNo.addEventListener("blur", lookupIdentityMajor);
```

In the existing role-switch handler, after clearing `studentNo`, call `loadIdentitySchools()`. Call `loadIdentitySchools()` once after all login listeners are registered.

- [ ] **Step 8: Run frontend contracts and syntax checks**

Run: `node --check public/app.js && node --test --test-name-pattern="orders login identity" tests/asset-contract.test.js`

Expected: PASS.

- [ ] **Step 9: Commit functional login behavior**

```bash
git add public/app.js tests/asset-contract.test.js
git commit -m "feat: autofill login major from identity library"
```

### Task 4: Style, release, and verify the complete flow

**Files:**
- Modify: `public/assets/styles.css`
- Create: `public/assets/styles-v157.css`
- Modify: `public/index.html`
- Modify: `tests/asset-contract.test.js`

**Interfaces:**
- Consumes: login IDs and classes from Task 3.
- Produces: visually stable day/night and mobile/desktop states.
- Produces: cache-safe release assets `styles-v157.css` and `app.js?v=157`.

- [ ] **Step 1: Extend the release-asset test to require v157**

In `tests/asset-contract.test.js`, update the cache-safe asset assertions:

```js
  const releaseStylesPath = path.join(root, "public", "assets", "styles-v157.css");
  assert.match(index, /\/assets\/styles-v157\.css/);
  assert.match(index, /\/app\.js\?v=157/);
```

- [ ] **Step 2: Run the asset test and verify failure**

Run: `node --test --test-name-pattern="cache-safe assets" tests/asset-contract.test.js`

Expected: FAIL because `styles-v157.css` is absent and `index.html` still references v156.

- [ ] **Step 3: Add select and lookup-state styles**

Append alongside the existing login field rules in `public/assets/styles.css`:

```css
.login-field select {
  width: 100%;
  height: 42px;
  padding: 0 36px 0 12px;
  border: 1px solid rgba(126, 161, 184, 0.34);
  border-radius: 9px;
  background: rgba(8, 29, 64, 0.7);
  color: #edf8ff;
  font: inherit;
  letter-spacing: 0;
}

.login-field select:focus {
  border-color: #37b9d2;
  outline: 2px solid rgba(55, 185, 210, 0.16);
}

.login-field-status {
  min-height: 16px;
  color: #8eb3ca;
  font-size: 11px;
  line-height: 1.35;
}

.login-field input.is-matched {
  border-color: rgba(55, 205, 162, 0.62);
  background: rgba(27, 113, 99, 0.18);
}

html[data-theme="day"] .login-field select {
  border-color: rgba(43, 108, 113, 0.22);
  background: rgba(250, 254, 253, 0.9);
  color: #173f46;
}

html[data-theme="day"] .login-field-status {
  color: #56777d;
}

html[data-theme="day"] .login-field input.is-matched {
  border-color: rgba(22, 143, 136, 0.48);
  background: rgba(226, 248, 241, 0.9);
}
```

- [ ] **Step 4: Create release assets and update the shell**

Run the mechanical copy:

```powershell
Copy-Item public/assets/styles.css public/assets/styles-v157.css
```

Update `public/index.html`:

```html
<link rel="stylesheet" href="/assets/styles-v157.css" />
<script type="module" src="/app.js?v=157"></script>
```

- [ ] **Step 5: Run the complete automated verification**

Run: `npm run check`

Expected: all syntax checks and all tests PASS.

- [ ] **Step 6: Run local visual and interaction verification**

Start: `npm run dev`

Verify at `http://localhost:5173/#profile` in desktop `1366x768` and mobile `390x844`:

- Student mode loads active student schools.
- Teacher mode reloads teacher schools and changes 学号 to 工号.
- School appears before account; account appears before major.
- A valid school/account fills major without moving focus.
- Changing school or role clears stale major data.
- Unknown account shows a compact message without exposing account details.
- Simulated API failure allows manual school and major entry.
- Day and night themes have readable controls with no overlap or horizontal page scrolling.

- [ ] **Step 7: Commit the release asset and styling**

```bash
git add public/assets/styles.css public/assets/styles-v157.css public/index.html tests/asset-contract.test.js
git commit -m "style: polish database-driven login fields"
```

- [ ] **Step 8: Final diff and repository hygiene check**

Run:

```bash
git diff HEAD~4 --check
git status --short
```

Expected: no whitespace errors; unrelated pre-existing untracked files remain untouched.
