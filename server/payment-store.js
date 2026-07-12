const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const STORE_PATH = path.join(__dirname, "payment-orders.json");
const mysqlConfigured = Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);
let pool = null;
let initialized = false;

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
          ssl: process.env.MYSQL_SSL === "true" ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
          connectionLimit: 8,
          charset: "utf8mb4"
        });
  }
  return pool;
}

async function initialize() {
  if (!mysqlConfigured || initialized) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id VARCHAR(80) PRIMARY KEY,
      user_id VARCHAR(80) NOT NULL,
      provider VARCHAR(40) NOT NULL DEFAULT '',
      scene VARCHAR(160) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(12) NOT NULL DEFAULT 'cny',
      status VARCHAR(40) NOT NULL DEFAULT 'created',
      stripe_session_id VARCHAR(160) NULL,
      checkout_url TEXT NULL,
      metadata JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_payment_user (user_id, created_at),
      UNIQUE KEY uq_stripe_session (stripe_session_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  initialized = true;
}

function readStore() {
  try {
    const rows = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeStore(rows) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(rows, null, 2));
}

async function create(order) {
  if (!mysqlConfigured) {
    const rows = readStore();
    rows.unshift(order);
    writeStore(rows.slice(0, 500));
    return order;
  }
  await initialize();
  await getPool().execute(
    `INSERT INTO payment_orders
      (id, user_id, provider, scene, amount, currency, status, stripe_session_id, checkout_url, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [order.id, order.userId, order.provider || "", order.scene, order.amount, order.currency || "cny", order.status || "created", order.stripeSessionId || null, order.checkoutUrl || "", JSON.stringify(order.metadata || {})]
  );
  return order;
}

async function update(id, patch = {}) {
  if (!mysqlConfigured) {
    const rows = readStore();
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0) rows[index] = { ...rows[index], ...patch };
    writeStore(rows);
    return index >= 0 ? rows[index] : null;
  }
  await initialize();
  await getPool().execute(
    `UPDATE payment_orders SET status = ?, stripe_session_id = ?, checkout_url = ?, metadata = ? WHERE id = ?`,
    [patch.status || "created", patch.stripeSessionId || null, patch.checkoutUrl || "", JSON.stringify(patch.metadata || {}), id]
  );
  return { id, ...patch };
}

async function markStripeSession(sessionId, status, metadata = {}) {
  if (!mysqlConfigured) {
    const rows = readStore();
    const index = rows.findIndex((item) => item.stripeSessionId === sessionId);
    if (index >= 0) rows[index] = { ...rows[index], status, metadata: { ...(rows[index].metadata || {}), ...metadata } };
    writeStore(rows);
    return index >= 0 ? rows[index] : null;
  }
  await initialize();
  const [result] = await getPool().execute(
    "UPDATE payment_orders SET status = ?, metadata = ? WHERE stripe_session_id = ?",
    [status, JSON.stringify(metadata), sessionId]
  );
  return result.affectedRows || 0;
}

async function health() {
  if (!mysqlConfigured) return { mode: "json", status: "ready" };
  await initialize();
  await getPool().query("SELECT 1");
  return { mode: "mysql", status: "ready" };
}

module.exports = { create, update, markStripeSession, health };
