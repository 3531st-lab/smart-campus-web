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
const timetableStore = require("./timetable-store");
const reservationStore = require("./reservation-store");
const notificationStore = require("./notification-store");
const paymentStore = require("./payment-store");
const integrations = require("./integrations");
const campusNewsService = require("./campus-news");
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
const AUTH_TOKEN_TTL_MS = Math.max(Number(process.env.AUTH_TOKEN_TTL_MS || 8 * 60 * 60 * 1000), 30 * 60 * 1000);
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1024 * 1024);
const MAX_UPLOAD_BODY_BYTES = Number(process.env.MAX_UPLOAD_BODY_BYTES || 8 * 1024 * 1024);
const URL_MAX_LENGTH = Number(process.env.URL_MAX_LENGTH || 2048);
const SECURITY_BUILD = "security-hardening-v89-20260617";
const LEGAL_CONSENT_VERSION = "2026.06.20";
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || "https://zhihueixiaoyuan.pages.dev").replace(/\/+$/, "");
const rateLimits = new Map();
const authFailures = new Map();
const AI_RUNTIME_CONFIG_PATH = path.join(__dirname, "ai-runtime.json");
let AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").toLowerCase();
let AI_BASE_URL = String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
let AI_API_KEY = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "");
let AI_MODEL = String(process.env.AI_MODEL || "gpt-5.5");
let AI_SYSTEM_PROMPT = String(process.env.AI_SYSTEM_PROMPT || "你是一个能力全面、准确、实用的 AI 助手。你可以回答通用知识、学习、写作、编程、数据分析、职业规划和校园生活等问题。请直接解决用户问题，不要把回答局限于校园场景。");
let AI_MAX_REQUESTS_PER_MINUTE = Math.max(1, Number(process.env.AI_MAX_REQUESTS_PER_MINUTE || 12));
const aiRateLimits = new Map();

function applyAiRuntimeConfig(config = {}) {
  if (config.provider) AI_PROVIDER = String(config.provider).trim().toLowerCase();
  if (config.baseUrl) AI_BASE_URL = String(config.baseUrl).trim().replace(/\/+$/, "");
  if (config.apiKey) AI_API_KEY = String(config.apiKey).trim();
  if (config.model) AI_MODEL = String(config.model).trim();
  if (config.systemPrompt) AI_SYSTEM_PROMPT = String(config.systemPrompt).trim();
  if (config.requestsPerMinute) AI_MAX_REQUESTS_PER_MINUTE = Math.max(1, Number(config.requestsPerMinute || 12));
}

function loadAiRuntimeConfig() {
  if (!fs.existsSync(AI_RUNTIME_CONFIG_PATH)) return;
  try {
    applyAiRuntimeConfig(JSON.parse(fs.readFileSync(AI_RUNTIME_CONFIG_PATH, "utf8")));
  } catch (error) {
    console.warn("Failed to load AI runtime config:", error.message);
  }
}

function saveAiRuntimeConfig(config = {}) {
  const nextConfig = {
    provider: String(config.provider || AI_PROVIDER || "openai").trim().toLowerCase(),
    baseUrl: String(config.baseUrl || AI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
    apiKey: config.apiKey ? String(config.apiKey).trim() : AI_API_KEY,
    model: String(config.model || AI_MODEL || "gpt-5.5").trim(),
    systemPrompt: String(config.systemPrompt || AI_SYSTEM_PROMPT || "").trim(),
    requestsPerMinute: Math.max(1, Number(config.requestsPerMinute || AI_MAX_REQUESTS_PER_MINUTE || 12)),
    updatedAt: new Date().toISOString()
  };
  applyAiRuntimeConfig(nextConfig);
  fs.writeFileSync(AI_RUNTIME_CONFIG_PATH, JSON.stringify(nextConfig, null, 2));
  return nextConfig;
}

loadAiRuntimeConfig();
const libraryReservations = [];
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
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon"
};

function requestContext(res) {
  return res.__securityReq || {};
}

function allowedCorsOrigin(req) {
  const headers = req.headers || {};
  const origin = String(headers.origin || "");
  if (!origin) return "";
  const proto = String(headers["x-forwarded-proto"] || (req.socket && req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
  const host = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  const sameHostOrigin = host ? `${proto}://${host}` : "";
  const allowed = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    sameHostOrigin,
    ...String(process.env.CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)
  ]);
  return allowed.has(origin) ? origin : "";
}

