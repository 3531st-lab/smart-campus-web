const crypto = require("crypto");
const mysql = require("mysql2/promise");
const data = require("./data");

const mysqlConfigured = Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);
let pool = null;
let initialized = false;

function normalizeStudent(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    school: row.school,
    college: row.college || "",
    major: row.major,
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
  };
}

function getPool() {
  if (!mysqlConfigured) return null;
  if (!pool) {
    pool = process.env.DATABASE_URL
      ? mysql.createPool(process.env.DATABASE_URL)
      : mysql.createPool({
          host: process.env.MYSQL_HOST,
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE || "smart_campus",
          connectionLimit: 8,
          charset: "utf8mb4"
        });
  }
  return pool;
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      school VARCHAR(120) NOT NULL,
      college VARCHAR(120) NOT NULL DEFAULT '',
      major VARCHAR(120) NOT NULL,
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
      KEY idx_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query("ALTER TABLE students MODIFY role ENUM('student','teacher','admin','super_admin') NOT NULL DEFAULT 'student'");
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
  initialized = true;
  await seedPrivateStudent();
  await db.execute("UPDATE students SET password_hash = NULL, password_must_change = 0 WHERE password_must_change = 1");
}

async function seedPrivateStudent() {
  if (!mysqlConfigured || !process.env.CAMPUS_USER_STUDENT_NO || !process.env.CAMPUS_USER_PHONE) return;
  await upsertStudent({
    name: process.env.CAMPUS_USER_NAME || "石天",
    school: process.env.CAMPUS_USER_SCHOOL || "泰州学院",
    college: process.env.CAMPUS_USER_COLLEGE || "",
    major: process.env.CAMPUS_USER_MAJOR || "",
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

async function listStudents({ query = "", status = "", role = "", limit = 200 } = {}) {
  if (!mysqlConfigured) {
    return data.users
      .filter((user) => user.role !== "guest")
      .map(normalizeStudent)
      .filter((student) => !status || student.status === status)
      .filter((student) => !role || student.role === role)
      .filter((student) => !query || [student.name, student.school, student.major, student.studentNo, student.phone].some((value) => String(value || "").includes(query)));
  }
  await initialize();
  const values = [];
  const filters = [];
  if (query) {
    filters.push("(name LIKE ? OR school LIKE ? OR major LIKE ? OR student_no LIKE ? OR phone LIKE ?)");
    const like = `%${query}%`;
    values.push(like, like, like, like, like);
  }
  if (status === "active" || status === "disabled") {
    filters.push("status = ?");
    values.push(status);
  }
  if (["student", "teacher", "admin", "super_admin"].includes(role)) {
    filters.push("role = ?");
    values.push(role);
  }
  const safeLimit = Math.min(Number(limit) || 200, 1000);
  const [rows] = await getPool().execute(
    `SELECT * FROM students ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ${safeLimit}`,
    values
  );
  return rows.map(normalizeStudent);
}

async function countStudents({ roles = [] } = {}) {
  if (!mysqlConfigured) {
    return data.users.filter((user) => user.role !== "guest" && (!roles.length || roles.includes(user.role))).length;
  }
  await initialize();
  if (!roles.length) {
    const [rows] = await getPool().query("SELECT COUNT(*) AS total FROM students");
    return Number(rows[0].total);
  }
  const placeholders = roles.map(() => "?").join(",");
  const [rows] = await getPool().execute(`SELECT COUNT(*) AS total FROM students WHERE role IN (${placeholders})`, roles);
  return Number(rows[0].total);
}

function validateStudent(input) {
  const student = {
    id: String(input.id || `u-${crypto.randomUUID()}`),
    name: String(input.name || "").trim(),
    school: String(input.school || "").trim(),
    college: String(input.college || "").trim(),
    major: String(input.major || "").trim(),
    studentNo: String(input.studentNo || input.student_no || "").trim(),
    phone: String(input.phone || "").trim(),
    status: input.status === "disabled" ? "disabled" : "active",
    role: ["student", "teacher", "admin", "super_admin"].includes(input.role) ? input.role : "student",
    verified: input.verified !== false,
    avatarColor: input.avatarColor || "#1f7a6d"
  };
  if (!student.name || !student.school || !student.major || !student.studentNo || !student.phone) {
    throw new Error("姓名、学校、专业、学号和手机号不能为空");
  }
  if (!/^1\d{10}$/.test(student.phone)) throw new Error(`手机号格式错误：${student.phone}`);
  return student;
}

async function upsertStudent(input) {
  const student = validateStudent(input);
  if (!mysqlConfigured) {
    const index = data.users.findIndex((user) => user.school === student.school && user.studentNo === student.studentNo);
    if (index >= 0) data.users[index] = { ...data.users[index], ...student };
    else data.users.push(student);
    return student;
  }
  await initialize();
  await getPool().execute(`
    INSERT INTO students (id, name, school, college, major, student_no, phone, status, role, verified, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), college = VALUES(college), major = VALUES(major), phone = VALUES(phone),
      status = VALUES(status), role = VALUES(role), verified = VALUES(verified), avatar_color = VALUES(avatar_color)
  `, [student.id, student.name, student.school, student.college, student.major, student.studentNo, student.phone, student.status, student.role, student.verified ? 1 : 0, student.avatarColor]);
  return student;
}

async function setStudentStatus(studentNo, status) {
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
  upsertStudent,
  setStudentStatus,
  setStudentRole,
  findByStudentNo,
  setPassword,
  clearPassword,
  verifyPassword,
  logAdminAction,
  health
};
