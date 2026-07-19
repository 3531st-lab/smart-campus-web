const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createMemoryQualityStore, createMysqlQualityStore } = require("../server/quality-store");

const users = {
  student: { id: "student-1", name: "学生甲", role: "student", classId: "class-1", school: "泰州学院", college: "经济与管理学院" },
  monitor: { id: "monitor-1", name: "班长甲", role: "student", classId: "class-1", school: "泰州学院", college: "经济与管理学院" }
};
users.collegeReviewer = { id: "college-reviewer-1", name: "辅导员甲", role: "teacher", qualityRole: "college_reviewer", school: "泰州学院", college: "经济与管理学院" };
users.operator = { id: "admin-1", name: "管理员甲", role: "admin", school: "泰州学院", college: "经济与管理学院" };

test("student saves and submits a versioned record", async () => {
  const store = createMemoryQualityStore({
    periods: [{ id: "period-1", name: "2025-2026 学年", status: "open", ruleVersion: "2025-economics-management" }]
  });
  const record = await store.getOrCreateRecord("period-1", users.student);
  const saved = await store.saveDraft(record.id, {
    version: record.version,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  }, users.student);

  assert.equal(saved.version, record.version + 1);

  const submitted = await store.submitRecord(record.id, users.student);
  assert.equal(submitted.status, "class_review");
});

test("monitor and league secretary review their class but not themselves", async () => {
  const store = createMemoryQualityStore({
    periods: [{ id: "period-1", name: "2025-2026 学年", status: "open", ruleVersion: "2025-economics-management" }],
    classAssignments: [
      { id: "assignment-monitor", classId: "class-1", userId: users.monitor.id, duty: "monitor", active: true }
    ],
    records: [
      { id: "student-record", periodId: "period-1", studentId: users.student.id, classId: "class-1", school: "泰州学院", college: "经济与管理学院", status: "class_review", version: 2 },
      { id: "monitor-record", periodId: "period-1", studentId: users.monitor.id, classId: "class-1", school: "泰州学院", college: "经济与管理学院", status: "class_review", version: 2 }
    ]
  });

  const queue = await store.listClassQueue({ periodId: "period-1" }, users.monitor);
  assert.ok(queue.records.some((record) => record.studentId === users.student.id));
  await assert.rejects(
    store.reviewClassRecord("monitor-record", { decision: "approved", itemDecisions: [] }, users.monitor),
    /不能审核自己的申报/
  );
  const reviewed = await store.reviewClassRecord("student-record", {
    decision: "approved",
    opinion: "材料与申报项目一致",
    itemDecisions: []
  }, users.monitor);
  assert.equal(reviewed.status, "college_review");
});

test("class review trusts only active persisted monitor, league secretary, or class admin assignments", async () => {
  const classAdmin = { id: "class-admin-1", role: "student", classId: "forged-class", classDuty: "member" };
  const inactiveMonitor = { id: "inactive-monitor-1", role: "student", classId: "class-1", classDuty: "monitor" };
  const forgedMonitor = { id: "forged-monitor-1", role: "student", classId: "class-1", classDuty: "monitor" };
  const store = createMemoryQualityStore({
    classAssignments: [
      { id: "assignment-class-admin", classId: "class-1", userId: classAdmin.id, duty: "class_admin", active: true },
      { id: "assignment-inactive", classId: "class-1", userId: inactiveMonitor.id, duty: "monitor", active: false }
    ],
    records: [{
      id: "class-admin-target", periodId: "period-1", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "class_review", version: 2
    }]
  });

  const queue = await store.listClassQueue({ periodId: "period-1" }, classAdmin);
  assert.deepEqual(queue.records.map((record) => record.id), ["class-admin-target"]);
  const reviewed = await store.reviewClassRecord("class-admin-target", {
    version: 2,
    decision: "approved",
    opinion: "班级管理员代审通过",
    itemDecisions: []
  }, classAdmin);
  assert.equal(reviewed.status, "college_review");

  await assert.rejects(
    store.listClassQueue({ periodId: "period-1" }, inactiveMonitor),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    store.listClassQueue({ periodId: "period-1" }, forgedMonitor),
    (error) => error.statusCode === 403
  );
});

test("college reviewer advances only their college records to publication", async () => {
  const store = createMemoryQualityStore({
    records: [{
      id: "college-record", periodId: "period-1", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "college_review", version: 3
    }]
  });

  const queue = await store.listCollegeQueue({ periodId: "period-1" }, users.collegeReviewer);
  assert.equal(queue.records.length, 1);
  const reviewed = await store.reviewCollegeRecord("college-record", {
    decision: "approved",
    opinion: "学院复核通过",
    itemDecisions: []
  }, users.collegeReviewer);
  assert.equal(reviewed.status, "pending_publication");
});

