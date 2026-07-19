const test = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryQualityStore, createMysqlQualityStore } = require("../server/quality-store");

const users = {
  student: { id: "student-1", name: "学生甲", role: "student", classId: "class-1", college: "经济与管理学院" },
  monitor: { id: "monitor-1", name: "班长甲", role: "student", classId: "class-1", classDuty: "monitor", college: "经济与管理学院" }
};
users.collegeReviewer = { id: "college-reviewer-1", name: "辅导员甲", role: "teacher", qualityRole: "college_reviewer", college: "经济与管理学院" };
users.operator = { id: "admin-1", name: "管理员甲", role: "admin", college: "经济与管理学院" };

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
    records: [
      { id: "student-record", periodId: "period-1", studentId: users.student.id, classId: "class-1", college: "经济与管理学院", status: "class_review", version: 2 },
      { id: "monitor-record", periodId: "period-1", studentId: users.monitor.id, classId: "class-1", college: "经济与管理学院", status: "class_review", version: 2 }
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

test("college reviewer advances only their college records to publication", async () => {
  const store = createMemoryQualityStore({
    records: [{
      id: "college-record", periodId: "period-1", studentId: users.student.id, classId: "class-1",
      college: "经济与管理学院", status: "college_review", version: 3
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
  const period = await store.publishPeriod("period-1", { notice: "公示开始" }, users.operator);
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
          college: "经济与管理学院", rule_version: "2025-economics-management", status: "draft",
          module_scores: "{}", total_score: 0, calculation_snapshot: "{}", risk_flags: "[]", version: 3
        }]];
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