function securityHeaders(req, extra = {}) {
  const corsOrigin = allowedCorsOrigin(req || {});
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://images.unsplash.com",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.bigdatacloud.net"
    ].join("; "),
    "X-Security-Build": SECURITY_BUILD,
    ...extra
  };
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function sendJson(res, status, payload) {
  res.writeHead(status, securityHeaders(requestContext(res), {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  }));
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function requireLegalConsent(res, body) {
  const consent = body?.legalConsent;
  const valid = consent
    && consent.accepted === true
    && consent.version === LEGAL_CONSENT_VERSION
    && Array.isArray(consent.documents)
    && consent.documents.includes("user_agreement")
    && consent.documents.includes("privacy_policy");
  if (!valid) sendError(res, 428, "请先阅读并同意当前版本的用户协议与隐私政策");
  return valid;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function consumeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (rateLimits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    const error = new Error("请求过于频繁，请稍后再试");
    error.statusCode = 429;
    throw error;
  }
  recent.push(now);
  rateLimits.set(key, recent);
}

function guardRequest(req, route) {
  if (String(req.url || "").length > URL_MAX_LENGTH) {
    const error = new Error("请求地址过长");
    error.statusCode = 414;
    throw error;
  }
  const ip = clientIp(req);
  const isAuthRoute = route.includes("/api/auth/");
  consumeRateLimit(`${ip}:${isAuthRoute ? "auth" : route}`, isAuthRoute ? 20 : 120, 60 * 1000);
}

function authFailureKey(req, body = {}) {
  const identity = [body.school, body.major, body.studentId || body.teacherId || body.workId, body.phone]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return `${clientIp(req)}:${identity || "unknown"}`;
}

function blockIfAuthThrottled(req, body = {}) {
  const key = authFailureKey(req, body);
  const now = Date.now();
  const recent = (authFailures.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 8) {
    const error = new Error("登录失败次数过多，请稍后再试");
    error.statusCode = 429;
    throw error;
  }
}

function recordAuthFailure(req, body = {}) {
  const key = authFailureKey(req, body);
  const now = Date.now();
  const recent = (authFailures.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  recent.push(now);
  authFailures.set(key, recent);
  blockIfAuthThrottled(req, body);
}

function clearAuthFailures(req, body = {}) {
  authFailures.delete(authFailureKey(req, body));
}

function aiStatus() {
  return {
    configured: Boolean(AI_API_KEY),
    provider: AI_PROVIDER,
    model: AI_MODEL,
    baseUrl: AI_BASE_URL.replace(/:\/\/([^/@]+)@/, "://***@"),
    keySaved: Boolean(AI_API_KEY),
    systemPrompt: AI_SYSTEM_PROMPT,
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

async function requestAi(messages, personalConfig = {}) {
  const provider = String(personalConfig.provider || AI_PROVIDER || "openai").trim().toLowerCase();
  const baseUrl = String(personalConfig.baseUrl || AI_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(personalConfig.apiKey || AI_API_KEY || "").trim();
  const model = String(personalConfig.model || AI_MODEL || "").trim();
  const systemPrompt = String(personalConfig.systemPrompt || AI_SYSTEM_PROMPT || "").trim();
  if (!apiKey) throw new Error("AI 服务尚未配置：请在右侧填写个人 API Key");
  if (!model) throw new Error("请填写模型名称");
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl)) {
    throw new Error("Base URL 必须使用 HTTPS，或指向本机服务");
  }
  const endpoint = new URL(baseUrl);
  const allowedHosts = new Set([
    "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.deepseek.com",
    "dashscope.aliyuncs.com", "api.moonshot.ai", "open.bigmodel.cn", "api.baiduqianfan.ai",
    "api.hunyuan.cloud.tencent.com", "spark-api-open.xf-yun.com", "api.minimax.chat",
    "ark.cn-beijing.volces.com", "api.siliconflow.cn", "openrouter.ai", "api.x.ai", "api.groq.com",
    "localhost", "127.0.0.1"
  ]);
  if (!allowedHosts.has(endpoint.hostname) && !endpoint.hostname.endsWith(".openai.azure.com")) {
    throw new Error("该 API 域名尚未列入安全允许清单");
  }
  const signal = AbortSignal.timeout(90000);
  if (provider === "openai" || provider === "responses") {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, instructions: systemPrompt, input: messages })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `AI 服务请求失败（${response.status}）`);
    const reply = payload.output_text
      || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!reply) throw new Error("AI 服务未返回可显示的文本");
    return reply;
  }
  if (provider === "anthropic") {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, system: systemPrompt, max_tokens: 4096, messages })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `AI 服务请求失败（${response.status}）`);
    const reply = payload.content?.find((item) => item.type === "text")?.text;
    if (!reply) throw new Error("AI 服务未返回可显示的文本");
    return reply;
  }
  if (provider === "gemini") {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] }))
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `AI 服务请求失败（${response.status}）`);
    const reply = payload.candidates?.[0]?.content?.parts?.map((item) => item.text || "").join("");
    if (!reply) throw new Error("AI 服务未返回可显示的文本");
    return reply;
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `AI 服务请求失败（${response.status}）`);
  const reply = payload.choices?.[0]?.message?.content;
  if (!reply) throw new Error("AI 服务未返回可显示的文本");
  return reply;
}