test("ordinary administrators list and review only records in both their school and college", async () => {
  const superAdmin = { id: "super-admin-1", role: "super_admin" };
  const store = createMemoryQualityStore({
    records: [
      { id: "same-scope", periodId: "period-1", studentId: "student-a", classId: "class-a", school: "泰州学院", college: "经济与管理学院", status: "college_review", version: 3 },
      { id: "other-school", periodId: "period-1", studentId: "student-b", classId: "class-b", school: "常州大学", college: "经济与管理学院", status: "college_review", version: 3 },
      { id: "other-college", periodId: "period-1", studentId: "student-c", classId: "class-c", school: "泰州学院", college: "计算机科学与技术学院", status: "college_review", version: 3 }
    ]
  });

  const scoped = await store.listCollegeQueue({ periodId: "period-1" }, users.operator);
  assert.deepEqual(scoped.records.map((record) => record.id), ["same-scope"]);
  await assert.rejects(
    store.reviewCollegeRecord("other-school", { version: 3, decision: "approved", opinion: "越权", itemDecisions: [] }, users.operator),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    store.reviewCollegeRecord("other-college", { version: 3, decision: "approved", opinion: "越权", itemDecisions: [] }, users.operator),
    (error) => error.statusCode === 403
  );

  const unscoped = await store.listCollegeQueue({ periodId: "period-1" }, superAdmin);
  assert.deepEqual(new Set(unscoped.records.map((record) => record.id)), new Set(["same-scope", "other-school", "other-college"]));
});

test("publication, appeals, stale writes, and audits preserve workflow accountability", async () => {
  const store = createMemoryQualityStore({
    periods: [{ id: "period-1", name: "2025-2026 学年", status: "open", ruleVersion: "2025-economics-management" }],
    records: [
      { id: "published-record", periodId: "period-1", studentId: users.student.id, classId: "class-1", college: "经济与管理学院", status: "pending_publication", version: 4 },
      { id: "stale-record", periodId: "period-1", studentId: users.student.id, classId: "class-1", college: "经济与管理学院", status: "draft", version: 2 }
    ]
  });

  await assert.rejects(
    store.saveDraft("stale-record", { version: 1, items: [] }, users.student),
    (error) => error.statusCode === 409 && /记录已被其他审核人更新/.test(error.message)
  );
  const period = await store.publishPeriod("period-1", { notice: "公示开始", workingDays: 3 }, users.operator);
  assert.equal(period.status, "published");
  assert.equal(store.data.records.find((record) => record.id === "published-record").status, "published");

  const appeal = await store.createAppeal({ recordId: "published-record", reason: "请复核加分材料" }, users.student);
  await assert.rejects(store.createAppeal({ recordId: "published-record", reason: "重复提交" }, users.student), /已有待处理申诉/);
  const resolved = await store.reviewAppeal(appeal.id, { decision: "rejected", opinion: "维持原审核结论" }, users.operator);
  assert.equal(resolved.status, "rejected");
  const auditLogs = await store.listAuditLogs({ targetId: "published-record" }, users.operator);
  assert.ok(auditLogs.some((entry) => entry.action === "period_published"));
  assert.ok(auditLogs.some((entry) => entry.action === "appeal_reviewed"));
});

test("publication enforces three working days and closes record creation and early archive", async () => {
  const store = createMemoryQualityStore({
    periods: [{ id: "period-lifecycle", name: "生命周期测试", status: "open", ruleVersion: "2025-economics-management" }],
    records: [{
      id: "record-lifecycle", periodId: "period-lifecycle", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "pending_publication", version: 4
    }]
  });

  await assert.rejects(
    store.publishPeriod("period-lifecycle", { notice: "公示期过短", workingDays: 2 }, users.operator),
    (error) => error.statusCode === 400 && /3个工作日/.test(error.message)
  );
  const published = await store.publishPeriod("period-lifecycle", { notice: "公示开始", workingDays: 3 }, users.operator);
  assert.equal(published.publicationWorkingDays, 3);
  assert.ok(new Date(published.publicationEndsAt) > new Date(published.publishedAt));

  const lateStudent = { ...users.student, id: "late-student" };
  await assert.rejects(
    store.getOrCreateRecord("period-lifecycle", lateStudent),
    (error) => error.statusCode === 409 && /不在申报期/.test(error.message)
  );
  await assert.rejects(
    store.archivePeriod("period-lifecycle", users.operator),
    (error) => error.statusCode === 409 && /公示期尚未结束/.test(error.message)
  );
});

