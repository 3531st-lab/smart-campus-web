const mysql = require("mysql2/promise");

const mysqlConfigured = Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);
let pool = null;

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
          ssl: process.env.MYSQL_SSL === "true"
            ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
            : undefined,
          connectionLimit: Math.min(Math.max(2, Number(process.env.MYSQL_POOL_SIZE) || 6), 12),
          maxIdle: 3,
          idleTimeout: 30_000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          charset: "utf8mb4"
        });
  }
  return pool;
}

module.exports = { mysqlConfigured, getPool };
