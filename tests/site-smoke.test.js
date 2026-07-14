const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";
process.env.AUTH_SECRET = "test-only-auth-secret-with-more-than-thirty-two-characters";
process.env.CAMPUS_USER_ROLE = "super_admin";
process.env.CAMPUS_USER_STUDENT_NO = "TEST-SUPER-ADMIN";

const requestHandler = require("../server/index.js");
const data = require("../server/data");
const studentStore = require("../server/student-store");

const legalConsent = {
  accepted: true,
  version: "2026.06.20",
  documents: ["user_agreement", "privacy_policy"],
  consentedAt: "2026-07-13T00:00:00.000Z"
};

let server;
let baseUrl;
const mutableStorePaths = [
  "lab-reservations.json",
  "notification-receipts.json",
  "user-timetables.json",
  "user-timetable-preferences.json",
  "ai-runtime.json"
].map((filename) => path.join(__dirname, "..", "server", filename));
const mutableStoreBackups = new Map();

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

function withIdentityFixtures(t) {
  const fixtures = [
    { id: "lookup-student", name: "联动学生", school: "联动大学", college: "信息学院", major: "软件工程", studentNo: "LOOKUP-S001", phone: "13800000001", status: "active", role: "student", verified: true },
    { id: "lookup-teacher", name: "联动老师", school: "联动大学", college: "信息学院", major: "计算机科学", studentNo: "LOOKUP-T001", phone: "13800000002", status: "active", role: "teacher", verified: true },
    { id: "lookup-disabled", name: "停用学生", school: "停用账号大学", college: "信息学院", major: "数据科学", studentNo: "LOOKUP-D001", phone: "13800000003", status: "disabled", role: "student", verified: true }
  ];
  data.users.push(...fixtures);
  t.after(() => {
    for (const fixture of fixtures) {
      const index = data.users.findIndex((user) => user.id === fixture.id);
      if (index >= 0) data.users.splice(index, 1);
    }
  });
}

test.before(async () => {
  for (const storePath of mutableStorePaths) {
    mutableStoreBackups.set(storePath, fs.existsSync(storePath) ? fs.readFileSync(storePath) : null);
  }
  server = http.createServer(requestHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const [storePath, backup] of mutableStoreBackups) {
    if (backup === null) fs.rmSync(storePath, { force: true });
    else fs.writeFileSync(storePath, backup);
  }
});

test("serves the app with the security baseline", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id") || "", /^[a-f0-9-]{36}$/);
});

test("serves the single-page app for direct deep links", async () => {
  for (const route of ["/tools", "/tools/quality-score"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} should fall back to the application shell`);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.match(await response.text(), /<div id="app"><\/div>/);
  }
});

test("rejects untrusted CORS origins and malformed JSON", async () => {
  const preflight = await fetch(`${baseUrl}/api/me`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example" }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);

  const malformed = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json"
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "JSON 格式错误");
});

test("queries role-scoped schools and majors from the identity store", async (t) => {
  withIdentityFixtures(t);
  const studentSchools = await studentStore.listActiveSchools("student");
  const teacherSchools = await studentStore.listActiveSchools("teacher");
  assert.deepEqual(studentSchools.filter((school) => school.startsWith("联动")), ["联动大学"]);
  assert.ok(teacherSchools.includes("联动大学"));
  assert.equal(studentSchools.includes("停用账号大学"), false);
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "联动大学", studentNo: "LOOKUP-S001", identityType: "student" }), "软件工程");
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "联动大学", studentNo: "LOOKUP-T001", identityType: "student" }), "");
  assert.equal(await studentStore.findMajorBySchoolAndAccount({ school: "停用账号大学", studentNo: "LOOKUP-D001", identityType: "student" }), "");
});

test("returns the campus news shell immediately while a cold cache refreshes", async () => {
  const login = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ legalConsent })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/campus-news`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(response.status, 200);
  assert.ok(elapsedMs < 1000, `cold campus news response took ${elapsedMs}ms`);
  assert.equal((await response.json()).refreshing, true);
});

test("supports the guest read-only core journey", async () => {
  const login = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ legalConsent })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);

  const headers = { Authorization: `Bearer ${token}` };
  for (const route of [
    "me",
    "integrations/status",
    "library/layout",
    "exams",
    "timetable/personal",
    "tools/catalog",
    "ai/status",
    "dashboard",
    "labs",
    "reservations",
    "repairs",
    "notifications",
    "lab-rules",
    "timetable",
    "canteen/menu",
    "visitor/qrcode"
  ]) {
    const response = await fetch(`${baseUrl}/api/${route}`, { headers });
    assert.equal(response.status, 200, `${route} should load`);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
  }

  const admin = await fetch(`${baseUrl}/api/admin/students`, { headers });
  assert.equal(admin.status, 403);
});

