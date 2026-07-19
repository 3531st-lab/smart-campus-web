# Quality Assessment Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-backed five-dimension quality assessment workflow with class-officer first review, college review, publication, appeals, audit history, and Excel-compatible export.

**Architecture:** Add a versioned assessment domain beside the existing class and chat domains. Keep calculation rules pure and testable, store workflow data through the existing MySQL-with-memory-fallback pattern, and expose a focused route module from `server/index.js`. Replace the legacy localStorage calculator with a dedicated vanilla JavaScript page module and sanitized Excel template adapter.

**Tech Stack:** Node.js 22, CommonJS server modules, MySQL 8 compatible schema, vanilla JavaScript SPA, existing `xlsx` runtime, `@oai/artifact-tool` workspace runtime for the one-time template sanitization, Node test runner, Playwright browser verification.

## Global Constraints

- Use the approved rule version identifier `2025-economics-management`.
- The maximum scores are 德育 28, 智育 48, 体育 8, 美育 8, 劳育 8; total maximum is 100.
- Calculate each module as `基础分 + 审核通过的加分 - 审核通过的扣分`, then apply minimum, cap, and zero-score rules.
- Labor score may fall to `-8`; all other module scores have a minimum of `0`.
- Class first review is performed by students whose active class duty is `monitor` or `league_secretary`.
- A class reviewer cannot review their own record. The other class officer or an explicitly assigned class administrator handles that record.
- Do not implement image OCR. Evidence upload and manual review remain supported.
- Preserve the original user workbook. Generate separate sanitized blank and fictional trial workbooks.
- Do not add personal data, API credentials, or uploaded evidence to Git.
- Keep all user-facing copy in Chinese and support the existing day and night themes.
- Follow the repository's MySQL plus in-memory fallback conventions; do not add a backend framework.

---

### Task 1: Pure Rule Engine

**Files:**
- Create: `server/quality-rules.js`
- Create: `tests/quality-rules.test.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `getQualityRuleVersion(versionId)` returning an immutable rule definition.
- Produces: `calculateQualityRecord({ modules, zeroRuleCodes })` returning `{ moduleScores, totalScore, zeroed, warnings, calculation }`.
- Produces: `validateQualityItem(item, ruleVersion)` returning normalized `{ module, type, ruleCode, claimedScore, evidenceRequired }` or throwing a status-coded error.

- [ ] **Step 1: Write failing tests for normal calculation, caps, deductions, labor negatives, and total zero**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateQualityRecord } = require("../server/quality-rules");

test("calculates five modules with positive deductions", () => {
  const result = calculateQualityRecord({
    modules: {
      moral: { base: 18, bonus: 2.3, deduction: 0.5 },
      intellectual: { base: 36, bonus: 1.2, deduction: 0.2 },
      physical: { base: 4, bonus: 0.5, deduction: 0.2 },
      aesthetic: { base: 3, bonus: 1, deduction: 0.3 },
      labor: { base: 4, bonus: 1.5, deduction: 0.5 }
    },
    zeroRuleCodes: []
  });
  assert.deepEqual(result.moduleScores, {
    moral: 19.8,
    intellectual: 37,
    physical: 4.3,
    aesthetic: 3.7,
    labor: 5
  });
  assert.equal(result.totalScore, 69.8);
});

test("caps modules and permits labor down to negative eight", () => {
  const result = calculateQualityRecord({
    modules: {
      moral: { base: 28, bonus: 20, deduction: 0 },
      intellectual: { base: 48, bonus: 20, deduction: 0 },
      physical: { base: 8, bonus: 10, deduction: 0 },
      aesthetic: { base: 8, bonus: 10, deduction: 0 },
      labor: { base: 0, bonus: 0, deduction: 20 }
    },
    zeroRuleCodes: []
  });
  assert.deepEqual(result.moduleScores, { moral: 28, intellectual: 48, physical: 8, aesthetic: 8, labor: -8 });
  assert.equal(result.totalScore, 84);
});

test("zero rules override the calculated total", () => {
  const result = calculateQualityRecord({
    modules: { moral: { base: 18 }, intellectual: { base: 38 }, physical: { base: 5 }, aesthetic: { base: 3 }, labor: { base: 4 } },
    zeroRuleCodes: ["SERIOUS_DISCIPLINE"]
  });
  assert.equal(result.zeroed, true);
  assert.equal(result.totalScore, 0);
});
```