function parseAiJsonArray(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOcrCourse(row, index, defaults = {}) {
  const read = (...keys) => {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    }
    return "";
  };
  return {
    id: `ocr-${Date.now()}-${index}`,
    semester: read("semester", "学期") || defaults.semester || "2025-2026学年第二学期",
    weeks: read("weeks", "week", "周次") || defaults.week || "1-20",
    day: read("day", "weekday", "星期") || "",
    startSection: Number(read("startSection", "section", "开始节次", "起始节次") || 1),
    sectionCount: Number(read("sectionCount", "duration", "连续节数", "节数") || 2),
    course: String(read("course", "title", "课程名称", "课程") || "").trim(),
    location: String(read("location", "room", "上课地点", "地点", "教室") || "").trim(),
    teacher: String(read("teacher", "任课教师", "教师") || "").trim(),
    note: String(read("note", "备注") || "图片OCR识别").trim(),
    source: "图片OCR"
  };
}

async function requestTimetableOcr(imageData, defaults = {}) {
  if (!AI_API_KEY) throw new Error("AI OCR 尚未配置：请先在服务端 .env 配置 AI_API_KEY / OPENAI_API_KEY");
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(String(imageData || ""))) {
    throw new Error("请上传 JPG、PNG 或 WebP 课表图片");
  }
  const prompt = [
    "请从这张中文课表截图中识别课程信息，只输出 JSON 数组，不要输出解释。",
    "每一项字段必须使用：semester, weeks, day, startSection, sectionCount, course, location, teacher, note。",
    "day 使用 周一/周二/周三/周四/周五/周六/周日。",
    "startSection 是课程开始节次数字，sectionCount 是连续节数。",
    "如果截图显示第几周，请把 weeks 填为该周数字；如果无法判断，用传入默认周次。",
    "课程名、校区、教室、老师尽量从色块文字中提取；不确定的内容可放到 note。",
    `默认学期：${defaults.semester || "2025-2026学年第二学期"}；默认周次：${defaults.week || "1-20"}。`
  ].join("\n");
  const signal = AbortSignal.timeout(120000);
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: "你是课表 OCR 结构化助手。只返回合法 JSON 数组。" },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `AI OCR 识别失败（${response.status}）`);
  const text = payload.choices?.[0]?.message?.content || "";
  return parseAiJsonArray(text)
    .map((row, index) => normalizeOcrCourse(row, index, defaults))
    .filter((course) => course.course && course.day);
}

function parseBody(req, options = {}) {
  const limitBytes = options.limitBytes || MAX_JSON_BODY_BYTES;
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
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
  if (!userId) return null;
  return studentStore.findById(userId);
}

function parseRawBody(req, options = {}) {
  const limitBytes = options.limitBytes || MAX_JSON_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function createToken(userId) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + AUTH_TOKEN_TTL_MS,
    jti: crypto.randomUUID()
  }), "utf8").toString("base64url");
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
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!parsed.sub || !parsed.exp || Date.now() > parsed.exp) return "";
    return String(parsed.sub);
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
    className: user.className,
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

function courseIdentity(course = {}) {
  return [
    course.semester,
    Array.isArray(course.weeks) ? course.weeks.join(",") : course.weeks,
    course.day,
    course.startSection,
    course.sectionCount,
    course.course,
    course.location
  ].map((value) => String(value || "").trim()).join("|");
}

