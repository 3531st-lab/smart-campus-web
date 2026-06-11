const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const data = require("./data");

const PORT = Number(process.env.PORT || 5173);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
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

function getCurrentUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = sessions.get(token);
  return data.users.find((user) => user.id === userId) || null;
}

function requireUser(req, res) {
  const user = getCurrentUser(req);
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
    phone: user.phone,
    role: user.role,
    college: user.college,
    major: user.major,
    studentNo: user.studentNo,
    verified: user.verified,
    avatarColor: user.avatarColor
  };
}

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
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

  if (route === "POST /api/auth/login") {
    const body = await parseBody(req);
    const user = data.users.find((item) => item.phone === body.phone);
    if (!user || body.code !== "123456") {
      sendError(res, 401, "手机号或验证码错误");
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    sendJson(res, 200, { token, user: publicUser(user) });
    return;
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (route === "GET /api/me") {
    sendJson(res, 200, { user: publicUser(user) });
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
    handleApi(req, res).catch((error) => sendError(res, 400, error.message));
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
