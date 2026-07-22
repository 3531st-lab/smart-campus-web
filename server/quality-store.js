const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const data = require("./data");
const { mysqlConfigured, autoMigrateSchema, getPool } = require("./db");
const { getQualityRuleVersion, calculateQualityRecord, validateQualityItem } = require("./quality-rules");

const TRANSITIONS = Object.freeze({
  draft: ["class_review"],
  returned: ["class_review"],
  class_review: ["returned", "college_review"],
  college_review: ["returned", "pending_publication"],
  pending_publication: ["published"],
  published: ["archived"],
  archived: []
});
const CLASS_REVIEW_DUTIES = Object.freeze(["monitor", "league_secretary", "class_admin"]);
const CLASS_REVIEW_DUTY_SET = new Set(CLASS_REVIEW_DUTIES);

let initialized = false;

function qualitySchemaStatements() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  return schema.split(";").map((statement) => statement.trim()).filter((statement) => (
    /^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) quality_(?:rule_versions|assessment_)/.test(statement)
  ));
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  if (!autoMigrateSchema) {
    initialized = true;
    return;
  }
  const pool = getPool();
  for (const statement of qualitySchemaStatements()) await pool.query(statement);
  initialized = true;
}

function publicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function publicationWorkingDays(input = {}) {
  const workingDays = Number(input.workingDays);
  if (!Number.isInteger(workingDays) || workingDays < 3) throw publicError("公示期不得少于3个工作日");
  return workingDays;
}