- [ ] **Step 2: Run the rule tests and confirm the missing-module failure**

Run: `node --test tests/quality-rules.test.js`

Expected: FAIL with `Cannot find module '../server/quality-rules'`.

- [ ] **Step 3: Implement immutable 2025 rules and the calculator**

```js
const MODULES = Object.freeze({
  moral: Object.freeze({ label: "德育", max: 28, min: 0 }),
  intellectual: Object.freeze({ label: "智育", max: 48, min: 0 }),
  physical: Object.freeze({ label: "体育", max: 8, min: 0 }),
  aesthetic: Object.freeze({ label: "美育", max: 8, min: 0 }),
  labor: Object.freeze({ label: "劳育", max: 8, min: -8 })
});

const RULE_VERSION = Object.freeze({
  id: "2025-economics-management",
  modules: MODULES,
  zeroRules: Object.freeze(["SERIOUS_DISCIPLINE", "EVIDENCE_FALSIFICATION"])
});

function score(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error("分值必须为数字"), { statusCode: 400 });
  return Math.round(parsed * 100) / 100;
}

function calculateQualityRecord({ modules = {}, zeroRuleCodes = [] }) {
  const moduleScores = {};
  const calculation = {};
  for (const [id, config] of Object.entries(MODULES)) {
    const input = modules[id] || {};
    const base = score(input.base);
    const bonus = score(input.bonus);
    const deduction = score(input.deduction);
    const raw = score(base + bonus - deduction);
    const final = score(Math.min(config.max, Math.max(config.min, raw)));
    moduleScores[id] = final;
    calculation[id] = { base, bonus, deduction, raw, final, capped: raw !== final };
  }
  const zeroed = zeroRuleCodes.some((code) => RULE_VERSION.zeroRules.includes(code));
  const totalScore = zeroed ? 0 : score(Object.values(moduleScores).reduce((sum, value) => sum + value, 0));
  const warnings = moduleScores.moral < 16 ? ["德育低于16分，需进行评奖评优资格复核"] : [];
  return { moduleScores, totalScore, zeroed, warnings, calculation };
}

function validateQualityItem(item, ruleVersion = RULE_VERSION) {
  const module = String(item?.module || "");
  const type = String(item?.type || "");
  if (!ruleVersion.modules[module]) throw Object.assign(new Error("综测模块无效"), { statusCode: 400 });
  if (!["base", "bonus", "deduction"].includes(type)) throw Object.assign(new Error("计分类型无效"), { statusCode: 400 });
  return {
    module,
    type,
    ruleCode: String(item?.ruleCode || "CUSTOM").slice(0, 80),
    claimedScore: score(item?.claimedScore),
    evidenceRequired: type !== "base"
  };
}

module.exports = { getQualityRuleVersion: () => RULE_VERSION, calculateQualityRecord, validateQualityItem };
```

- [ ] **Step 4: Run the rule tests**

Run: `node --test tests/quality-rules.test.js`

Expected: PASS for calculation, capping, negative labor, zeroing, invalid values, and moral warning tests.

- [ ] **Step 5: Register the test and commit**

```bash
git add server/quality-rules.js tests/quality-rules.test.js tests/run-all.js
git commit -m "feat: add quality assessment rule engine"
```

---

### Task 2: Assessment Schema and Store