test("archive waits for resolved appeals after the publication window", async () => {
  const store = createMemoryQualityStore({
    periods: [{
      id: "period-expired", name: "已结束公示", status: "published", ruleVersion: "2025-economics-management",
      publishedAt: "2026-06-01T00:00:00.000Z", publicationWorkingDays: 3, publicationEndsAt: "2026-06-04T00:00:00.000Z"
    }],
    records: [{
      id: "record-expired", periodId: "period-expired", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "published", version: 5
    }],
    appeals: [{
      id: "appeal-active", recordId: "record-expired", appellantId: users.student.id, reason: "申请复核",
      evidence: [], status: "submitted", activeKey: "record-expired"
    }]
  });

  await assert.rejects(
    store.archivePeriod("period-expired", users.operator),
    (error) => error.statusCode === 409 && /待处理申诉/.test(error.message)
  );
  await store.reviewAppeal("appeal-active", { decision: "rejected", opinion: "维持原结论" }, users.operator);
  const archived = await store.archivePeriod("period-expired", users.operator);
  assert.equal(archived.status, "archived");
  assert.equal(store.data.records[0].status, "archived");
  await assert.rejects(
    store.createAppeal({ recordId: "record-expired", reason: "归档后再次申诉" }, users.student),
    (error) => error.statusCode === 409
  );
});

test("memory audits use the same target types and creation events as MySQL", async () => {
  const store = createMemoryQualityStore();
  const period = await store.createPeriod({ id: "period-audit", name: "审计测试", status: "open" }, users.operator);
  const record = await store.getOrCreateRecord(period.id, users.student);
  const auditLogs = await store.listAuditLogs({}, users.operator);

  assert.ok(auditLogs.some((entry) => (
    entry.action === "period_created" && entry.targetType === "period" && entry.targetId === period.id
  )));
  assert.ok(auditLogs.some((entry) => (
    entry.action === "record_created" && entry.targetType === "record" && entry.targetId === record.id
  )));
});

test("memory store snapshots isolate nested records, review items, and appeal evidence", async () => {
  const reviewItems = [{ ruleCode: "MORAL_BASE", evidence: { url: "https://example.test/one" } }];
  const appealEvidence = [{ name: "证明材料", metadata: { source: "original" } }];
  const seed = {
    classAssignments: [{ id: "assignment-monitor", classId: "class-1", userId: users.monitor.id, duty: "monitor", active: true }],
    periods: [{ id: "period-snapshot", name: "快照测试", status: "published", ruleVersion: "2025-economics-management", publicationEndsAt: "2099-01-01T00:00:00.000Z" }],
    records: [{
      id: "record-snapshot", periodId: "period-snapshot", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "class_review", version: 2,
      moduleScores: { moral: { base: 18 } }, calculationSnapshot: { modules: { moral: { base: 18 } } }, riskFlags: [{ code: "none" }]
    }]
  };
  const store = createMemoryQualityStore(seed);
  seed.records[0].calculationSnapshot.modules.moral.base = 0;

  const queued = await store.listClassQueue({}, users.monitor);
  queued.records[0].moduleScores.moral.base = 0;
  queued.records[0].calculationSnapshot.modules.moral.base = 0;
  queued.records[0].riskFlags[0].code = "mutated";
  const freshQueue = await store.listClassQueue({}, users.monitor);
  assert.equal(freshQueue.records[0].moduleScores.moral.base, 18);
  assert.equal(freshQueue.records[0].calculationSnapshot.modules.moral.base, 18);
  assert.equal(freshQueue.records[0].riskFlags[0].code, "none");

  await store.reviewClassRecord("record-snapshot", { decision: "approved", itemDecisions: reviewItems }, users.monitor);
  reviewItems[0].evidence.url = "https://example.test/mutated";
  assert.equal(store.data.reviews[0].itemDecisions[0].evidence.url, "https://example.test/one");

  const appealStore = createMemoryQualityStore({
    periods: [{ id: "period-appeal", name: "申诉快照测试", status: "published", ruleVersion: "2025-economics-management", publicationEndsAt: "2099-01-01T00:00:00.000Z" }],
    records: [{
      id: "record-appeal", periodId: "period-appeal", studentId: users.student.id, classId: "class-1",
      school: "泰州学院", college: "经济与管理学院", status: "published", version: 4
    }]
  });
  const appeal = await appealStore.createAppeal({ recordId: "record-appeal", reason: "申请复核", evidence: appealEvidence }, users.student);
  appealEvidence[0].metadata.source = "mutated-input";
  appeal.evidence[0].metadata.source = "mutated-output";
  assert.equal(appealStore.data.appeals[0].evidence[0].metadata.source, "original");
});

