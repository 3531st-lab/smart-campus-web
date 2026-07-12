const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const STORE_PATH = path.join(__dirname, "user-timetables.json");
const PREFERENCES_PATH = path.join(__dirname, "user-timetable-preferences.json");
const mysqlConfigured = Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);
let pool = null;
let initialized = false;

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readStore() {
  const value = readJson(STORE_PATH, {});
  return value && typeof value === "object" ? value : {};
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function readPreferencesStore() {
  const value = readJson(PREFERENCES_PATH, { global: {}, users: {} });
  return {
    global: value.global && typeof value.global === "object" ? value.global : {},
    users: value.users && typeof value.users === "object" ? value.users : {}
  };
}

function writePreferencesStore(store) {
  fs.writeFileSync(PREFERENCES_PATH, JSON.stringify(store, null, 2));
}

function ownerKey(user) {
  return String(user?.studentNo || user?.id || "guest");
}

function mysqlOptions() {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "smart_campus",
    ssl: process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
    connectionLimit: 8,
    charset: "utf8mb4"
  };
}

function getPool() {
  if (!mysqlConfigured) return null;
  if (!pool) {
    pool = process.env.DATABASE_URL
      ? mysql.createPool(process.env.DATABASE_URL)
      : mysql.createPool(mysqlOptions());
  }
  return pool;
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_timetable_courses (
      owner_key VARCHAR(80) NOT NULL,
      course_id VARCHAR(160) NOT NULL,
      course_data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_key, course_id),
      KEY idx_timetable_owner (owner_key)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_timetable_preferences (
      owner_key VARCHAR(80) PRIMARY KEY,
      semester VARCHAR(120) NOT NULL DEFAULT '',
      week TINYINT UNSIGNED NOT NULL DEFAULT 0,
      schedule VARCHAR(20) NOT NULL DEFAULT '',
      hidden_course_ids JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS timetable_global_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  initialized = true;
  await seedLocalData();
}

async function seedLocalData() {
  const db = getPool();
  const localCourses = readStore();
  for (const [key, courses] of Object.entries(localCourses)) {
    if (!Array.isArray(courses)) continue;
    for (const course of courses) {
      const id = String(course.id || `local-${Date.now()}`);
      await db.execute(
        "INSERT IGNORE INTO user_timetable_courses (owner_key, course_id, course_data) VALUES (?, ?, ?)",
        [key, id, JSON.stringify({ ...course, id })]
      );
    }
  }

  const localPreferences = readPreferencesStore();
  for (const [key, value] of Object.entries(localPreferences.users)) {
    await db.execute(
      `INSERT IGNORE INTO user_timetable_preferences
        (owner_key, semester, week, schedule, hidden_course_ids) VALUES (?, ?, ?, ?, ?)`,
      [
        key,
        String(value.semester || ""),
        Number(value.week || 0),
        String(value.schedule || ""),
        JSON.stringify(Array.isArray(value.hiddenCourseIds) ? value.hiddenCourseIds : [])
      ]
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(localPreferences.global.weekOneStart || ""))) {
    await db.execute(
      "INSERT IGNORE INTO timetable_global_settings (setting_key, setting_value) VALUES ('weekOneStart', ?)",
      [localPreferences.global.weekOneStart]
    );
  }
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function listCourses(user) {
  const key = ownerKey(user);
  if (!mysqlConfigured) {
    const store = readStore();
    return Array.isArray(store[key]) ? store[key] : [];
  }
  await initialize();
  const [rows] = await getPool().execute(
    "SELECT course_data FROM user_timetable_courses WHERE owner_key = ? ORDER BY created_at, course_id",
    [key]
  );
  return rows.map((row) => parseJson(row.course_data, null)).filter(Boolean);
}

async function getPreferences(user) {
  const key = ownerKey(user);
  if (!mysqlConfigured) {
    const store = readPreferencesStore();
    const own = store.users[key] || {};
    return {
      semester: own.semester || "",
      week: Number(own.week || 0) || 0,
      schedule: own.schedule || "",
      weekOneStart: store.global.weekOneStart || "2026-02-23",
      hiddenCourseIds: Array.isArray(own.hiddenCourseIds) ? own.hiddenCourseIds : []
    };
  }
  await initialize();
  const [[ownRows], [globalRows]] = await Promise.all([
    getPool().execute("SELECT * FROM user_timetable_preferences WHERE owner_key = ? LIMIT 1", [key]),
    getPool().execute("SELECT setting_value FROM timetable_global_settings WHERE setting_key = 'weekOneStart' LIMIT 1")
  ]);
  const own = ownRows[0] || {};
  return {
    semester: own.semester || "",
    week: Number(own.week || 0) || 0,
    schedule: own.schedule || "",
    weekOneStart: globalRows[0]?.setting_value || "2026-02-23",
    hiddenCourseIds: parseJson(own.hidden_course_ids, [])
  };
}

async function savePreferences(user, patch = {}, canManageCalendar = false) {
  const key = ownerKey(user);
  const current = await getPreferences(user);
  const next = {
    semester: typeof patch.semester === "string" ? patch.semester : current.semester,
    week: Number(patch.week) >= 1 && Number(patch.week) <= 20 ? Number(patch.week) : current.week,
    schedule: ["summer", "winter"].includes(patch.schedule) ? patch.schedule : current.schedule,
    hiddenCourseIds: current.hiddenCourseIds
  };
  const nextStart = canManageCalendar && /^\d{4}-\d{2}-\d{2}$/.test(String(patch.weekOneStart || ""))
    ? patch.weekOneStart
    : current.weekOneStart;

  if (!mysqlConfigured) {
    const store = readPreferencesStore();
    store.users[key] = next;
    if (canManageCalendar) store.global.weekOneStart = nextStart;
    writePreferencesStore(store);
    return { ...next, weekOneStart: nextStart };
  }
  await initialize();
  await getPool().execute(
    `INSERT INTO user_timetable_preferences (owner_key, semester, week, schedule, hidden_course_ids)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE semester = VALUES(semester), week = VALUES(week),
      schedule = VALUES(schedule), hidden_course_ids = VALUES(hidden_course_ids)`,
    [key, next.semester, next.week, next.schedule, JSON.stringify(next.hiddenCourseIds)]
  );
  if (canManageCalendar) {
    await getPool().execute(
      `INSERT INTO timetable_global_settings (setting_key, setting_value) VALUES ('weekOneStart', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [nextStart]
    );
  }
  return { ...next, weekOneStart: nextStart };
}

async function setCourseHidden(user, id, hidden = true) {
  const current = await getPreferences(user);
  const ids = new Set(current.hiddenCourseIds.map(String));
  if (hidden) ids.add(String(id));
  else ids.delete(String(id));
  const nextIds = [...ids];
  const key = ownerKey(user);
  if (!mysqlConfigured) {
    const store = readPreferencesStore();
    store.users[key] = { ...(store.users[key] || {}), hiddenCourseIds: nextIds };
    writePreferencesStore(store);
    return nextIds;
  }
  await initialize();
  await getPool().execute(
    `INSERT INTO user_timetable_preferences (owner_key, hidden_course_ids) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE hidden_course_ids = VALUES(hidden_course_ids)`,
    [key, JSON.stringify(nextIds)]
  );
  return nextIds;
}

async function saveCourses(user, courses = []) {
  const key = ownerKey(user);
  const normalized = (Array.isArray(courses) ? courses : []).map((course) => ({
    ...course,
    id: String(course.id || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  }));
  if (!mysqlConfigured) {
    const store = readStore();
    store[key] = normalized;
    writeStore(store);
    return normalized;
  }
  await initialize();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM user_timetable_courses WHERE owner_key = ?", [key]);
    for (const course of normalized) {
      await connection.execute(
        "INSERT INTO user_timetable_courses (owner_key, course_id, course_data) VALUES (?, ?, ?)",
        [key, course.id, JSON.stringify(course)]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return normalized;
}

async function upsertCourse(user, course) {
  const id = String(course.id || `manual-${Date.now()}`);
  const nextCourse = { ...course, id };
  if (!mysqlConfigured) {
    const courses = await listCourses(user);
    const index = courses.findIndex((item) => String(item.id) === id);
    const nextCourses = index >= 0
      ? courses.map((item) => (String(item.id) === id ? { ...item, ...nextCourse } : item))
      : [...courses, nextCourse];
    await setCourseHidden(user, id, false);
    return { course: nextCourse, courses: await saveCourses(user, nextCourses) };
  }
  await initialize();
  const existing = (await listCourses(user)).find((item) => String(item.id) === id);
  const merged = existing ? { ...existing, ...nextCourse } : nextCourse;
  await getPool().execute(
    `INSERT INTO user_timetable_courses (owner_key, course_id, course_data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE course_data = VALUES(course_data)`,
    [ownerKey(user), id, JSON.stringify(merged)]
  );
  await setCourseHidden(user, id, false);
  return { course: merged, courses: await listCourses(user) };
}

async function deleteCourse(user, id) {
  if (!mysqlConfigured) {
    const courses = (await listCourses(user)).filter((item) => String(item.id) !== String(id));
    return saveCourses(user, courses);
  }
  await initialize();
  await getPool().execute(
    "DELETE FROM user_timetable_courses WHERE owner_key = ? AND course_id = ?",
    [ownerKey(user), String(id)]
  );
  return listCourses(user);
}

async function health() {
  if (!mysqlConfigured) return { mode: "json", status: "ready" };
  await initialize();
  await getPool().query("SELECT 1");
  return { mode: "mysql", status: "ready" };
}

module.exports = {
  listCourses,
  saveCourses,
  upsertCourse,
  deleteCourse,
  getPreferences,
  savePreferences,
  setCourseHidden,
  health
};