test("restricts campus news imports to administrators and safe article URLs", async () => {
  const login = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ legalConsent })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const guestImport = await fetch(`${baseUrl}/api/campus-news/import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: "访客不能导入",
      source: "测试来源",
      category: "校园资讯",
      url: "https://www.tzu.edu.cn/"
    })
  });
  assert.equal(guestImport.status, 403);

  const invalidUrl = await fetch(`${baseUrl}/api/campus-news/import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createTestToken("u-1001")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: "不安全链接",
      source: "测试来源",
      category: "校园资讯",
      url: "javascript:alert(1)"
    })
  });
  assert.equal(invalidUrl.status, 400);
});

test("imports an Excel identity workbook and supports role filters and pagination", async () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({
    姓名: `测试学生${String(index + 1).padStart(2, "0")}`,
    学校: "测试大学",
    学院: "测试学院",
    专业: "软件工程",
    班级: "软工2401班",
    学号: `S${String(index + 1).padStart(4, "0")}`,
    手机号: String(13810000001 + index),
    状态: "正常",
    角色: "学生"
  }));
  rows.push(
    { 姓名: "测试老师", 学校: "测试大学", 学院: "测试学院", 专业: "软件工程", 班级: "教师组", 学号: "T0001", 手机号: "13910000001", 状态: "正常", 角色: "老师" },
    { 姓名: "测试管理员", 学校: "测试大学", 学院: "测试学院", 专业: "信息管理", 班级: "管理组", 学号: "A0001", 手机号: "13910000002", 状态: "正常", 角色: "普通管理员" },
    { 姓名: "测试总管理员", 学校: "测试大学", 学院: "测试学院", 专业: "信息管理", 班级: "管理组", 学号: "SA0001", 手机号: "13910000003", 状态: "正常", 角色: "总管理员" }
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "身份库");
  const fileBase64 = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64");
  const headers = {
    Authorization: `Bearer ${createTestToken("u-1001")}`,
    "Content-Type": "application/json"
  };

  const imported = await fetch(`${baseUrl}/api/admin/students/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ filename: "身份库测试.xlsx", fileBase64 })
  });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).success, rows.length);

  const firstPage = await fetch(`${baseUrl}/api/admin/students?role=student&page=1&pageSize=10`, { headers });
  const firstPageData = await firstPage.json();
  assert.equal(firstPage.status, 200);
  assert.equal(firstPageData.students.length, 10);
  assert.equal(firstPageData.totalCount, 24);
  assert.equal(firstPageData.totalPages, 3);
  assert.equal(firstPageData.canManageRoles, true);

  const lastPage = await fetch(`${baseUrl}/api/admin/students?role=student&page=3&pageSize=10`, { headers });
  const lastPageData = await lastPage.json();
  assert.equal(lastPageData.students.length, 4);

  for (const [role, expectedName] of [["teacher", "测试老师"], ["admin", "测试管理员"], ["super_admin", "测试总管理员"]]) {
    const response = await fetch(`${baseUrl}/api/admin/students?role=${role}&page=1&pageSize=10`, { headers });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.ok(payload.students.some((student) => student.name === expectedName), `${role} filter should return ${expectedName}`);
  }
});

test("exports a timetable as an in-memory workbook for serverless deployments", async () => {
  const headers = {
    Authorization: `Bearer ${createTestToken("u-1001")}`,
    "Content-Type": "application/json"
  };
  const response = await fetch(`${baseUrl}/api/timetable/export`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      courses: [{
        semester: "2025-2026-2",
        weeks: [1, 2, 3],
        day: 1,
        startSection: 1,
        sectionCount: 2,
        course: "Serverless Export Regression",
        location: "A101",
        teacher: "Test Teacher"
      }]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.filename, /^timetable-\d+\.xlsx$/);
  assert.equal(payload.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok(payload.fileBase64, "the workbook must be returned without writing to the deployment filesystem");

  const workbook = XLSX.read(Buffer.from(payload.fileBase64, "base64"), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  assert.equal(rows.length, 1);
  assert.ok(Object.values(rows[0]).includes("Serverless Export Regression"));
});

test("persists timetable edits, calendar settings and course deletion", async () => {
  const headers = {
    Authorization: `Bearer ${createTestToken("u-1001")}`,
    "Content-Type": "application/json"
  };
  const courseId = `workflow-course-${Date.now()}`;
  const course = {
    id: courseId,
    semester: "2025-2026-2",
    weeks: [1, 2, 3],
    day: 2,
    startSection: 3,
    sectionCount: 2,
    course: "Workflow Course",
    location: "B202",
    teacher: "Original Teacher"
  };

  const created = await fetch(`${baseUrl}/api/timetable/personal/course`, {
    method: "POST",
    headers,
    body: JSON.stringify({ course })
  });
  assert.equal(created.status, 200);
  assert.ok((await created.json()).courses.some((item) => item.id === courseId));

  const updated = await fetch(`${baseUrl}/api/timetable/personal/course`, {
    method: "POST",
    headers,
    body: JSON.stringify({ course: { ...course, teacher: "Updated Teacher" } })
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).course.teacher, "Updated Teacher");

  const settings = await fetch(`${baseUrl}/api/timetable/settings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ semester: course.semester, week: 9, schedule: "summer", weekOneStart: "2026-03-02" })
  });
  assert.equal(settings.status, 200);
  assert.deepEqual((await settings.json()).settings, {
    semester: course.semester,
    week: 9,
    schedule: "summer",
    weekOneStart: "2026-03-02",
    hiddenCourseIds: []
  });

  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers });
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.timetable.settings.weekOneStart, "2026-03-02");
  assert.ok(dashboardData.timetable.personalCourses.some((item) => item.id === courseId && item.teacher === "Updated Teacher"));
  assert.ok(dashboardData.recentCampusNews.length <= 5, "the dashboard must never overflow the five-row campus news panel");

  const deleted = await fetch(`${baseUrl}/api/timetable/personal/delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: courseId })
  });
  const deletedData = await deleted.json();
  assert.equal(deleted.status, 200);
  assert.ok(!deletedData.courses.some((item) => item.id === courseId));
  assert.ok(deletedData.hiddenCourseIds.includes(courseId));
});

test("connects lab reservation approval to unread notifications", async () => {
  const headers = {
    Authorization: `Bearer ${createTestToken("u-1001")}`,
    "Content-Type": "application/json"
  };
  const beforeResponse = await fetch(`${baseUrl}/api/dashboard/reservations`, { headers });
  const before = await beforeResponse.json();
  assert.equal(beforeResponse.status, 200);

  const slot = `周二 14:00-16:00 · Regression ${Date.now()}`;
  const submitted = await fetch(`${baseUrl}/api/reservations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ labId: "lab-301", slot, reason: "Workflow regression" })
  });
  assert.equal(submitted.status, 201);
  const reservation = (await submitted.json()).reservation;
  assert.equal(reservation.status, "pending");

  const pendingResponse = await fetch(`${baseUrl}/api/dashboard/reservations`, { headers });
  const pendingDashboard = await pendingResponse.json();
  assert.equal(pendingDashboard.reservationSummary.totalCount, before.reservationSummary.totalCount + 1);
  assert.equal(pendingDashboard.reservationSummary.pendingCount, before.reservationSummary.pendingCount + 1);
  assert.equal(pendingDashboard.recentReservations[0].id, reservation.id);

  const reviewed = await fetch(`${baseUrl}/api/admin/reservations/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: reservation.id, status: "approved", adminNote: "Approved in regression test" })
  });
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).reservation.status, "approved");

  const approvedResponse = await fetch(`${baseUrl}/api/dashboard/reservations`, { headers });
  const approvedDashboard = await approvedResponse.json();
  assert.equal(approvedDashboard.reservationSummary.approvedCount, before.reservationSummary.approvedCount + 1);
  assert.equal(approvedDashboard.reservationSummary.pendingCount, before.reservationSummary.pendingCount);
  assert.equal(approvedDashboard.reservationSummary.approvedHours, before.reservationSummary.approvedHours + 2);
  assert.ok(approvedDashboard.reservationSummary.updatedAt);

  const notificationResponse = await fetch(`${baseUrl}/api/notifications`, { headers });
  const notificationData = await notificationResponse.json();
  const notification = notificationData.notifications.find((item) => item.sourceId === reservation.id);
  assert.equal(notificationResponse.status, 200);
  assert.ok(notification);
  assert.equal(notification.status, "approved");
  assert.equal(notification.read, false);

  const markedRead = await fetch(`${baseUrl}/api/notifications/read`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: notification.id })
  });
  assert.equal(markedRead.status, 200);

  const nextNotifications = await fetch(`${baseUrl}/api/notifications`, { headers });
  const nextData = await nextNotifications.json();
  assert.equal(nextData.notifications.find((item) => item.id === notification.id)?.read, true);
});

test("saves and reports the AI runtime configuration without exposing its key", async () => {
  const headers = {
    Authorization: `Bearer ${createTestToken("u-1001")}`,
    "Content-Type": "application/json"
  };
  const saved = await fetch(`${baseUrl}/api/admin/ai-config`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "audit-test-model",
      apiKey: "test-key-that-must-not-be-returned",
      requestsPerMinute: 7,
      systemPrompt: "Regression test"
    })
  });
  const savedPayload = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(savedPayload.model, "audit-test-model");
  assert.equal(savedPayload.persistence, "file");
  assert.equal(savedPayload.persistent, true);
  assert.equal(savedPayload.keySaved, true);
  assert.equal("apiKey" in savedPayload, false);
  const storedConfig = fs.readFileSync(path.join(__dirname, "..", "server", "ai-runtime.json"), "utf8");
  assert.doesNotMatch(storedConfig, /test-key-that-must-not-be-returned/);
  assert.equal(JSON.parse(storedConfig).algorithm, "aes-256-gcm");

  const loaded = await fetch(`${baseUrl}/api/admin/ai-config`, { headers });
  const loadedPayload = await loaded.json();
  assert.equal(loaded.status, 200);
  assert.equal(loadedPayload.model, "audit-test-model");
  assert.equal("apiKey" in loadedPayload, false);
});
