const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
const data = require("./data");
const XLSX = require("xlsx");
const studentStore = require("./student-store");
const examCatalog = require("./exams-data.json");

const PORT = Number(process.env.PORT || 5173);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const sessions = new Map();
const smsRateLimits = new Map();
const TOKEN_SECRET = process.env.AUTH_SECRET || "smart-campus-public-demo-v1";
const SMS_TOKEN_SECRET = process.env.SMS_TOKEN_SECRET || TOKEN_SECRET;
const SMS_CODE_TTL_MS = 5 * 60 * 1000;
const SMS_RESEND_MS = 60 * 1000;
const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").toLowerCase();
const AI_BASE_URL = String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const AI_API_KEY = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "");
const AI_MODEL = String(process.env.AI_MODEL || "gpt-5.5");
const AI_SYSTEM_PROMPT = String(process.env.AI_SYSTEM_PROMPT || "你是一个能力全面、准确、实用的 AI 助手。你可以回答通用知识、学习、写作、编程、数据分析、职业规划和校园生活等问题。请直接解决用户问题，不要把回答局限于校园场景。");
const AI_MAX_REQUESTS_PER_MINUTE = Math.max(1, Number(process.env.AI_MAX_REQUESTS_PER_MINUTE || 12));
const aiRateLimits = new Map();
const libraryReservations = [];
const paymentOrders = [];
const importedNews = [];
const conversionJobs = [];

const libraryFloors = [
  { id: "1", name: "一层", summary: "综合服务与活动空间", image: "/assets/library-floors/floor-1.png" },
  { id: "2", name: "二层", summary: "安静自习与阅览区", image: "/assets/library-floors/floor-2.png" },
  { id: "3", name: "三层", summary: "研讨室与数字学习区", image: "/assets/library-floors/floor-3.png" }
];
const libraryZones = [
  { id: "z-101", floorId: "1", name: "共享学习区", type: "开放座位", capacity: 48, available: 31, quiet: "★★★", power: "桌面电源", x: 8, y: 18, w: 40, h: 30, slots: ["08:00-10:00", "10:00-12:00", "14:00-16:00", "16:00-18:00"] },
  { id: "z-201", floorId: "2", name: "安静阅览区", type: "个人座位", capacity: 80, available: 52, quiet: "★★★★★", power: "部分电源", x: 10, y: 14, w: 48, h: 36, slots: ["08:00-12:00", "13:30-17:30", "18:00-21:00"] },
  { id: "z-301", floorId: "3", name: "数字学习区", type: "电脑座位", capacity: 36, available: 18, quiet: "★★★★", power: "全覆盖", x: 8, y: 16, w: 42, h: 32, slots: ["09:00-11:00", "14:00-16:00", "18:00-20:00"] },
  { id: "z-302", floorId: "3", name: "研讨室", type: "小组空间", capacity: 24, available: 8, quiet: "★★★", power: "全覆盖", x: 56, y: 18, w: 34, h: 30, slots: ["09:00-11:00", "13:30-15:30", "16:00-18:00"] }
];
const librarySeats = libraryZones.flatMap((zone) => Array.from({ length: Math.min(zone.capacity, 18) }, (_, index) => ({
  id: `${zone.id}-s${index + 1}`,
  floorId: zone.floorId,
  zoneId: zone.id,
  code: `${zone.name.slice(0, 1)}${String(index + 1).padStart(2, "0")}`,
  status: index % 7 === 0 ? "occupied" : index % 11 === 0 ? "reserved" : "available",
  x: zone.x + 4 + (index % 6) * 6,
  y: zone.y + 5 + Math.floor(index / 6) * 8
})));
const campusNews = [
  { title: "泰州学院智慧校园服务持续升级", source: "泰州学院", category: "官网公告", date: "06-14", url: "https://www.tzu.edu.cn/" },
  { title: "数字经济专业实践周活动安排", source: "经济与管理学院", category: "二级学院", date: "06-13", url: "https://www.tzu.edu.cn/" },
  { title: "青年志愿服务项目开始招募", source: "校团委", category: "团委社团", date: "06-12", url: "https://www.tzu.edu.cn/" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function aiStatus() {
  return {
    configured: Boolean(AI_API_KEY),
    provider: AI_PROVIDER,
    model: AI_MODEL,
    baseUrl: AI_BASE_URL.replace(/:\/\/([^/@]+)@/, "://***@"),
    requestsPerMinute: AI_MAX_REQUESTS_PER_MINUTE
  };
}

function consumeAiRequest(userId) {
  const now = Date.now();
  const recent = (aiRateLimits.get(userId) || []).filter((time) => now - time < 60_000);
  if (recent.length >= AI_MAX_REQUESTS_PER_MINUTE) {
    const retryAfter = Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1000));
    const error = new Error(`AI 请求过于频繁，请在 ${retryAfter} 秒后重试`);
    error.statusCode = 429;
    throw error;
  }
  recent.push(now);
  aiRateLimits.set(userId, recent);
}

function normalizeAiMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => ["user", "assistant"].includes(item?.role) && String(item?.text || item?.content || "").trim())
    .slice(-30)
    .map((item) => ({ role: item.role, content: String(item.text || item.content).slice(0, 20000) }));
}

async function requestAi(messages) {
  if (!AI_API_KEY) throw new Error("AI 服务尚未配置：请在服务端 .env 中填写 AI_API_KEY");
  const signal = AbortSignal.timeout(90000);
  if (AI_PROVIDER === "openai" || AI_PROVIDER === "responses") {
    const response = await fetch(`${AI_BASE_URL}/responses`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, instructions: AI_SYSTEM_PROMPT, input: messages })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `AI 服务请求失败（${response.status}）`);
    const reply = payload.output_text
      || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!reply) throw new Error("AI 服务未返回可显示的文本");
    return reply;
  }
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, ...messages],
      temperature: 0.7
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `AI 服务请求失败（${response.status}）`);
  const reply = payload.choices?.[0]?.message?.content;
  if (!reply) throw new Error("AI 服务未返回可显示的文本");
  return reply;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON 格式错误"));
      }
    });
  });
}

async function getCurrentUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = verifyToken(token) || sessions.get(token);
  return studentStore.findById(userId);
}

function createToken(userId) {
  const payload = Buffer.from(userId, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return "";
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return "";
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

async function requireUser(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    sendError(res, 401, "请先登录");
    return null;
  }
  return user;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    school: user.school,
    phone: user.phone,
    role: user.role,
    college: user.college,
    major: user.major,
    studentNo: user.studentNo,
    verified: user.verified,
    avatarColor: user.avatarColor,
    hasPassword: Boolean(user.hasPassword),
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function signPayload(payload, secret = TOKEN_SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(token, secret = TOKEN_SECRET) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function codeDigest(code, phone, expiresAt) {
  return crypto.createHmac("sha256", SMS_TOKEN_SECRET).update(`${phone}:${expiresAt}:${code}`).digest("base64url");
}

async function deliverSmsCode(phone, code) {
  const provider = String(process.env.SMS_PROVIDER || "development").toLowerCase();
  if (provider === "development") return { delivered: false, provider };
  if (provider === "aliyun") return deliverAliyunSmsCode(phone, code);
  if (provider !== "webhook") throw new Error("短信服务商配置无效");

  const webhookUrl = process.env.SMS_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("短信 Webhook 地址尚未配置");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {})
    },
    body: JSON.stringify({
      phone,
      code,
      templateId: process.env.SMS_TEMPLATE_ID || "",
      expiresInMinutes: 5,
      scene: "smart-campus-login"
    })
  });
  if (!response.ok) throw new Error("短信服务暂时不可用，请稍后再试");
  return { delivered: true, provider: "webhook" };
}

function aliyunPercentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function deliverAliyunSmsCode(phone, code) {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error("阿里云短信配置不完整，请检查 AccessKey、签名和模板编号");
  }

  const parameters = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: process.env.ALIYUN_SMS_REGION_ID || "cn-hangzhou",
    SignName: signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25"
  };
  const canonicalQuery = Object.keys(parameters).sort().map((key) => `${aliyunPercentEncode(key)}=${aliyunPercentEncode(parameters[key])}`).join("&");
  const stringToSign = `POST&%2F&${aliyunPercentEncode(canonicalQuery)}`;
  const signature = crypto.createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
  const response = await fetch("https://dysmsapi.aliyuncs.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...parameters, Signature: signature })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.Code !== "OK") {
    throw new Error(`阿里云短信发送失败：${result.Message || result.Code || response.status}`);
  }
  return { delivered: true, provider: "aliyun" };
}

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
}

function maskPhone(phone) {
  const value = String(phone || "");
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
}

function adminStudent(student) {
  const { phone, ...safeStudent } = student;
  return { ...safeStudent, phoneMasked: maskPhone(phone) };
}

function importedStudent(row) {
  return {
    name: row["姓名"] ?? row.name,
    school: row["学校"] ?? row.school,
    college: row["学院"] ?? row.college ?? "",
    major: row["专业"] ?? row.major,
    studentNo: row["学号"] ?? row["工号"] ?? row.studentNo ?? row.student_no,
    phone: String(row["手机号"] ?? row.phone ?? "").replace(/\.0$/, ""),
    status: ["停用", "disabled"].includes(row["状态"] ?? row.status) ? "disabled" : "active",
    role: ["总管理员", "super_admin"].includes(row["角色"] ?? row.role)
      ? "super_admin"
      : ["老师", "teacher"].includes(row["角色"] ?? row.role)
      ? "teacher"
      : ["管理员", "普通管理员", "admin"].includes(row["角色"] ?? row.role) ? "admin" : "student"
  };
}

function handleStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "禁止访问");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (route === "POST /api/auth/sms/send") {
    const body = await parseBody(req);
    const user = await studentStore.findIdentity(body);
    const identityMatches = body.identityType === "teacher" ? user?.role === "teacher" : user?.role !== "teacher";
    if (!user || !identityMatches) {
      sendError(res, 404, body.identityType === "teacher" ? "学校、专业、工号或手机号与教师档案不一致" : "学校、专业、学号或手机号与校园档案不一致");
      return;
    }

    const now = Date.now();
    const lastSentAt = smsRateLimits.get(user.phone) || 0;
    const retryAfter = Math.ceil((SMS_RESEND_MS - (now - lastSentAt)) / 1000);
    if (retryAfter > 0) {
      sendJson(res, 429, { error: `请在 ${retryAfter} 秒后重新获取验证码`, retryAfter });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = now + SMS_CODE_TTL_MS;
    const delivery = await deliverSmsCode(user.phone, code);
    smsRateLimits.set(user.phone, now);
    const challenge = signPayload({
      userId: user.id,
      phone: user.phone,
      identityType: body.identityType === "teacher" ? "teacher" : "student",
      expiresAt,
      codeDigest: codeDigest(code, user.phone, expiresAt)
    }, SMS_TOKEN_SECRET);
    sendJson(res, 200, {
      challenge,
      expiresIn: Math.floor(SMS_CODE_TTL_MS / 1000),
      retryAfter: Math.floor(SMS_RESEND_MS / 1000),
      delivery: delivery.delivered ? "sms" : "development",
      ...(delivery.delivered ? {} : { developmentCode: code })
    });
    return;
  }

  if (route === "POST /api/auth/login") {
    const body = await parseBody(req);
    const user = await studentStore.findIdentity(body);
    const identityMatches = body.identityType === "teacher" ? user?.role === "teacher" : user?.role !== "teacher";
    const challenge = verifyPayload(body.challenge, SMS_TOKEN_SECRET);
    const validCode = challenge
      && identityMatches
      && challenge.userId === user?.id
      && challenge.phone === user?.phone
      && challenge.identityType === (body.identityType === "teacher" ? "teacher" : "student")
      && challenge.expiresAt > Date.now()
      && challenge.codeDigest === codeDigest(String(body.code || ""), challenge.phone, challenge.expiresAt);
    if (!user || !validCode) {
      sendError(res, 401, "校园身份或短信验证码错误，请重新核验");
      return;
    }
    const token = createToken(user.id);
    sendJson(res, 200, { token, user: publicUser(user), requiresPasswordSetup: !user.hasPassword });
    return;
  }

  if (route === "POST /api/auth/guest") {
    const guest = data.users.find((user) => user.role === "guest");
    if (!guest) {
      sendError(res, 503, "游客体验暂不可用");
      return;
    }
    sendJson(res, 200, { token: createToken(guest.id), user: publicUser(guest), readOnly: true });
    return;
  }

  if (route === "POST /api/auth/password/login") {
    const body = await parseBody(req);
    const user = await studentStore.findIdentity(body);
    const identityMatches = body.identityType === "teacher" ? user?.role === "teacher" : user?.role !== "teacher";
    const hasBoundPhone = /^1\d{10}$/.test(String(user?.phone || ""));
    const passwordMatches = user && await studentStore.verifyPassword(user.studentNo, body.password);
    if (!user || !identityMatches || !hasBoundPhone || !user.hasPassword || user.mustChangePassword || !passwordMatches) {
      sendError(res, 401, "账号、密码或登录身份错误；密码登录需要账号已绑定手机号");
      return;
    }
    const token = createToken(user.id);
    sendJson(res, 200, { token, user: publicUser(user) });
    return;
  }

  if (route.startsWith("GET /api/admin/") || route.startsWith("POST /api/admin/") || route.startsWith("PUT /api/admin/")) {
    const adminUser = await requireUser(req, res);
    if (!adminUser) return;
    if (!["admin", "super_admin"].includes(adminUser.role)) {
      sendError(res, 403, "仅管理员可以访问学生身份库");
      return;
    }
    const isSuperAdmin = adminUser.role === "super_admin";

    if (route === "GET /api/admin/health") {
      sendJson(res, 200, await studentStore.health());
      return;
    }

    if (route === "GET /api/admin/students") {
      const requestedRole = url.searchParams.get("role") || "";
      const roleFilter = !isSuperAdmin && requestedRole && !["student", "teacher"].includes(requestedRole) ? "__denied__" : requestedRole;
      if (roleFilter === "__denied__") {
        sendJson(res, 200, { students: [], count: 0, totalCount: 0, canManageRoles: false });
        return;
      }
      const [students, totalCount] = await Promise.all([
        studentStore.listStudents({
          query: url.searchParams.get("query") || "",
          status: url.searchParams.get("status") || "",
          role: roleFilter
        }),
        studentStore.countStudents({
          roles: roleFilter
            ? [roleFilter]
            : isSuperAdmin ? [] : ["student", "teacher"]
        })
      ]);
      const visibleStudents = isSuperAdmin ? students : students.filter((student) => ["student", "teacher"].includes(student.role));
      sendJson(res, 200, {
        students: visibleStudents.map(adminStudent),
        count: visibleStudents.length,
        totalCount,
        canManageRoles: isSuperAdmin
      });
      return;
    }

    if (route === "POST /api/admin/students") {
      const body = await parseBody(req);
      const existing = await studentStore.findByStudentNo(String(body.studentNo || ""));
      if (!isSuperAdmin && existing && !["student", "teacher"].includes(existing.role)) {
        sendError(res, 403, "普通管理员不能修改其他管理员");
        return;
      }
      if (!isSuperAdmin && !["student", "teacher"].includes(body.role || "student")) {
        sendError(res, 403, "普通管理员只能录入学生或老师");
        return;
      }
      const student = await studentStore.upsertStudent(body);
      await studentStore.logAdminAction("upsert_student", student.studentNo, { operator: adminUser.studentNo, school: student.school, major: student.major });
      sendJson(res, 200, { student: adminStudent(student) });
      return;
    }

    if (route === "PUT /api/admin/students/status") {
      const body = await parseBody(req);
      const target = await studentStore.findByStudentNo(String(body.studentNo || ""));
      if (!target) {
        sendError(res, 404, "未找到该账号");
        return;
      }
      if (!isSuperAdmin && !["student", "teacher"].includes(target.role)) {
        sendError(res, 403, "普通管理员不能停用其他管理员");
        return;
      }
      if (target.role === "super_admin" && target.id === adminUser.id) {
        sendError(res, 400, "不能停用当前总管理员账号");
        return;
      }
      const status = body.status === "disabled" ? "disabled" : "active";
      const updated = await studentStore.setStudentStatus(String(body.studentNo || ""), status);
      if (!updated) {
        sendError(res, 404, "未找到该学号");
        return;
      }
      await studentStore.logAdminAction("set_student_status", String(body.studentNo || ""), { operator: adminUser.studentNo, status });
      sendJson(res, 200, { updated: true, status });
      return;
    }

    if (route === "PUT /api/admin/students/role") {
      if (!isSuperAdmin) {
        sendError(res, 403, "仅总管理员可以调整账号角色");
        return;
      }
      const body = await parseBody(req);
      const target = await studentStore.findByStudentNo(String(body.studentNo || ""));
      if (!target) {
        sendError(res, 404, "未找到该账号");
        return;
      }
      const role = ["student", "teacher", "admin", "super_admin"].includes(body.role) ? body.role : "";
      if (!role) {
        sendError(res, 400, "账号角色无效");
        return;
      }
      if (target.id === adminUser.id && target.role === "super_admin" && role !== "super_admin") {
        sendError(res, 400, "不能降级当前登录的总管理员账号");
        return;
      }
      await studentStore.setStudentRole(target.studentNo, role);
      await studentStore.logAdminAction("set_student_role", target.studentNo, { operator: adminUser.studentNo, role });
      sendJson(res, 200, { updated: true, role });
      return;
    }

    if (route === "POST /api/admin/students/password-reset") {
      const body = await parseBody(req);
      const target = await studentStore.findByStudentNo(String(body.studentNo || ""));
      if (!target) {
        sendError(res, 404, "未找到该账号");
        return;
      }
      if (!isSuperAdmin && !["student", "teacher"].includes(target.role)) {
        sendError(res, 403, "普通管理员不能重置其他管理员的密码");
        return;
      }
      if (!/^1\d{10}$/.test(String(target.phone || ""))) {
        sendError(res, 400, "该账号尚未绑定有效手机号，不能启用密码登录");
        return;
      }
      await studentStore.clearPassword(target.studentNo);
      await studentStore.logAdminAction("reset_student_password", target.studentNo, { operator: adminUser.studentNo });
      sendJson(res, 200, { updated: true, requiresPhoneLogin: true });
      return;
    }

    if (route === "POST /api/admin/students/import") {
      const body = await parseBody(req);
      let rows = Array.isArray(body.rows) ? body.rows : [];
      if (body.fileBase64) {
        const workbook = XLSX.read(Buffer.from(body.fileBase64, "base64"), { type: "buffer" });
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      }
      if (!rows.length) {
        sendError(res, 400, "导入文件没有学生数据");
        return;
      }
      const result = { success: 0, failed: 0, errors: [] };
      for (let index = 0; index < rows.length; index += 1) {
        try {
          const input = importedStudent(rows[index]);
          if (!isSuperAdmin && ["admin", "super_admin"].includes(input.role)) input.role = "student";
          const existing = await studentStore.findByStudentNo(String(input.studentNo || ""));
          if (!isSuperAdmin && existing && !["student", "teacher"].includes(existing.role)) throw new Error("普通管理员不能修改其他管理员");
          const student = await studentStore.upsertStudent(input);
          result.success += 1;
          await studentStore.logAdminAction("import_student", student.studentNo, { operator: adminUser.studentNo, row: index + 2 });
        } catch (error) {
          result.failed += 1;
          result.errors.push(`第 ${index + 2} 行：${error.message}`);
        }
      }
      sendJson(res, 200, result);
      return;
    }

    sendError(res, 404, "管理员接口不存在");
    return;
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (route === "GET /api/me") {
    sendJson(res, 200, { user: publicUser(user), readOnly: user.role === "guest" });
    return;
  }

  if (user.role === "guest" && req.method !== "GET") {
    sendError(res, 403, "游客模式仅支持浏览，请使用校园身份登录后操作");
    return;
  }

  if (route === "POST /api/account/password") {
    const body = await parseBody(req);
    if (!/^1\d{10}$/.test(String(user.phone || ""))) {
      sendError(res, 400, "请先绑定有效手机号，再设置登录密码");
      return;
    }
    await studentStore.setPassword(user.studentNo, body.password, { mustChange: false });
    await studentStore.logAdminAction("set_own_password", user.studentNo, { operator: user.studentNo });
    const updatedUser = await studentStore.findById(user.id);
    sendJson(res, 200, { updated: true, user: publicUser(updatedUser) });
    return;
  }

  if (route === "GET /api/library/layout") {
    sendJson(res, 200, {
      floors: libraryFloors,
      zones: libraryZones,
      seats: librarySeats,
      reservations: libraryReservations.filter((item) => item.userId === user.id),
      rules: ["预约开始前 15 分钟可签到。", "离座超过 30 分钟请释放座位。", "研讨室请保持整洁并控制音量。"]
    });
    return;
  }

  if (route === "POST /api/library/reservations") {
    const body = await parseBody(req);
    const zone = libraryZones.find((item) => item.id === body.zoneId);
    const seat = librarySeats.find((item) => item.id === body.seatId);
    if (!zone) {
      sendError(res, 404, "预约区域不存在");
      return;
    }
    if (body.seatId && (!seat || seat.status !== "available")) {
      sendError(res, 409, "该座位当前不可预约");
      return;
    }
    if (seat) seat.status = "reserved";
    const floor = libraryFloors.find((item) => item.id === zone.floorId);
    const reservation = {
      id: nextId("lib"),
      userId: user.id,
      zoneName: zone.name,
      floorName: floor?.name || "",
      date: body.date,
      slot: body.slot,
      seatCode: seat?.code || body.seatCode || "",
      status: "approved"
    };
    libraryReservations.unshift(reservation);
    sendJson(res, 201, { reservation });
    return;
  }

  if (route === "GET /api/exams") {
    sendJson(res, 200, examCatalog);
    return;
  }

  if (route === "GET /api/campus-news") {
    sendJson(res, 200, {
      source: "https://www.tzu.edu.cn/",
      sourceStatus: "live",
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      cacheSeconds: 300,
      sources: [
        { name: "泰州学院官网", url: "https://www.tzu.edu.cn/", status: "live", count: campusNews.length + importedNews.length },
        { name: "经济与管理学院", url: "https://www.tzu.edu.cn/", status: "live", count: 1 },
        { name: "校团委与社团", url: "https://www.tzu.edu.cn/", status: "live", count: 1 }
      ],
      items: [...importedNews, ...campusNews]
    });
    return;
  }

  if (route === "POST /api/campus-news/import") {
    const body = await parseBody(req);
    importedNews.unshift({ ...body, date: new Date().toISOString().slice(5, 10) });
    sendJson(res, 201, { imported: true });
    return;
  }

  if (route === "POST /api/payments/create") {
    const body = await parseBody(req);
    const order = { id: nextId("pay"), userId: user.id, ...body, status: "created" };
    paymentOrders.unshift(order);
    sendJson(res, 201, { order });
    return;
  }

  if (route === "POST /api/payments/bind") {
    const body = await parseBody(req);
    user.paymentBindings = { ...(user.paymentBindings || {}), [body.provider]: true };
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (route === "POST /api/timetable/import") {
    const body = await parseBody(req);
    const workbook = XLSX.read(Buffer.from(body.fileData || "", "base64"), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    const courses = rows.map((row, index) => ({
      id: `import-${Date.now()}-${index}`,
      day: row.day || row["星期"] || row["周次"] || "周一",
      time: row.time || row["时间"] || "08:00-09:40",
      course: row.course || row["课程"] || row["课程名称"] || "未命名课程",
      location: row.location || row["地点"] || row["教室"] || "",
      teacher: row.teacher || row["教师"] || row["老师"] || "",
      source: "外部导入"
    }));
    sendJson(res, 200, { courses, count: courses.length });
    return;
  }

  if (route === "POST /api/timetable/export") {
    const body = await parseBody(req);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(body.courses || []), "Timetable");
    const filename = `timetable-${Date.now()}.xlsx`;
    const downloadDir = path.join(PUBLIC_DIR, "downloads", "conversions");
    fs.mkdirSync(downloadDir, { recursive: true });
    XLSX.writeFile(workbook, path.join(downloadDir, filename));
    sendJson(res, 200, { filename });
    return;
  }

  if (route === "GET /api/tools/catalog") {
    sendJson(res, 200, { engines: [{ name: "LibreOffice", role: "文档转换" }, { name: "SheetJS", role: "表格处理" }, { name: "LibreTranslate", role: "语言翻译" }] });
    return;
  }

  if (route === "POST /api/tools/conversions") {
    const body = await parseBody(req);
    const job = {
      id: nextId("convert"),
      filename: body.filename || "未命名文件",
      sourceFormat: body.sourceFormat || "unknown",
      targetFormat: body.targetFormat || "pdf",
      status: "已创建",
      message: "转换任务已创建，当前演示服务保留原文件并等待正式转换引擎接入。"
    };
    conversionJobs.unshift(job);
    sendJson(res, 201, { job });
    return;
  }

  if (route === "POST /api/tools/translate") {
    const body = await parseBody(req);
    const text = body.text || body.content || "";
    sendJson(res, 200, { provider: "校内术语演示", detectedSource: body.source || "auto", target: body.target || "zh", translatedText: text, note: "当前为演示回显，正式版可接入 LibreTranslate。" });
    return;
  }

  if (route === "GET /api/ai/status") {
    sendJson(res, 200, aiStatus());
    return;
  }

  if (route === "POST /api/ai/chat") {
    const body = await parseBody(req);
    const messages = normalizeAiMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      sendError(res, 400, "请输入问题后再发送");
      return;
    }
    consumeAiRequest(user.id);
    const reply = await requestAi(messages);
    sendJson(res, 200, { reply, model: AI_MODEL, provider: AI_PROVIDER });
    return;
  }

  if (route === "GET /api/dashboard") {
    sendJson(res, 200, {
      stats: {
        pendingReservations: data.reservations.filter((item) => item.userId === user.id && item.status === "pending").length,
        unreadNotifications: data.notifications.filter((item) => !item.read).length,
        activeRepairs: data.repairs.filter((item) => item.userId === user.id && item.status !== "closed").length,
        todayCourses: data.timetable.length
      },
      latestNotifications: data.notifications.slice(0, 3),
      recommendedLabs: data.labs.filter((lab) => lab.status === "available").slice(0, 2)
    });
    return;
  }

  if (route === "GET /api/labs") {
    sendJson(res, 200, { labs: data.labs });
    return;
  }

  if (route === "POST /api/reservations") {
    const body = await parseBody(req);
    const lab = data.labs.find((item) => item.id === body.labId);
    if (!lab) {
      sendError(res, 404, "实验室不存在");
      return;
    }
    const reservation = {
      id: nextId("r"),
      userId: user.id,
      labId: lab.id,
      labName: lab.name,
      slot: body.slot || lab.freeSlots[0],
      reason: body.reason || "网页端预约",
      status: "pending",
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    data.reservations.unshift(reservation);
    sendJson(res, 201, { reservation });
    return;
  }

  if (route === "GET /api/reservations") {
    sendJson(res, 200, { reservations: data.reservations.filter((item) => item.userId === user.id) });
    return;
  }

  if (route === "GET /api/repairs") {
    sendJson(res, 200, { repairs: data.repairs.filter((item) => item.userId === user.id) });
    return;
  }

  if (route === "POST /api/repairs") {
    const body = await parseBody(req);
    const repair = {
      id: nextId("fix"),
      userId: user.id,
      labName: body.labName || "未选择实验室",
      device: body.device || "未填写设备",
      issue: body.issue || "未填写问题",
      status: "submitted",
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    data.repairs.unshift(repair);
    sendJson(res, 201, { repair });
    return;
  }

  if (route === "GET /api/notifications") {
    sendJson(res, 200, { notifications: data.notifications });
    return;
  }

  if (route === "GET /api/lab-rules") {
    sendJson(res, 200, { rules: data.labRules });
    return;
  }

  if (route === "GET /api/timetable") {
    const freeLabs = data.labs
      .filter((lab) => lab.status === "available")
      .map((lab) => ({ id: lab.id, name: lab.name, slots: lab.freeSlots }));
    sendJson(res, 200, { courses: data.timetable, freeLabs });
    return;
  }

  if (route === "GET /api/canteen/menu") {
    sendJson(res, 200, { menu: data.menu });
    return;
  }

  if (route === "POST /api/canteen/orders") {
    const body = await parseBody(req);
    const food = data.menu.find((item) => item.id === body.foodId);
    if (!food) {
      sendError(res, 404, "餐品不存在");
      return;
    }
    const order = {
      id: nextId("order"),
      userId: user.id,
      foodName: food.name,
      price: food.price,
      deliveryPoint: body.deliveryPoint || "宿舍楼下取餐点",
      status: "preparing",
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    data.orders.unshift(order);
    sendJson(res, 201, { order });
    return;
  }

  if (route === "GET /api/visitor/qrcode") {
    sendJson(res, 200, {
      qrPayload: `SMART_TY_VISITOR:${user.id}:${Date.now()}`,
      owner: publicUser(user),
      expiresInSeconds: 300
    });
    return;
  }

  if (route === "POST /api/support/tickets") {
    const body = await parseBody(req);
    const ticket = {
      id: nextId("ticket"),
      userId: user.id,
      title: body.title || "在线客服咨询",
      content: body.content || "",
      status: "open",
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    data.supportTickets.unshift(ticket);
    sendJson(res, 201, { ticket });
    return;
  }

  if (route === "POST /api/feedback") {
    const body = await parseBody(req);
    const feedback = {
      id: nextId("feedback"),
      userId: user.id,
      content: body.content || "",
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    data.feedbackItems.unshift(feedback);
    sendJson(res, 201, { feedback });
    return;
  }

  sendError(res, 404, "接口不存在");
}

function requestHandler(req, res) {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => sendError(res, error.statusCode || 400, error.message));
    return;
  }
  handleStatic(req, res);
}

module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
  console.log(`智慧泰院网页版已启动：http://localhost:${PORT}`);
  });
}
