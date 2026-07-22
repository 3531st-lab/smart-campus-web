const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryQualityStore } = require("../server/quality-store");

const SCHOOL = "Demo University";
const COLLEGE = "Demo College";
const PERIOD_ID = "workflow-period";

const users = {
  student: { id: "workflow-student", role: "student", classId: "workflow-class", school: SCHOOL, college: COLLEGE },
  monitor: { id: "workflow-monitor", role: "student", classId: "workflow-class", school: SCHOOL, college: COLLEGE },
  otherStudent: { id: "workflow-other-student", role: "student", classId: "other-class", school: SCHOOL, college: COLLEGE },
  collegeAdmin: { id: "workflow-college-admin", role: "admin", school: SCHOOL, college: COLLEGE },
  otherCollegeAdmin: { id: "workflow-other-college-admin", role: "admin", school: SCHOOL, college: "Other College" },
  superAdmin: { id: "workflow-super-admin", role: "super_admin" },
  guest: { id: "workflow-guest", role: "guest" }
};

function makeStore() {
  return createMemoryQualityStore({
    periods: [{ id: PERIOD_ID, name: "Workflow assessment", status: "open", ruleVersion: "2025-economics-management" }],
    classAssignments: [{ id: "workflow-monitor-duty", classId: users.monitor.classId, userId: users.monitor.id, duty: "monitor", active: true }]
  });
}

function withClock(value, callback) {
  const NativeDate = global.Date;
  const fixed = new NativeDate(value).getTime();
  global.Date = class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }

    static now() {
      return fixed;
    }
  };
  return Promise.resolve()
    .then(callback)
    .finally(() => { global.Date = NativeDate; });
}

test("assessment moves from student draft through appeal and archive", async () => {
  const store = makeStore();
  const draft = await store.getOrCreateRecord(PERIOD_ID, users.student);

  const saved = await store.saveDraft(draft.id, {
    version: draft.version,
    items: [
      { module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 },
      { module: "moral", type: "bonus", ruleCode: "MORAL_SERVICE", claimedScore: 2 },
      { module: "moral", type: "deduction", ruleCode: "MORAL_LATE", claimedScore: 0.5 }
    ]
  }, users.student);
  assert.equal(saved.moduleScores.moral, 19.5);

  await assert.rejects(
    store.submitRecord(saved.id, users.student),
    (error) => error.statusCode === 409 && /证明材料/.test(error.message)
  );

  const bonusItem = store.data.items.find((item) => item.recordId === saved.id && item.type === "bonus");
  const deductionItem = store.data.items.find((item) => item.recordId === saved.id && item.type === "deduction");
  for (const [item, suffix] of [[bonusItem, "bonus"], [deductionItem, "deduction"]]) {
    await store.createEvidenceMetadata({
      id: `workflow-evidence-${suffix}`,
      recordId: saved.id,
      itemId: item.id,
      name: `${suffix}.pdf`,
      mimeType: "application/pdf",
      size: 256,
      digest: `digest-${suffix}`,
      storageKey: `private/${suffix}.pdf`
    }, users.student);
  }

  const submitted = await store.submitRecord(saved.id, users.student);
  assert.equal(submitted.status, "class_review");
  const classReviewed = await store.reviewClassRecord(submitted.id, {
    version: submitted.version,
    decision: "approved",
    opinion: "Class review approved",
    itemDecisions: []
  }, users.monitor);
  assert.equal(classReviewed.status, "college_review");
  const collegeReviewed = await store.reviewCollegeRecord(classReviewed.id, {
    version: classReviewed.version,
    decision: "approved",
    opinion: "College review approved",
    itemDecisions: []
  }, users.collegeAdmin);
  assert.equal(collegeReviewed.status, "pending_publication");

  await assert.rejects(
    store.publishPeriod(PERIOD_ID, { workingDays: 2 }, users.superAdmin),
    (error) => error.statusCode === 400
  );

  const { published, appeal } = await withClock("2026-07-06T08:00:00.000Z", async () => {
    const publication = await store.publishPeriod(PERIOD_ID, { notice: "Publication notice", workingDays: 3 }, users.superAdmin);
    const createdAppeal = await store.createAppeal({ recordId: submitted.id, reason: "Request a score review" }, users.student);
    await assert.rejects(
      store.createAppeal({ recordId: submitted.id, reason: "Duplicate appeal" }, users.student),
      (error) => error.statusCode === 409
    );
    return { published: publication, appeal: createdAppeal };
  });
  assert.equal(published.status, "published");

  const resolvedAppeal = await store.reviewAppeal(appeal.id, { decision: "rejected", opinion: "Original score is retained" }, users.collegeAdmin);
  assert.equal(resolvedAppeal.status, "rejected");

  const archived = await withClock("2026-07-13T08:00:00.000Z", () => store.archivePeriod(PERIOD_ID, users.superAdmin));
  assert.equal(archived.status, "archived");
  await assert.rejects(
    store.saveDraft(submitted.id, { version: collegeReviewed.version, items: [] }, users.student),
    (error) => error.statusCode === 409
  );

  const actions = (await store.listAuditLogs({ targetId: submitted.id }, users.superAdmin)).map((entry) => entry.action);
  for (const action of ["record_submitted", "class_reviewed", "college_reviewed", "period_published", "appeal_created", "appeal_reviewed", "record_archived"]) {
    assert.ok(actions.includes(action), `missing audit action: ${action}`);
  }
});

test("workflow denies cross-scope, self-review, guest, stale, and closed-period writes", async () => {
  const store = makeStore();
  const monitorRecord = await store.getOrCreateRecord(PERIOD_ID, users.monitor);
  await store.submitRecord(monitorRecord.id, users.monitor);
  await assert.rejects(
    store.reviewClassRecord(monitorRecord.id, { version: 2, decision: "approved", itemDecisions: [] }, users.monitor),
    (error) => error.statusCode === 403
  );

  const otherRecord = await store.getOrCreateRecord(PERIOD_ID, users.otherStudent);
  await store.submitRecord(otherRecord.id, users.otherStudent);
  await assert.rejects(
    store.reviewClassRecord(otherRecord.id, { version: 2, decision: "approved", itemDecisions: [] }, users.monitor),
    (error) => error.statusCode === 403
  );

  const ownRecord = await store.getOrCreateRecord(PERIOD_ID, users.student);
  await assert.rejects(
    store.saveDraft(ownRecord.id, { version: 0, items: [] }, users.student),
    (error) => error.statusCode === 409
  );
  await assert.rejects(
    store.saveDraft(ownRecord.id, { version: ownRecord.version, items: [] }, users.guest),
    (error) => error.statusCode === 403
  );

  const collegeOnlyRecord = await store.getOrCreateRecord(PERIOD_ID, { ...users.student, id: "workflow-college-target" });
  await store.submitRecord(collegeOnlyRecord.id, { ...users.student, id: "workflow-college-target" });
  const monitorReviewed = await store.reviewClassRecord(collegeOnlyRecord.id, { version: 2, decision: "approved", itemDecisions: [] }, users.monitor);
  await assert.rejects(
    store.reviewCollegeRecord(monitorReviewed.id, { version: monitorReviewed.version, decision: "approved", itemDecisions: [] }, users.otherCollegeAdmin),
    (error) => error.statusCode === 403
  );

  const closedStore = createMemoryQualityStore({
    periods: [{ id: "closed-period", name: "Closed period", status: "draft", ruleVersion: "2025-economics-management" }]
  });
  await assert.rejects(
    closedStore.getOrCreateRecord("closed-period", users.student),
    (error) => error.statusCode === 409
  );
});
