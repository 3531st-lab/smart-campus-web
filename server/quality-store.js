const crypto = require("node:crypto");
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

const MYSQL_TABLES = [
  "CREATE TABLE IF NOT EXISTS quality_rule_versions (id VARCHAR(80) PRIMARY KEY, rules_snapshot JSON NOT NULL, created_by VARCHAR(64) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS quality_assessment_periods (id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'draft', rule_version VARCHAR(80) NOT NULL, starts_at TIMESTAMP NULL, ends_at TIMESTAMP NULL, published_at TIMESTAMP NULL, notice TEXT NOT NULL, created_by VARCHAR(64) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY idx_quality_period_status_time (status, starts_at, ends_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_records (id VARCHAR(64) PRIMARY KEY, period_id VARCHAR(64) NOT NULL, student_id VARCHAR(64) NOT NULL, class_id VARCHAR(64) NOT NULL, college VARCHAR(120) NOT NULL DEFAULT '', rule_version VARCHAR(80) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'draft', module_scores JSON NOT NULL, total_score DECIMAL(6,2) NOT NULL DEFAULT 0, calculation_snapshot JSON NOT NULL, risk_flags JSON NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 1, submitted_at TIMESTAMP NULL, archived_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_quality_record_period_student (period_id, student_id), KEY idx_quality_record_class_status (class_id, status, updated_at), KEY idx_quality_record_period_total (period_id, total_score), KEY idx_quality_record_college_status (college, status, updated_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_items (id VARCHAR(64) PRIMARY KEY, record_id VARCHAR(64) NOT NULL, module VARCHAR(32) NOT NULL, item_type VARCHAR(32) NOT NULL, rule_code VARCHAR(80) NOT NULL, claimed_score DECIMAL(6,2) NOT NULL, evidence_required TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY idx_quality_item_record (record_id, created_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_evidence (id VARCHAR(64) PRIMARY KEY, item_id VARCHAR(64) NOT NULL, record_id VARCHAR(64) NOT NULL, file_url VARCHAR(2048) NOT NULL, file_name VARCHAR(255) NOT NULL DEFAULT '', uploaded_by VARCHAR(64) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_quality_evidence_item (item_id, created_at), KEY idx_quality_evidence_record (record_id, created_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_reviews (id VARCHAR(64) PRIMARY KEY, record_id VARCHAR(64) NOT NULL, stage VARCHAR(32) NOT NULL, reviewer_id VARCHAR(64) NOT NULL, decision VARCHAR(32) NOT NULL, opinion TEXT NOT NULL, item_decisions JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_quality_review_record_stage (record_id, stage, created_at), KEY idx_quality_review_reviewer_time (reviewer_id, created_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_appeals (id VARCHAR(64) PRIMARY KEY, record_id VARCHAR(64) NOT NULL, appellant_id VARCHAR(64) NOT NULL, reason TEXT NOT NULL, evidence JSON NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'submitted', active_key VARCHAR(64) NULL, reviewer_id VARCHAR(64) NULL, opinion TEXT NULL, reviewed_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_quality_appeal_active (record_id, active_key), KEY idx_quality_appeal_status_time (status, created_at), KEY idx_quality_appeal_reviewer_time (reviewer_id, reviewed_at))",
  "CREATE TABLE IF NOT EXISTS quality_assessment_audits (id VARCHAR(64) PRIMARY KEY, operator_id VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL, target_type VARCHAR(32) NOT NULL, target_id VARCHAR(64) NOT NULL, metadata JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_quality_audit_target_time (target_type, target_id, created_at), KEY idx_quality_audit_operator_time (operator_id, created_at), KEY idx_quality_audit_action_time (action, created_at))"
];

let initialized = false;

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  if (!autoMigrateSchema) {
    initialized = true;
    return;
  }
  const pool = getPool();
  for (const statement of MYSQL_TABLES) await pool.query(statement);
  initialized = true;
}

function publicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id), periodId: row.period_id ?? row.periodId, studentId: row.student_id ?? row.studentId,
    classId: row.class_id ?? row.classId, college: row.college || "", ruleVersion: row.rule_version ?? row.ruleVersion,
    status: row.status, moduleScores: jsonValue(row.module_scores ?? row.moduleScores, {}), totalScore: Number(row.total_score ?? row.totalScore ?? 0),
    calculationSnapshot: jsonValue(row.calculation_snapshot ?? row.calculationSnapshot, {}), riskFlags: jsonValue(row.risk_flags ?? row.riskFlags, []),
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
    publishedAt: row.published_at ?? row.publishedAt ?? null, createdAt: row.created_at ?? row.createdAt ?? null, updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function createMemoryQualityStore(seed = {}) {
  const data = {
    periods: seed.periods || seed.qualityAssessmentPeriods || [],
    records: seed.records || seed.qualityAssessmentRecords || [],
    items: seed.items || seed.qualityAssessmentItems || [],
    reviews: seed.reviews || seed.qualityAssessmentReviews || [],
    appeals: seed.appeals || seed.qualityAssessmentAppeals || [],
    auditLogs: seed.auditLogs || seed.qualityAssessmentAudits || []
  };

  function requireOperator(user) {
    if (!["admin", "super_admin"].includes(user?.role)) throw publicError("仅管理员可以执行该操作", 403);
  }

  function recordById(recordId) {
    const record = data.records.find((entry) => String(entry.id) === String(recordId));
    if (!record) throw publicError("综测申报不存在", 404);
    return record;
  }

  function addAuditLog(operator, action, targetId, metadata = null) {
    const audit = {
      id: `quality-audit-${crypto.randomUUID()}`,
      operatorId: String(operator.id),
      action,
      targetType: "record",
      targetId: String(targetId),
      metadata,
      createdAt: new Date().toISOString()
    };
    data.auditLogs.push(audit);
    return audit;
  }

  function transition(record, nextStatus) {
    if (!TRANSITIONS[record.status]?.includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
    record.status = nextStatus;
    record.version = Number(record.version || 1) + 1;
    record.updatedAt = new Date().toISOString();
  }

  function requireClassReviewer(reviewer, record) {
    const duty = reviewer.classDuty || reviewer.class_duty || reviewer.duty || "";
    if (!["monitor", "league_secretary", "leagueSecretary", "班长", "团支书"].includes(duty)) {
      throw publicError("仅班长或团支书可以审核", 403);
    }
    if (String(reviewer.classId || reviewer.class_id || "") !== String(record.classId)) throw publicError("无权审核其他班级的申报", 403);
  }

  function requireCollegeReviewer(reviewer, record) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    if (!["admin", "super_admin"].includes(reviewer.role) && String(reviewer.college || "") !== String(record.college || "")) {
      throw publicError("无权审核其他学院的申报", 403);
    }
  }

  async function getOrCreateRecord(periodId, user) {
    const period = data.periods.find((entry) => String(entry.id) === String(periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    let record = data.records.find((entry) => String(entry.periodId) === String(periodId) && String(entry.studentId) === String(user.id));
    if (!record) {
      const ruleVersion = period.ruleVersion || getQualityRuleVersion().id;
      const calculated = calculateQualityRecord({});
      record = {
        id: `quality-record-${crypto.randomUUID()}`,
        periodId: String(periodId),
        studentId: String(user.id),
        classId: String(user.classId || user.class_id || ""),
        college: String(user.college || ""),
        ruleVersion,
        status: "draft",
        moduleScores: calculated.moduleScores,
        totalScore: calculated.totalScore,
        calculationSnapshot: calculated,
        riskFlags: calculated.warnings,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.records.push(record);
    }
    return { ...record };
  }

  async function createPeriod(input = {}, operator) {
    requireOperator(operator);
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
    addAuditLog(operator, "period_created", period.id, { targetType: "period" });
    return { ...period };
  }

  async function listPeriods(user) {
    const periods = data.periods
      .filter((period) => ["admin", "super_admin"].includes(user?.role) || ["open", "published"].includes(period.status))
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    return periods.map((period) => ({ ...period }));
  }

  async function saveDraft(recordId, input = {}, user) {
    const record = recordById(recordId);
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
    data.items.push(...items.map((item) => ({ ...item, id: `quality-item-${crypto.randomUUID()}`, recordId: record.id })));
    Object.assign(record, {
      moduleScores: calculated.moduleScores,
      totalScore: calculated.totalScore,
      calculationSnapshot: calculated,
      riskFlags: calculated.warnings,
      version: Number(record.version) + 1,
      updatedAt: new Date().toISOString()
    });
    return { ...record };
  }

  async function submitRecord(recordId, user) {
    const record = recordById(recordId);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权提交该综测申报", 403);
    if (!TRANSITIONS[record.status]?.includes("class_review")) throw publicError("当前状态不能提交", 409);
    transition(record, "class_review");
    record.submittedAt = new Date().toISOString();
    record.updatedAt = record.submittedAt;
    addAuditLog(user, "record_submitted", record.id);
    return { ...record };
  }

  async function listClassQueue(filters = {}, reviewer) {
    const scopeRecord = data.records.find((record) => (
      String(record.classId) === String(reviewer.classId || reviewer.class_id || "")
      && (!filters.periodId || String(record.periodId) === String(filters.periodId))
    ));
    if (scopeRecord) requireClassReviewer(reviewer, scopeRecord);
    else if (!["monitor", "league_secretary", "leagueSecretary", "班长", "团支书"].includes(reviewer.classDuty || reviewer.class_duty || reviewer.duty || "")) {
      throw publicError("仅班长或团支书可以审核", 403);
    }
    const records = data.records
      .filter((record) => record.status === "class_review")
      .filter((record) => String(record.classId) === String(reviewer.classId || reviewer.class_id || ""))
      .filter((record) => !filters.periodId || String(record.periodId) === String(filters.periodId))
      .map((record) => ({ ...record }));
    return { records, total: records.length };
  }

  async function reviewClassRecord(recordId, input = {}, reviewer) {
    const record = recordById(recordId);
    requireClassReviewer(reviewer, record);
    if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
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
      itemDecisions: input.itemDecisions || [],
      createdAt: new Date().toISOString()
    };
    data.reviews.push(review);
    addAuditLog(reviewer, "class_reviewed", record.id, { decision: input.decision });
    return { ...record };
  }

  async function listCollegeQueue(filters = {}, reviewer) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    const records = data.records
      .filter((record) => record.status === "college_review")
      .filter((record) => !filters.periodId || String(record.periodId) === String(filters.periodId))
      .filter((record) => ["admin", "super_admin"].includes(reviewer.role) || String(record.college || "") === String(reviewer.college || ""));
    const scoped = records.map((record) => ({ ...record }));
    return { records: scoped, total: scoped.length };
  }

  async function reviewCollegeRecord(recordId, input = {}, reviewer) {
    const record = recordById(recordId);
    requireCollegeReviewer(reviewer, record);
    if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
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
      itemDecisions: input.itemDecisions || [],
      createdAt: new Date().toISOString()
    });
    addAuditLog(reviewer, "college_reviewed", record.id, { decision: input.decision });
    return { ...record };
  }

  async function publishPeriod(periodId, input = {}, operator) {
    requireOperator(operator);
    const period = data.periods.find((entry) => String(entry.id) === String(periodId));
    if (!period) throw publicError("综测周期不存在", 404);
    const records = data.records.filter((record) => String(record.periodId) === String(periodId) && record.status === "pending_publication");
    for (const record of records) {
      transition(record, "published");
      record.publishedAt = record.updatedAt;
      addAuditLog(operator, "period_published", record.id, { periodId: period.id, notice: String(input.notice || "") });
    }
    period.status = "published";
    period.notice = String(input.notice || period.notice || "");
    period.publishedAt = new Date().toISOString();
    period.updatedAt = period.publishedAt;
    addAuditLog(operator, "period_published", period.id, { targetType: "period", publishedCount: records.length });
    return { ...period, publishedCount: records.length };
  }

  async function createAppeal(input = {}, user) {
    const record = recordById(input.recordId);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权发起该申诉", 403);
    if (!["published", "archived"].includes(record.status)) throw publicError("当前状态不能发起申诉", 409);
    if (data.appeals.some((appeal) => String(appeal.recordId) === String(record.id) && ["submitted", "reviewing"].includes(appeal.status))) {
      throw publicError("已有待处理申诉", 409);
    }
    const appeal = {
      id: `quality-appeal-${crypto.randomUUID()}`,
      recordId: record.id,
      appellantId: String(user.id),
      reason: String(input.reason || "").trim(),
      evidence: input.evidence || [],
      status: "submitted",
      activeKey: String(record.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!appeal.reason) throw publicError("申诉理由不能为空");
    data.appeals.push(appeal);
    addAuditLog(user, "appeal_created", record.id, { appealId: appeal.id });
    return { ...appeal };
  }

  async function reviewAppeal(appealId, input = {}, reviewer) {
    requireOperator(reviewer);
    const appeal = data.appeals.find((entry) => String(entry.id) === String(appealId));
    if (!appeal) throw publicError("申诉不存在", 404);
    if (!["submitted", "reviewing"].includes(appeal.status)) throw publicError("申诉已处理", 409);
    if (!["approved", "rejected"].includes(input.decision)) throw publicError("申诉决定无效");
    appeal.status = input.decision;
    appeal.reviewerId = String(reviewer.id);
    appeal.opinion = String(input.opinion || "");
    appeal.activeKey = null;
    appeal.reviewedAt = new Date().toISOString();
    appeal.updatedAt = appeal.reviewedAt;
    addAuditLog(reviewer, "appeal_reviewed", appeal.recordId, { appealId: appeal.id, decision: input.decision });
    return { ...appeal };
  }

  async function listAuditLogs(filters = {}, user) {
    requireOperator(user);
    return data.auditLogs
      .filter((entry) => !filters.targetId || String(entry.targetId) === String(filters.targetId))
      .filter((entry) => !filters.action || entry.action === filters.action)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((entry) => ({ ...entry }));
  }

  return {
    data,
    getOrCreateRecord,
    saveDraft,
    submitRecord,
    listClassQueue,
    reviewClassRecord,
    listCollegeQueue,
    reviewCollegeRecord,
    createPeriod,
    listPeriods,
    publishPeriod,
    createAppeal,
    reviewAppeal,
    listAuditLogs
  };
}

