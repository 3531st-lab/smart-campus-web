require("../server/index");
const mysql = require("mysql2/promise");
const studentStore = require("../server/student-store");

(async () => {
  if (process.env.DATABASE_URL || process.env.MYSQL_HOST) {
    const pool = process.env.DATABASE_URL
      ? mysql.createPool(process.env.DATABASE_URL)
      : mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE || "smart_campus",
        charset: "utf8mb4"
      });
    const [[counts]] = await pool.query("SELECT COUNT(*) AS total, SUM(class_name <> '') AS withClass, COUNT(DISTINCT NULLIF(class_name, '')) AS classCount FROM students");
    const [classRows] = await pool.query("SELECT DISTINCT class_name FROM students WHERE class_name <> '' ORDER BY class_name LIMIT 20");
    const [noClassRows] = await pool.query("SELECT name, school, college, major, student_no, phone, role FROM students WHERE class_name = '' OR class_name IS NULL LIMIT 10");
    await pool.end();
    console.log(JSON.stringify({
      total: Number(counts.total),
      withClass: Number(counts.withClass || 0),
      classCount: Number(counts.classCount || 0),
      sampleClasses: classRows.map((row) => row.class_name),
      noClassRows
    }, null, 2));
    process.exit(0);
  }
  const rows = await studentStore.listStudents({ limit: 3000 });
  const classes = [...new Set(rows.map((student) => student.className).filter(Boolean))].sort();
  console.log(JSON.stringify({
    total: rows.length,
    withClass: rows.filter((student) => String(student.className || "").trim()).length,
    classCount: classes.length,
    sampleClasses: classes.slice(0, 20)
  }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
