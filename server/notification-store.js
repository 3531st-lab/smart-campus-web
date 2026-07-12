const fs = require("fs");
const path = require("path");
const { mysqlConfigured, autoMigrateSchema, getPool } = require("./db");

const STORE_PATH = path.join(__dirname, "notification-receipts.json");
let initialized = false;

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const rows = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    return [];
  }
}

function writeStore(rows) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2));
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  if (!autoMigrateSchema) {
    initialized = true;
    return;
  }
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS notification_receipts (
      user_id VARCHAR(80) NOT NULL,
      notification_id VARCHAR(220) NOT NULL,
      read_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (user_id, notification_id),
      KEY idx_read_at (read_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  initialized = true;
}

async function readIds(userId, notificationIds = []) {
  if (!userId || !notificationIds.length) return new Set();
  if (!mysqlConfigured) {
    const allowed = new Set(notificationIds);
    return new Set(readStore().filter((row) => row.userId === userId && allowed.has(row.notificationId)).map((row) => row.notificationId));
  }
  await initialize();
  const placeholders = notificationIds.map(() => "?").join(",");
  const [rows] = await getPool().execute(
    `SELECT notification_id FROM notification_receipts WHERE user_id = ? AND notification_id IN (${placeholders})`,
    [userId, ...notificationIds]
  );
  return new Set(rows.map((row) => row.notification_id));
}

async function markRead(userId, notificationIds = []) {
  const ids = [...new Set(notificationIds.filter(Boolean))];
  if (!userId || !ids.length) return 0;
  const readAt = new Date().toISOString();
  if (!mysqlConfigured) {
    const rows = readStore();
    const keys = new Set(rows.map((row) => `${row.userId}|${row.notificationId}`));
    for (const notificationId of ids) {
      const key = `${userId}|${notificationId}`;
      if (!keys.has(key)) rows.push({ userId, notificationId, readAt });
    }
    writeStore(rows);
    return ids.length;
  }
  await initialize();
  for (const notificationId of ids) {
    await getPool().execute(
      "INSERT INTO notification_receipts (user_id, notification_id, read_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE read_at = VALUES(read_at)",
      [userId, notificationId, readAt]
    );
  }
  return ids.length;
}

async function cleanup(retentionDays = 14) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  if (!mysqlConfigured) {
    const rows = readStore();
    const nextRows = rows.filter((row) => String(row.readAt || "") >= cutoff);
    if (nextRows.length !== rows.length) writeStore(nextRows);
    return rows.length - nextRows.length;
  }
  await initialize();
  const [result] = await getPool().execute("DELETE FROM notification_receipts WHERE read_at < ?", [cutoff]);
  return result.affectedRows || 0;
}

module.exports = { readIds, markRead, cleanup };