**Files:**
- Create: `server/quality-store.js`
- Create: `tests/quality-store.test.js`
- Modify: `server/schema.sql`
- Modify: `server/data.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Consumes: `calculateQualityRecord()` from Task 1.
- Produces: `createPeriod(input, operator)`, `listPeriods(user)`, `getOrCreateRecord(periodId, user)`, `saveDraft(recordId, input, user)`, `submitRecord(recordId, user)`.
- Produces: `listClassQueue(filters, reviewer)`, `reviewClassRecord(recordId, input, reviewer)`, `listCollegeQueue(filters, reviewer)`, `reviewCollegeRecord(recordId, input, reviewer)`.
- Produces: `publishPeriod(periodId, input, operator)`, `createAppeal(input, user)`, `reviewAppeal(appealId, input, reviewer)`, `listAuditLogs(filters, user)`.

- [ ] **Step 1: Write failing memory-store tests for draft and submission**

```js
test("student saves and submits a versioned record", async () => {
  const record = await store.getOrCreateRecord("period-1", users.student);
  const saved = await store.saveDraft(record.id, {
    version: record.version,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  }, users.student);
  assert.equal(saved.version, record.version + 1);
  const submitted = await store.submitRecord(record.id, users.student);
  assert.equal(submitted.status, "class_review");
});
```

- [ ] **Step 2: Write failing tests for class officer scope and self-recusal**

```js
test("monitor and league secretary review their class but not themselves", async () => {
  const queue = await store.listClassQueue({ periodId: "period-1" }, users.monitor);
  assert.ok(queue.records.some((record) => record.studentId === users.student.id));
  await assert.rejects(
    store.reviewClassRecord(users.monitorRecord.id, { decision: "approved", itemDecisions: [] }, users.monitor),
    /不能审核自己的申报/
  );
  const reviewed = await store.reviewClassRecord(users.studentRecord.id, {
    decision: "approved",
    opinion: "材料与申报项目一致",
    itemDecisions: []
  }, users.monitor);
  assert.equal(reviewed.status, "college_review");
});
```

- [ ] **Step 3: Run store tests and confirm failure**

Run: `node --test tests/quality-store.test.js`

Expected: FAIL because `server/quality-store.js` does not exist.

- [ ] **Step 4: Add MySQL tables and indexes**

Add tables named `quality_rule_versions`, `quality_assessment_periods`, `quality_assessment_records`, `quality_assessment_items`, `quality_assessment_evidence`, `quality_assessment_reviews`, `quality_assessment_appeals`, and `quality_assessment_audits`. Use `VARCHAR(64)` IDs, JSON for immutable calculation snapshots, `version INT UNSIGNED`, and indexes on period/status/class/student/reviewer timestamps. Add a unique key on `(period_id, student_id)` and an active-appeal key on `(record_id, active_key)`.

```sql
CREATE TABLE IF NOT EXISTS quality_assessment_records (
  id VARCHAR(64) PRIMARY KEY,
  period_id VARCHAR(64) NOT NULL,
  student_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  rule_version VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  module_scores JSON NOT NULL,
  total_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  calculation_snapshot JSON NOT NULL,
  risk_flags JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at TIMESTAMP NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_quality_record_period_student (period_id, student_id),
  KEY idx_quality_record_class_status (class_id, status, updated_at),
  KEY idx_quality_record_period_total (period_id, total_score)
);
```

- [ ] **Step 5: Implement memory and MySQL store adapters**

Follow `reservation-store.js`: initialize missing arrays in `server/data.js`, lazily create tables through `initialize()`, use transactions for state transitions, and map snake_case SQL rows to camelCase API objects. Centralize state transitions in:

```js
const TRANSITIONS = Object.freeze({
  draft: ["class_review"],
  returned: ["class_review"],
  class_review: ["returned", "college_review"],
  college_review: ["returned", "pending_publication"],
  pending_publication: ["published"],
  published: ["archived"],
  archived: []
});
```

Use `SELECT ... FOR UPDATE` and `version = version + 1` for workflow writes. Reject stale versions with status `409` and message `记录已被其他审核人更新，请刷新后重试`.

- [ ] **Step 6: Run store tests**

Run: `node --test tests/quality-store.test.js`

Expected: PASS for memory CRUD, MySQL query contracts, allowed transitions, stale versions, class scope, self-recusal, publication, appeal uniqueness, and audit append tests.

- [ ] **Step 7: Register the test and commit**

```bash
git add server/quality-store.js server/schema.sql server/data.js tests/quality-store.test.js tests/run-all.js
git commit -m "feat: persist quality assessment workflow"
```

---

### Task 3: Authenticated Quality Assessment API

**Files:**
- Create: `server/quality-routes.js`
- Create: `tests/quality-api.test.js`
- Modify: `server/index.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Consumes: store methods from Task 2 and existing `requireUser`, `parseBody`, `sendJson`, `sendError` helpers.
- Produces: `handleQualityRoute(context): Promise<boolean>`.

