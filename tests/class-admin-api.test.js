const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";
process.env.AUTH_SECRET = "test-only-auth-secret-with-more-than-thirty-two-characters";
process.env.CAMPUS_USER_ROLE = "super_admin";
process.env.CAMPUS_USER_STUDENT_NO = "CLASS-SUPER-ADMIN";

const requestHandler = require("../server/index.js");
const data = require("../server/data");
const classStore = require("../server/class-store");

const fixtureIds = new Set([
  "class-api-admin",
  "class-api-monitor",
  "class-api-member",
  "class-api-other",
  "class-api-teacher",
  "class-api-duplicate-a",
  "class-api-duplicate-b"
]);

const fixtures = [
  {
    id: "class-api-admin",
    name: "班级普通管理员",
    school: "班级测试大学",
    college: "管理学院",
    major: "信息管理",
    className: "管理组",
    studentNo: "CLASS-ADMIN-001",
    phone: "13900001001",
    status: "active",
    role: "admin",
    verified: true
  },
  {
    id: "class-api-monitor",
    name: "赵同学",
    school: "班级测试大学",
    college: "经济学院",
    major: "数字经济",
    className: "24数字经济",
    studentNo: "CLASS-S001",
    phone: "13800001001",
    status: "active",
    role: "student",
    verified: true
  },
  {
    id: "class-api-member",
    name: "安同学",
    school: "班级测试大学",
    college: "经济学院",
    major: "数字经济",
    className: "24数字经济",
    studentNo: "CLASS-S002",
    phone: "13800001002",
    status: "active",
    role: "student",
    verified: true
  },
  {
    id: "class-api-other",
    name: "陈同学",
    school: "班级测试大学",
    college: "经济学院",
    major: "国际经济",
    className: "24国际经济",
    studentNo: "CLASS-S003",
    phone: "13800001003",
    status: "active",
    role: "student",
    verified: true
  },
  {
    id: "class-api-teacher",
    name: "周老师",
    school: "班级测试大学",
    college: "经济学院",
    major: "数字经济",
    className: "",
    studentNo: "CLASS-T001",
    phone: "13700001001",
    status: "active",
    role: "teacher",
    verified: true
  },
  {
    id: "class-api-duplicate-a", name: "同号甲", school: "班级测试大学", college: "经济学院",
    major: "数字经济", className: "24数字经济", studentNo: "DUPLICATE-001", phone: "13600001111",
    status: "active", role: "student", verified: true
  },
  {
    id: "class-api-duplicate-b", name: "同号乙", school: "另一所大学", college: "商学院",
    major: "会计学", className: "24会计", studentNo: "DUPLICATE-001", phone: "13600002222",
    status: "active", role: "student", verified: true
  }
];

let server;
let baseUrl;
let digitalClass;

function createTestToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: Date.now(),
    exp: Date.now() + 60_000,
    jti: crypto.randomUUID()
  }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function adminHeaders(userId, json = false) {
  return {
    Authorization: `Bearer ${createTestToken(userId)}`,
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function jsonRequest(pathname, { userId = "class-api-admin", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: adminHeaders(userId, body !== undefined),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, payload: await response.json() };
}

test.before(async () => {
  data.users.push(...fixtures);
  await classStore.ensureStudentClassAssignment(fixtures[1]);
  await classStore.ensureStudentClassAssignment(fixtures[2]);
  await classStore.ensureStudentClassAssignment(fixtures[3]);
  await classStore.ensureStudentClassAssignment(fixtures[5]);
  await classStore.ensureStudentClassAssignment(fixtures[6]);
  digitalClass = data.campusClasses.find((item) => item.className === "24数字经济");

  server = http.createServer(requestHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  const fixtureUserIds = new Set([
    ...fixtureIds,
    ...data.users.filter((user) => String(user.studentNo || "").startsWith("IMPORT-CLASS-")).map((user) => user.id)
  ]);
  for (let index = data.users.length - 1; index >= 0; index -= 1) {
    if (fixtureIds.has(data.users[index].id) || String(data.users[index].studentNo || "").startsWith("IMPORT-CLASS-")) {
      data.users.splice(index, 1);
    }
  }
  for (let index = data.classAssignments.length - 1; index >= 0; index -= 1) {
    if (fixtureUserIds.has(data.classAssignments[index].userId)) data.classAssignments.splice(index, 1);
  }
  for (let index = data.campusClasses.length - 1; index >= 0; index -= 1) {
    if (data.campusClasses[index].school === "班级测试大学") data.campusClasses.splice(index, 1);
  }
  for (let index = data.chatGroups.length - 1; index >= 0; index -= 1) {
    if (!data.campusClasses.some((campusClass) => campusClass.id === data.chatGroups[index].classId)) data.chatGroups.splice(index, 1);
  }
});

test("normal and super administrators can list privacy-safe class summaries", async () => {
  for (const userId of ["class-api-admin", "u-1001"]) {
    const { response, payload } = await jsonRequest("/api/admin/classes?school=班级测试大学", { userId });
    assert.equal(response.status, 200);
    const item = payload.classes.find((campusClass) => campusClass.id === digitalClass.id);
    assert.equal(item.className, "24数字经济");
    assert.equal(item.studentCount, 3);
    assert.equal(item.teacherCount, 0);
    assert.equal("phone" in item, false);
  }
});

test("class assignment APIs manage duties without granting platform roles or leaking phones", async () => {
  const studentUpdate = await jsonRequest("/api/admin/classes/assignments", {
    method: "PUT",
    body: { userId: "class-api-monitor", classId: digitalClass.id, duty: "monitor" }
  });
  assert.equal(studentUpdate.response.status, 200);
  assert.equal(studentUpdate.payload.assignment.duty, "monitor");
  assert.equal(studentUpdate.payload.assignment.user.role, "student");
  assert.equal("phone" in studentUpdate.payload.assignment.user, false);
  assert.equal("phoneMasked" in studentUpdate.payload.assignment.user, true);

  const teacherUpdate = await jsonRequest("/api/admin/classes/assignments", {
    userId: "u-1001",
    method: "PUT",
    body: { userId: "class-api-teacher", classId: digitalClass.id, duty: "head_teacher" }
  });
  assert.equal(teacherUpdate.response.status, 200);
  assert.equal(teacherUpdate.payload.assignment.duty, "head_teacher");
  assert.equal(teacherUpdate.payload.assignment.user.role, "teacher");

  const forbiddenRoleGrant = await jsonRequest("/api/admin/classes/assignments", {
    method: "PUT",
    body: { userId: "class-api-monitor", classId: digitalClass.id, duty: "monitor", role: "super_admin" }
  });
  assert.equal(forbiddenRoleGrant.response.status, 400);
  assert.equal(data.users.find((user) => user.id === "class-api-monitor").role, "student");
});

test("student duty rejects a different identity class and keeps one active assignment", async () => {
  const otherClass = data.campusClasses.find((item) => item.className === "24国际经济");
  const rejected = await jsonRequest("/api/admin/classes/assignments", {
    method: "PUT",
    body: { userId: "class-api-monitor", classId: otherClass.id, duty: "monitor" }
  });
  assert.equal(rejected.response.status, 400);
  const active = data.classAssignments.filter((item) => item.userId === "class-api-monitor" && item.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].classId, digitalClass.id);
});

test("duplicate student numbers remain manageable with stable id and school", async () => {
  const { payload } = await jsonRequest("/api/admin/students?query=DUPLICATE-001&page=1&pageSize=10");
  assert.equal(payload.students.length, 2);
  assert.deepEqual(new Set(payload.students.map((item) => item.school)), new Set(["班级测试大学", "另一所大学"]));
  const target = payload.students.find((item) => item.id === "class-api-duplicate-b");
  const updated = await jsonRequest("/api/admin/students/status", {
    method: "PUT",
    body: { userId: target.id, school: target.school, studentNo: target.studentNo, status: "disabled" }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(data.users.find((item) => item.id === target.id).status, "disabled");
  assert.equal(data.users.find((item) => item.id === "class-api-duplicate-a").status, "active");
});

test("teacher listing returns every active class assignment and supports removal", async () => {
  const otherClass = data.campusClasses.find((item) => item.className === "24国际经济");
  await jsonRequest("/api/admin/classes/assignments", {
    method: "PUT", body: { userId: "class-api-teacher", classId: otherClass.id, duty: "subject_teacher" }
  });
  const listed = await jsonRequest("/api/admin/students?role=teacher&query=CLASS-T001&page=1&pageSize=10");
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.students[0].classAssignments.length, 2);
  const removed = await jsonRequest("/api/admin/classes/assignments", {
    method: "DELETE", body: { userId: "class-api-teacher", classId: otherClass.id }
  });
  assert.equal(removed.response.status, 200);
  assert.equal(data.classAssignments.some((item) => item.userId === "class-api-teacher" && item.classId === otherClass.id && item.active), false);
});

test("student listing joins class identity, filters classes and uses stable duty order", async () => {
  const { response, payload } = await jsonRequest("/api/admin/students?role=student&school=班级测试大学&college=经济学院&className=24数字经济&page=1&pageSize=10");
  assert.equal(response.status, 200);
  assert.deepEqual(payload.students.map((student) => student.id), ["class-api-monitor", "class-api-member", "class-api-duplicate-a"]);
  assert.deepEqual(payload.students.map((student) => student.classDuty), ["monitor", "member", "member"]);
  for (const student of payload.students) {
    assert.equal(student.classId, digitalClass.id);
    assert.match(student.classKey, /班级测试大学/);
    assert.equal("phone" in student, false);
  }
  assert.equal(payload.page, 1);
  assert.equal(payload.totalPages, 1);
  assert.equal(payload.totalCount, 3);
});

test("class sync is available to normal administrators", async () => {
  const dryRun = await jsonRequest("/api/admin/classes/sync", {
    method: "POST",
    body: { dryRun: true }
  });
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.payload.summary.dryRun, true);
  assert.ok(dryRun.payload.summary.checked >= 3);
});

test("identity import accepts class duties and related classes with row-specific validation", async () => {
  const rows = [
    {
      姓名: "导入班长",
      学校: "班级测试大学",
      学院: "经济学院",
      专业: "数字经济",
      班级: "24数字经济",
      学号: "IMPORT-CLASS-S001",
      手机号: "13600001001",
      角色: "学生",
      班级职务: "班长"
    },
    {
      姓名: "导入老师",
      学校: "班级测试大学",
      学院: "经济学院",
      专业: "数字经济",
      学号: "IMPORT-CLASS-T001",
      手机号: "13600001002",
      角色: "老师",
      班级职务: "任课老师",
      关联班级: "24数字经济"
    },
    {
      姓名: "错误职务",
      学校: "班级测试大学",
      学院: "经济学院",
      专业: "数字经济",
      班级: "24数字经济",
      学号: "IMPORT-CLASS-BAD",
      手机号: "13600001003",
      角色: "学生",
      班级职务: "平台总管理员"
    }
  ];
  const { response, payload } = await jsonRequest("/api/admin/students/import", {
    method: "POST",
    body: { filename: "班级职务导入.xlsx", rows }
  });
  assert.equal(response.status, 200);
  assert.equal(payload.success, 2);
  assert.equal(payload.failed, 1);
  assert.ok(payload.errors.some((error) => String(error).includes("第 4 行") && String(error).includes("班级职务")));
  assert.equal(data.users.some((user) => user.studentNo === "IMPORT-CLASS-BAD"), false);

  const importedStudent = data.users.find((user) => user.studentNo === "IMPORT-CLASS-S001");
  const importedTeacher = data.users.find((user) => user.studentNo === "IMPORT-CLASS-T001");
  assert.equal(data.classAssignments.find((item) => item.userId === importedStudent.id && item.active).duty, "monitor");
  assert.equal(data.classAssignments.find((item) => item.userId === importedTeacher.id && item.active).duty, "subject_teacher");
});

test("assignment failure reports identity persistence truthfully", async () => {
  const original = classStore.setStudentDuty;
  const originalConsoleError = console.error;
  classStore.setStudentDuty = async () => { throw new Error("private SQL text"); };
  console.error = () => {};
  try {
    const { response, payload } = await jsonRequest("/api/admin/students/import", {
      method: "POST",
      body: { rows: [{ 姓名: "半成功", 学校: "班级测试大学", 学院: "经济学院", 专业: "数字经济", 班级: "24数字经济", 学号: "IMPORT-CLASS-PARTIAL", 手机号: "13600001009", 角色: "学生", 班级职务: "班长" }] }
    });
    assert.equal(response.status, 200);
    assert.equal(payload.success, 1);
    assert.equal(payload.failed, 0);
    assert.equal(payload.classAssignmentFailed, 1);
    assert.equal(payload.rows[0].identityImported, true);
    assert.equal(payload.rows[0].classAssignmentFailed, true);
    assert.doesNotMatch(JSON.stringify(payload), /private SQL text/);
    assert.equal(data.users.some((item) => item.studentNo === "IMPORT-CLASS-PARTIAL"), true);
  } finally {
    classStore.setStudentDuty = original;
    console.error = originalConsoleError;
  }
});

test("role counts honor class filters and unassigned continuation uses a sentinel", async () => {
  const filtered = await jsonRequest("/api/admin/students?school=班级测试大学&college=经济学院&className=24数字经济&role=student&page=1&pageSize=10");
  assert.equal(filtered.payload.roleCounts.student, filtered.payload.totalCount);
  const filteredTeachers = await jsonRequest("/api/admin/students?school=班级测试大学&college=经济学院&className=24数字经济&role=teacher&page=1&pageSize=10");
  assert.equal(filtered.payload.roleCounts.teacher, filteredTeachers.payload.totalCount);

  const unassigned = [];
  for (let index = 0; index < 12; index += 1) {
    const row = { id: `class-unassigned-${index}`, name: `未分班${index}`, school: "续页大学", college: "学院", major: "专业", className: "", studentNo: `UNASSIGNED-${index}`, phone: `1350000${String(index).padStart(4, "0")}`, status: "active", role: "teacher", verified: true };
    data.users.push(row); unassigned.push(row.id); fixtureIds.add(row.id);
  }
  const page = await jsonRequest("/api/admin/students?school=续页大学&role=teacher&page=2&pageSize=10");
  assert.equal(page.payload.continuedClassKey, "__unassigned__");

  const emptyTrailingPage = await jsonRequest("/api/admin/students?school=续页大学&role=teacher&page=3&pageSize=10");
  assert.equal(emptyTrailingPage.response.status, 200);
  assert.deepEqual(emptyTrailingPage.payload.students, []);
  assert.equal(emptyTrailingPage.payload.continuedClassKey, null);
});

test("identity UI exposes grouped class controls for desktop and mobile", () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "assets", "styles.css"), "utf8");
  assert.match(app, /student-class-filters/);
  assert.match(app, /class-group-heading/);
  assert.match(app, /接上页/);
  assert.match(app, /student-class-duty-select/);
  assert.match(app, /teacher-class-assignment/);
  assert.match(app, /data-user-id/);
  assert.match(app, /data-school/);
  assert.match(app, /teacher-class-assignment-remove/);
  assert.match(app, /method:\s*"DELETE"[\s\S]*userId:\s*button\.dataset\.userId/);
  assert.match(app, /userId:\s*select\.dataset\.userId, school:\s*select\.dataset\.school/);
  assert.match(app, /班级职务/);
  assert.match(app, /关联班级/);
  assert.match(styles, /\.class-group-heading/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.student-class-filters/);
});