function addWorkingDays(start, workingDays) {
  const result = new Date(start);
  let remaining = workingDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

function requireOpenPeriod(period, now = new Date()) {
  const startsAt = period.startsAt ? new Date(period.startsAt) : null;
  const endsAt = period.endsAt ? new Date(period.endsAt) : null;
  if (period.status !== "open" || (startsAt && startsAt > now) || (endsAt && endsAt < now)) {
    throw publicError("当前不在申报期，不能创建、修改或提交申报", 409);
  }
}

function requirePublicationEnded(period, now = new Date()) {
  if (period.status !== "published") throw publicError("当前周期不在公示状态", 409);
  if (!period.publicationEndsAt || new Date(period.publicationEndsAt) > now) throw publicError("公示期尚未结束，不能归档", 409);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id), periodId: row.period_id ?? row.periodId, studentId: row.student_id ?? row.studentId,
    classId: row.class_id ?? row.classId, school: row.school || "", college: row.college || "", ruleVersion: row.rule_version ?? row.ruleVersion,
    status: row.status, moduleScores: cloneValue(jsonValue(row.module_scores ?? row.moduleScores, {})), totalScore: Number(row.total_score ?? row.totalScore ?? 0),
    calculationSnapshot: cloneValue(jsonValue(row.calculation_snapshot ?? row.calculationSnapshot, {})), riskFlags: cloneValue(jsonValue(row.risk_flags ?? row.riskFlags, [])),
    version: Number(row.version ?? 1), submittedAt: row.submitted_at ?? row.submittedAt ?? null,
    archivedAt: row.archived_at ?? row.archivedAt ?? null, createdAt: row.created_at ?? row.createdAt ?? null, updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function normalizePeriod(row) {
  if (!row) return null;
  return {
    id: String(row.id), name: row.name, status: row.status, ruleVersion: row.rule_version ?? row.ruleVersion,
    startsAt: row.starts_at ?? row.startsAt ?? null, endsAt: row.ends_at ?? row.endsAt ?? null,
    notice: row.notice || "", createdBy: row.created_by ?? row.createdBy ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    publicationWorkingDays: Number(row.publication_working_days ?? row.publicationWorkingDays ?? 0) || null,
    publicationEndsAt: row.publication_ends_at ?? row.publicationEndsAt ?? null,
    archivedAt: row.archived_at ?? row.archivedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null, updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function normalizeAppeal(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    recordId: row.record_id ?? row.recordId,
    appellantId: row.appellant_id ?? row.appellantId,
    reason: row.reason,
    status: row.status,
    activeKey: row.active_key ?? row.activeKey ?? null,
    reviewerId: row.reviewer_id ?? row.reviewerId ?? null,
    opinion: row.opinion ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function requireVersion(input, record) {
  if (Number(input?.version) !== Number(record.version)) {
    throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
  }
}

function createMemoryQualityStore(seed = {}) {
  const data = {
    periods: cloneValue(seed.periods || seed.qualityAssessmentPeriods || []),
    records: cloneValue(seed.records || seed.qualityAssessmentRecords || []),
    items: cloneValue(seed.items || seed.qualityAssessmentItems || []),
    reviews: cloneValue(seed.reviews || seed.qualityAssessmentReviews || []),
    appeals: cloneValue(seed.appeals || seed.qualityAssessmentAppeals || []),
    auditLogs: cloneValue(seed.auditLogs || seed.qualityAssessmentAudits || []),
    classAssignments: cloneValue(seed.classAssignments || [])
  };

  function requireOperator(user) {
    if (!["admin", "super_admin"].includes(user?.role)) throw publicError("仅管理员可以执行该操作", 403);
  }

  function requireGlobalPeriodOperator(user) {
    if (user?.role !== "super_admin") throw publicError("仅超级管理员可以管理全局综测周期", 403);
  }

  function requireRecordScope(user, record, message = "无权处理其他学校或学院的记录") {
    if (user?.role !== "super_admin" && (
      String(user?.school || "") !== String(record.school || "")
      || String(user?.college || "") !== String(record.college || "")
    )) throw publicError(message, 403);
  }

  function recordById(recordId) {
    const record = data.records.find((entry) => String(entry.id) === String(recordId));
    if (!record) throw publicError("综测申报不存在", 404);
    return record;
  }

  function addAuditLog(operator, action, targetType, targetId, metadata = null) {
    const audit = {
      id: `quality-audit-${crypto.randomUUID()}`,
      operatorId: String(operator.id),
      action,
      targetType,
      targetId: String(targetId),
      metadata: cloneValue(metadata),
      createdAt: new Date().toISOString()
    };
    data.auditLogs.push(audit);
    return cloneValue(audit);
  }

  function transition(record, nextStatus) {
    if (!TRANSITIONS[record.status]?.includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
    record.status = nextStatus;
    record.version = Number(record.version || 1) + 1;
    record.updatedAt = new Date().toISOString();
  }

  function classReviewAssignments(reviewer) {
    return data.classAssignments.filter((assignment) => (
      String(assignment.userId ?? assignment.user_id) === String(reviewer?.id)
      && (assignment.active === true || Number(assignment.active) === 1)
      && CLASS_REVIEW_DUTY_SET.has(assignment.duty)
    ));
  }

  function requireClassReviewer(reviewer, record) {
    const assignment = classReviewAssignments(reviewer)
      .find((entry) => String(entry.classId ?? entry.class_id) === String(record.classId));
    if (!assignment) throw publicError("仅本班在任班长、团支书或班级管理员可以审核", 403);
    return assignment;
  }

  function requireCollegeReviewer(reviewer, record) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    if (reviewer.role !== "super_admin" && (
      String(reviewer.school || "") !== String(record.school || "")
      || String(reviewer.college || "") !== String(record.college || "")
    )) {
      throw publicError("无权审核其他学校或学院的申报", 403);
    }
  }

  async function getOrCreateRecord(periodId, user) {
    const period = data.periods.find((entry) => String(entry.id) === String(periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    let record = data.records.find((entry) => String(entry.periodId) === String(periodId) && String(entry.studentId) === String(user.id));
    if (!record) {
      requireOpenPeriod(period);
      const ruleVersion = period.ruleVersion || getQualityRuleVersion().id;
      const calculated = calculateQualityRecord({});
      record = {
        id: `quality-record-${crypto.randomUUID()}`,
        periodId: String(periodId),
        studentId: String(user.id),
        classId: String(user.classId || user.class_id || ""),
        school: String(user.school || ""),
        college: String(user.college || ""),
        ruleVersion,
        status: "draft",
        moduleScores: cloneValue(calculated.moduleScores),
        totalScore: calculated.totalScore,
        calculationSnapshot: cloneValue(calculated),
        riskFlags: cloneValue(calculated.warnings),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.records.push(record);
      addAuditLog(user, "record_created", "record", record.id);
    }
    return cloneValue(record);
  }

  async function createPeriod(input = {}, operator) {
    requireGlobalPeriodOperator(operator);
    const period = {
      id: String(input.id || `quality-period-${crypto.randomUUID()}`),
      name: String(input.name || "综测周期").trim(),
      status: input.status === "open" ? "open" : "draft",
      ruleVersion: String(input.ruleVersion || getQualityRuleVersion().id),
      startsAt: input.startsAt || null,
      endsAt: input.endsAt || null,
      notice: String(input.notice || ""),
      createdBy: String(operator.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!period.name) throw publicError("综测周期名称不能为空");
    if (data.periods.some((entry) => String(entry.id) === period.id)) throw publicError("综测周期已存在", 409);
    data.periods.push(period);
    addAuditLog(operator, "period_created", "period", period.id);
    return cloneValue(period);
  }

  async function listPeriods(user) {
    const periods = data.periods
      .filter((period) => ["admin", "super_admin"].includes(user?.role) || ["open", "published"].includes(period.status))
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    return periods.map(cloneValue);
  }

  async function saveDraft(recordId, input = {}, user) {
    const record = recordById(recordId);
    const period = data.periods.find((entry) => String(entry.id) === String(record.periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    requireOpenPeriod(period);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权修改该综测申报", 403);
    if (!["draft", "returned"].includes(record.status)) throw publicError("当前状态不能保存草稿", 409);
    if (Number(input.version) !== Number(record.version)) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
    const items = (input.items || []).map((item) => validateQualityItem(item));
    const modules = {};
    for (const item of items) {
      modules[item.module] ||= {};
      modules[item.module][item.type] = Number(modules[item.module][item.type] || 0) + item.claimedScore;
    }
    const calculated = calculateQualityRecord({ modules, zeroRuleCodes: input.zeroRuleCodes || [] });
    data.items = data.items.filter((item) => String(item.recordId) !== String(record.id));
    data.items.push(...items.map((item) => ({ ...cloneValue(item), id: `quality-item-${crypto.randomUUID()}`, recordId: record.id })));
    Object.assign(record, {
      moduleScores: cloneValue(calculated.moduleScores),
      totalScore: calculated.totalScore,
      calculationSnapshot: cloneValue(calculated),
      riskFlags: cloneValue(calculated.warnings),
      version: Number(record.version) + 1,
      updatedAt: new Date().toISOString()
    });
    addAuditLog(user, "draft_saved", "record", record.id);
    return cloneValue(record);
  }

  async function submitRecord(recordId, user) {
    const record = recordById(recordId);
    const period = data.periods.find((entry) => String(entry.id) === String(record.periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    requireOpenPeriod(period);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权提交该综测申报", 403);
    if (!TRANSITIONS[record.status]?.includes("class_review")) throw publicError("当前状态不能提交", 409);
    transition(record, "class_review");
    record.submittedAt = new Date().toISOString();
    record.updatedAt = record.submittedAt;
    addAuditLog(user, "record_submitted", "record", record.id);
    return cloneValue(record);
  }

  async function listClassQueue(filters = {}, reviewer) {
    const assignments = classReviewAssignments(reviewer);
    if (!assignments.length) throw publicError("仅本班在任班长、团支书或班级管理员可以审核", 403);
    const classIds = new Set(assignments.map((assignment) => String(assignment.classId ?? assignment.class_id)));
    const records = data.records
      .filter((record) => record.status === "class_review")
      .filter((record) => classIds.has(String(record.classId)))
      .filter((record) => !filters.periodId || String(record.periodId) === String(filters.periodId))
      .map(cloneValue);
    return { records, total: records.length };
  }

  async function reviewClassRecord(recordId, input = {}, reviewer) {
    const record = recordById(recordId);
    requireClassReviewer(reviewer, record);
    if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
    requireVersion(input, record);
    const nextStatus = input.decision === "approved" ? "college_review" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    transition(record, nextStatus);
    const review = {
      id: `quality-review-${crypto.randomUUID()}`,
      recordId: record.id,
      stage: "class",
      reviewerId: String(reviewer.id),
      decision: input.decision,
      opinion: String(input.opinion || ""),
      itemDecisions: cloneValue(input.itemDecisions || []),
      createdAt: new Date().toISOString()
    };
    data.reviews.push(review);
    addAuditLog(reviewer, "class_reviewed", "record", record.id, { decision: input.decision });
    return cloneValue(record);
  }

  async function listCollegeQueue(filters = {}, reviewer) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    const records = data.records
      .filter((record) => record.status === "college_review")
      .filter((record) => !filters.periodId || String(record.periodId) === String(filters.periodId))
      .filter((record) => reviewer.role === "super_admin" || (
        String(record.school || "") === String(reviewer.school || "")
        && String(record.college || "") === String(reviewer.college || "")
      ));
    const scoped = records.map(cloneValue);
    return { records: scoped, total: scoped.length };
  }

  async function listExportRecords(filters = {}, user) {
    requireOperator(user);
    const records = data.records
      .filter((record) => !filters.periodId || String(record.periodId) === String(filters.periodId))
      .filter((record) => !filters.classId || String(record.classId) === String(filters.classId))
      .filter((record) => user.role === "super_admin" || (
        String(record.school || "") === String(user.school || "")
        && String(record.college || "") === String(user.college || "")
      ))
      .sort((left, right) => String(left.classId || "").localeCompare(String(right.classId || "")) || String(left.studentId).localeCompare(String(right.studentId)))
      .map(cloneValue);
    return { records, total: records.length };
  }

  async function reviewCollegeRecord(recordId, input = {}, reviewer) {
    const record = recordById(recordId);
    requireCollegeReviewer(reviewer, record);
    if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
    requireVersion(input, record);
    const nextStatus = input.decision === "approved" ? "pending_publication" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    transition(record, nextStatus);
    data.reviews.push({
      id: `quality-review-${crypto.randomUUID()}`,
      recordId: record.id,
      stage: "college",
      reviewerId: String(reviewer.id),
      decision: input.decision,
      opinion: String(input.opinion || ""),
      itemDecisions: cloneValue(input.itemDecisions || []),
      createdAt: new Date().toISOString()
    });
    addAuditLog(reviewer, "college_reviewed", "record", record.id, { decision: input.decision });
    return cloneValue(record);
  }

  async function publishPeriod(periodId, input = {}, operator) {
    requireGlobalPeriodOperator(operator);
    const workingDays = publicationWorkingDays(input);
    const period = data.periods.find((entry) => String(entry.id) === String(periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    if (period.status !== "open") throw publicError("当前周期不能开始公示", 409);
    const records = data.records.filter((record) => String(record.periodId) === String(periodId));
    if (!records.length || records.some((record) => record.status !== "pending_publication")) {
      throw publicError("周期内仍有未完成的申报，不能开始公示", 409);
    }
    const publishedAt = new Date();
    const publicationEndsAt = addWorkingDays(publishedAt, workingDays);
    for (const record of records) {
      transition(record, "published");
      record.publishedAt = record.updatedAt;
      addAuditLog(operator, "period_published", "record", record.id, { periodId: period.id, notice: String(input.notice || "") });
    }
    period.status = "published";
    period.notice = String(input.notice || period.notice || "");
    period.publishedAt = publishedAt.toISOString();
    period.publicationWorkingDays = workingDays;
    period.publicationEndsAt = publicationEndsAt.toISOString();
    period.updatedAt = period.publishedAt;
    addAuditLog(operator, "period_published", "period", period.id, { publishedCount: records.length });
    return cloneValue({ ...period, publishedCount: records.length });
  }

  async function archivePeriod(periodId, operator) {
    requireGlobalPeriodOperator(operator);
    const period = data.periods.find((entry) => String(entry.id) === String(periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    requirePublicationEnded(period);
    const periodRecordIds = new Set(data.records
      .filter((record) => String(record.periodId) === String(periodId))
      .map((record) => String(record.id)));
    if (data.appeals.some((appeal) => periodRecordIds.has(String(appeal.recordId)) && appeal.activeKey)) {
      throw publicError("仍有待处理申诉，不能归档", 409);
    }
    const records = data.records.filter((record) => String(record.periodId) === String(periodId));
    if (records.some((record) => record.status !== "published")) throw publicError("周期内仍有未完成的申报，不能归档", 409);
    const archivedAt = new Date().toISOString();
    for (const record of records) {
      transition(record, "archived");
      record.archivedAt = archivedAt;
      addAuditLog(operator, "record_archived", "record", record.id, { periodId: period.id });
    }
    period.status = "archived";
    period.archivedAt = archivedAt;
    period.updatedAt = archivedAt;
    addAuditLog(operator, "period_archived", "period", period.id, { archivedCount: records.length });
    return cloneValue({ ...period, archivedCount: records.length });
  }

  async function createAppeal(input = {}, user) {
    const record = recordById(input.recordId);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权发起该申诉", 403);
    const period = data.periods.find((entry) => String(entry.id) === String(record.periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    if (record.status !== "published" || period.status !== "published" || !period.publicationEndsAt || new Date(period.publicationEndsAt) < new Date()) {
      throw publicError("当前状态不能发起申诉", 409);
    }
    if (data.appeals.some((appeal) => String(appeal.recordId) === String(record.id) && ["submitted", "reviewing"].includes(appeal.status))) {
      throw publicError("已有待处理申诉", 409);
    }
    const appeal = {
      id: `quality-appeal-${crypto.randomUUID()}`,
      recordId: record.id,
      appellantId: String(user.id),
      reason: String(input.reason || "").trim(),
      evidence: cloneValue(input.evidence || []),
      status: "submitted",
      activeKey: String(record.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!appeal.reason) throw publicError("申诉理由不能为空");
    data.appeals.push(appeal);
    addAuditLog(user, "appeal_created", "record", record.id, { appealId: appeal.id });
    return cloneValue(normalizeAppeal(appeal));
  }

  async function reviewAppeal(appealId, input = {}, reviewer) {
    requireOperator(reviewer);
    const appeal = data.appeals.find((entry) => String(entry.id) === String(appealId));
    if (!appeal) throw publicError("申诉不存在", 404);
    const record = recordById(appeal.recordId);
    requireRecordScope(reviewer, record, "无权处理其他学校或学院的申诉");
    if (!["submitted", "reviewing"].includes(appeal.status)) throw publicError("申诉已处理", 409);
    if (!["approved", "rejected"].includes(input.decision)) throw publicError("申诉决定无效");
    appeal.status = input.decision;
    appeal.reviewerId = String(reviewer.id);
    appeal.opinion = String(input.opinion || "");
    appeal.activeKey = null;
    appeal.reviewedAt = new Date().toISOString();
    appeal.updatedAt = appeal.reviewedAt;
    addAuditLog(reviewer, "appeal_reviewed", "record", appeal.recordId, { appealId: appeal.id, decision: input.decision });
    return cloneValue(normalizeAppeal(appeal));
  }

  async function listAuditLogs(filters = {}, user) {
    requireOperator(user);
    return data.auditLogs
      .filter((entry) => {
        if (user.role === "super_admin") return true;
        if (entry.targetType !== "record") return false;
        const record = data.records.find((candidate) => String(candidate.id) === String(entry.targetId));
        return record
          && String(record.school || "") === String(user.school || "")
          && String(record.college || "") === String(user.college || "");
      })
      .filter((entry) => !filters.targetId || String(entry.targetId) === String(filters.targetId))
      .filter((entry) => !filters.action || entry.action === filters.action)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(cloneValue);
  }

  return {
    get data() { return cloneValue(data); },
    getOrCreateRecord,
    saveDraft,
    submitRecord,
    listClassQueue,
    reviewClassRecord,
    listCollegeQueue,
    listExportRecords,
    reviewCollegeRecord,
    createPeriod,
    listPeriods,
    publishPeriod,
    archivePeriod,
    createAppeal,
    reviewAppeal,
    listAuditLogs
  };
}

function createMysqlQualityStore(pool) {
  function requireOperator(user) {
    if (!["admin", "super_admin"].includes(user?.role)) throw publicError("仅管理员可以执行该操作", 403);
  }

  function requireGlobalPeriodOperator(user) {
    if (user?.role !== "super_admin") throw publicError("仅超级管理员可以管理全局综测周期", 403);
  }

  function requireRecordScope(user, record, message = "无权处理其他学校或学院的记录") {
    if (user?.role !== "super_admin" && (
      String(user?.school || "") !== String(record.school || "")
      || String(user?.college || "") !== String(record.college || "")
    )) throw publicError(message, 403);
  }

  async function listClassReviewAssignments(reviewer, connection = pool, classId = null, forUpdate = false) {
    const params = [reviewer?.id, ...CLASS_REVIEW_DUTIES];
    let sql = "SELECT class_id, duty FROM class_assignments WHERE user_id = ? AND active = 1 AND duty IN (?, ?, ?)";
    if (classId !== null) {
      sql += " AND class_id = ?";
      params.push(classId);
    }
    if (forUpdate) sql += " FOR UPDATE";
    const [rows] = await connection.execute(sql, params);
    return rows;
  }

  async function requireClassReviewer(reviewer, record, connection = pool, forUpdate = false) {
    const assignments = await listClassReviewAssignments(reviewer, connection, record.classId, forUpdate);
    if (!assignments.length) throw publicError("仅本班在任班长、团支书或班级管理员可以审核", 403);
    return assignments[0];
  }

  function requireCollegeReviewer(reviewer, record) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    if (reviewer.role !== "super_admin" && (
      String(reviewer.school || "") !== String(record.school || "")
      || String(reviewer.college || "") !== String(record.college || "")
    )) throw publicError("无权审核其他学校或学院的申报", 403);
  }

  async function transaction(work) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.code)) {
        throw publicError("系统繁忙，请刷新后重试", 409);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function findRecord(recordId, connection = pool, forUpdate = false) {
    const [rows] = await connection.execute(`SELECT * FROM quality_assessment_records WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`, [recordId]);
    const record = normalizeRecord(rows[0]);
    if (!record) throw publicError("综测申报不存在", 404);
    return record;
  }

  async function findPeriod(periodId, connection = pool, forUpdate = false) {
    const [rows] = await connection.execute(`SELECT * FROM quality_assessment_periods WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`, [periodId]);
    const period = normalizePeriod(rows[0]);
    if (!period) throw publicError("综测周期不存在", 404);
    return period;
  }

  async function findRecordWithPeriodForUpdate(recordId, connection) {
    const discoveredRecord = await findRecord(recordId, connection);
    const period = await findPeriod(discoveredRecord.periodId, connection, true);
    const record = await findRecord(recordId, connection, true);
    if (String(record.periodId) !== String(period.id)) {
      throw publicError("综测申报所属周期已变更，请刷新后重试", 409);
    }
    return { record, period };
  }

  async function addAuditLog(connection, operator, action, targetType, targetId, metadata = null) {
    await connection.execute(
      "INSERT INTO quality_assessment_audits (id, operator_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      [`quality-audit-${crypto.randomUUID()}`, String(operator.id), action, targetType, String(targetId), JSON.stringify(metadata)]
    );
  }

  async function createPeriod(input = {}, operator) {
    requireGlobalPeriodOperator(operator);
    const period = {
      id: String(input.id || `quality-period-${crypto.randomUUID()}`), name: String(input.name || "综测周期").trim(),
      status: input.status === "open" ? "open" : "draft", ruleVersion: String(input.ruleVersion || getQualityRuleVersion().id),
      startsAt: input.startsAt || null, endsAt: input.endsAt || null, notice: String(input.notice || ""), createdBy: String(operator.id)
    };
    if (!period.name) throw publicError("综测周期名称不能为空");
    await transaction(async (connection) => {
      await connection.execute(
        "INSERT INTO quality_assessment_periods (id, name, status, rule_version, starts_at, ends_at, notice, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [period.id, period.name, period.status, period.ruleVersion, period.startsAt, period.endsAt, period.notice, period.createdBy]
      );
      await addAuditLog(connection, operator, "period_created", "period", period.id);
    });
    return period;
  }

  async function listPeriods(user) {
    const [rows] = await pool.execute(
      ["admin", "super_admin"].includes(user?.role)
        ? "SELECT * FROM quality_assessment_periods ORDER BY created_at DESC"
        : "SELECT * FROM quality_assessment_periods WHERE status IN ('open', 'published') ORDER BY created_at DESC"
    );
    return rows.map(normalizePeriod);
  }

  async function getOrCreateRecord(periodId, user) {
    return transaction(async (connection) => {
      const period = await findPeriod(periodId, connection, true);
      const [existingRows] = await connection.execute("SELECT * FROM quality_assessment_records WHERE period_id = ? AND student_id = ? FOR UPDATE", [periodId, user.id]);
      const existing = normalizeRecord(existingRows[0]);
      if (existing) return existing;
      requireOpenPeriod(period);
      const calculation = calculateQualityRecord({});
      const record = {
        id: `quality-record-${crypto.randomUUID()}`, periodId: String(periodId), studentId: String(user.id),
        classId: String(user.classId || user.class_id || ""), school: String(user.school || ""), college: String(user.college || ""), ruleVersion: period.ruleVersion,
        status: "draft", moduleScores: calculation.moduleScores, totalScore: calculation.totalScore,
        calculationSnapshot: calculation, riskFlags: calculation.warnings, version: 1
      };
      await connection.execute(
        "INSERT INTO quality_assessment_records (id, period_id, student_id, class_id, school, college, rule_version, status, module_scores, total_score, calculation_snapshot, risk_flags, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record.id, record.periodId, record.studentId, record.classId, record.school, record.college, record.ruleVersion, record.status, JSON.stringify(record.moduleScores), record.totalScore, JSON.stringify(record.calculationSnapshot), JSON.stringify(record.riskFlags), record.version]
      );
      await addAuditLog(connection, user, "record_created", "record", record.id);
      return record;
    });
  }

  async function saveDraft(recordId, input = {}, user) {
    return transaction(async (connection) => {
      const { record, period } = await findRecordWithPeriodForUpdate(recordId, connection);
      requireOpenPeriod(period);
      if (String(record.studentId) !== String(user.id)) throw publicError("无权修改该综测申报", 403);
      if (!["draft", "returned"].includes(record.status)) throw publicError("当前状态不能保存草稿", 409);
      if (Number(input.version) !== record.version) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      const items = (input.items || []).map((item) => validateQualityItem(item));
      const modules = {};
      for (const item of items) {
        modules[item.module] ||= {};
        modules[item.module][item.type] = Number(modules[item.module][item.type] || 0) + item.claimedScore;
      }
      const calculation = calculateQualityRecord({ modules, zeroRuleCodes: input.zeroRuleCodes || [] });
      await connection.execute("DELETE FROM quality_assessment_items WHERE record_id = ?", [record.id]);
      for (const item of items) {
        await connection.execute(
          "INSERT INTO quality_assessment_items (id, record_id, module, item_type, rule_code, claimed_score, evidence_required) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [`quality-item-${crypto.randomUUID()}`, record.id, item.module, item.type, item.ruleCode, item.claimedScore, item.evidenceRequired ? 1 : 0]
        );
      }
      const [updated] = await connection.execute(
        "UPDATE quality_assessment_records SET module_scores = ?, total_score = ?, calculation_snapshot = ?, risk_flags = ?, version = version + 1 WHERE id = ? AND version = ?",
        [JSON.stringify(calculation.moduleScores), calculation.totalScore, JSON.stringify(calculation), JSON.stringify(calculation.warnings), record.id, record.version]
      );
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await addAuditLog(connection, user, "draft_saved", "record", record.id);
      return { ...record, moduleScores: calculation.moduleScores, totalScore: calculation.totalScore, calculationSnapshot: calculation, riskFlags: calculation.warnings, version: record.version + 1 };
    });
  }

  async function submitRecord(recordId, user) {
    return transaction(async (connection) => {
      const { record, period } = await findRecordWithPeriodForUpdate(recordId, connection);
      requireOpenPeriod(period);
      if (String(record.studentId) !== String(user.id)) throw publicError("无权提交该综测申报", 403);
      if (!TRANSITIONS[record.status]?.includes("class_review")) throw publicError("当前状态不能提交", 409);
      const submittedAt = new Date().toISOString();
      const [updated] = await connection.execute(
        "UPDATE quality_assessment_records SET status = 'class_review', submitted_at = ?, version = version + 1 WHERE id = ? AND version = ?",
        [submittedAt, record.id, record.version]
      );
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await addAuditLog(connection, user, "record_submitted", "record", record.id);
      return { ...record, status: "class_review", version: record.version + 1, submittedAt };
    });
  }

  async function listClassQueue(filters = {}, reviewer) {
    const assignments = await listClassReviewAssignments(reviewer);
    if (!assignments.length) throw publicError("仅本班在任班长、团支书或班级管理员可以审核", 403);
    const classIds = [...new Set(assignments.map((assignment) => String(assignment.class_id ?? assignment.classId)))];
    const params = [...classIds];
    let sql = `SELECT * FROM quality_assessment_records WHERE status = 'class_review' AND class_id IN (${classIds.map(() => "?").join(", ")})`;
    if (filters.periodId) { sql += " AND period_id = ?"; params.push(filters.periodId); }
    sql += " ORDER BY updated_at ASC";
    const [rows] = await pool.execute(sql, params);
    const records = rows.map(normalizeRecord);
    return { records, total: records.length };
  }

  async function reviewClassRecord(recordId, input = {}, reviewer) {
    const nextStatus = input.decision === "approved" ? "college_review" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    return transaction(async (connection) => {
      const { record } = await findRecordWithPeriodForUpdate(recordId, connection);
      await requireClassReviewer(reviewer, record, connection, true);
      if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
      requireVersion(input, record);
      if (!TRANSITIONS[record.status]?.includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
      const [updated] = await connection.execute("UPDATE quality_assessment_records SET status = ?, version = version + 1 WHERE id = ? AND version = ?", [nextStatus, record.id, record.version]);
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await connection.execute("INSERT INTO quality_assessment_reviews (id, record_id, stage, reviewer_id, decision, opinion, item_decisions) VALUES (?, ?, 'class', ?, ?, ?, ?)", [`quality-review-${crypto.randomUUID()}`, record.id, reviewer.id, input.decision, String(input.opinion || ""), JSON.stringify(input.itemDecisions || [])]);
      await addAuditLog(connection, reviewer, "class_reviewed", "record", record.id, { decision: input.decision });
      return { ...record, status: nextStatus, version: record.version + 1 };
    });
  }

  async function listCollegeQueue(filters = {}, reviewer) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    const params = [];
    let sql = "SELECT * FROM quality_assessment_records WHERE status = 'college_review'";
    if (reviewer.role !== "super_admin") {
      sql += " AND school = ? AND college = ?";
      params.push(reviewer.school || "", reviewer.college || "");
    }
    if (filters.periodId) { sql += " AND period_id = ?"; params.push(filters.periodId); }
    sql += " ORDER BY updated_at ASC";
    const [rows] = await pool.execute(sql, params);
    const records = rows.map(normalizeRecord);
    return { records, total: records.length };
  }

  async function listExportRecords(filters = {}, user) {
    requireOperator(user);
    const clauses = [];
    const params = [];
    if (user.role !== "super_admin") {
      clauses.push("school = ? AND college = ?");
      params.push(user.school || "", user.college || "");
    }
    if (filters.periodId) { clauses.push("period_id = ?"); params.push(filters.periodId); }
    if (filters.classId) { clauses.push("class_id = ?"); params.push(filters.classId); }
    const [rows] = await pool.execute(
      `SELECT * FROM quality_assessment_records${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY class_id ASC, student_id ASC`,
      params
    );
    const records = rows.map(normalizeRecord);
    return { records, total: records.length };
  }

  async function reviewCollegeRecord(recordId, input = {}, reviewer) {
    const nextStatus = input.decision === "approved" ? "pending_publication" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    return transaction(async (connection) => {
      const { record } = await findRecordWithPeriodForUpdate(recordId, connection);
      requireCollegeReviewer(reviewer, record);
      if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
      requireVersion(input, record);
      if (!TRANSITIONS[record.status]?.includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
      const [updated] = await connection.execute("UPDATE quality_assessment_records SET status = ?, version = version + 1 WHERE id = ? AND version = ?", [nextStatus, record.id, record.version]);
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await connection.execute("INSERT INTO quality_assessment_reviews (id, record_id, stage, reviewer_id, decision, opinion, item_decisions) VALUES (?, ?, 'college', ?, ?, ?, ?)", [`quality-review-${crypto.randomUUID()}`, record.id, reviewer.id, input.decision, String(input.opinion || ""), JSON.stringify(input.itemDecisions || [])]);
      await addAuditLog(connection, reviewer, "college_reviewed", "record", record.id, { decision: input.decision });
      return { ...record, status: nextStatus, version: record.version + 1 };
    });
  }

  async function publishPeriod(periodId, input = {}, operator) {
    requireGlobalPeriodOperator(operator);
    const workingDays = publicationWorkingDays(input);
    return transaction(async (connection) => {
      const period = await findPeriod(periodId, connection, true);
      if (period.status !== "open") throw publicError("当前周期不能开始公示", 409);
      const [rows] = await connection.execute("SELECT * FROM quality_assessment_records WHERE period_id = ? FOR UPDATE", [periodId]);
      const records = rows.map(normalizeRecord);
      if (!records.length || records.some((record) => record.status !== "pending_publication")) {
        throw publicError("周期内仍有未完成的申报，不能开始公示", 409);
      }
      const publishedAt = new Date();
      const publicationEndsAt = addWorkingDays(publishedAt, workingDays);
      for (const record of records) {
        const [updated] = await connection.execute("UPDATE quality_assessment_records SET status = 'published', version = version + 1 WHERE id = ? AND version = ?", [record.id, record.version]);
        if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
        await addAuditLog(connection, operator, "period_published", "record", record.id, { periodId, notice: String(input.notice || "") });
      }
      const [updatedPeriod] = await connection.execute(
        "UPDATE quality_assessment_periods SET status = 'published', notice = ?, published_at = ?, publication_working_days = ?, publication_ends_at = ? WHERE id = ? AND status = 'open'",
        [String(input.notice || period.notice || ""), publishedAt, workingDays, publicationEndsAt, periodId]
      );
      if (!updatedPeriod.affectedRows) throw publicError("综测周期已被其他管理员更新，请刷新后重试", 409);
      await addAuditLog(connection, operator, "period_published", "period", periodId, { publishedCount: records.length });
      return {
        ...period,
        status: "published",
        notice: String(input.notice || period.notice || ""),
        publishedAt: publishedAt.toISOString(),
        publicationWorkingDays: workingDays,
        publicationEndsAt: publicationEndsAt.toISOString(),
        publishedCount: records.length
      };
    });
  }

  async function archivePeriod(periodId, operator) {
    requireGlobalPeriodOperator(operator);
    return transaction(async (connection) => {
      const period = await findPeriod(periodId, connection, true);
      requirePublicationEnded(period);
      const [activeAppeals] = await connection.execute(
        "SELECT qa.id FROM quality_assessment_appeals qa INNER JOIN quality_assessment_records qr ON qr.id = qa.record_id WHERE qr.period_id = ? AND qa.active_key IS NOT NULL FOR UPDATE",
        [periodId]
      );
      if (activeAppeals.length) throw publicError("仍有待处理申诉，不能归档", 409);
      const [rows] = await connection.execute("SELECT * FROM quality_assessment_records WHERE period_id = ? FOR UPDATE", [periodId]);
      const records = rows.map(normalizeRecord);
      if (records.some((record) => record.status !== "published")) throw publicError("周期内仍有未完成的申报，不能归档", 409);
      const archivedAt = new Date();
      for (const record of records) {
        const [updated] = await connection.execute(
          "UPDATE quality_assessment_records SET status = 'archived', archived_at = ?, version = version + 1 WHERE id = ? AND version = ?",
          [archivedAt, record.id, record.version]
        );
        if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
        await addAuditLog(connection, operator, "record_archived", "record", record.id, { periodId });
      }
      await connection.execute("UPDATE quality_assessment_periods SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'published'", [archivedAt, periodId]);
      await addAuditLog(connection, operator, "period_archived", "period", periodId, { archivedCount: records.length });
      return { ...period, status: "archived", archivedAt: archivedAt.toISOString(), archivedCount: records.length };
    });
  }

  async function createAppeal(input = {}, user) {
    return transaction(async (connection) => {
      const { record, period } = await findRecordWithPeriodForUpdate(input.recordId, connection);
      if (String(record.studentId) !== String(user.id)) throw publicError("无权发起该申诉", 403);
      if (record.status !== "published" || period.status !== "published" || !period.publicationEndsAt || new Date(period.publicationEndsAt) < new Date()) {
        throw publicError("当前状态不能发起申诉", 409);
      }
      const [existing] = await connection.execute("SELECT id FROM quality_assessment_appeals WHERE record_id = ? AND active_key IS NOT NULL FOR UPDATE", [record.id]);
      if (existing.length) throw publicError("已有待处理申诉", 409);
      const appeal = { id: `quality-appeal-${crypto.randomUUID()}`, recordId: record.id, appellantId: String(user.id), reason: String(input.reason || "").trim(), evidence: input.evidence || [], status: "submitted", activeKey: String(record.id) };
      if (!appeal.reason) throw publicError("申诉理由不能为空");
      await connection.execute("INSERT INTO quality_assessment_appeals (id, record_id, appellant_id, reason, evidence, status, active_key) VALUES (?, ?, ?, ?, ?, ?, ?)", [appeal.id, appeal.recordId, appeal.appellantId, appeal.reason, JSON.stringify(appeal.evidence), appeal.status, appeal.activeKey]);
      await addAuditLog(connection, user, "appeal_created", "record", record.id, { appealId: appeal.id });
      return normalizeAppeal(appeal);
    });
  }

  async function reviewAppeal(appealId, input = {}, reviewer) {
    requireOperator(reviewer);
    if (!["approved", "rejected"].includes(input.decision)) throw publicError("申诉决定无效");
    return transaction(async (connection) => {
      const [discoveredRows] = await connection.execute("SELECT * FROM quality_assessment_appeals WHERE id = ?", [appealId]);
      const discoveredAppeal = discoveredRows[0];
      if (!discoveredAppeal) throw publicError("申诉不存在", 404);
      const { record } = await findRecordWithPeriodForUpdate(discoveredAppeal.record_id, connection);
      requireRecordScope(reviewer, record, "无权处理其他学校或学院的申诉");
      const [rows] = await connection.execute("SELECT * FROM quality_assessment_appeals WHERE id = ? FOR UPDATE", [appealId]);
      const appeal = rows[0];
      if (!appeal || String(appeal.record_id) !== String(record.id)) throw publicError("申诉已被其他管理员更新，请刷新后重试", 409);
      if (!["submitted", "reviewing"].includes(appeal.status)) throw publicError("申诉已处理", 409);
      await connection.execute("UPDATE quality_assessment_appeals SET status = ?, reviewer_id = ?, opinion = ?, active_key = NULL, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [input.decision, reviewer.id, String(input.opinion || ""), appealId]);
      await addAuditLog(connection, reviewer, "appeal_reviewed", "record", appeal.record_id, { appealId, decision: input.decision });
      return normalizeAppeal({ ...appeal, status: input.decision, reviewer_id: String(reviewer.id), opinion: String(input.opinion || ""), active_key: null });
    });
  }

  async function listAuditLogs(filters = {}, user) {
    requireOperator(user);
    const clauses = [];
    const params = [];
    let from = "quality_assessment_audits";
    if (user.role !== "super_admin") {
      from += " INNER JOIN quality_assessment_records ON quality_assessment_audits.target_type = 'record' AND quality_assessment_records.id = quality_assessment_audits.target_id";
      clauses.push("quality_assessment_records.school = ? AND quality_assessment_records.college = ?");
      params.push(user.school || "", user.college || "");
    }
    if (filters.targetId) { clauses.push("target_id = ?"); params.push(filters.targetId); }
    if (filters.action) { clauses.push("action = ?"); params.push(filters.action); }
    const [rows] = await pool.execute(`SELECT quality_assessment_audits.* FROM ${from}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY quality_assessment_audits.created_at DESC`, params);
    return rows.map((row) => ({ id: String(row.id), operatorId: row.operator_id, action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: jsonValue(row.metadata, null), createdAt: row.created_at }));
  }

  return { createPeriod, listPeriods, getOrCreateRecord, saveDraft, submitRecord, listClassQueue, reviewClassRecord, listCollegeQueue, listExportRecords, reviewCollegeRecord, publishPeriod, archivePeriod, createAppeal, reviewAppeal, listAuditLogs };
}

const memoryStore = createMemoryQualityStore({
  periods: data.qualityAssessmentPeriods,
  records: data.qualityAssessmentRecords,
  items: data.qualityAssessmentItems,
  reviews: data.qualityAssessmentReviews,
  appeals: data.qualityAssessmentAppeals,
  auditLogs: data.qualityAssessmentAudits,
  classAssignments: data.classAssignments
});

function selectedStore() {
  return mysqlConfigured ? createMysqlQualityStore(getPool()) : memoryStore;
}

async function callStore(method, args) {
  await initialize();
  return selectedStore()[method](...args);
}

module.exports = {
  TRANSITIONS,
  initialize,
  createMemoryQualityStore,
  createMysqlQualityStore,
  createPeriod: (...args) => callStore("createPeriod", args),
  listPeriods: (...args) => callStore("listPeriods", args),
  getOrCreateRecord: (...args) => callStore("getOrCreateRecord", args),
  saveDraft: (...args) => callStore("saveDraft", args),
  submitRecord: (...args) => callStore("submitRecord", args),
  listClassQueue: (...args) => callStore("listClassQueue", args),
  reviewClassRecord: (...args) => callStore("reviewClassRecord", args),
  listCollegeQueue: (...args) => callStore("listCollegeQueue", args),
  listExportRecords: (...args) => callStore("listExportRecords", args),
  reviewCollegeRecord: (...args) => callStore("reviewCollegeRecord", args),
  publishPeriod: (...args) => callStore("publishPeriod", args),
  archivePeriod: (...args) => callStore("archivePeriod", args),
  createAppeal: (...args) => callStore("createAppeal", args),
  reviewAppeal: (...args) => callStore("reviewAppeal", args),
  listAuditLogs: (...args) => callStore("listAuditLogs", args)
};
