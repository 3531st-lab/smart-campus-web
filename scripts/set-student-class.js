require("../server/index");
const studentStore = require("../server/student-store");

(async () => {
  const studentNo = process.argv[2];
  const className = process.argv[3];
  if (!studentNo || !className) throw new Error("用法：node scripts/set-student-class.js 学号 班级");
  const existing = await studentStore.findByStudentNo(studentNo);
  if (!existing) throw new Error(`未找到学号/工号：${studentNo}`);
  await studentStore.upsertStudent({ ...existing, className });
  console.log(JSON.stringify({ updated: true, studentNo, name: existing.name, className }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