- [ ] **Step 1: Write route tests for student, class reviewer, college admin, and super admin**

```js
test("student can save only their own draft", async () => {
  const own = await call("PUT /api/quality/records/record-student/draft", users.student, {
    version: 1,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  });
  assert.equal(own.status, 200);
  const other = await call("PUT /api/quality/records/record-peer/draft", users.student, { version: 1, items: [] });
  assert.equal(other.status, 403);
});

test("class officer review enforces class scope and self-recusal", async () => {
  assert.equal((await call("POST /api/quality/review/class/record-peer", users.monitor, {
    version: 2,
    decision: "approved",
    opinion: "核验通过",
    itemDecisions: []
  })).status, 200);
  assert.equal((await call("POST /api/quality/review/class/record-monitor", users.monitor, {
    version: 2,
    decision: "approved",
    opinion: "不能自审",
    itemDecisions: []
  })).status, 403);
});
```

- [ ] **Step 2: Run API tests and confirm missing-route failure**

Run: `node --test tests/quality-api.test.js`

Expected: FAIL because `handleQualityRoute` is missing.

- [ ] **Step 3: Implement explicit routes**

Implement these route contracts:

```text
GET  /api/quality/periods
GET  /api/quality/records/current?periodId=
PUT  /api/quality/records/:id/draft
POST /api/quality/records/:id/submit
GET  /api/quality/review/class?periodId=&status=&query=&page=
POST /api/quality/review/class/:id
GET  /api/admin/quality/review?periodId=&classId=&status=&page=
POST /api/admin/quality/review/:id
POST /api/admin/quality/periods
POST /api/admin/quality/periods/:id/publish
POST /api/admin/quality/periods/:id/archive
POST /api/quality/appeals
POST /api/admin/quality/appeals/:id/review
GET  /api/admin/quality/audit?recordId=&limit=
GET  /api/admin/quality/export-data?periodId=&classId=
```

Class review routes require an active assignment duty of `monitor`, `league_secretary`, or explicitly assigned `class_admin`. College routes require `admin` or `super_admin`; normal admins must match the record school and college. Guests and teachers without an assessment assignment receive `403`.

- [ ] **Step 4: Mount the route before the generic admin branch**

```js
const { handleQualityRoute } = require("./quality-routes");

const qualityHandled = await handleQualityRoute({
  route, url, req, res, requireUser, parseBody, sendJson, sendError
});
if (qualityHandled) return;
```

- [ ] **Step 5: Run API and smoke tests**

Run: `node --test tests/quality-api.test.js && node --test tests/site-smoke.test.js`

Expected: PASS, including unauthenticated `401`, guest `403`, stale write `409`, and valid lifecycle responses.

- [ ] **Step 6: Register the test and commit**

```bash
git add server/quality-routes.js server/index.js tests/quality-api.test.js tests/run-all.js
git commit -m "feat: expose quality assessment workflow api"
```

---

### Task 4: Evidence Upload and Access Control

