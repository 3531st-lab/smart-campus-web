const crypto = require("crypto");
const data = require("./data");
const permanentAdmins = require("./permanent-admins");
const { mysqlConfigured, autoMigrateSchema, getPool } = require("./db");
const classStore = require("./class-store");

let initialized = false;

function normalizeStudent(row) {
  if (!row) return null;
  return permanentAdmins.enforcePermanentPrivileges({
    id: String(row.id),
    name: row.name,
    school: row.school,
    college: row.college || "",
    major: row.major,
    className: row.class_name ?? row.className ?? "",
    studentNo: row.student_no ?? row.studentNo,
    phone: row.phone,
    status: row.status || "active",
    role: row.role || "student",
    verified: Boolean(row.verified ?? true),
    avatarColor: row.avatar_color ?? row.avatarColor ?? "#1f7a6d",
    hasPassword: Boolean(row.password_hash ?? row.passwordHash),
    mustChangePassword: Boolean(row.password_must_change ?? row.mustChangePassword),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  });
}

async function initialize({ forceSchema = false } = {}) {
  if (!mysqlConfigured || (initialized && !forceSchema)) return;
  if (!autoMigrateSchema && !forceSchema) {
    initialized = true;
    await seedPrivateStudent();
    await enforcePermanentSuperAdmins();
    return;
  }
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      school VARCHAR(120) NOT NULL,
      college VARCHAR(120) NOT NULL DEFAULT '',
      major VARCHAR(120) NOT NULL,
      class_name VARCHAR(120) NOT NULL DEFAULT '',
      student_no VARCHAR(64) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      role ENUM('student','teacher','admin','super_admin') NOT NULL DEFAULT 'student',
      verified TINYINT(1) NOT NULL DEFAULT 1,
      avatar_color VARCHAR(24) NOT NULL DEFAULT '#1f7a6d',
      password_hash VARCHAR(255) NULL,
      password_must_change TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_school_student_no (school, student_no),
      KEY idx_identity (school, major, student_no, phone),
      KEY idx_class (school, college, major, class_name),
      KEY idx_class_identity_order (school, college, class_name, role, name, student_no),
      KEY idx_role_updated (role, updated_at),
      KEY idx_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query("ALTER TABLE students MODIFY role ENUM('student','teacher','admin','super_admin') NOT NULL DEFAULT 'student'");
  try {
    await db.query("ALTER TABLE students ADD COLUMN class_name VARCHAR(120) NOT NULL DEFAULT '' AFTER major");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
  try {
    await db.query("ALTER TABLE students ADD INDEX idx_class (school, college, major, class_name)");
  } catch (error) {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  }
  try {
    await db.query("ALTER TABLE students ADD INDEX idx_role_updated (role, updated_at)");
  } catch (error) {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  }
  try {
    await db.query("ALTER TABLE students ADD INDEX idx_class_identity_order (school, college, class_name, role, name, student_no)");
  } catch (error) {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  }
  try {
    await db.query("ALTER TABLE students ADD COLUMN password_hash VARCHAR(255) NULL");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
  try {
    await db.query("ALTER TABLE students ADD COLUMN password_must_change TINYINT(1) NOT NULL DEFAULT 0");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS campus_classes (
      id VARCHAR(64) PRIMARY KEY,
      school VARCHAR(120) NOT NULL,
      college VARCHAR(120) NOT NULL,
      class_name VARCHAR(120) NOT NULL,
      class_key VARCHAR(400) NOT NULL,
      group_id VARCHAR(64) NULL,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_class_key (class_key),
      KEY idx_class_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  try {
    await db.query("ALTER TABLE campus_classes DROP INDEX uq_class_identity");
  } catch (error) {
    if (error.code !== "ER_CANT_DROP_FIELD_OR_KEY") throw error;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS class_assignments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      class_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      duty VARCHAR(32) NOT NULL DEFAULT 'member',
      source VARCHAR(32) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      assigned_by VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_class_assignment (class_id, user_id),
      KEY idx_assignment_user_active (user_id, active),
      KEY idx_assignment_class_active (class_id, active)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  try {
    await db.query("ALTER TABLE class_assignments ADD COLUMN assigned_by VARCHAR(64) NULL AFTER active");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_groups (
      id VARCHAR(64) PRIMARY KEY,
      type VARCHAR(32) NOT NULL,
      public_no VARCHAR(32) NULL,
      name VARCHAR(120) NOT NULL,
      owner_id VARCHAR(64) NULL,
      class_id VARCHAR(64) NULL,
      status ENUM('active','frozen','closed','disabled') NOT NULL DEFAULT 'active',
      frozen TINYINT(1) NOT NULL DEFAULT 0,
      next_message_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
      description VARCHAR(500) NOT NULL DEFAULT '',
      join_policy VARCHAR(32) NOT NULL DEFAULT 'review',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_group_class (class_id),
      UNIQUE KEY uq_chat_group_public_no (public_no),
      KEY idx_chat_group_owner (owner_id, status),
      KEY idx_chat_group_type_status (type, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  for (const statement of [
    "ALTER TABLE chat_groups ADD COLUMN public_no VARCHAR(32) NULL",
    "ALTER TABLE chat_groups ADD COLUMN owner_id VARCHAR(64) NULL",
    "ALTER TABLE chat_groups ADD COLUMN frozen TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE chat_groups ADD COLUMN next_message_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0",
    "ALTER TABLE chat_groups ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT ''",
    "ALTER TABLE chat_groups ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT 'review'",
    "ALTER TABLE chat_groups ADD UNIQUE INDEX uq_chat_group_public_no (public_no)",
    "ALTER TABLE chat_groups ADD INDEX idx_chat_group_owner (owner_id, status)"
  ]) {
    try {
      await db.query(statement);
    } catch (error) {
      if (!["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME"].includes(error.code)) throw error;
    }
  }
  await db.query("ALTER TABLE chat_groups MODIFY COLUMN status ENUM('active','frozen','closed','disabled') NOT NULL DEFAULT 'active'");
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
      joined_via VARCHAR(32) NOT NULL,
      muted_until TIMESTAMP NULL,
      last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_member (group_id, user_id),
      KEY idx_chat_member_user_active (user_id, active, group_id),
      KEY idx_chat_member_group_role (group_id, active, role, user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_join_requests (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      applicant_id VARCHAR(64) NOT NULL,
      source ENUM('group_number','qr') NOT NULL,
      status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
      pending_key VARCHAR(160) NULL,
      reviewer_id VARCHAR(64) NULL,
      reviewed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_join_pending (pending_key),
      KEY idx_chat_join_group_status (group_id, status, created_at),
      KEY idx_chat_join_applicant (applicant_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_invites (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      inviter_id VARCHAR(64) NOT NULL,
      invitee_id VARCHAR(64) NOT NULL,
      status ENUM('pending','accepted','rejected','expired','cancelled') NOT NULL DEFAULT 'pending',
      pending_key VARCHAR(160) NULL,
      expires_at TIMESTAMP NULL,
      accepted_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_invite_pending (pending_key),
      KEY idx_chat_invite_group_status (group_id, status, created_at),
      KEY idx_chat_invite_invitee_status (invitee_id, status, created_at),
      KEY idx_chat_invite_expiry (expires_at, status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  try {
    await db.query("ALTER TABLE chat_invites ADD COLUMN expires_at TIMESTAMP NULL");
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_invite_tokens (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      creator_id VARCHAR(64) NOT NULL,
      token_digest CHAR(64) NOT NULL,
      expires_at TIMESTAMP NULL,
      max_uses INT UNSIGNED NOT NULL DEFAULT 1,
      use_count INT UNSIGNED NOT NULL DEFAULT 0,
      revoked TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_invite_token_digest (token_digest),
      KEY idx_chat_token_group_active (group_id, revoked, expires_at),
      KEY idx_chat_token_creator (creator_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      sequence BIGINT UNSIGNED NOT NULL,
      sender_id VARCHAR(64) NOT NULL,
      client_request_id VARCHAR(128) NOT NULL,
      text TEXT NOT NULL,
      sticker_id VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_message_sequence (group_id, sequence),
      UNIQUE KEY uq_chat_message_request (group_id, sender_id, client_request_id),
      KEY idx_chat_message_group_sequence (group_id, sequence),
      KEY idx_chat_message_sender_created (sender_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  for (const statement of [
    "ALTER TABLE chat_messages ADD COLUMN sticker_id VARCHAR(64) NULL",
    "ALTER TABLE chat_messages ADD INDEX idx_chat_message_sticker (sticker_id)"
  ]) {
    try {
      await db.query(statement);
    } catch (error) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error;
    }
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_media (
      id VARCHAR(64) PRIMARY KEY,
      owner_id VARCHAR(64) NOT NULL,
      object_key VARCHAR(512) NOT NULL,
      public_url VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(80) NOT NULL,
      byte_size INT UNSIGNED NOT NULL,
      sha256 CHAR(64) NOT NULL,
      source_type ENUM('upload','network') NOT NULL DEFAULT 'upload',
      source_url VARCHAR(2048) NULL,
      source_author VARCHAR(160) NULL,
      source_license VARCHAR(160) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_media_sha256_owner (sha256, owner_id),
      KEY idx_chat_media_owner_created (owner_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_stickers (
      id VARCHAR(64) PRIMARY KEY,
      media_id VARCHAR(64) NOT NULL,
      owner_id VARCHAR(64) NOT NULL,
      name VARCHAR(80) NOT NULL,
      visibility ENUM('private','public') NOT NULL DEFAULT 'private',
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_sticker_media (media_id),
      KEY idx_chat_sticker_owner_status (owner_id, status, created_at),
      KEY idx_chat_sticker_visibility_status (visibility, status, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_sticker_favorites (
      user_id VARCHAR(64) NOT NULL,
      sticker_id VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, sticker_id),
      KEY idx_chat_sticker_favorite_sticker (sticker_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_reports (
      id VARCHAR(64) PRIMARY KEY,
      reporter_id VARCHAR(64) NOT NULL,
      target_type ENUM('message','sticker','group') NOT NULL,
      target_id VARCHAR(64) NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      status ENUM('submitted','reviewing','resolved','rejected') NOT NULL DEFAULT 'submitted',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_chat_report_status_created (status, created_at),
      KEY idx_chat_report_target (target_type, target_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_read_cursors (
      group_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id),
      KEY idx_chat_read_cursor_user (user_id, updated_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_appeals (
      id VARCHAR(64) PRIMARY KEY,
      group_id VARCHAR(64) NOT NULL,
      appellant_id VARCHAR(64) NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      status ENUM('submitted','reviewing','approved','rejected') NOT NULL DEFAULT 'submitted',
      reviewer_id VARCHAR(64) NULL,
      reviewed_at TIMESTAMP NULL,
      active_key VARCHAR(160) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_chat_appeal_active (active_key),
      KEY idx_chat_appeal_group_status (group_id, status, created_at),
      KEY idx_chat_appeal_appellant (appellant_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_audit_logs (
      id VARCHAR(64) PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      target_type VARCHAR(32) NOT NULL,
      target_id VARCHAR(64) NOT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_chat_audit_target (target_type, target_id, created_at),
      KEY idx_chat_audit_operator (operator_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS class_sync_errors (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      student_no VARCHAR(64) NOT NULL DEFAULT '',
      public_message VARCHAR(160) NOT NULL,
      retryable TINYINT(1) NOT NULL DEFAULT 1,
      diagnostic JSON NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_class_sync_errors_user (user_id, recorded_at),
      KEY idx_class_sync_errors_student_no (student_no, recorded_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(80) NOT NULL,
      target_student_no VARCHAR(64) NOT NULL DEFAULT '',
      detail JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS legal_consents (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      student_no VARCHAR(64) NOT NULL DEFAULT '',
      consent_version VARCHAR(32) NOT NULL,
      documents JSON NOT NULL,
      context JSON NULL,
      client_consented_at VARCHAR(40) NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_legal_user_version (user_id, consent_version),
      KEY idx_legal_recorded_at (recorded_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  initialized = true;
  await seedPrivateStudent();
  await enforcePermanentSuperAdmins();
  await db.execute("UPDATE students SET password_hash = NULL, password_must_change = 0 WHERE password_must_change = 1");
}

async function enforcePermanentSuperAdmins() {
  if (!mysqlConfigured) {
    for (let index = 0; index < data.users.length; index += 1) {
      const enforced = permanentAdmins.enforcePermanentPrivileges(data.users[index]);
      data.users[index] = enforced;
      if (enforced.role === "super_admin") await synchronizeClassAssignment(enforced);
    }
    return;
  }
  const [rows] = await getPool().query("SELECT id, name, school, major, student_no FROM students");
  const protectedIds = rows
    .filter((row) => permanentAdmins.isPermanentSuperAdmin(row))
    .map((row) => row.id);
  if (!protectedIds.length) return;
  const placeholders = protectedIds.map(() => "?").join(",");
  await getPool().execute(
    `UPDATE students SET role = 'super_admin', status = 'active', verified = 1 WHERE id IN (${placeholders})`,
    protectedIds
  );
  for (const id of protectedIds) {
    await synchronizeClassAssignment({ id, role: "super_admin", status: "active" });
  }
}

async function seedPrivateStudent() {
  const requiredValues = [
    process.env.CAMPUS_USER_NAME,
    process.env.CAMPUS_USER_SCHOOL,
    process.env.CAMPUS_USER_MAJOR,
    process.env.CAMPUS_USER_STUDENT_NO,
    process.env.CAMPUS_USER_PHONE
  ];
  if (!mysqlConfigured || requiredValues.some((value) => !String(value || "").trim())) return;
  await upsertStudent({
    name: process.env.CAMPUS_USER_NAME,
    school: process.env.CAMPUS_USER_SCHOOL,
    college: process.env.CAMPUS_USER_COLLEGE || "",
    major: process.env.CAMPUS_USER_MAJOR || "",
    className: process.env.CAMPUS_USER_CLASS || process.env.CAMPUS_USER_CLASS_NAME || "",
    studentNo: process.env.CAMPUS_USER_STUDENT_NO,
    phone: process.env.CAMPUS_USER_PHONE,
    status: "active",
    role: process.env.CAMPUS_USER_ROLE || "super_admin",
    verified: true
  });
}

async function findById(id) {
  if (!mysqlConfigured) return normalizeStudent(data.users.find((user) => user.id === id));
  await initialize();
  const [rows] = await getPool().execute("SELECT * FROM students WHERE id = ? LIMIT 1", [id]);
  return normalizeStudent(rows[0] || data.users.find((user) => user.id === id && user.role === "guest"));
}

async function findIdentity({ school, major, studentNo, phone }) {
  if (!mysqlConfigured) {
    return normalizeStudent(data.users.find((user) => (
      user.status !== "disabled"
      && user.school === String(school || "").trim()
      && user.major === String(major || "").trim()
      && user.studentNo === String(studentNo || "").trim()
      && user.phone === String(phone || "").trim()
    )));
  }
  await initialize();
  const [rows] = await getPool().execute(
    "SELECT * FROM students WHERE school = ? AND major = ? AND student_no = ? AND phone = ? AND status = 'active' LIMIT 1",
    [String(school || "").trim(), String(major || "").trim(), String(studentNo || "").trim(), String(phone || "").trim()]
  );
  return normalizeStudent(rows[0]);
}

async function findLoginAccount({ school, major, studentNo }) {
  if (!mysqlConfigured) {
    return normalizeStudent(data.users.find((user) => (
      user.status !== "disabled"
      && user.school === String(school || "").trim()
      && user.major === String(major || "").trim()
      && user.studentNo === String(studentNo || "").trim()
    )));
  }
  await initialize();
  const [rows] = await getPool().execute(
    "SELECT * FROM students WHERE school = ? AND major = ? AND student_no = ? AND status = 'active' LIMIT 1",
    [String(school || "").trim(), String(major || "").trim(), String(studentNo || "").trim()]
  );
  return normalizeStudent(rows[0]);
}

function matchesIdentityType(user, identityType) {
  if (!user || user.status === "disabled" || user.role === "guest") return false;
  return identityType === "teacher" ? user.role === "teacher" : user.role !== "teacher";
}

function normalizeStudentNoIdentity(identity) {
  if (identity && typeof identity === "object") {
    return {
      id: String(identity.id || "").trim(),
      school: String(identity.school || "").trim(),
      studentNo: String(identity.studentNo ?? identity.student_no ?? "").trim()
    };
  }
  return { id: "", school: "", studentNo: String(identity || "").trim() };
}

function ambiguousStudentNoError(studentNo) {
  const error = new Error(`学校 is required for ambiguous student number ${studentNo}`);
  error.statusCode = 400;
  return error;
}

function memoryMatchesStudentNo(identity) {
  return data.users.filter((user) => (
    (identity.id ? user.id === identity.id : user.studentNo === identity.studentNo)
    && (!identity.school || user.school === identity.school)
  ));
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

async function listStudents({ query = "", status = "", role = "", limit = 50, offset = 0 } = {}) {
  if (!mysqlConfigured) {
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
    return data.users
      .filter((user) => user.role !== "guest")
      .map(normalizeStudent)
      .filter((student) => !status || student.status === status)
      .filter((student) => !role || student.role === role)
      .filter((student) => !query || [student.name, student.school, student.college, student.major, student.className, student.studentNo, student.phone].some((value) => String(value || "").includes(query)))
      .slice(safeOffset, safeOffset + safeLimit);
  }
  await initialize();
  const values = [];
  const filters = [];
  if (query) {
    filters.push("(name LIKE ? OR school LIKE ? OR college LIKE ? OR major LIKE ? OR class_name LIKE ? OR student_no LIKE ? OR phone LIKE ?)");
    const like = `%${query}%`;
    values.push(like, like, like, like, like, like, like);
  }
  if (status === "active" || status === "disabled") {
    filters.push("status = ?");
    values.push(status);
  }
  if (["student", "teacher", "admin", "super_admin"].includes(role)) {
    filters.push("role = ?");
    values.push(role);
  }
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const [rows] = await getPool().execute(
    `SELECT * FROM students ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY school ASC, college ASC, class_name ASC, CASE role WHEN 'student' THEN 0 WHEN 'teacher' THEN 1 WHEN 'admin' THEN 2 WHEN 'super_admin' THEN 3 ELSE 4 END ASC, name ASC, student_no ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    values
  );
  return rows.map(normalizeStudent);
}

async function countStudents({ roles = [], query = "", status = "", role = "" } = {}) {
  if (!mysqlConfigured) {
    return data.users
      .filter((user) => user.role !== "guest")
      .map(normalizeStudent)
      .filter((student) => !status || student.status === status)
      .filter((student) => !role || student.role === role)
      .filter((student) => !roles.length || roles.includes(student.role))
      .filter((student) => !query || [student.name, student.school, student.college, student.major, student.className, student.studentNo, student.phone].some((value) => String(value || "").includes(query)))
      .length;
  }
  await initialize();
  const values = [];
  const filters = [];
  if (query) {
    filters.push("(name LIKE ? OR school LIKE ? OR college LIKE ? OR major LIKE ? OR class_name LIKE ? OR student_no LIKE ? OR phone LIKE ?)");
    const like = `%${query}%`;
    values.push(like, like, like, like, like, like, like);
  }
  if (status === "active" || status === "disabled") {
    filters.push("status = ?");
    values.push(status);
  }
  if (["student", "teacher", "admin", "super_admin"].includes(role)) {
    filters.push("role = ?");
    values.push(role);
  } else if (roles.length) {
    filters.push(`role IN (${roles.map(() => "?").join(",")})`);
    values.push(...roles);
  }
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS total FROM students ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}`,
    values
  );
  return Number(rows[0].total);
}

async function countStudentsByRole({ query = "", status = "" } = {}) {
  const counts = { student: 0, teacher: 0, admin: 0, super_admin: 0 };
  if (!mysqlConfigured) {
    for (const student of data.users.map(normalizeStudent)) {
      if (!counts.hasOwnProperty(student.role)) continue;
      if (status && student.status !== status) continue;
      if (query && ![student.name, student.school, student.college, student.major, student.className, student.studentNo, student.phone].some((value) => String(value || "").includes(query))) continue;
      counts[student.role] += 1;
    }
    return counts;
  }
  await initialize();
  const values = [];
  const filters = [];
  if (query) {
    filters.push("(name LIKE ? OR school LIKE ? OR college LIKE ? OR major LIKE ? OR class_name LIKE ? OR student_no LIKE ? OR phone LIKE ?)");
    const like = `%${query}%`;
    values.push(like, like, like, like, like, like, like);
  }
  if (status === "active" || status === "disabled") {
    filters.push("status = ?");
    values.push(status);
  }
  const [rows] = await getPool().execute(
    `SELECT role, COUNT(*) AS total FROM students ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} GROUP BY role`,
    values
  );
  for (const row of rows) if (counts.hasOwnProperty(row.role)) counts[row.role] = Number(row.total);
  return counts;
}

function validateStudent(input) {
  const student = permanentAdmins.enforcePermanentPrivileges({
    id: String(input.id || `u-${crypto.randomUUID()}`),
    name: String(input.name || "").trim(),
    school: String(input.school || "").trim(),
    college: String(input.college || "").trim(),
    major: String(input.major || "").trim(),
    className: String(input.className || input.class_name || input.class || "").trim(),
    studentNo: String(input.studentNo || input.student_no || "").trim(),
    phone: String(input.phone || "").trim(),
    status: input.status === "disabled" ? "disabled" : "active",
    role: ["student", "teacher", "admin", "super_admin"].includes(input.role) ? input.role : "student",
    verified: input.verified !== false,
    avatarColor: input.avatarColor || "#1f7a6d"
  });
  if (!student.name || !student.school || !student.major || !student.studentNo || !student.phone) {
    throw new Error("姓名、学校、专业、学号和手机号不能为空");
  }
  if (!/^1\d{10}$/.test(student.phone)) throw new Error(`手机号格式错误：${student.phone}`);
  return student;
}

async function recordClassSyncError(student, error) {
  const syncError = {
    code: "class_sync_failed",
    retryable: true,
    userId: student.id || "",
    message: "班级同步失败，可稍后重试",
    detail: error?.message || "unknown class synchronization error",
    recordedAt: new Date().toISOString()
  };
  const recording = {
    durableRecorded: false,
    memoryQueued: false,
    auditRecorded: false
  };
  if (mysqlConfigured) {
    try {
      await getPool().execute(
        "INSERT INTO class_sync_errors (user_id, student_no, public_message, retryable, diagnostic) VALUES (?, ?, ?, ?, ?)",
        [
          syncError.userId,
          student.studentNo || "",
          syncError.message,
          syncError.retryable ? 1 : 0,
          JSON.stringify({
            code: syncError.code,
            detail: syncError.detail,
            recordedAt: syncError.recordedAt
          })
        ]
      );
      recording.durableRecorded = true;
    } catch (durableError) {
      syncError.recordingError = durableError.message;
    }
  }
  data.classSyncErrors.push(syncError);
  recording.memoryQueued = true;
  if (data.classSyncErrors.length > 500) data.classSyncErrors.splice(0, data.classSyncErrors.length - 500);
  try {
    if (mysqlConfigured) await getPool().execute(
      "INSERT INTO admin_audit_logs (action, target_student_no, detail) VALUES (?, ?, ?)",
      ["class_sync_failed", student.studentNo || "", JSON.stringify(syncError)]
    );
    if (mysqlConfigured) recording.auditRecorded = true;
  } catch (auditError) {
    console.warn("Class sync error could not be recorded:", auditError.message);
  }
  return {
    code: syncError.code,
    retryable: syncError.retryable,
    userId: syncError.userId,
    message: syncError.message,
    recordedAt: syncError.recordedAt,
    recording
  };
}

async function synchronizeClassAssignment(student) {
  try {
    await classStore.ensureStudentClassAssignment(student);
    return null;
  } catch (error) {
    return recordClassSyncError(student, error);
  }
}

async function upsertStudent(input) {
  let student = validateStudent(input);
  const existing = student.studentNo ? await findByStudentNo({ school: student.school, studentNo: student.studentNo }) : null;
  if (existing) {
    student.id = existing.id;
  }
  if (existing && permanentAdmins.isPermanentSuperAdmin(existing)) {
    student = {
      ...student,
      id: existing.id,
      name: existing.name,
      school: existing.school,
      major: existing.major,
      studentNo: existing.studentNo,
      status: "active",
      role: "super_admin",
      verified: true
    };
  }
  if (!mysqlConfigured) {
    const index = data.users.findIndex((user) => user.school === student.school && user.studentNo === student.studentNo);
    if (index >= 0) data.users[index] = { ...data.users[index], ...student };
    else data.users.push(student);
    student.syncError = await synchronizeClassAssignment(student);
    return student;
  }
  await initialize();
  await getPool().execute(`
    INSERT INTO students (id, name, school, college, major, class_name, student_no, phone, status, role, verified, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), college = VALUES(college), major = VALUES(major), class_name = VALUES(class_name), phone = VALUES(phone),
      status = VALUES(status), role = VALUES(role), verified = VALUES(verified), avatar_color = VALUES(avatar_color)
  `, [student.id, student.name, student.school, student.college, student.major, student.className, student.studentNo, student.phone, student.status, student.role, student.verified ? 1 : 0, student.avatarColor]);
  student.syncError = await synchronizeClassAssignment(student);
  return student;
}

async function bulkUpsertStudents(items = []) {
  const prepared = [];
  const errors = [];
  for (const item of items) {
    try {
      prepared.push({
        student: validateStudent(item.input),
        roleExplicit: Boolean(item.input.roleExplicit),
        statusExplicit: Boolean(item.input.statusExplicit),
        rowNumber: Number(item.rowNumber || 0)
      });
    } catch (error) {
      errors.push(`第 ${item.rowNumber || "?"} 行：${error.message}`);
    }
  }
  if (!prepared.length) return { success: 0, failed: errors.length, errors };
  if (!mysqlConfigured) {
    const syncErrors = [];
    for (const item of prepared) {
      const existing = await findByStudentNo({ school: item.student.school, studentNo: item.student.studentNo });
      let input = { ...item.student };
      if (existing) {
        input.id = existing.id;
        if (!item.roleExplicit) input.role = existing.role;
        if (!item.statusExplicit) input.status = existing.status;
        if (permanentAdmins.isPermanentSuperAdmin(existing)) input = { ...input, role: "super_admin", status: "active", verified: true };
      }
      const student = await upsertStudent(input);
      if (student.syncError) syncErrors.push(student.syncError);
    }
    return { success: prepared.length, failed: errors.length, errors, syncErrors };
  }

  await initialize();
  const existingByKey = new Map();
  const studentNumbers = [...new Set(prepared.map((item) => item.student.studentNo))];
  for (let offset = 0; offset < studentNumbers.length; offset += 300) {
    const chunk = studentNumbers.slice(offset, offset + 300);
    const placeholders = chunk.map(() => "?").join(",");
    const [rows] = await getPool().execute(`SELECT * FROM students WHERE student_no IN (${placeholders})`, chunk);
    for (const row of rows) existingByKey.set(`${row.school}\x1f${row.student_no}`, normalizeStudent(row));
  }

  const students = prepared.map((item) => {
    const key = `${item.student.school}\x1f${item.student.studentNo}`;
    const existing = existingByKey.get(key);
    let student = { ...item.student };
    if (existing) {
      student.id = existing.id;
      if (!item.roleExplicit) student.role = existing.role;
      if (!item.statusExplicit) student.status = existing.status;
      if (permanentAdmins.isPermanentSuperAdmin(existing)) {
        student = { ...student, role: "super_admin", status: "active", verified: true };
      }
    }
    return student;
  });

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    for (let offset = 0; offset < students.length; offset += 150) {
      const chunk = students.slice(offset, offset + 150);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const values = chunk.flatMap((student) => [
        student.id, student.name, student.school, student.college, student.major, student.className,
        student.studentNo, student.phone, student.status, student.role, student.verified ? 1 : 0, student.avatarColor
      ]);
      await connection.execute(`
        INSERT INTO students (id, name, school, college, major, class_name, student_no, phone, status, role, verified, avatar_color)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          name = VALUES(name), college = VALUES(college), major = VALUES(major), class_name = VALUES(class_name), phone = VALUES(phone),
          status = VALUES(status), role = VALUES(role), verified = VALUES(verified), avatar_color = VALUES(avatar_color)
      `, values);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const syncErrors = [];
  for (const student of students) {
    const syncError = await synchronizeClassAssignment(student);
    if (syncError) syncErrors.push(syncError);
  }
  return { success: students.length, failed: errors.length, errors, syncErrors };
}

async function setStudentStatus(identityInput, status) {
  const target = await findByStudentNo(identityInput);
  if (target && permanentAdmins.isPermanentSuperAdmin(target) && status !== "active") {
    throw new Error("永久总管理员账号不可停用");
  }
  if (!mysqlConfigured) {
    const student = target ? data.users.find((user) => user.id === target.id) : null;
    if (!student) return { updated: false, syncError: null };
    student.status = status;
    return { updated: true, syncError: await synchronizeClassAssignment(student) };
  }
  await initialize();
  if (!target) return { updated: false, syncError: null };
  const [result] = await getPool().execute("UPDATE students SET status = ? WHERE id = ?", [status, target.id]);
  if (!result.affectedRows) return { updated: false, syncError: null };
  return { updated: true, syncError: await synchronizeClassAssignment({ ...target, status }) };
}

async function setStudentRole(identityInput, role) {
  const target = await findByStudentNo(identityInput);
  if (target && permanentAdmins.isPermanentSuperAdmin(target) && role !== "super_admin") {
    throw new Error("永久总管理员账号不可降级");
  }
  if (!["student", "teacher", "admin", "super_admin"].includes(role)) throw new Error("账号角色无效");
  if (!mysqlConfigured) {
    const student = target ? data.users.find((user) => user.id === target.id) : null;
    if (!student) return { updated: false, syncError: null };
    student.role = role;
    return { updated: true, syncError: await synchronizeClassAssignment(student) };
  }
  await initialize();
  if (!target) return { updated: false, syncError: null };
  const [result] = await getPool().execute("UPDATE students SET role = ? WHERE id = ?", [role, target.id]);
  if (!result.affectedRows) return { updated: false, syncError: null };
  return { updated: true, syncError: await synchronizeClassAssignment({ ...target, role }) };
}

async function findByStudentNo(identityInput) {
  const identity = normalizeStudentNoIdentity(identityInput);
  if (!identity.id && !identity.studentNo) return null;
  if (!mysqlConfigured) {
    const matches = memoryMatchesStudentNo(identity);
    if (!identity.school && matches.length > 1) throw ambiguousStudentNoError(identity.studentNo);
    return normalizeStudent(matches[0]);
  }
  await initialize();
  let rows;
  if (identity.id) {
    [rows] = await getPool().execute("SELECT * FROM students WHERE id = ? LIMIT 1", [identity.id]);
  } else if (identity.school) {
    [rows] = await getPool().execute("SELECT * FROM students WHERE school = ? AND student_no = ? LIMIT 1", [identity.school, identity.studentNo]);
  } else {
    [rows] = await getPool().execute("SELECT * FROM students WHERE student_no = ? LIMIT 2", [identity.studentNo]);
  }
  if (!identity.school && rows.length > 1) throw ambiguousStudentNoError(identity.studentNo);
  return normalizeStudent(rows[0]);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function validPassword(password) {
  return String(password || "").length >= 8
    && /[A-Za-z]/.test(String(password))
    && /\d/.test(String(password));
}

async function setPassword(identityInput, password, { mustChange = false } = {}) {
  if (!validPassword(password)) throw new Error("密码至少 8 位，并同时包含字母和数字");
  const target = await findByStudentNo(identityInput);
  const passwordHash = hashPassword(password);
  if (!mysqlConfigured) {
    const student = target ? data.users.find((user) => user.id === target.id) : null;
    if (!student) return false;
    student.passwordHash = passwordHash;
    student.mustChangePassword = mustChange;
    return true;
  }
  await initialize();
  if (!target) return false;
  const [result] = await getPool().execute(
    "UPDATE students SET password_hash = ?, password_must_change = ? WHERE id = ?",
    [passwordHash, mustChange ? 1 : 0, target.id]
  );
  return result.affectedRows > 0;
}

async function clearPassword(identityInput) {
  const target = await findByStudentNo(identityInput);
  if (!mysqlConfigured) {
    const student = target ? data.users.find((user) => user.id === target.id) : null;
    if (!student) return false;
    student.passwordHash = "";
    student.mustChangePassword = false;
    return true;
  }
  await initialize();
  if (!target) return false;
  const [result] = await getPool().execute(
    "UPDATE students SET password_hash = NULL, password_must_change = 0 WHERE id = ?",
    [target.id]
  );
  return result.affectedRows > 0;
}

async function verifyPassword(identityInput, password) {
  const target = await findByStudentNo(identityInput);
  let encoded = "";
  if (!mysqlConfigured) {
    encoded = target ? data.users.find((user) => user.id === target.id)?.passwordHash || "" : "";
  } else {
    await initialize();
    if (!target) return false;
    const [rows] = await getPool().execute("SELECT password_hash FROM students WHERE id = ? LIMIT 1", [target.id]);
    encoded = rows[0]?.password_hash || "";
  }
  const [, salt, expected] = String(encoded).split("$");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

async function logAdminAction(action, studentNo = "", detail = {}) {
  if (!mysqlConfigured) return;
  await initialize();
  await getPool().execute("INSERT INTO admin_audit_logs (action, target_student_no, detail) VALUES (?, ?, ?)", [action, studentNo, JSON.stringify(detail)]);
}

async function logLegalConsent(user, consent, context = {}) {
  if (!user || !consent?.accepted) return false;
  const record = {
    userId: String(user.id || "guest"),
    studentNo: String(user.studentNo || ""),
    consentVersion: String(consent.version || ""),
    documents: Array.isArray(consent.documents) ? consent.documents : [],
    context,
    clientConsentedAt: String(consent.consentedAt || "")
  };
  if (!mysqlConfigured) {
    if (!Array.isArray(data.legalConsents)) data.legalConsents = [];
    data.legalConsents.push({ ...record, recordedAt: new Date().toISOString() });
    if (data.legalConsents.length > 500) data.legalConsents.splice(0, data.legalConsents.length - 500);
    return true;
  }
  await initialize();
  await getPool().execute(
    "INSERT INTO legal_consents (user_id, student_no, consent_version, documents, context, client_consented_at) VALUES (?, ?, ?, ?, ?, ?)",
    [record.userId, record.studentNo, record.consentVersion, JSON.stringify(record.documents), JSON.stringify(record.context), record.clientConsentedAt]
  );
  return true;
}

async function health() {
  if (!mysqlConfigured) return { mode: "memory", connected: true, message: "尚未配置 MySQL，当前使用本地演示数据" };
  try {
    await initialize();
    await getPool().query("SELECT 1");
    return { mode: "mysql", connected: true, database: process.env.MYSQL_DATABASE || "smart_campus" };
  } catch (error) {
    return { mode: "mysql", connected: false, message: error.message };
  }
}

module.exports = {
  mysqlConfigured,
  initialize,
  findById,
  findIdentity,
  findLoginAccount,
  listActiveSchools,
  findMajorBySchoolAndAccount,
  listStudents,
  countStudents,
  countStudentsByRole,
  upsertStudent,
  bulkUpsertStudents,
  setStudentStatus,
  setStudentRole,
  findByStudentNo,
  setPassword,
  clearPassword,
  verifyPassword,
  logAdminAction,
  logLegalConsent,
  health,
  enforcePermanentSuperAdmins,
  permanentAdminStatus: permanentAdmins.configurationStatus
};
