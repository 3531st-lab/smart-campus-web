const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const XLSX = require("xlsx");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";
process.env.AUTH_SECRET = "test-only-auth-secret-with-more-than-thirty-two-characters";
process.env.CAMPUS_USER_ROLE = "super_admin";
process.env.CAMPUS_USER_STUDENT_NO = "TEST-SUPER-ADMIN";

const requestHandler = require("../server/index.js");

const legalConsent = {
  accepted: true,
  version: "2026.06.20",
  documents: ["user_agreement", "privacy_policy"],
  consentedAt: "2026-07-13T00:00:00.000Z"
};

let server;
let baseUrl;

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

test.before(async () => {
  server = http.createServer(requestHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("serves the app with the security baseline", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id") || "", /^[a-f0-9-]{36}$/);
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