**Files:**
- Create: `server/quality-evidence.js`
- Create: `tests/quality-evidence.test.js`
- Modify: `server/quality-routes.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Consumes: existing `media-store.js` concepts without exposing permanent public URLs.
- Produces: `saveEvidence({ recordId, itemId, owner, file })`, `listEvidence(recordId, user)`, `readEvidence(evidenceId, user)`.

- [ ] **Step 1: Write failing evidence validation and authorization tests**

```js
test("accepts image and PDF evidence within ten megabytes", async () => {
  const image = await evidence.saveEvidence({ recordId: "r1", itemId: "i1", owner: users.student, file: pngFixture });
  assert.equal(image.mimeType, "image/png");
});

test("rejects executable content and unrelated readers", async () => {
  await assert.rejects(() => evidence.saveEvidence({ recordId: "r1", itemId: "i1", owner: users.student, file: exeFixture }), /文件类型/);
  await assert.rejects(() => evidence.readEvidence("e1", users.outsider), /无权访问/);
});
```

- [ ] **Step 2: Run evidence tests and confirm failure**

Run: `node --test tests/quality-evidence.test.js`

Expected: FAIL because `server/quality-evidence.js` is missing.

- [ ] **Step 3: Implement signature validation and private storage keys**

Allow `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`; compare MIME, extension, and leading bytes; reject files over `10 * 1024 * 1024`; generate storage keys with `crypto.randomUUID()`; save SHA-256; enforce at most 10 active files per assessment item. Evidence responses expose `id`, `name`, `mimeType`, `size`, and `createdAt`, never a raw storage path. The Base64 JSON upload route calls `parseBody(req, { limitBytes: 14 * 1024 * 1024 })` so a valid 10 MB binary file is not rejected after Base64 expansion.

- [ ] **Step 4: Add upload, list, and download routes**

```text
POST   /api/quality/records/:recordId/items/:itemId/evidence
GET    /api/quality/records/:recordId/evidence
GET    /api/quality/evidence/:evidenceId
DELETE /api/quality/evidence/:evidenceId
```

Student owners can modify evidence only while the record is `draft` or `returned`. Assigned class reviewers and scoped college admins can read evidence. Downloads use `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/quality-evidence.test.js && node --test tests/quality-api.test.js`

Expected: PASS.

```bash
git add server/quality-evidence.js server/quality-routes.js tests/quality-evidence.test.js tests/run-all.js
git commit -m "feat: secure quality assessment evidence"
```

---

### Task 5: Dedicated Frontend Assessment Module

**Files:**
- Create: `public/quality-assessment.js`
- Create: `tests/quality-frontend-contract.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `window.QualityAssessmentPage.render({ user, route })` returning page HTML.
- Produces: `window.QualityAssessmentPage.bind({ api, toast, navigate })` returning a cleanup function.
- Consumes: existing global `api()` behavior through an injected adapter, not direct duplicated token parsing.

- [ ] **Step 1: Write failing frontend contract tests**

```js
test("quality page exposes five modules and role-aware workspaces", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/quality-assessment.js"), "utf8");
  for (const label of ["德育", "智育", "体育", "美育", "劳育"]) assert.match(source, new RegExp(label));
  assert.match(source, /班级初审/);
  assert.match(source, /学院复核/);
  assert.match(source, /公示与申诉/);
  assert.doesNotMatch(source, /OCR|自动识别图片/);
});
```

- [ ] **Step 2: Run the frontend test and confirm failure**

Run: `node --test tests/quality-frontend-contract.test.js`

Expected: FAIL because the page module is missing.

- [ ] **Step 3: Implement the role-aware shell and state store**

```js
const MODULES = [
  { id: "moral", label: "德育", max: 28 },
  { id: "intellectual", label: "智育", max: 48 },
  { id: "physical", label: "体育", max: 8 },
  { id: "aesthetic", label: "美育", max: 8 },
  { id: "labor", label: "劳育", max: 8 }
];

const state = {
  periodId: "",
  record: null,
  activeModule: "moral",
  activeWorkspace: "application",
  classQueue: [],
  collegeQueue: [],
  loading: false,
  error: ""
};
```

