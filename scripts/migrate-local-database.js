const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const TABLES = [
  "students",
  "admin_audit_logs",
  "legal_consents",
  "lab_reservations",
  "notification_receipts"
];

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

function connectionOptions(values, prefix = "") {
  const read = (name, fallback = "") => values[`${prefix}${name}`] || fallback;
  return {
    host: read("MYSQL_HOST"),
    port: Number(read("MYSQL_PORT", "3306")),
    user: read("MYSQL_USER"),
    password: read("MYSQL_PASSWORD"),
    database: read("MYSQL_DATABASE", "smart_campus"),
    ssl: read("MYSQL_SSL") === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
    charset: "utf8mb4"
  };
}

async function columns(connection, database, table) {
  const [rows] = await connection.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [database, table]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function migrateTable(source, target, sourceDatabase, targetDatabase, table) {
  const [sourceColumns, targetColumns] = await Promise.all([
    columns(source, sourceDatabase, table),
    columns(target, targetDatabase, table)
  ]);
  if (!sourceColumns.length || !targetColumns.length) return { table, rows: 0, skipped: true };

  const shared = sourceColumns.filter((column) => targetColumns.includes(column));
  const escaped = shared.map((column) => `\`${column}\``).join(", ");
  const [rows] = await source.query(`SELECT ${escaped} FROM \`${table}\``);
  if (!rows.length) return { table, rows: 0 };

  const updateColumns = shared.filter((column) => column !== "id");
  const updates = updateColumns.length
    ? updateColumns.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(", ")
    : `${escaped.split(", ")[0]} = ${escaped.split(", ")[0]}`;
  const placeholders = `(${shared.map(() => "?").join(", ")})`;

  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const values = batch.flatMap((row) => shared.map((column) => row[column]));
    const groups = batch.map(() => placeholders).join(", ");
    await target.query(
      `INSERT INTO \`${table}\` (${escaped}) VALUES ${groups} ON DUPLICATE KEY UPDATE ${updates}`,
      values
    );
  }
  return { table, rows: rows.length };
}

async function main() {
  const localEnv = readEnv(path.join(__dirname, "..", ".env"));
  const sourceOptions = connectionOptions(localEnv);
  const targetOptions = connectionOptions(process.env, "TARGET_");
  if (!sourceOptions.host || !targetOptions.host) throw new Error("Missing source or target database configuration.");

  const source = await mysql.createConnection(sourceOptions);
  const target = await mysql.createConnection(targetOptions);
  try {
    for (const table of TABLES) {
      const result = await migrateTable(
        source,
        target,
        sourceOptions.database,
        targetOptions.database,
        table
      );
      console.log(`${result.table}: ${result.skipped ? "not present" : `${result.rows} rows`}`);
    }
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
