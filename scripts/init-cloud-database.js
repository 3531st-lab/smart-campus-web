const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

// Keep this maintenance command aligned with the development server: local
// credentials stay in .env and are never printed by the script.
function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadLocalEnv();

const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing database variables: ${missing.join(", ")}`);
  process.exit(1);
}

function databaseName() {
  const name = String(process.env.MYSQL_DATABASE || "smart_campus").trim();
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("MYSQL_DATABASE contains unsupported characters");
  return name;
}

function baseSchemaStatements(schema, database) {
  return schema
    .replace(/CREATE DATABASE IF NOT EXISTS smart_campus/gi, `CREATE DATABASE IF NOT EXISTS \`${database}\``)
    .replace(/USE smart_campus/gi, `USE \`${database}\``)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement && !/^ALTER TABLE\s+/i.test(statement));
}

async function hasColumn(connection, database, table, column) {
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1",
    [database, table, column]
  );
  return rows.length > 0;
}

async function hasIndex(connection, database, table, index) {
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ? LIMIT 1",
    [database, table, index]
  );
  return rows.length > 0;
}

async function ensureColumn(connection, database, table, column, definition) {
  if (await hasColumn(connection, database, table, column)) return;
  await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function ensureIndex(connection, database, table, index, definition) {
  if (await hasIndex(connection, database, table, index)) return;
  await connection.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
}

async function applyCompatibilityMigrations(connection, database) {
  const columns = [
    ["chat_groups", "public_no", "VARCHAR(32) NULL"],
    ["chat_groups", "owner_id", "VARCHAR(64) NULL"],
    ["chat_groups", "frozen", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["chat_groups", "next_message_sequence", "BIGINT UNSIGNED NOT NULL DEFAULT 0"],
    ["chat_groups", "description", "VARCHAR(500) NOT NULL DEFAULT ''"],
    ["chat_groups", "join_policy", "VARCHAR(32) NOT NULL DEFAULT 'review'"],
    ["chat_invites", "expires_at", "TIMESTAMP NULL"],
    ["chat_messages", "sticker_id", "VARCHAR(64) NULL"],
    ["quality_assessment_periods", "publication_working_days", "INT UNSIGNED NULL"],
    ["quality_assessment_periods", "publication_ends_at", "TIMESTAMP NULL"],
    ["quality_assessment_periods", "archived_at", "TIMESTAMP NULL"],
    ["quality_assessment_records", "school", "VARCHAR(120) NOT NULL DEFAULT ''"],
    ["quality_assessment_evidence", "mime_type", "VARCHAR(120) NOT NULL DEFAULT ''"],
    ["quality_assessment_evidence", "size_bytes", "BIGINT UNSIGNED NOT NULL DEFAULT 0"],
    ["quality_assessment_evidence", "content_digest", "CHAR(64) NOT NULL DEFAULT ''"]
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(connection, database, table, column, definition);
  }

  await connection.query(
    "ALTER TABLE `chat_groups` MODIFY COLUMN `status` ENUM('active','frozen','closed','disabled') NOT NULL DEFAULT 'active'"
  );

  const indexes = [
    ["chat_groups", "uq_chat_group_public_no", "UNIQUE INDEX `uq_chat_group_public_no` (`public_no`)"],
    ["chat_groups", "idx_chat_group_owner", "INDEX `idx_chat_group_owner` (`owner_id`, `status`)"],
    ["chat_invites", "idx_chat_invite_expiry", "INDEX `idx_chat_invite_expiry` (`expires_at`, `status`)"],
    ["chat_messages", "idx_chat_message_sticker", "INDEX `idx_chat_message_sticker` (`sticker_id`)"],
    ["quality_assessment_records", "idx_quality_record_scope_status", "INDEX `idx_quality_record_scope_status` (`school`, `college`, `status`, `updated_at`)" ]
  ];
  for (const [table, index, definition] of indexes) {
    await ensureIndex(connection, database, table, index, definition);
  }
}

async function main() {
  const database = databaseName();
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ssl: process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
    charset: "utf8mb4",
    multipleStatements: true
  });

  try {
    const schemaPath = path.join(__dirname, "..", "server", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    for (const statement of baseSchemaStatements(schema, database)) await connection.query(statement);
    await applyCompatibilityMigrations(connection, database);
    const [tables] = await connection.query(`SHOW TABLES FROM \`${database}\``);
    console.log(`Database ${database} is ready with ${tables.length} tables.`);
  } finally {
    await connection.end();
  }

  const studentStore = require("../server/student-store");
  const reservationStore = require("../server/reservation-store");
  const notificationStore = require("../server/notification-store");
  const timetableStore = require("../server/timetable-store");
  const paymentStore = require("../server/payment-store");
  const [identity, reservations, timetable, payments] = await Promise.all([
    studentStore.health(),
    reservationStore.health(),
    timetableStore.health(),
    paymentStore.health()
  ]);
  await notificationStore.cleanup(14);
  console.log(`Business stores are ready: identity=${identity.mode}, reservations=${reservations.mode}, timetable=${timetable.mode}, payments=${payments.mode}.`);

  const verification = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    ssl: process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
    charset: "utf8mb4"
  });
  try {
    const [roles] = await verification.query(
      "SELECT role, COUNT(*) AS count FROM students GROUP BY role ORDER BY role"
    );
    console.log(`Account roles: ${roles.map((row) => `${row.role}=${row.count}`).join(", ") || "empty"}.`);
  } finally {
    await verification.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
}).then(() => process.exit(0));
