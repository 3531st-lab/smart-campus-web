const crypto = require("crypto");
const data = require("./data");
const permanentAdmins = require("./permanent-admins");
const { mysqlConfigured, autoMigrateSchema, getPool } = require("./db");

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

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  if (!autoMigrateSchema) {
    initialized = true;
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
      data.users[index] = permanentAdmins.enforcePermanentPrivileges(data.users[index]);
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
    `SELECT * FROM students ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
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

async function upsertStudent(input) {
  let student = validateStudent(input);
  const existing = student.studentNo ? await findByStudentNo(student.studentNo) : null;
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
    for (const item of prepared) await upsertStudent(item.student);
    return { success: prepared.length, failed: errors.length, errors };
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
  return { success: students.length, failed: errors.length, errors };
}

async function setStudentStatus(studentNo, status) {
  const target = await findByStudentNo(studentNo);
  if (target && permanentAdmins.isPermanentSuperAdmin(target) && status !== "active") {
    throw new Error("永久总管理员账号不可停用");
  }
  if (!mysqlConfigured) {
    const student = data.users.find((user) => user.studentNo === studentNo);
    if (!student) return false;
    student.status = status;
    return true;
  }
  await initialize();
  const [result] = await getPool().execute("UPDATE students SET status = ? WHERE student_no = ?", [status, studentNo]);
  return result.affectedRows > 0;
}

async function setStudentRole(studentNo, role) {
  const target = await findByStudentNo(studentNo);
  if (target && permanentAdmins.isPermanentSuperAdmin(target) && role !== "super_admin") {
    throw new Error("永久总管理员账号不可降级");
  }
  if (!["student", "teacher", "admin", "super_admin"].includes(role)) throw new Error("账号角色无效");
  if (!mysqlConfigured) {
    const student = data.users.find((user) => user.studentNo === studentNo);
    if (!student) return false;
    student.role = role;
    return true;
  }
  await initialize();
  const [result] = await getPool().execute("UPDATE students SET role = ? WHERE student_no = ?", [role, studentNo]);
  return result.affectedRows > 0;
}

async function findByStudentNo(studentNo) {
  if (!mysqlConfigured) return normalizeStudent(data.users.find((user) => user.studentNo === studentNo));
  await initialize();
  const [rows] = await getPool().execute("SELECT * FROM students WHERE student_no = ? LIMIT 1", [studentNo]);
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

async function setPassword(studentNo, password, { mustChange = false } = {}) {
  if (!validPassword(password)) throw new Error("密码至少 8 位，并同时包含字母和数字");
  const passwordHash = hashPassword(password);
  if (!mysqlConfigured) {
    const student = data.users.find((user) => user.studentNo === studentNo);
    if (!student) return false;
    student.passwordHash = passwordHash;
    student.mustChangePassword = mustChange;
    return true;
  }
  await initialize();
  const [result] = await getPool().execute(
    "UPDATE students SET password_hash = ?, password_must_change = ? WHERE student_no = ?",
    [passwordHash, mustChange ? 1 : 0, studentNo]
  );
  return result.affectedRows > 0;
}

async function clearPassword(studentNo) {
  if (!mysqlConfigured) {
    const student = data.users.find((user) => user.studentNo === studentNo);
    if (!student) return false;
    student.passwordHash = "";
    student.mustChangePassword = false;
    return true;
  }
  await initialize();
  const [result] = await getPool().execute(
    "UPDATE students SET password_hash = NULL, password_must_change = 0 WHERE student_no = ?",
    [studentNo]
  );
  return result.affectedRows > 0;
}

async function verifyPassword(studentNo, password) {
  let encoded = "";
  if (!mysqlConfigured) {
    encoded = data.users.find((user) => user.studentNo === studentNo)?.passwordHash || "";
  } else {
    await initialize();
    const [rows] = await getPool().execute("SELECT password_hash FROM students WHERE student_no = ? LIMIT 1", [studentNo]);
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