Render a compact header with period, workflow status, five score cards, and warnings. Render module forms as item lists with rule selector, claimed score, occurrence date, explanation, evidence list, save action, and submit action. Render `班级初审` only when the API reports `canClassReview`; render `学院复核` only for admin roles.

- [ ] **Step 4: Implement safe event binding and request cancellation**

Use one `AbortController` per page mount. Save drafts with an 800 ms debounce, show `保存中/已保存/保存失败`, and preserve unsaved form state after network errors. Require confirmation before submission, approval, rejection, publication, or appeal resolution.

- [ ] **Step 5: Replace the legacy route body**

Load `/quality-assessment.js?v=1` before `app.js`. Change the `tools/quality-score` route to call the new module. Remove the legacy localStorage key, duplicate calculator panels, filename-based evidence suggestions, and CSV-only export handler from `public/app.js`.

- [ ] **Step 6: Run frontend contracts and syntax checks**

Run: `node --check public/quality-assessment.js && node --check public/app.js && node --test tests/quality-frontend-contract.test.js`

Expected: PASS and no references to `smart_campus_quality_score_2025_v2` in `public/app.js`.

- [ ] **Step 7: Commit**

```bash
git add public/quality-assessment.js public/index.html public/app.js tests/quality-frontend-contract.test.js tests/run-all.js
git commit -m "feat: rebuild quality assessment workspace"
```

---

### Task 6: Theme, Responsive Layout, and Review Ergonomics

**Files:**
- Create: `public/assets/quality-assessment.css`
- Modify: `public/index.html`
- Modify: `tests/quality-frontend-contract.test.js`

**Interfaces:**
- Consumes: stable class names emitted by `public/quality-assessment.js`.
- Produces: responsive desktop, tablet, and mobile layouts without changing business state.

- [ ] **Step 1: Add failing CSS contract assertions**

```js
assert.match(css, /\.quality-module-grid\s*\{[^}]*grid-template-columns/s);
assert.match(css, /\.quality-review-table-wrap\s*\{[^}]*overflow:\s*auto/s);
assert.match(css, /@media\s*\(max-width:\s*760px\)/);
assert.match(css, /html\[data-theme="day"\][\s\S]*\.quality-assessment-page/);
assert.match(css, /html\[data-theme="night"\][\s\S]*\.quality-assessment-page/);
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `node --test tests/quality-frontend-contract.test.js`

Expected: FAIL because the stylesheet is absent.

- [ ] **Step 3: Implement the operational layout**

Use a 5-column score strip at widths above 1100 px, a 2-column form/summary workspace at widths above 900 px, and one column below 900 px. Keep cards at 8 px radius or less. Use module accents only on top borders, icons, charts, and active controls; keep body surfaces theme-neutral and readable. On mobile, use a horizontally scrollable five-module tab bar, sticky save/submit bar, and full-width review decision sheet.

- [ ] **Step 4: Add reduced-motion and keyboard focus support**

Use `prefers-reduced-motion: reduce` to disable score count-up and card transitions. All interactive elements must show `:focus-visible`; color cannot be the only status indicator.

- [ ] **Step 5: Run CSS contracts and commit**

Run: `node --test tests/quality-frontend-contract.test.js`

Expected: PASS.

```bash
git add public/assets/quality-assessment.css public/index.html tests/quality-frontend-contract.test.js
git commit -m "style: polish quality assessment workflows"
```

---

### Task 7: Sanitize the Workbook and Add Server Export

**Files:**
- Create: `server/quality-export.js`
- Create: `tests/quality-export.test.js`
- Create: `server/templates/quality-assessment-blank.xlsx`
- Create outside Git: `C:/Users/华硕/Documents/Codex/2026-06-03/new-chat/tmp/quality-score-workbook/generate-final.mjs`
- Modify: `server/quality-routes.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `buildQualityWorkbook({ period, students, records })` returning a Node `Buffer`.
- Produces: sanitized blank and fictional trial workbooks under `C:/Users/华硕/Documents/Codex/2026-06-03/new-chat/outputs/quality-score/`.

