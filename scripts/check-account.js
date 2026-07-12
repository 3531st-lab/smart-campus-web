require("../server/index");
const mysql = require("mysql2/promise");

async function main() {
  const studentNo = String(process.argv[2] || "").trim();
  if (!studentNo) throw new Error("Usage: node scripts/check-account.js <student-no>");
  const connection = process.env.DATABASE_URL
    ? await mysql.createConnection(process.env.DATABASE_URL)
    : await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE || "smart_campus",
        ssl: process.env.MYSQL_SSL === "true" ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
        charset: "utf8mb4"
      });
  try {
    const [rows] = await connection.execute(
      "SELECT school, college, major, class_name, student_no, phone, role, status FROM students WHERE student_no = ? LIMIT 1",
      [studentNo]
    );
    if (!rows[0]) {
      console.log(JSON.stringify({ found: false }));
      return;
    }
    const row = rows[0];
    console.log(JSON.stringify({
      found: true,
      school: row.school,
      college: row.college,
      major: row.major,
      className: row.class_name,
      studentNo: String(row.student_no).replace(/^(.{2}).*(.{2})$/, "$1****$2"),
      phone: String(row.phone).replace(/^(.{3}).*(.{2})$/, "$1******$2"),
      role: row.role,
      status: row.status
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
