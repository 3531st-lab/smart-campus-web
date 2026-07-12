const fs = require("fs");
const path = require("path");
const data = require("./data");
const { mysqlConfigured, getPool } = require("./db");

const STORE_PATH = path.join(__dirname, "lab-reservations.json");
let initialized = false;

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function normalize(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id ?? row.userId,
    userName: row.user_name ?? row.userName ?? "",
    studentNo: row.student_no ?? row.studentNo ?? "",
    phone: row.phone ?? "",
    labId: row.lab_id ?? row.labId,
    labName: row.lab_name ?? row.labName,
    slot: row.slot,
    reason: row.reason,
    status: row.status || "pending",
    adminNote: row.admin_note ?? row.adminNote ?? "",
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? "",
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

function seedRows() {
  return (data.reservations || []).map((item) => normalize({
    ...item,
    userName: item.userName || "",
    studentNo: item.studentNo || "",
    phone: item.phone || "",
    createdAt: item.createdAt || item.updatedAt || nowText()
  }));
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const seeded = seedRows();
      fs.writeFileSync(STORE_PATH, JSON.stringify(seeded, null, 2));
      return seeded;
    }
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")).map(normalize).filter(Boolean);
  } catch (error) {
    return seedRows();
  }
}

function writeStore(rows) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows.map(normalize).filter(Boolean), null, 2));
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS lab_reservations (
      id VARCHAR(80) PRIMARY KEY,
      user_id VARCHAR(80) NOT NULL,
      user_name VARCHAR(80) NOT NULL DEFAULT '',
      student_no VARCHAR(64) NOT NULL DEFAULT '',
      phone VARCHAR(32) NOT NULL DEFAULT '',
      lab_id VARCHAR(80) NOT NULL,
      lab_name VARCHAR(160) NOT NULL,
      slot VARCHAR(160) NOT NULL,
      reason VARCHAR(600) NOT NULL DEFAULT '',
      status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
      admin_note VARCHAR(600) NOT NULL DEFAULT '',
      reviewed_by VARCHAR(80) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      KEY idx_user (user_id),
      KEY idx_status (status),
      KEY idx_lab_slot (lab_id, slot)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  initialized = true;
}

async function listForUser(user) {
  if (!mysqlConfigured) {
    return readStore().filter((item) => item.userId === user.id);
  }
  await initialize();
  const [rows] = await getPool().execute(
    "SELECT * FROM lab_reservations WHERE user_id = ? ORDER BY updated_at DESC",
    [user.id]
  );
  return rows.map(normalize);
}

async function listAll({ status = "" } = {}) {
  if (!mysqlConfigured) {
    return readStore()
      .filter((item) => !status || item.status === status)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  await initialize();
  const params = [];
  const where = status ? "WHERE status = ?" : "";
  if (status) params.push(status);
  const [rows] = await getPool().execute(
    `SELECT * FROM lab_reservations ${where} ORDER BY updated_at DESC`,
    params
  );
  return rows.map(normalize);
}

async function createReservation(input, user, lab) {
  const createdAt = nowText();
  const reservation = normalize({
    id: input.id,
    userId: user.id,
    userName: user.name || "",
    studentNo: user.studentNo || "",
    phone: user.phone || "",
    labId: lab.id,
    labName: lab.name,
    slot: input.slot || lab.freeSlots?.[0] || "",
    reason: input.reason || "网页端预约",
    status: "pending",
    adminNote: "",
    reviewedBy: "",
    createdAt,
    updatedAt: createdAt
  });
  if (!mysqlConfigured) {
    const rows = readStore();
    rows.unshift(reservation);
    writeStore(rows);
    return reservation;
  }
  await initialize();
  await getPool().execute(
    `INSERT INTO lab_reservations
      (id, user_id, user_name, student_no, phone, lab_id, lab_name, slot, reason, status, admin_note, reviewed_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reservation.id, reservation.userId, reservation.userName, reservation.studentNo, reservation.phone, reservation.labId, reservation.labName, reservation.slot, reservation.reason, reservation.status, reservation.adminNote, reservation.reviewedBy, reservation.createdAt, reservation.updatedAt]
  );
  return reservation;
}

async function reviewReservation(id, { status, adminNote = "" } = {}, adminUser) {
  const nextStatus = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "";
  if (!nextStatus) throw new Error("审批状态无效");
  const updatedAt = nowText();
  if (!mysqlConfigured) {
    const rows = readStore();
    const index = rows.findIndex((item) => item.id === id);
    if (index < 0) return null;
    rows[index] = normalize({
      ...rows[index],
      status: nextStatus,
      adminNote,
      reviewedBy: adminUser?.name || adminUser?.studentNo || "",
      updatedAt
    });
    writeStore(rows);
    return rows[index];
  }
  await initialize();
  const [result] = await getPool().execute(
    "UPDATE lab_reservations SET status = ?, admin_note = ?, reviewed_by = ?, updated_at = ? WHERE id = ?",
    [nextStatus, adminNote, adminUser?.name || adminUser?.studentNo || "", updatedAt, id]
  );
  if (!result.affectedRows) return null;
  const [rows] = await getPool().execute("SELECT * FROM lab_reservations WHERE id = ? LIMIT 1", [id]);
  return normalize(rows[0]);
}

async function health() {
  if (!mysqlConfigured) return { mode: "json", storage: STORE_PATH, status: "ready" };
  await initialize();
  return { mode: "mysql", status: "ready" };
}

module.exports = {
  createReservation,
  listForUser,
  listAll,
  reviewReservation,
  health
};
