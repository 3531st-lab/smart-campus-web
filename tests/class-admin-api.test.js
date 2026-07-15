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
  "class-api-teacher"
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
    assert.equal(item.studentCount, 2);
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

test("student listing joins class identity, filters classes and uses stable duty order", async () => {
  const { response, payload } = await jsonRequest("/api/admin/students?role=student&school=班级测试大学&college=经济学院&className=24数字经济&page=1&pageSize=10");
  assert.equal(response.status, 200);
  assert.deepEqual(payload.students.map((student) => student.id), ["class-api-monitor", "class-api-member"]);
  assert.deepEqual(payload.students.map((student) => student.classDuty), ["monitor", "member"]);
  for (const student of payload.students) {
    assert.equal(student.classId, digitalClass.id);
    assert.match(student.classKey, /班级测试大学/);
    assert.equal("phone" in student, false);
  }
  assert.equal(payload.page, 1);
  assert.equal(payload.totalPages, 1);
  assert.equal(payload.totalCount, 2);
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

test("identity UI exposes grouped class controls for desktop and mobile", () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public", "assets", "styles.css"), "utf8");
  assert.match(app, /student-class-filters/);
  assert.match(app, /class-group-heading/);
  assert.match(app, /接上页/);
  assert.match(app, /student-class-duty-select/);
  assert.match(app, /teacher-class-assignment/);
  assert.match(app, /班级职务/);
  assert.match(app, /关联班级/);
  assert.match(styles, /\.class-group-heading/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.student-class-filters/);
});