- [ ] **Step 1: Write failing export tests**

```js
test("export contains four expected sheets and positive deduction columns", () => {
  const buffer = buildQualityWorkbook({ period, students: [fictionalStudent], records: [fictionalRecord] });
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true });
  assert.deepEqual(workbook.SheetNames, ["学年汇总表", "学期汇总表", "学期情况一览表", "学期登记表"]);
  assert.equal(workbook.Sheets["学期情况一览表"].F4.v, 0.5);
  assert.match(workbook.Sheets["学期情况一览表"].G4.f, /D4\+E4-F4/);
});
```

- [ ] **Step 2: Run the export test and confirm failure**

Run: `node --test tests/quality-export.test.js`

Expected: FAIL because the export module and sanitized template do not exist.

- [ ] **Step 3: Generate a privacy-safe template with artifact-tool**

Import the original workbook from `C:/Users/华硕/Desktop/2025-2026学年第一学期综测表格（24数字经济班) .xlsx`. Preserve styles, widths, heights, merges, print settings, and sheet order. Remove all real names, student numbers, scores, project descriptions, and cached formula values. Correct detail and summary formulas so deductions are positive inputs subtracted from totals. Export the sanitized base to `server/templates/quality-assessment-blank.xlsx`.

- [ ] **Step 4: Generate two review artifacts**

Create:

```text
C:/Users/华硕/Documents/Codex/2026-06-03/new-chat/outputs/quality-score/24数字经济班综测空白模板.xlsx
C:/Users/华硕/Documents/Codex/2026-06-03/new-chat/outputs/quality-score/24数字经济班综测试填示例.xlsx
```

The trial file contains only `示例学生`, `DEMO2025001`, and these values: 德 `18 + 2.3 - 0.5 = 19.8`, 智 `36 + 1.2 - 0.2 = 37`, 体 `4 + 0.5 - 0.2 = 4.3`, 美 `3 + 1 - 0.3 = 3.7`, 劳 `4 + 1.5 - 0.5 = 5`, total `69.8`, rank `1`.

- [ ] **Step 5: Implement production export mapping**

Use `xlsx` to clone the sanitized template, create one 15-row detail block per student, populate the three summary tables, and apply formulas. The server export endpoint must read only records visible to the requesting administrator and must write an audit entry `quality_export_generated`.

- [ ] **Step 6: Inspect the generated workbooks**

Use artifact-tool `inspect` for formulas and formula errors, render all four sheets, and visually confirm no real student data remains. Expected formula-error scan: zero `#REF!`, `#DIV/0!`, `#VALUE!`, or `#NAME?` cells.

- [ ] **Step 7: Run tests and commit the sanitized template only**

Run: `node --test tests/quality-export.test.js`

Expected: PASS.

```bash
git add server/quality-export.js server/quality-routes.js server/templates/quality-assessment-blank.xlsx tests/quality-export.test.js tests/run-all.js
git commit -m "feat: export quality assessment workbooks"
```

---

### Task 8: End-to-End Workflow and Regression Coverage