function dedupeCourses(courses = []) {
  const seen = new Set();
  return courses.filter((course) => {
    const key = courseIdentity(course);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildUserNotifications(user) {
  const reservations = await reservationStore.listForUser(user);
  const retentionDays = 14;
  const cutoff = Date.now() - retentionDays * 86400000;
  const notifications = reservations
    .filter((item) => {
      const timestamp = Date.parse(item.updatedAt || item.createdAt || "");
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, 100)
    .map((item) => {
    const statusTitle = item.status === "approved"
      ? "实验室预约已通过"
      : item.status === "rejected"
      ? "实验室预约未通过"
      : "实验室预约待审批";
    const statusBody = item.status === "approved"
      ? `${item.labName} 已为你保留 ${item.slot} 时段。`
      : item.status === "rejected"
      ? `${item.labName} ${item.slot} 预约未通过${item.adminNote ? `，原因：${item.adminNote}` : "。"}`
      : `${item.labName} ${item.slot} 预约已提交，等待管理员审批。`;
    const revision = Buffer.from(`${item.status}|${item.updatedAt || item.createdAt || ""}`).toString("base64url").slice(0, 24);
    return {
      id: `reservation-${item.id}-${revision}`,
      title: statusTitle,
      type: "预约通知",
      body: statusBody,
      read: false,
      createdAt: item.updatedAt || item.createdAt || "",
      sourceId: item.id,
      status: item.status
    };
  });
  await notificationStore.cleanup(retentionDays);
  const readIds = await notificationStore.readIds(user.id, notifications.map((item) => item.id));
  return notifications.map((item) => ({ ...item, read: readIds.has(item.id) }));
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
    className: row["班级"] ?? row["行政班"] ?? row["班级名称"] ?? row.className ?? row.class_name ?? "",
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
  let requestPath = "/";
  try {
    requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    sendError(res, 400, "请求地址无效");
    return;
  }
  if (requestPath.includes("\0")) {
    sendError(res, 400, "请求地址无效");
    return;
  }
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);

  const relativePath = path.relative(PUBLIC_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendError(res, 403, "禁止访问");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === ".html";
  res.writeHead(200, securityHeaders(req, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": isHtml ? "no-store" : "public, max-age=3600"
  }));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  guardRequest(req, route);

  if (route === "POST /api/webhooks/stripe") {
    const rawBody = await parseRawBody(req);
    const event = integrations.verifyStripeWebhook(rawBody, req.headers["stripe-signature"]);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await paymentStore.markStripeSession(event.data?.object?.id || "", "paid", {
        paymentStatus: event.data?.object?.payment_status || "paid",
        eventId: event.id || ""
      });
    }
    sendJson(res, 200, { received: true });
    return;
  }

  if (route === "POST /api/auth/sms/send") {
    const body = await parseBody(req);
    if (!requireLegalConsent(res, body)) return;
    blockIfAuthThrottled(req, body);
    const user = await studentStore.findIdentity(body);
    const identityMatches = body.identityType === "teacher" ? user?.role === "teacher" : user?.role !== "teacher";
    if (!user || !identityMatches) {
      recordAuthFailure(req, body);
      sendError(res, 404, body.identityType === "teacher" ? "学校、专业、工号或手机号与教师档案不一致" : "学校、专业、学号或手机号与校园档案不一致");
      return;
    }
    clearAuthFailures(req, body);
    await studentStore.logLegalConsent(user, body.legalConsent, { loginMode: "sms_request" });

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
    if (!requireLegalConsent(res, body)) return;
    blockIfAuthThrottled(req, body);
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
      recordAuthFailure(req, body);
      sendError(res, 401, "校园身份或短信验证码错误，请重新核验");
      return;
    }
    clearAuthFailures(req, body);
    await studentStore.logLegalConsent(user, body.legalConsent, { loginMode: "sms_login" });
    const token = createToken(user.id);
    sendJson(res, 200, { token, user: publicUser(user), requiresPasswordSetup: !user.hasPassword });
    return;
  }

  if (route === "POST /api/auth/guest") {
    const body = await parseBody(req);
    if (!requireLegalConsent(res, body)) return;
    const guest = data.users.find((user) => user.role === "guest");
    if (!guest) {
      sendError(res, 503, "游客体验暂不可用");
      return;
    }
    await studentStore.logLegalConsent(guest, body.legalConsent, { loginMode: "guest" });
    void integrations.captureAnalytics("guest_login", guest);
    sendJson(res, 200, { token: createToken(guest.id), user: publicUser(guest), readOnly: true });
    return;
  }

  if (route === "POST /api/auth/password/login") {
    const body = await parseBody(req);
    if (!requireLegalConsent(res, body)) return;
    blockIfAuthThrottled(req, body);
    const user = await studentStore.findIdentity(body);
    const identityMatches = body.identityType === "teacher" ? user?.role === "teacher" : user?.role !== "teacher";
    const hasBoundPhone = /^1\d{10}$/.test(String(user?.phone || ""));
    const passwordMatches = user && await studentStore.verifyPassword(user.studentNo, body.password);
    if (!user || !identityMatches || !hasBoundPhone || !user.hasPassword || user.mustChangePassword || !passwordMatches) {
      recordAuthFailure(req, body);
      sendError(res, 401, "账号、密码或登录身份错误；密码登录需要账号已绑定手机号");
      return;
    }
    clearAuthFailures(req, body);
    await studentStore.logLegalConsent(user, body.legalConsent, { loginMode: "password" });
    const token = createToken(user.id);
    void integrations.captureAnalytics("password_login", user);
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

    if (route === "GET /api/admin/ai-config") {
      if (!isSuperAdmin) {
        sendError(res, 403, "仅总管理员可以查看 AI 模型配置");
        return;
      }
      sendJson(res, 200, aiStatus());
      return;
    }

    if (route === "PUT /api/admin/ai-config") {
      if (!isSuperAdmin) {
        sendError(res, 403, "仅总管理员可以修改 AI 模型配置");
        return;
      }
      const body = await parseBody(req);
      const provider = String(body.provider || "").trim().toLowerCase();
      const baseUrl = String(body.baseUrl || "").trim();
      const model = String(body.model || "").trim();
      const requestsPerMinute = Math.max(1, Number(body.requestsPerMinute || AI_MAX_REQUESTS_PER_MINUTE || 12));
      if (!provider || !baseUrl || !model) {
        sendError(res, 400, "请填写服务商、接口地址和模型名称");
        return;
      }
      const config = saveAiRuntimeConfig({
        provider,
        baseUrl,
        model,
        requestsPerMinute,
        systemPrompt: String(body.systemPrompt || AI_SYSTEM_PROMPT || "").trim(),
        apiKey: String(body.apiKey || "").trim() || AI_API_KEY
      });
      await studentStore.logAdminAction("update_ai_config", adminUser.studentNo, { operator: adminUser.studentNo, provider: config.provider, model: config.model });
      sendJson(res, 200, aiStatus());
      return;
    }

    if (route === "POST /api/admin/ai-config/test") {
      if (!isSuperAdmin) {
        sendError(res, 403, "仅总管理员可以测试 AI 模型配置");
        return;
      }
      consumeAiRequest(`admin-test-${adminUser.id}`);
      const reply = await requestAi([{ role: "user", content: "请只回复 OK，用于测试连接。" }]);
      sendJson(res, 200, { ok: true, reply, ...aiStatus() });
      return;
    }

    if (route === "GET /api/admin/health") {
      sendJson(res, 200, {
        identity: await studentStore.health(),
        permanentAdmin: studentStore.permanentAdminStatus(),
        reservations: await reservationStore.health(),
        timetable: await timetableStore.health(),
        payments: await paymentStore.health(),
        integrations: integrations.configured()
      });
      return;
    }

    if (route === "GET /api/admin/reservations") {
      const status = url.searchParams.get("status") || "";
      sendJson(res, 200, { reservations: await reservationStore.listAll({ status }) });
      return;
    }

    if (route === "POST /api/admin/reservations/review") {
      const body = await parseBody(req);
      const reservation = await reservationStore.reviewReservation(String(body.id || ""), {
        status: body.status,
        adminNote: String(body.adminNote || "")
      }, adminUser);
      if (!reservation) {
        sendError(res, 404, "未找到该预约申请");
        return;
      }
      await studentStore.logAdminAction("review_lab_reservation", reservation.id, {
        operator: adminUser.studentNo,
        status: reservation.status,
        labName: reservation.labName,
        slot: reservation.slot
      });
      sendJson(res, 200, { reservation });
      return;
    }

    if (route === "GET /api/admin/students") {
      const requestedRole = url.searchParams.get("role") || "";
      const query = String(url.searchParams.get("query") || "").trim().slice(0, 120);
      const status = url.searchParams.get("status") || "";
      const pageSize = Math.min(Math.max(10, Number(url.searchParams.get("pageSize")) || 50), 100);
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const roleFilter = !isSuperAdmin && requestedRole && !["student", "teacher"].includes(requestedRole) ? "__denied__" : requestedRole;
      if (roleFilter === "__denied__") {
        sendJson(res, 200, { students: [], count: 0, totalCount: 0, accountCount: 0, roleCounts: { student: 0, teacher: 0 }, page: 1, pageSize, totalPages: 1, canManageRoles: false });
        return;
      }
      const visibleRoles = isSuperAdmin ? [] : ["student", "teacher"];
      const [students, totalCount, allRoleCounts] = await Promise.all([
        studentStore.listStudents({
          query,
          status,
          role: roleFilter,
          limit: pageSize,
          offset: (page - 1) * pageSize
        }),
        studentStore.countStudents({
          query,
          status,
          role: roleFilter,
          roles: roleFilter ? [] : visibleRoles
        }),
        studentStore.countStudentsByRole({ query, status })
      ]);
      const visibleStudents = isSuperAdmin ? students : students.filter((student) => ["student", "teacher"].includes(student.role));
      const roleCounts = isSuperAdmin
        ? allRoleCounts
        : { student: allRoleCounts.student, teacher: allRoleCounts.teacher };
      const accountCount = Object.values(roleCounts).reduce((sum, count) => sum + Number(count || 0), 0);
      sendJson(res, 200, {
        students: visibleStudents.map(adminStudent),
        count: visibleStudents.length,
        totalCount,
        accountCount,
        roleCounts,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
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
      await studentStore.logAdminAction("upsert_student", student.studentNo, { operator: adminUser.studentNo, school: student.school, major: student.major, className: student.className });
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
      const body = await parseBody(req, { limitBytes: MAX_UPLOAD_BODY_BYTES });
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
          await studentStore.logAdminAction("import_student", student.studentNo, { operator: adminUser.studentNo, row: index + 2, className: student.className });
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

  if (route === "GET /api/integrations/status") {
    sendJson(res, 200, { services: integrations.configured() });
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
    const liveNews = await campusNewsService.getCampusNews(url.searchParams.get("refresh") === "1");
    sendJson(res, 200, { ...liveNews, items: [...importedNews, ...liveNews.items] });
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
    const scene = String(body.scene || "智慧校园服务").slice(0, 160);
    let amount = Number(body.amount || 0);
    if (body.orderId) {
      const sourceOrder = data.orders.find((item) => item.id === body.orderId && item.userId === user.id);
      if (!sourceOrder) {
        sendError(res, 404, "关联订单不存在");
        return;
      }
      amount = Number(sourceOrder.price || 0);
    }
    if (!Number.isFinite(amount) || amount < 0.5 || amount > 50000) {
      sendError(res, 400, "支付金额无效");
      return;
    }
    const order = {
      id: nextId("pay"),
      userId: user.id,
      provider: String(body.provider || "stripe"),
      scene,
      amount,
      currency: "cny",
      status: "created",
      metadata: { sourceOrderId: String(body.orderId || "") }
    };
    await paymentStore.create(order);
    const checkout = await integrations.createStripeCheckout({
      orderId: order.id,
      user,
      scene,
      amount,
      successUrl: `${PUBLIC_APP_URL}/#profile?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${PUBLIC_APP_URL}/#profile?payment=cancelled`
    });
    if (checkout.configured) {
      order.status = "checkout_created";
      order.stripeSessionId = checkout.id;
      order.checkoutUrl = checkout.url;
      await paymentStore.update(order.id, order);
    }
    void integrations.captureAnalytics("payment_order_created", user, { scene, amount, stripe: checkout.configured });
    sendJson(res, 201, {
      order,
      checkoutUrl: checkout.url || "",
      paymentMode: checkout.configured ? "stripe" : "configuration_required",
      message: checkout.configured ? "" : "Stripe 尚未配置，订单已保存但未发起扣款"
    });
    return;
  }

  if (route === "POST /api/payments/bind") {
    const body = await parseBody(req);
    user.paymentBindings = { ...(user.paymentBindings || {}), [body.provider]: true };
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (route === "GET /api/timetable/personal") {
    sendJson(res, 200, { courses: await timetableStore.listCourses(user) });
    return;
  }

  if (route === "POST /api/timetable/personal") {
    const body = await parseBody(req, { limitBytes: MAX_UPLOAD_BODY_BYTES });
    const courses = await timetableStore.saveCourses(user, dedupeCourses(Array.isArray(body.courses) ? body.courses : []));
    sendJson(res, 200, { courses, count: courses.length });
    return;
  }

  if (route === "POST /api/timetable/personal/course") {
    const body = await parseBody(req);
    const result = await timetableStore.upsertCourse(user, body.course || body);
    sendJson(res, 200, { course: result.course, courses: result.courses });
    return;
  }

  if (route === "POST /api/timetable/personal/delete") {
    const body = await parseBody(req);
    const courses = await timetableStore.deleteCourse(user, body.id);
    const hiddenCourseIds = await timetableStore.setCourseHidden(user, body.id, true);
    sendJson(res, 200, { courses, count: courses.length, hiddenCourseIds });
    return;
  }

  if (route === "POST /api/timetable/settings") {
    const body = await parseBody(req);
    const canManageCalendar = ["admin", "super_admin"].includes(user.role);
    const settings = await timetableStore.savePreferences(user, body, canManageCalendar);
    sendJson(res, 200, { settings });
    return;
  }

  if (route === "POST /api/timetable/import") {
    const body = await parseBody(req, { limitBytes: MAX_UPLOAD_BODY_BYTES });
    const workbook = XLSX.read(Buffer.from(body.fileData || "", "base64"), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    const read = (row, ...keys) => {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== "") return row[key];
      }
      return "";
    };
    const courses = rows.map((row, index) => ({
      id: `import-${Date.now()}-${index}`,
      semester: read(row, "semester", "学期") || "2025-2026学年第二学期",
      weeks: read(row, "weeks", "week", "周次", "上课周次") || "1-20",
      day: read(row, "day", "weekday", "星期", "周几") || "周一",
      startSection: Number(read(row, "startSection", "section", "开始节次", "起始节次", "节次") || 1),
      sectionCount: Number(read(row, "sectionCount", "duration", "连续节数", "节数") || 2),
      course: read(row, "course", "title", "课程", "课程名称", "科目") || "未命名课程",
      location: read(row, "location", "room", "地点", "上课地点", "教室") || "",
      teacher: read(row, "teacher", "教师", "老师", "任课教师") || "",
      note: read(row, "note", "remark", "备注") || "",
      source: "中文课表导入"
    })).filter((course) => course.course);
    sendJson(res, 200, { courses, count: courses.length });
    return;
  }

  if (route === "POST /api/timetable/image/import") {
    const body = await parseBody(req, { limitBytes: MAX_UPLOAD_BODY_BYTES });
    consumeAiRequest(user.id);
    const courses = await requestTimetableOcr(body.imageData, {
      semester: body.semester,
      week: body.week
    });
    const currentCourses = await timetableStore.listCourses(user);
    const savedCourses = courses.length
      ? await timetableStore.saveCourses(user, dedupeCourses([...currentCourses, ...courses]))
      : currentCourses;
    sendJson(res, 200, {
      courses,
      count: courses.length,
      savedCourses,
      model: AI_MODEL,
      provider: AI_PROVIDER,
      warning: courses.length ? "" : "未能识别到可导入课程，请保留图片后手动添加。"
    });
    return;
  }

  if (route === "POST /api/timetable/export") {
    const body = await parseBody(req);
    const workbook = XLSX.utils.book_new();
    const rows = (body.courses || []).map((course) => ({
      学期: course.semester || "",
      周次: Array.isArray(course.weeks) ? course.weeks.join(",") : (course.weeks || ""),
      星期: course.day || "",
      开始节次: course.startSection || "",
      连续节数: course.sectionCount || "",
      课程名称: course.course || "",
      上课地点: course.location || "",
      任课教师: course.teacher || "",
      备注: course.note || ""
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "中文课表");
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
    const body = await parseBody(req, { limitBytes: MAX_UPLOAD_BODY_BYTES });
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
    const reply = await requestAi(messages, body.config || {});
    sendJson(res, 200, { reply, model: AI_MODEL, provider: AI_PROVIDER });
    return;
  }

  if (route === "GET /api/dashboard") {
    const [userReservations, notifications, liveCampusNews, timetablePreferences, personalCourses] = await Promise.all([
      reservationStore.listForUser(user),
      buildUserNotifications(user),
      campusNewsService.getCampusNews(false, { preferCache: true }),
      timetableStore.getPreferences(user),
      timetableStore.listCourses(user)
    ]);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const recentCutoff = new Date(todayStart);
    recentCutoff.setDate(recentCutoff.getDate() - 2);
    const currentYear = todayStart.getFullYear();
    const recentCampusNews = [...importedNews, ...(liveCampusNews.items || [])]
      .map((item) => {
        const fullDate = item.fullDate || (/^\d{2}-\d{2}$/.test(String(item.date || "")) ? `${currentYear}-${item.date}` : "");
        return { ...item, fullDate };
      })
      .filter((item) => {
        const publishedAt = new Date(`${item.fullDate}T00:00:00`);
        return item.fullDate && !Number.isNaN(publishedAt.getTime()) && publishedAt >= recentCutoff && publishedAt <= todayStart;
      })
      .sort((a, b) => String(b.fullDate).localeCompare(String(a.fullDate)))
      .slice(0, 5);
    const reservationDurationHours = (slot) => {
      const match = String(slot || "").match(/(\d{1,2}):(\d{2})\s*[-–—至]\s*(\d{1,2}):(\d{2})/);
      if (!match) return 0;
      const start = Number(match[1]) * 60 + Number(match[2]);
      const end = Number(match[3]) * 60 + Number(match[4]);
      return end > start ? (end - start) / 60 : 0;
    };
    const approvedReservations = userReservations.filter((item) => item.status === "approved");
    const pendingReservations = userReservations.filter((item) => item.status === "pending");
    const approvedHours = approvedReservations.reduce((sum, item) => sum + reservationDurationHours(item.slot), 0);
    const reservationSummary = {
      approvedHours: Number(approvedHours.toFixed(1)),
      approvedCount: approvedReservations.length,
      pendingCount: pendingReservations.length,
      totalCount: userReservations.length,
      approvalRate: userReservations.length ? Math.round((approvedReservations.length / userReservations.length) * 100) : 0
    };
    const recentReservations = [...userReservations]
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 3);
    sendJson(res, 200, {
      stats: {
        pendingReservations: userReservations.filter((item) => item.status === "pending").length,
        unreadNotifications: notifications.filter((item) => !item.read).length,
        activeRepairs: data.repairs.filter((item) => item.userId === user.id && item.status !== "closed").length,
        todayCourses: data.timetable.length
      },
      latestNotifications: notifications.slice(0, 5),
      recentCampusNews,
      reservationSummary,
      recentReservations,
      timetable: {
        courses: data.timetable.filter((course) => !course.ownerStudentNo || course.ownerStudentNo === user.studentNo),
        personalCourses,
        hiddenCourseIds: timetablePreferences.hiddenCourseIds,
        settings: {
          semester: timetablePreferences.semester,
          week: timetablePreferences.week,
          schedule: timetablePreferences.schedule,
          weekOneStart: timetablePreferences.weekOneStart
        }
      },
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
    {
      const reservation = await reservationStore.createReservation({
        id: nextId("r"),
        slot: body.slot,
        reason: body.reason
      }, user, lab);
      void integrations.captureAnalytics("lab_reservation_created", user, { labId: lab.id, slot: body.slot || "" });
      sendJson(res, 201, { reservation });
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
    sendJson(res, 200, { reservations: await reservationStore.listForUser(user) });
    return;
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
    const notifications = await buildUserNotifications(user);
    sendJson(res, 200, {
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
      retentionDays: 14,
      maxItems: 100
    });
    return;
  }

  if (route === "POST /api/notifications/read") {
    const body = await parseBody(req);
    const notifications = await buildUserNotifications(user);
    const availableIds = new Set(notifications.map((item) => item.id));
    const ids = body.all
      ? [...availableIds]
      : [String(body.id || "")].filter((id) => availableIds.has(id));
    if (!body.all && !ids.length) {
      sendError(res, 404, "消息不存在或已被清理");
      return;
    }
    await notificationStore.markRead(user.id, ids);
    const nextNotifications = notifications.map((item) => ({ ...item, read: item.read || ids.includes(item.id) }));
    sendJson(res, 200, {
      success: true,
      updated: ids.length,
      unreadCount: nextNotifications.filter((item) => !item.read).length
    });
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
    const courses = data.timetable.filter((course) => !course.ownerStudentNo || course.ownerStudentNo === user.studentNo);
    const preferences = await timetableStore.getPreferences(user);
    const personalCourses = await timetableStore.listCourses(user);
    sendJson(res, 200, {
      courses,
      personalCourses,
      hiddenCourseIds: preferences.hiddenCourseIds,
      settings: {
        semester: preferences.semester,
        week: preferences.week,
        schedule: preferences.schedule,
        weekOneStart: preferences.weekOneStart
      },
      freeLabs
    });
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
    let email = { configured: integrations.configured().resend, sent: false };
    try {
      email = await integrations.sendEmail({
        to: process.env.SUPPORT_EMAIL,
        subject: `智慧校园工单：${ticket.title}`,
        text: `工单编号：${ticket.id}\n提交角色：${user.role}\n内容：${ticket.content}`,
        idempotencyKey: `ticket-${ticket.id}`
      });
    } catch (error) {
      void integrations.captureError(error, { route, method: req.method, status: 502, user });
    }
    void integrations.captureAnalytics("support_ticket_created", user, { emailSent: email.sent });
    sendJson(res, 201, { ticket, email });
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
    let email = { configured: integrations.configured().resend, sent: false };
    try {
      email = await integrations.sendEmail({
        to: process.env.SUPPORT_EMAIL,
        subject: `智慧校园用户反馈 ${feedback.id}`,
        text: `提交角色：${user.role}\n反馈内容：${feedback.content}`,
        idempotencyKey: `feedback-${feedback.id}`
      });
    } catch (error) {
      void integrations.captureError(error, { route, method: req.method, status: 502, user });
    }
    void integrations.captureAnalytics("feedback_created", user, { emailSent: email.sent });
    sendJson(res, 201, { feedback, email });
    return;
  }

  sendError(res, 404, "接口不存在");
}

function requestHandler(req, res) {
  res.__securityReq = req;
  if (!["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"].includes(req.method)) {
    sendError(res, 405, "请求方法不允许");
    return;
  }
  if (String(req.url || "").length > URL_MAX_LENGTH) {
    sendError(res, 414, "请求地址过长");
    return;
  }
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      const status = error.statusCode || 500;
      void integrations.captureError(error, { route: req.url.split("?")[0], method: req.method, status });
      const databaseError = /access denied|econnrefused|etimedout|database|mysql|tidb/i.test(String(error.message || ""));
      sendError(res, databaseError ? 503 : status, databaseError ? "数据库服务暂时不可用，请稍后重试" : error.message);
    });
    return;
  }
  handleStatic(req, res);
}

module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 10000);
  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 5000);
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  server.listen(PORT, () => {
  console.log(`智慧泰院网页版已启动：http://localhost:${PORT}`);
  });
}