test("MySQL draft writes lock records and use optimistic version updates", async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM quality_assessment_records WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{
          id: "mysql-record", period_id: "period-1", student_id: users.student.id, class_id: "class-1",
          school: "泰州学院", college: "经济与管理学院", rule_version: "2025-economics-management", status: "draft",
          module_scores: "{}", total_score: 0, calculation_snapshot: "{}", risk_flags: "[]", version: 3
        }]];
      }
      if (/FROM quality_assessment_periods WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{ id: "period-1", status: "open", rule_version: "2025-economics-management", notice: "" }]];
      }
      if (/DELETE FROM quality_assessment_items/.test(sql) || /INSERT INTO quality_assessment_items/.test(sql) || /INSERT INTO quality_assessment_audits/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE quality_assessment_records SET/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const store = createMysqlQualityStore({ async getConnection() { return connection; } });
  const saved = await store.saveDraft("mysql-record", {
    version: 3,
    items: [{ module: "moral", type: "base", ruleCode: "MORAL_BASE", claimedScore: 18 }]
  }, users.student);

  assert.equal(saved.version, 4);
  const sql = calls.filter((call) => typeof call === "object").map((call) => call.sql).join("\n");
  assert.match(sql, /quality_assessment_records WHERE id = \? FOR UPDATE/);
  assert.match(sql, /version = version \+ 1/);
  assert.equal(calls.includes("commit"), true);
});

test("MySQL college review scopes ordinary admins and rolls back rejected scoped or stale writes", async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM quality_assessment_records WHERE id = \? FOR UPDATE/.test(sql)) {
        const id = params[0];
        return [[{
          id, period_id: "period-1", student_id: users.student.id, class_id: "class-1",
          school: id === "other-school" ? "常州大学" : "泰州学院", college: "经济与管理学院",
          rule_version: "2025-economics-management", status: "college_review", module_scores: "{}",
          total_score: 0, calculation_snapshot: "{}", risk_flags: "[]", version: 3
        }]];
      }
      if (/UPDATE quality_assessment_records SET status/.test(sql)) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const pool = {
    async getConnection() { return connection; },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM quality_assessment_records WHERE status = 'college_review'/.test(sql)) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const store = createMysqlQualityStore(pool);

  await store.listCollegeQueue({ periodId: "period-1" }, users.operator);
  const queueCall = calls.find((call) => typeof call === "object" && /status = 'college_review'/.test(call.sql));
  assert.match(queueCall.sql, /AND school = \? AND college = \?/);
  assert.deepEqual(queueCall.params, [users.operator.school, users.operator.college, "period-1"]);

  await assert.rejects(
    store.reviewCollegeRecord("other-school", { decision: "approved", itemDecisions: [] }, users.operator),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    store.reviewCollegeRecord("same-scope", { decision: "approved", itemDecisions: [] }, users.operator),
    (error) => error.statusCode === 409 && /记录已被其他审核人更新/.test(error.message)
  );
  assert.equal(calls.filter((call) => call === "rollback").length, 2);
  assert.equal(calls.includes("commit"), false);
});

test("runtime initialization applies the canonical quality schema indexes", async () => {
  const dbPath = require.resolve("../server/db");
  const qualityStorePath = require.resolve("../server/quality-store");
  const originalDb = require.cache[dbPath].exports;
  const statements = [];
  const pool = {
    async query(sql) { statements.push(sql); },
    async execute() { return [[]]; }
  };

  require.cache[dbPath].exports = {
    mysqlConfigured: true,
    autoMigrateSchema: true,
    getPool: () => pool
  };
  delete require.cache[qualityStorePath];

  try {
    const runtimeStore = require("../server/quality-store");
    await runtimeStore.listPeriods(users.operator);

    const schema = fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8");
    const appliedSql = statements.join("\n");
    assert.match(schema, /CREATE TABLE IF NOT EXISTS quality_rule_versions[\s\S]*KEY idx_quality_rule_created/);
    assert.match(appliedSql, /CREATE TABLE IF NOT EXISTS quality_rule_versions[\s\S]*KEY idx_quality_rule_created/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS quality_assessment_records[\s\S]*KEY idx_quality_record_student_updated/);
    assert.match(appliedSql, /CREATE TABLE IF NOT EXISTS quality_assessment_records[\s\S]*KEY idx_quality_record_student_updated/);
    assert.doesNotMatch(fs.readFileSync(qualityStorePath, "utf8"), /const MYSQL_TABLES/);
  } finally {
    delete require.cache[qualityStorePath];
    require.cache[dbPath].exports = originalDb;
  }
});
