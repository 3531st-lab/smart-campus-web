const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryQualityStore } = require("../server/quality-store");
const { handleQualityRoute } = require("../server/quality-routes");

const users = {
  student: { id: "quality-api-student", role: "student", classId: "quality-api-class", school: "Campus A", college: "College A" },
  peer: { id: "quality-api-peer", role: "student", classId: "quality-api-class", school: "Campus A", college: "College A" },
  monitor: { id: "quality-api-monitor", role: "student", classId: "quality-api-class", school: "Campus A", college: "College A" },
  admin: { id: "quality-api-admin", role: "admin", school: "Campus A", college: "College A" },
  superAdmin: { id: "quality-api-super", role: "super_admin" },
  guest: { id: "quality-api-guest", role: "guest" }
};

function fixtures() {
  return createMemoryQualityStore({
    periods: [{ id: "quality-api-period", name: "Quality API period", status: "open", ruleVersion: "2025-economics-management" }],
    students: [users.student, users.peer, users.monitor].map((user, index) => ({ ...user, name: `学生${index + 1}`, studentNo: `DEMO00${index + 1}`, className: "示例班" })),
    classAssignments: [{ id: "quality-api-monitor-duty", classId: "quality-api-class", userId: users.monitor.id, duty: "monitor", active: true }]
  });
}

async function callRoute(store, route, user, body = {}) {
  const url = new URL(`http://campus.test${route.replace(/^\w+\s+/, "")}`);
  const response = {};
  const handled = await handleQualityRoute({
    route,
    url,
    store,
    req: {},
    res: {},
    requireUser: async () => {
      if (!user) {
        Object.assign(response, { status: 401, payload: { error: "login required" } });
        return null;
      }
      return user;
    },
    parseBody: async () => body,
    sendJson: (_res, status, payload) => Object.assign(response, { status, payload }),
    sendError: (_res, status, error) => Object.assign(response, { status, payload: { error } })
  });
  assert.equal(handled, true);
  return response;
}

test("quality API requires login and rejects guests from assessment actions", async () => {
  const store = fixtures();
  assert.equal((await callRoute(store, "GET /api/quality/periods", null)).status, 401);
  assert.equal((await callRoute(store, "GET /api/quality/records/current?periodId=quality-api-period", users.guest)).status, 403);
});

test("student can save only their own draft and submits through the API", async () => {
  const store = fixtures();
  const current = await callRoute(store, "GET /api/quality/records/current?periodId=quality-api-period", users.student);
  assert.equal(current.status, 200);

  const saved = await callRoute(store, `PUT /api/quality/records/${current.payload.record.id}/draft`, users.student, {
    version: current.payload.record.version,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.record.version, 2);

  const peerRecord = await store.getOrCreateRecord("quality-api-period", users.peer);
  const denied = await callRoute(store, `PUT /api/quality/records/${peerRecord.id}/draft`, users.student, { version: 1, items: [] });
  assert.equal(denied.status, 403);

  const submitted = await callRoute(store, `POST /api/quality/records/${current.payload.record.id}/submit`, users.student);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.payload.record.status, "class_review");
});

test("class review enforces class duty, self-recusal, and optimistic versions", async () => {
  const store = fixtures();
  const peerRecord = await store.getOrCreateRecord("quality-api-period", users.peer);
  await store.submitRecord(peerRecord.id, users.peer);
  const monitorRecord = await store.getOrCreateRecord("quality-api-period", users.monitor);
  await store.submitRecord(monitorRecord.id, users.monitor);

  const queue = await callRoute(store, "GET /api/quality/review/class?periodId=quality-api-period", users.monitor);
  assert.equal(queue.status, 200);
  assert.equal(queue.payload.total, 2);

  const stale = await callRoute(store, `POST /api/quality/review/class/${peerRecord.id}`, users.monitor, { version: 1, decision: "approved" });
  assert.equal(stale.status, 409);
  const reviewed = await callRoute(store, `POST /api/quality/review/class/${peerRecord.id}`, users.monitor, { version: 2, decision: "approved", itemDecisions: [] });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.payload.record.status, "college_review");
  const selfReview = await callRoute(store, `POST /api/quality/review/class/${monitorRecord.id}`, users.monitor, { version: 2, decision: "approved", itemDecisions: [] });
  assert.equal(selfReview.status, 403);
});

test("college review and global period operations are separated by role", async () => {
  const store = fixtures();
  const peerRecord = await store.getOrCreateRecord("quality-api-period", users.peer);
  await store.submitRecord(peerRecord.id, users.peer);
  await store.reviewClassRecord(peerRecord.id, { version: 2, decision: "approved", itemDecisions: [] }, users.monitor);

  const queue = await callRoute(store, "GET /api/admin/quality/review?periodId=quality-api-period", users.admin);
  assert.equal(queue.status, 200);
  assert.equal(queue.payload.total, 1);
  const reviewed = await callRoute(store, `POST /api/admin/quality/review/${peerRecord.id}`, users.admin, { version: 3, decision: "approved", itemDecisions: [] });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.payload.record.status, "pending_publication");

  const denied = await callRoute(store, "POST /api/admin/quality/periods", users.admin, { name: "Denied period" });
  assert.equal(denied.status, 403);
  const created = await callRoute(store, "POST /api/admin/quality/periods", users.superAdmin, { name: "Global period", status: "open" });
  assert.equal(created.status, 201);
  assert.equal(created.payload.period.name, "Global period");
});

test("administrator export creates a private workbook and leaves an audit record", async () => {
  const store = fixtures();
  const record = await store.getOrCreateRecord("quality-api-period", users.student);
  await store.saveDraft(record.id, {
    version: record.version,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  }, users.student);
  const exported = await callRoute(store, "GET /api/admin/quality/export?periodId=quality-api-period", users.admin);
  assert.equal(exported.status, 200);
  assert.match(exported.payload.filename, /\.xlsx$/);
  assert.ok(exported.payload.fileBase64.length > 100);
  const audit = await store.listAuditLogs({ action: "quality_export_generated" }, users.superAdmin);
  assert.equal(audit[0].action, "quality_export_generated");
});