function createMysqlQualityStore(pool) {
  function requireOperator(user) {
    if (!["admin", "super_admin"].includes(user?.role)) throw publicError("仅管理员可以执行该操作", 403);
  }

  function requireClassReviewer(reviewer, record) {
    const duty = reviewer.classDuty || reviewer.class_duty || reviewer.duty || "";
    if (!["monitor", "league_secretary", "leagueSecretary", "班长", "团支书"].includes(duty)) throw publicError("仅班长或团支书可以审核", 403);
    if (String(reviewer.classId || reviewer.class_id || "") !== String(record.classId)) throw publicError("无权审核其他班级的申报", 403);
  }

  function requireCollegeReviewer(reviewer, record) {
    const allowed = reviewer.qualityRole === "college_reviewer" || reviewer.quality_role === "college_reviewer" || ["admin", "super_admin"].includes(reviewer.role);
    if (!allowed) throw publicError("仅学院审核人员可以审核", 403);
    if (!["admin", "super_admin"].includes(reviewer.role) && String(reviewer.college || "") !== String(record.college || "")) throw publicError("无权审核其他学院的申报", 403);
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

  async function addAuditLog(connection, operator, action, targetType, targetId, metadata = null) {
    await connection.execute(
      "INSERT INTO quality_assessment_audits (id, operator_id, action, target_type, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      [`quality-audit-${crypto.randomUUID()}`, String(operator.id), action, targetType, String(targetId), JSON.stringify(metadata)]
    );
  }

  async function createPeriod(input = {}, operator) {
    requireOperator(operator);
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
      const [periodRows] = await connection.execute("SELECT * FROM quality_assessment_periods WHERE id = ? FOR UPDATE", [periodId]);
      const period = normalizePeriod(periodRows[0]);
      if (!period) throw publicError("综测周期不存在", 404);
      const [existingRows] = await connection.execute("SELECT * FROM quality_assessment_records WHERE period_id = ? AND student_id = ? FOR UPDATE", [periodId, user.id]);
      const existing = normalizeRecord(existingRows[0]);
      if (existing) return existing;
      const calculation = calculateQualityRecord({});
      const record = {
        id: `quality-record-${crypto.randomUUID()}`, periodId: String(periodId), studentId: String(user.id),
        classId: String(user.classId || user.class_id || ""), college: String(user.college || ""), ruleVersion: period.ruleVersion,
        status: "draft", moduleScores: calculation.moduleScores, totalScore: calculation.totalScore,
        calculationSnapshot: calculation, riskFlags: calculation.warnings, version: 1
      };
      await connection.execute(
        "INSERT INTO quality_assessment_records (id, period_id, student_id, class_id, college, rule_version, status, module_scores, total_score, calculation_snapshot, risk_flags, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [record.id, record.periodId, record.studentId, record.classId, record.college, record.ruleVersion, record.status, JSON.stringify(record.moduleScores), record.totalScore, JSON.stringify(record.calculationSnapshot), JSON.stringify(record.riskFlags), record.version]
      );
      await addAuditLog(connection, user, "record_created", "record", record.id);
      return record;
    });
  }

  async function saveDraft(recordId, input = {}, user) {
    return transaction(async (connection) => {
      const record = await findRecord(recordId, connection, true);
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

  async function transitionRecord(recordId, expectedStatus, nextStatus, operator, action, extra = {}) {
    return transaction(async (connection) => {
      const record = await findRecord(recordId, connection, true);
      if (record.status !== expectedStatus || !TRANSITIONS[record.status].includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
      const [updated] = await connection.execute(
        "UPDATE quality_assessment_records SET status = ?, submitted_at = COALESCE(?, submitted_at), archived_at = COALESCE(?, archived_at), version = version + 1 WHERE id = ? AND version = ?",
        [nextStatus, extra.submittedAt || null, extra.archivedAt || null, record.id, record.version]
      );
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await addAuditLog(connection, operator, action, "record", record.id, extra.metadata || null);
      return { ...record, status: nextStatus, version: record.version + 1, submittedAt: extra.submittedAt || record.submittedAt, archivedAt: extra.archivedAt || record.archivedAt };
    });
  }

  async function submitRecord(recordId, user) {
    const record = await findRecord(recordId);
    if (String(record.studentId) !== String(user.id)) throw publicError("无权提交该综测申报", 403);
    return transitionRecord(recordId, record.status, "class_review", user, "record_submitted", { submittedAt: new Date().toISOString() });
  }

  async function listClassQueue(filters = {}, reviewer) {
    const duty = reviewer.classDuty || reviewer.class_duty || reviewer.duty || "";
    if (!["monitor", "league_secretary", "leagueSecretary", "班长", "团支书"].includes(duty)) throw publicError("仅班长或团支书可以审核", 403);
    const params = [reviewer.classId || reviewer.class_id || ""];
    let sql = "SELECT * FROM quality_assessment_records WHERE status = 'class_review' AND class_id = ?";
    if (filters.periodId) { sql += " AND period_id = ?"; params.push(filters.periodId); }
    sql += " ORDER BY updated_at ASC";
    const [rows] = await pool.execute(sql, params);
    const records = rows.map(normalizeRecord);
    return { records, total: records.length };
  }

  async function reviewClassRecord(recordId, input = {}, reviewer) {
    const initial = await findRecord(recordId);
    requireClassReviewer(reviewer, initial);
    if (String(initial.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
    const nextStatus = input.decision === "approved" ? "college_review" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    return transaction(async (connection) => {
      const record = await findRecord(recordId, connection, true);
      requireClassReviewer(reviewer, record);
      if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
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
    if (!["admin", "super_admin"].includes(reviewer.role)) { sql += " AND college = ?"; params.push(reviewer.college || ""); }
    if (filters.periodId) { sql += " AND period_id = ?"; params.push(filters.periodId); }
    sql += " ORDER BY updated_at ASC";
    const [rows] = await pool.execute(sql, params);
    const records = rows.map(normalizeRecord);
    return { records, total: records.length };
  }

  async function reviewCollegeRecord(recordId, input = {}, reviewer) {
    const nextStatus = input.decision === "approved" ? "pending_publication" : input.decision === "returned" ? "returned" : "";
    if (!nextStatus) throw publicError("审核决定无效");
    return transaction(async (connection) => {
      const record = await findRecord(recordId, connection, true);
      requireCollegeReviewer(reviewer, record);
      if (String(record.studentId) === String(reviewer.id)) throw publicError("不能审核自己的申报", 403);
      if (!TRANSITIONS[record.status]?.includes(nextStatus)) throw publicError("当前状态不允许该操作", 409);
      const [updated] = await connection.execute("UPDATE quality_assessment_records SET status = ?, version = version + 1 WHERE id = ? AND version = ?", [nextStatus, record.id, record.version]);
      if (!updated.affectedRows) throw publicError("记录已被其他审核人更新，请刷新后重试", 409);
      await connection.execute("INSERT INTO quality_assessment_reviews (id, record_id, stage, reviewer_id, decision, opinion, item_decisions) VALUES (?, ?, 'college', ?, ?, ?, ?)", [`quality-review-${crypto.randomUUID()}`, record.id, reviewer.id, input.decision, String(input.opinion || ""), JSON.stringify(input.itemDecisions || [])]);
      await addAuditLog(connection, reviewer, "college_reviewed", "record", record.id, { decision: input.decision });
      return { ...record, status: nextStatus, version: record.version + 1 };
    });
  }

  async function publishPeriod(periodId, input = {}, operator) {
    requireOperator(operator);
    return transaction(async (connection) => {
      const [periodRows] = await connection.execute("SELECT * FROM quality_assessment_periods WHERE id = ? FOR UPDATE", [periodId]);
      const period = normalizePeriod(periodRows[0]);
      if (!period) throw publicError("综测周期不存在", 404);
      const [rows] = await connection.execute("SELECT * FROM quality_assessment_records WHERE period_id = ? AND status = 'pending_publication' FOR UPDATE", [periodId]);
      for (const raw of rows) {
        const record = normalizeRecord(raw);
        await connection.execute("UPDATE quality_assessment_records SET status = 'published', version = version + 1 WHERE id = ? AND version = ?", [record.id, record.version]);
        await addAuditLog(connection, operator, "period_published", "record", record.id, { periodId, notice: String(input.notice || "") });
      }
      await connection.execute("UPDATE quality_assessment_periods SET status = 'published', notice = ?, published_at = CURRENT_TIMESTAMP WHERE id = ?", [String(input.notice || period.notice || ""), periodId]);
      await addAuditLog(connection, operator, "period_published", "period", periodId, { publishedCount: rows.length });
      return { ...period, status: "published", notice: String(input.notice || period.notice || ""), publishedCount: rows.length };
    });
  }

  async function createAppeal(input = {}, user) {
    return transaction(async (connection) => {
      const record = await findRecord(input.recordId, connection, true);
      if (String(record.studentId) !== String(user.id)) throw publicError("无权发起该申诉", 403);
      if (!["published", "archived"].includes(record.status)) throw publicError("当前状态不能发起申诉", 409);
      const [existing] = await connection.execute("SELECT id FROM quality_assessment_appeals WHERE record_id = ? AND active_key IS NOT NULL FOR UPDATE", [record.id]);
      if (existing.length) throw publicError("已有待处理申诉", 409);
      const appeal = { id: `quality-appeal-${crypto.randomUUID()}`, recordId: record.id, appellantId: String(user.id), reason: String(input.reason || "").trim(), evidence: input.evidence || [], status: "submitted", activeKey: String(record.id) };
      if (!appeal.reason) throw publicError("申诉理由不能为空");
      await connection.execute("INSERT INTO quality_assessment_appeals (id, record_id, appellant_id, reason, evidence, status, active_key) VALUES (?, ?, ?, ?, ?, ?, ?)", [appeal.id, appeal.recordId, appeal.appellantId, appeal.reason, JSON.stringify(appeal.evidence), appeal.status, appeal.activeKey]);
      await addAuditLog(connection, user, "appeal_created", "record", record.id, { appealId: appeal.id });
      return appeal;
    });
  }

  async function reviewAppeal(appealId, input = {}, reviewer) {
    requireOperator(reviewer);
    if (!["approved", "rejected"].includes(input.decision)) throw publicError("申诉决定无效");
    return transaction(async (connection) => {
      const [rows] = await connection.execute("SELECT * FROM quality_assessment_appeals WHERE id = ? FOR UPDATE", [appealId]);
      const appeal = rows[0];
      if (!appeal) throw publicError("申诉不存在", 404);
      if (!["submitted", "reviewing"].includes(appeal.status)) throw publicError("申诉已处理", 409);
      await connection.execute("UPDATE quality_assessment_appeals SET status = ?, reviewer_id = ?, opinion = ?, active_key = NULL, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [input.decision, reviewer.id, String(input.opinion || ""), appealId]);
      await addAuditLog(connection, reviewer, "appeal_reviewed", "record", appeal.record_id, { appealId, decision: input.decision });
      return { id: String(appeal.id), recordId: appeal.record_id, appellantId: appeal.appellant_id, reason: appeal.reason, status: input.decision, reviewerId: String(reviewer.id), opinion: String(input.opinion || ""), activeKey: null };
    });
  }

  async function listAuditLogs(filters = {}, user) {
    requireOperator(user);
    const clauses = [];
    const params = [];
    if (filters.targetId) { clauses.push("target_id = ?"); params.push(filters.targetId); }
    if (filters.action) { clauses.push("action = ?"); params.push(filters.action); }
    const [rows] = await pool.execute(`SELECT * FROM quality_assessment_audits${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC`, params);
    return rows.map((row) => ({ id: String(row.id), operatorId: row.operator_id, action: row.action, targetType: row.target_type, targetId: row.target_id, metadata: jsonValue(row.metadata, null), createdAt: row.created_at }));
  }

  return { createPeriod, listPeriods, getOrCreateRecord, saveDraft, submitRecord, listClassQueue, reviewClassRecord, listCollegeQueue, reviewCollegeRecord, publishPeriod, createAppeal, reviewAppeal, listAuditLogs };
}

const memoryStore = createMemoryQualityStore({
  periods: data.qualityAssessmentPeriods,
  records: data.qualityAssessmentRecords,
  items: data.qualityAssessmentItems,
  reviews: data.qualityAssessmentReviews,
  appeals: data.qualityAssessmentAppeals,
  auditLogs: data.qualityAssessmentAudits
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
  reviewCollegeRecord: (...args) => callStore("reviewCollegeRecord", args),
  publishPeriod: (...args) => callStore("publishPeriod", args),
  createAppeal: (...args) => callStore("createAppeal", args),
  reviewAppeal: (...args) => callStore("reviewAppeal", args),
  listAuditLogs: (...args) => callStore("listAuditLogs", args)
};