**Files:**
- Create: `tests/quality-workflow.test.js`
- Modify: `tests/run-all.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: all server and frontend interfaces from Tasks 1-7.
- Produces: one executable lifecycle regression covering all required roles.

- [ ] **Step 1: Write the complete lifecycle test**

```js
test("assessment moves from student draft through appeal and archive", async () => {
  const draft = await student.saveDraft(fictionalItems);
  const submitted = await student.submit(draft.id);
  assert.equal(submitted.status, "class_review");
  const firstReview = await monitor.approve(submitted.id, "材料核验通过");
  assert.equal(firstReview.status, "college_review");
  const collegeReview = await collegeAdmin.approve(firstReview.id, "学院复核通过");
  assert.equal(collegeReview.status, "pending_publication");
  const published = await collegeAdmin.publish(period.id, { workingDays: 3 });
  const appeal = await student.appeal(published.id, "申请复核智育项目");
  await collegeAdmin.resolveAppeal(appeal.id, "rejected", "原核定分值符合细则");
  const archived = await collegeAdmin.archive(published.id);
  assert.equal(archived.status, "archived");
});
```

- [ ] **Step 2: Add negative lifecycle cases**

Cover own-record review, another class, another college, guest writes, closed submission period, missing evidence, stale version, duplicate active appeal, publication shorter than three working days, and attempts to edit archived records.

- [ ] **Step 3: Run targeted and full checks**

Run: `node --test tests/quality-workflow.test.js`

Expected: PASS.

Run: `npm run check`

Expected: all syntax checks and all registered test files PASS.

- [ ] **Step 4: Register quality modules in the repository check script**

Extend the `check` script in `package.json` with these syntax checks before `npm test`:

```json
"node --check public/quality-assessment.js && node --check server/quality-rules.js && node --check server/quality-store.js && node --check server/quality-evidence.js && node --check server/quality-export.js && node --check server/quality-routes.js"
```

- [ ] **Step 5: Commit**

```bash
git add tests/quality-workflow.test.js tests/run-all.js package.json
git commit -m "test: cover quality assessment lifecycle"
```

---

### Task 9: Browser Acceptance and Deployment

**Files:**
- Modify only if defects are found: `public/quality-assessment.js`, `public/assets/quality-assessment.css`, `server/quality-routes.js`, `server/quality-store.js`
- Create: `docs/operations/quality-assessment-release.md`

**Interfaces:**
- Consumes: production build and deployment configuration.
- Produces: verified local and Cloudflare Pages deployment with recorded migration steps.

- [ ] **Step 1: Start the local server**

Run: `npm run dev`

Expected: `http://localhost:5173` responds with status 200 and `/api/health` reports a usable storage mode.

- [ ] **Step 2: Run browser acceptance at desktop and mobile sizes**

Verify these identities and paths:

```text
学生：新增五育项目、保存草稿、上传材料、提交、查看公示、申诉
班长：查看本班队列、审核同学、本人记录显示回避
团支书：完成班长本人记录的初审
学院管理员：复核、退回、公示、处理申诉、导出
总管理员：跨学院查看和审计
```

Capture screenshots at `1440x900`, `1024x768`, and `390x844` in both day and night themes. Confirm no overlap, clipped text, horizontal page overflow, or inaccessible controls.

- [ ] **Step 3: Apply the database schema**

Run: `npm run db:init`

Expected: all `quality_*` tables exist and initialization is idempotent.

- [ ] **Step 4: Run final verification**

Run: `npm run check`

Expected: PASS.

Run: `git status --short`

Expected: only known unrelated user files remain untracked; no generated evidence or personal data is staged.

- [ ] **Step 5: Document release and rollback**

Record the schema command, environment variables, endpoint health checks, sanitized template path, Cloudflare deployment command, and rollback commit in `docs/operations/quality-assessment-release.md`.

- [ ] **Step 6: Push and deploy Cloudflare Pages**

```bash
git push origin main
npx wrangler pages deploy public --project-name zhihueixiaoyuan
```

Expected: Wrangler prints a successful deployment URL and `https://zhihueixiaoyuan.pages.dev/tools/quality-score` loads the new page.

- [ ] **Step 7: Verify production**

Check production login, current assessment period, one read-only record request, class reviewer authorization, and the four-sheet export. Do not create or publish a real assessment record during smoke verification.

- [ ] **Step 8: Commit release notes if they changed after verification**

```bash
git add docs/operations/quality-assessment-release.md
git commit -m "docs: record quality assessment release"
git push origin main
```
