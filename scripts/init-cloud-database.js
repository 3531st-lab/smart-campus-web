const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing database variables: ${missing.join(", ")}`);
  process.exit(1);
}

async function main() {
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
    await connection.query(fs.readFileSync(schemaPath, "utf8"));
    const database = process.env.MYSQL_DATABASE || "smart_campus";
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
    database: process.env.MYSQL_DATABASE || "smart_campus",
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
