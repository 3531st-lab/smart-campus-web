const THEME_STORAGE_KEY = "smart_campus_color_theme_v1";

function preferredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "day" || stored === "night") return stored;
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

function applyTheme(theme, persist = false) {
  const nextTheme = theme === "day" ? "day" : "night";
  document.documentElement.dataset.theme = nextTheme;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

applyTheme(preferredTheme());

const state = {
  token: localStorage.getItem("smart_taiyuan_token") || "",
  user: null,
  route: routeFromLocation()
};

const APP_BUILD = "login-particles-v29-20260609";
window.__SMART_CAMPUS_BUILD__ = APP_BUILD;
let renderShellVersion = 0;
let dashboardGreetingTimer = null;
let loginParticleCleanup = null;

const moduleGroups = [
  {
    title: "总览",
    items: [{ id: "dashboard", label: "首页", icon: "⌂", desc: "校园服务总览" }]
  },
  {
    title: "教学服务",
    items: [
      { id: "timetable", label: "课表查询", icon: "▣", desc: "智能课程表与外部导入" },
      { id: "progress", label: "成绩查询", icon: "▤", desc: "课程成绩与学业进度" },
      { id: "rooms", label: "空教室查询", icon: "▱", desc: "自习空间快速检索" },
      { id: "exams", label: "考试报名", icon: "✦", desc: "证书、竞赛与报名时间" }
    ]
  },
  {
    title: "校园生活",
    items: [
      { id: "labs", label: "实验室预约", icon: "⌘", desc: "实验室、设备与维修" },
      { id: "library", label: "图书馆服务", icon: "▥", desc: "座位、研讨室与楼层图" },
      { id: "canteen", label: "食堂点餐", icon: "♨", desc: "点餐、支付与配送点" },
      { id: "events", label: "校园活动", icon: "♔", desc: "活动报名与社团安排" }
    ]
  },
  {
    title: "学习与工作",
    items: [
      { id: "ai", label: "AI 助手", icon: "✧", desc: "问答、写作、资料分析" },
      { id: "news", label: "校园资讯", icon: "☷", desc: "官网、学院与社团动态" },
      { id: "tools", label: "学习工具中心", icon: "⌬", desc: "文档互转、计算、翻译" },
      { id: "software", label: "软件库", icon: "▦", desc: "学习办公与开发软件" }
    ]
  },
  {
    title: "个人服务",
    items: [{ id: "profile", label: "个人中心", icon: "○", desc: "账号、认证、支付绑定" }]
  }
];

const navItems = moduleGroups.flatMap((group) => group.items);
function routeFromLocation() {
  if (location.hash) return location.hash.slice(1);
  const path = location.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return "dashboard";
  if (path === "tools" || path.startsWith("tools/")) return path;
  return "dashboard";
}

function routeToUrl(route) {
  if (route === "tools" || String(route).startsWith("tools/")) return `/${route}`;
  return `/#${route || "dashboard"}`;
}

const aiProviderPresets = [
  { id: "openai", name: "OpenAI", region: "美国", protocol: "Responses / Chat Completions", baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", doc: "https://platform.openai.com/docs/models" },
  { id: "azure-openai", name: "Azure OpenAI", region: "美国/全球", protocol: "Azure OpenAI API", baseUrl: "https://{resource}.openai.azure.com/openai", model: "deployment-name", doc: "https://learn.microsoft.com/azure/ai-foundry/openai/" },
  { id: "anthropic", name: "Anthropic Claude", region: "美国", protocol: "Messages API", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", doc: "https://docs.claude.com/zh-CN/api/messages" },
  { id: "gemini", name: "Google Gemini", region: "美国", protocol: "GenerateContent API", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-pro", doc: "https://ai.google.dev/gemini-api/docs/text-generation" },
  { id: "xai", name: "xAI Grok", region: "美国", protocol: "OpenAI 兼容", baseUrl: "https://api.x.ai/v1", model: "grok-4", doc: "https://docs.x.ai/" },
  { id: "groq", name: "Groq", region: "美国", protocol: "OpenAI 兼容", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", doc: "https://console.groq.com/docs/overview" },
  { id: "deepseek", name: "DeepSeek", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", doc: "https://api-docs.deepseek.com/" },
  { id: "qwen", name: "通义千问 Qwen", region: "中国", protocol: "OpenAI 兼容 / DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", doc: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope" },
  { id: "kimi", name: "Kimi / Moonshot", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2", doc: "https://platform.kimi.ai/docs/api/overview" },
  { id: "zhipu", name: "智谱 GLM / Z.ai", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6", doc: "https://docs.z.ai/" },
  { id: "baidu", name: "百度千帆 / 文心", region: "中国", protocol: "OpenAI 兼容 / Qianfan", baseUrl: "https://api.baiduqianfan.ai/v1", model: "ernie-4.5-turbo", doc: "https://intl.cloud.baidu.com/doc/qianfan/index.html" },
  { id: "tencent", name: "腾讯混元", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-turbos", doc: "https://cloud.tencent.com/document/product/1729" },
  { id: "xunfei", name: "讯飞星火", region: "中国", protocol: "星火 API", baseUrl: "https://spark-api-open.xf-yun.com/v1", model: "spark-max", doc: "https://www.xfyun.cn/doc/spark/Web.html" },
  { id: "minimax", name: "MiniMax", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M1", doc: "https://platform.minimaxi.com/document" },
  { id: "doubao", name: "火山方舟 / 豆包", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6", doc: "https://www.volcengine.com/docs/82379" },
  { id: "siliconflow", name: "SiliconFlow 硅基流动", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-Coder", doc: "https://docs.siliconflow.cn/" },
  { id: "baichuan", name: "百川智能", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.baichuan-ai.com/v1", model: "Baichuan4", doc: "https://platform.baichuan-ai.com/docs" },
  { id: "stepfun", name: "阶跃星辰 StepFun", region: "中国", protocol: "OpenAI 兼容", baseUrl: "https://api.stepfun.com/v1", model: "step-2", doc: "https://platform.stepfun.com/docs" },
  { id: "mistral", name: "Mistral AI", region: "法国/美国", protocol: "Chat Completions", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", doc: "https://docs.mistral.ai/api/" },
  { id: "openrouter", name: "OpenRouter / 聚合", region: "全球", protocol: "OpenAI 兼容", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-5.2", doc: "https://openrouter.ai/docs" },
  { id: "custom", name: "自定义 OpenAI 兼容", region: "自定义", protocol: "OpenAI 兼容", baseUrl: "https://your-endpoint.example/v1", model: "your-model", doc: "" }
];
const AI_PANEL_SCHEMA = "timetable-import-modal-v24-20260602";
const AI_CONFIG_KEY = "smart_campus_ai_config_panel_v2";
const AI_MESSAGES_KEY = "smart_campus_ai_messages_panel_v2";
const app = document.querySelector("#app");

function currentDateInfo() {
  const now = new Date();
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return {
    monthDay: `${String(now.getMonth() + 1).padStart(2, "0")} / ${String(now.getDate()).padStart(2, "0")}`,
    weekday: weekdays[now.getDay()]
  };
}

function paymentName(provider) {
  return {
    wechat: "微信支付",
    alipay: "支付宝",
    campusCard: "校园卡"
  }[provider] || provider;
}

const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const TIMETABLE_STORAGE_KEY = "smart_taiyuan_imported_courses_xlsx_v2";

function getStoredCourses() {
  try {
    return JSON.parse(localStorage.getItem(TIMETABLE_STORAGE_KEY) || "[]").map((course) => ({
      ...course,
      day: normalizeDay(course.day)
    }));
  } catch (error) {
    return [];
  }
}

function saveStoredCourses(courses) {
  localStorage.setItem(TIMETABLE_STORAGE_KEY, JSON.stringify(courses));
}

function currentGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "早上好";
  if (hour >= 11 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚上好";
}

function studentSalutation(name = state.user?.name) {
  const normalizedName = String(name || "").trim().replace(/同学$/, "");
  if (!normalizedName) return "同学";
  const compoundSurnames = ["欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "令狐", "宇文", "长孙", "司徒", "司空", "夏侯", "南宫"];
  const surname = compoundSurnames.find((item) => normalizedName.startsWith(item)) || normalizedName.slice(0, 1);
  return `${surname}同学`;
}

function updateDashboardGreeting() {
  const node = document.querySelector("#dashboardGreeting");
  if (!node) return;
  node.textContent = `${currentGreeting()}，${studentSalutation()} 👋`;
  clearTimeout(dashboardGreetingTimer);
  dashboardGreetingTimer = setTimeout(updateDashboardGreeting, 60_000);
}

function stopLoginParticles() {
  loginParticleCleanup?.();
  loginParticleCleanup = null;
}

function initLoginParticles() {
  stopLoginParticles();
  const canvas = document.querySelector("#loginParticles");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: -1000, y: -1000 };
  let particles = [];
  let frame = 0;
  let width = 0;
  let height = 0;

  const palette = () => document.documentElement.dataset.theme === "day"
    ? ["#087f83", "#2b7798", "#d49324", "#42aaa3"]
    : ["#32d7ff", "#6d78ff", "#dc65bd", "#68f1c6"];

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = reducedMotion ? 38 : Math.min(96, Math.max(48, Math.round((width * height) / 14500)));
    const colors = palette();
    particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.34,
      vy: (Math.random() - 0.5) * 0.34,
      radius: 0.8 + Math.random() * 1.8,
      color: colors[index % colors.length],
      phase: Math.random() * Math.PI * 2
    }));
  };

  const draw = (time = 0) => {
    context.clearRect(0, 0, width, height);
    const isDay = document.documentElement.dataset.theme === "day";
    particles.forEach((particle, index) => {
      if (!reducedMotion) {
        const dx = pointer.x - particle.x;
        const dy = pointer.y - particle.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 150 && distance > 0) {
          particle.vx -= (dx / distance) * 0.004;
          particle.vy -= (dy / distance) * 0.004;
        }
        particle.vx *= 0.996;
        particle.vy *= 0.996;
        particle.x += particle.vx + Math.sin(time * 0.00035 + particle.phase) * 0.08;
        particle.y += particle.vy + Math.cos(time * 0.0003 + particle.phase) * 0.08;
        if (particle.x < -20) particle.x = width + 20;
        if (particle.x > width + 20) particle.x = -20;
        if (particle.y < -20) particle.y = height + 20;
        if (particle.y > height + 20) particle.y = -20;
      }

      for (let nextIndex = index + 1; nextIndex < particles.length; nextIndex += 1) {
        const next = particles[nextIndex];
        const distance = Math.hypot(next.x - particle.x, next.y - particle.y);
        if (distance < 112) {
          context.beginPath();
          context.moveTo(particle.x, particle.y);
          context.lineTo(next.x, next.y);
          context.strokeStyle = isDay
            ? `rgba(21, 108, 112, ${(1 - distance / 112) * 0.16})`
            : `rgba(93, 188, 255, ${(1 - distance / 112) * 0.18})`;
          context.lineWidth = 0.7;
          context.stroke();
        }
      }

      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = particle.color;
      context.globalAlpha = isDay ? 0.68 : 0.82;
      context.shadowColor = particle.color;
      context.shadowBlur = isDay ? 5 : 10;
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    });
    if (!reducedMotion && canvas.isConnected) frame = requestAnimationFrame(draw);
  };

  const movePointer = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };
  const leavePointer = () => {
    pointer.x = -1000;
    pointer.y = -1000;
  };

  resize();
  draw();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", movePointer, { passive: true });
  window.addEventListener("pointerleave", leavePointer);
  loginParticleCleanup = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", movePointer);
    window.removeEventListener("pointerleave", leavePointer);
  };
}

async function getUnifiedTimetable() {
  const data = await api("/api/timetable");
  const courses = [...(data.courses || []), ...getStoredCourses()].map((course) => ({
    ...course,
    day: normalizeDay(course.day)
  }));
  return { ...data, courses };
}

function currentWeekInfo() {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return weekDays.map((day, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      day,
      label: `${day}<br>${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      active: date.toDateString() === now.toDateString()
    };
  });
}

function bindTimetableEditor() {
  const modal = document.querySelector("#timetableEditModal");
  const form = document.querySelector("#timetableEditForm");
  if (!modal || !form) return;

  const closeModal = () => modal.classList.add("hidden");
  document.querySelectorAll("[data-course-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const course = getStoredCourses().find((item) => item.id === button.dataset.courseEdit);
      if (!course) {
        toast("该课程不是导入课程，暂不支持修改");
        return;
      }
      form.elements.id.value = course.id;
      form.elements.day.value = normalizeDay(course.day);
      form.elements.time.value = course.time || "";
      form.elements.course.value = course.course || "";
      form.elements.location.value = course.location || "";
      form.elements.teacher.value = course.teacher || "";
      modal.classList.remove("hidden");
      form.elements.course.focus();
    });
  });
  document.querySelectorAll("[data-timetable-edit-close]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const updated = {
      id: formData.get("id"),
      day: normalizeDay(formData.get("day")),
      time: String(formData.get("time") || "").trim(),
      course: String(formData.get("course") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      teacher: String(formData.get("teacher") || "").trim(),
      source: "智慧校园课表模板"
    };
    if (!updated.time || !updated.course) {
      toast("请填写课程名称和上课时间");
      return;
    }
    saveStoredCourses(getStoredCourses().map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    closeModal();
    toast("课程已更新");
    renderShell();
  });
}

function bindTimetableImportModal() {
  const modal = document.querySelector("#timetableImportModal");
  const openButton = document.querySelector("#openTimetableImport");
  if (!modal || !openButton) return;
  const closeModal = () => modal.classList.add("hidden");
  openButton.addEventListener("click", () => modal.classList.remove("hidden"));
  document.querySelectorAll("[data-timetable-import-close]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeDay(value) {
  const text = String(value || "").trim();
  const map = {
    "1": "周一",
    "2": "周二",
    "3": "周三",
    "4": "周四",
    "5": "周五",
    "6": "周六",
    "7": "周日",
    Monday: "周一",
    Tuesday: "周二",
    Wednesday: "周三",
    Thursday: "周四",
    Friday: "周五",
    Saturday: "周六",
    Sunday: "周日"
  };
  if (weekDays.includes(text)) return text;
  if (map[text]) return map[text];
  if (text.includes("一")) return "周一";
  if (text.includes("二")) return "周二";
  if (text.includes("三")) return "周三";
  if (text.includes("四")) return "周四";
  if (text.includes("五")) return "周五";
  if (text.includes("六")) return "周六";
  if (text.includes("日") || text.includes("天")) return "周日";
  return "周一";
}

function parseCsvCourses(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const hasHeader = header.some((item) => ["day", "weekday", "time", "course", "location", "teacher", "星期", "课程"].includes(item));
  const rows = hasHeader ? lines.slice(1) : lines;
  return rows.map((line, index) => {
    const cells = parseCsvLine(line);
    const get = (...keys) => {
      for (const key of keys) {
        const found = header.findIndex((item) => item === key.toLowerCase() || item.includes(key.toLowerCase()));
        if (found >= 0) return cells[found];
      }
      return "";
    };
    return {
      id: `import-csv-${Date.now()}-${index}`,
      day: normalizeDay(hasHeader ? get("day", "weekday", "星期", "周") : cells[0]),
      time: hasHeader ? get("time", "时间", "节次") : cells[1],
      course: hasHeader ? get("course", "title", "课程", "科目") : cells[2],
      location: hasHeader ? get("location", "room", "地点", "教室") : cells[3],
      teacher: hasHeader ? get("teacher", "教师", "老师") : cells[4],
      source: "外部导入"
    };
  }).filter((item) => item.course && item.time);
}

function parseIcsDate(value) {
  const match = String(value || "").match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
}

function parseIcsCourses(text) {
  return text.split("BEGIN:VEVENT").slice(1).map((block, index) => {
    const field = (name) => {
      const line = block.split(/\r?\n/).find((item) => item.startsWith(name) || item.startsWith(`${name};`));
      return line ? line.slice(line.indexOf(":") + 1).replace(/\\n/g, " ").trim() : "";
    };
    const start = parseIcsDate(field("DTSTART"));
    const end = parseIcsDate(field("DTEND"));
    if (!start) return null;
    const day = weekDays[(start.getDay() + 6) % 7];
    const time = end
      ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}-${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
      : `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    return {
      id: `import-ics-${Date.now()}-${index}`,
      day,
      time,
      course: field("SUMMARY") || "未命名课程",
      location: field("LOCATION"),
      teacher: field("DESCRIPTION"),
      source: "ICS 导入"
    };
  }).filter(Boolean);
}

function parseExternalCourses(text, filename = "") {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (filename.endsWith(".ics") || trimmed.includes("BEGIN:VCALENDAR")) return parseIcsCourses(trimmed);
  if (filename.endsWith(".json") || trimmed.startsWith("[")) {
    const items = JSON.parse(trimmed);
    return items.map((item, index) => ({
      id: item.id || `import-json-${Date.now()}-${index}`,
      day: normalizeDay(item.day || item.weekday),
      time: item.time || `${item.start || ""}-${item.end || ""}`.replace(/^-|-$/g, ""),
      course: item.course || item.title || item.name,
      location: item.location || item.room || "",
      teacher: item.teacher || "",
      source: "JSON 导入"
    })).filter((item) => item.course && item.time);
  }
  return parseCsvCourses(trimmed);
}

function minutesOf(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function courseConflicts(courses) {
  const conflicts = [];
  for (const day of weekDays) {
    const list = courses.filter((item) => item.day === day).sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
    for (let index = 1; index < list.length; index += 1) {
      const previousEnd = minutesOf(String(list[index - 1].time).split("-")[1]);
      const currentStart = minutesOf(list[index].time);
      if (previousEnd && currentStart && currentStart < previousEnd) conflicts.push([list[index - 1], list[index]]);
    }
  }
  return conflicts;
}

function statusText(status) {
  const map = {
    available: "可预约",
    busy: "使用中",
    pending: "待审核",
    approved: "已通过",
    rejected: "未通过",
    processing: "处理中",
    submitted: "已提交",
    closed: "已完成",
    preparing: "备餐中",
    open: "已受理"
  };
  return map[status] || status;
}

function statusClass(status) {
  if (["approved", "available", "closed", "可查分", "全年可约"].includes(status)) return "success";
  if (["pending", "processing", "submitted", "preparing", "open", "报名中", "备考中", "关注公告"].includes(status)) return "warning";
  if (["rejected"].includes(status)) return "danger";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function evaluateFormula(expression) {
  const normalized = String(expression || "")
    .replace(/π/g, "pi")
    .replace(/\^/g, "**")
    .replace(/×/g, "*")
    .replace(/÷/g, "/");
  if (!normalized.trim()) return "";
  if (!/^[0-9A-Za-z_+\-*/%().,\s*]+$/.test(normalized)) {
    throw new Error("公式中包含暂不支持的字符");
  }
  const allowed = {
    pi: Math.PI,
    e: Math.E,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    log: Math.log,
    log10: Math.log10,
    exp: Math.exp,
    pow: Math.pow,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    min: Math.min,
    max: Math.max,
    c: 299792458,
    g: 9.80665
  };
  const identifiers = normalized.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const unknown = identifiers.filter((name) => !(name in allowed));
  if (unknown.length) throw new Error(`未知函数或变量：${unknown.join(", ")}`);
  const fn = Function(...Object.keys(allowed), `"use strict"; return (${normalized});`);
  const value = fn(...Object.values(allowed));
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("计算结果无效");
  return Number(value.toPrecision(12)).toString();
}

function engineeringCompute(values) {
  const mode = values.get("calcMode");
  if (mode === "base") {
    const raw = String(values.get("baseValue") || "").trim();
    const from = Number(values.get("fromBase") || 10);
    const value = Number.parseInt(raw, from);
    if (!raw || Number.isNaN(value)) throw new Error("请输入有效进制数");
    return `DEC ${value} ｜ HEX ${value.toString(16).toUpperCase()} ｜ BIN ${value.toString(2)} ｜ OCT ${value.toString(8)}`;
  }
  if (mode === "unit") {
    const amount = Number(values.get("unitValue"));
    const unit = values.get("unitType");
    if (!Number.isFinite(amount)) throw new Error("请输入有效数值");
    const unitMap = {
      m: `${amount} m = ${amount * 100} cm = ${(amount / 1000).toPrecision(8)} km`,
      kg: `${amount} kg = ${amount * 1000} g = ${(amount * 2.2046226218).toPrecision(8)} lb`,
      byte: `${amount} B = ${(amount / 1024).toPrecision(8)} KB = ${(amount / 1024 / 1024).toPrecision(8)} MB`
    };
    return unitMap[unit];
  }
  const voltage = Number(values.get("voltage"));
  const current = Number(values.get("current"));
  const resistance = Number(values.get("resistance"));
  const known = [voltage, current, resistance].filter(Number.isFinite).length;
  if (known < 2) throw new Error("欧姆定律至少填写 V/I/R 中任意两项");
  const v = Number.isFinite(voltage) ? voltage : current * resistance;
  const i = Number.isFinite(current) ? current : voltage / resistance;
  const r = Number.isFinite(resistance) ? resistance : voltage / current;
  return `V=${Number(v.toPrecision(8))} V ｜ I=${Number(i.toPrecision(8))} A ｜ R=${Number(r.toPrecision(8))} Ω ｜ P=${Number((v * i).toPrecision(8))} W`;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function conversionDownloadHref(job) {
  if (!job?.downloadUrl) return "";
  const filename = job.outputPath || job.downloadUrl.split("/").pop();
  return `/downloads/conversions/${encodeURIComponent(filename)}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(response.ok ? "服务返回格式异常，请稍后重试" : "服务暂不可用，请稍后重试");
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

const weatherFallbackLocation = { latitude: 32.4558, longitude: 119.9231, name: "泰州市" };

function weatherCodeInfo(code, isDay = true) {
  const weatherMap = {
    0: ["晴", isDay ? "☀" : "☾"],
    1: ["大部晴朗", isDay ? "🌤" : "☾"],
    2: ["多云", "⛅"],
    3: ["阴", "☁"],
    45: ["雾", "≋"],
    48: ["雾凇", "≋"],
    51: ["小毛毛雨", "🌦"],
    53: ["毛毛雨", "🌦"],
    55: ["较强毛毛雨", "🌧"],
    56: ["冻毛毛雨", "🌧"],
    57: ["较强冻毛毛雨", "🌧"],
    61: ["小雨", "🌦"],
    63: ["中雨", "🌧"],
    65: ["大雨", "🌧"],
    66: ["冻雨", "🌧"],
    67: ["较强冻雨", "🌧"],
    71: ["小雪", "🌨"],
    73: ["中雪", "🌨"],
    75: ["大雪", "❄"],
    77: ["米雪", "❄"],
    80: ["阵雨", "🌦"],
    81: ["较强阵雨", "🌧"],
    82: ["强阵雨", "🌧"],
    85: ["阵雪", "🌨"],
    86: ["强阵雪", "❄"],
    95: ["雷雨", "⛈"],
    96: ["雷雨伴冰雹", "⛈"],
    99: ["强雷雨伴冰雹", "⛈"]
  };
  return weatherMap[code] || ["天气变化中", "◌"];
}

function windDirectionLabel(degrees = 0) {
  const directions = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return directions[Math.round(Number(degrees) / 45) % 8];
}

function windLevel(speed = 0) {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const index = limits.findIndex((limit) => Number(speed) < limit);
  return index < 0 ? 12 : index;
}

function getSystemPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ...weatherFallbackLocation, precise: false });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, precise: true }),
      () => resolve({ ...weatherFallbackLocation, precise: false }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function fetchRealtimeWeather(force = false) {
  const cacheKey = "campusRealtimeWeatherV1";
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  } catch {
    localStorage.removeItem(cacheKey);
  }
  if (!force && cached?.savedAt && Date.now() - cached.savedAt < 10 * 60 * 1000) return cached;

  const position = await getSystemPosition();
  const query = `latitude=${position.latitude}&longitude=${position.longitude}`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?${query}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day&wind_speed_unit=kmh&timezone=auto`;
  const locationUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?${query}&localityLanguage=zh`;
  const [weatherResult, locationResult] = await Promise.allSettled([
    fetch(weatherUrl).then((response) => {
      if (!response.ok) throw new Error("天气服务暂不可用");
      return response.json();
    }),
    position.precise
      ? fetch(locationUrl).then((response) => {
          if (!response.ok) throw new Error("位置解析暂不可用");
          return response.json();
        })
      : Promise.resolve(null)
  ]);
  if (weatherResult.status !== "fulfilled" || !weatherResult.value.current) throw new Error("实时天气加载失败");

  const current = weatherResult.value.current;
  const location = locationResult.status === "fulfilled" ? locationResult.value : null;
  const payload = {
    savedAt: Date.now(),
    location: location?.city || location?.locality || location?.principalSubdivision || position.name || "当前位置",
    precise: position.precise,
    temperature: Math.round(current.temperature_2m),
    apparentTemperature: Math.round(current.apparent_temperature),
    weatherCode: current.weather_code,
    isDay: Boolean(current.is_day),
    windSpeed: Math.round(current.wind_speed_10m),
    windDirection: current.wind_direction_10m
  };
  localStorage.setItem(cacheKey, JSON.stringify(payload));
  return payload;
}

async function updateDashboardWeather(force = false) {
  const card = document.querySelector("#dashboardWeather");
  if (!card) return;
  card.classList.add("loading");
  try {
    const weather = await fetchRealtimeWeather(force);
    const [condition, icon] = weatherCodeInfo(weather.weatherCode, weather.isDay);
    card.querySelector("[data-weather-icon]").textContent = icon;
    card.querySelector("[data-weather-temp]").textContent = `${weather.temperature}°C`;
    card.querySelector("[data-weather-condition]").textContent = condition;
    card.querySelector("[data-weather-location]").textContent = weather.location;
    card.querySelector("[data-weather-wind]").textContent = `${windDirectionLabel(weather.windDirection)} ${windLevel(weather.windSpeed)}级`;
    card.querySelector("[data-weather-updated]").textContent = `${weather.precise ? "设备定位" : "泰州回退"} · ${new Date(weather.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}更新`;
  } catch (error) {
    card.querySelector("[data-weather-updated]").textContent = "实时天气暂不可用";
  } finally {
    card.classList.remove("loading");
  }
}

function setRoute(route) {
  if (!route) return;
  if (route === state.route && routeFromLocation() === route) return;
  state.route = route;
  paintRouteIntent(route);
  const nextUrl = routeToUrl(route);
  if (location.pathname + location.hash !== nextUrl) {
    history.pushState(null, "", nextUrl);
  }
  renderShell();
}

function paintRouteIntent(route) {
  document.body.dataset.route = route;
  document.querySelectorAll(".nav [data-route]").forEach((button) => {
    button.classList.toggle("active", button.dataset.route === route || (button.dataset.route === "tools" && route.startsWith("tools/")));
  });
  const routeLabel = navItems.find((item) => item.id === route)?.label;
  const title = document.querySelector(".page-title");
  if (routeLabel && title) title.textContent = routeLabel;
}

function syncRouteFromLocation() {
  const nextRoute = routeFromLocation();
  if (nextRoute !== state.route) {
    state.route = nextRoute;
    renderShell();
  }
}

window.addEventListener("hashchange", syncRouteFromLocation);
window.addEventListener("popstate", syncRouteFromLocation);
window.addEventListener("storage", (event) => {
  if (event.key === TIMETABLE_STORAGE_KEY && ["dashboard", "timetable"].includes(state.route)) {
    renderShell();
  }
  if (event.key === THEME_STORAGE_KEY) {
    applyTheme(preferredTheme());
    renderShell();
  }
});

function renderLogin() {
  stopLoginParticles();
  app.innerHTML = `
    <main class="login-wrap">
      <canvas class="login-particles" id="loginParticles" aria-hidden="true"></canvas>
      <button class="login-theme-toggle" id="loginThemeToggle" type="button" aria-label="切换白天与夜晚主题">
        <span aria-hidden="true">${document.documentElement.dataset.theme === "day" ? "☀" : "☾"}</span>
        <strong>${document.documentElement.dataset.theme === "day" ? "白天" : "夜晚"}</strong>
      </button>
      <section class="login-panel">
        <div class="login-visual">
          <div class="login-brand">
            <img src="/assets/campus-mark.png" alt="智慧校园标识" />
            <div><strong>智慧校园</strong><span>SMART CAMPUS</span></div>
          </div>
          <div class="login-welcome">
            <h1>连接校园生活<br />从此刻开始</h1>
            <p>课程、考试、图书馆与校园服务，一个入口轻松抵达。</p>
          </div>
          <div class="login-visual-footer"><span></span>泰州学院统一服务平台</div>
        </div>
        <form class="login-form" id="loginForm">
          <div class="login-form-heading">
            <span>统一身份认证</span>
            <h2>欢迎回来</h2>
            <p>登录后继续使用智慧校园服务</p>
          </div>
          <label class="field login-field">
            <span>手机号</span>
            <input name="phone" value="13800000000" autocomplete="tel" inputmode="tel" />
          </label>
          <label class="field login-field">
            <span>验证码</span>
            <input name="code" value="123456" autocomplete="one-time-code" />
          </label>
          <button class="primary-btn login-submit" type="submit"><span>登录</span><b aria-hidden="true">→</b></button>
          <p class="login-help">测试账号已预填，可直接登录体验</p>
        </form>
      </section>
    </main>
  `;

  initLoginParticles();
  document.querySelector("#loginThemeToggle")?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "day" ? "night" : "day";
    applyTheme(nextTheme, true);
    renderLogin();
  });
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          phone: form.get("phone"),
          code: form.get("code")
        })
      });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem("smart_taiyuan_token", result.token);
      renderShell();
    } catch (error) {
      toast(error.message);
    }
  });
}

function shell(content, title, subtitle) {
  const firstName = state.user?.name?.slice(0, 1) || "泰";
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="/assets/campus-mark.png" alt="智慧校园标识" />
          <div>
            <p class="brand-title">智慧校园</p>
            <p class="brand-subtitle">SMART CAMPUS</p>
          </div>
        </div>
        <nav class="nav">
          ${moduleGroups
            .map(
              (group) => `
                <section class="nav-section">
                  <p class="nav-label">${group.title}</p>
                  ${group.items
                    .map(
                      (item) => `
                        <button class="${state.route === item.id || (item.id === "tools" && state.route.startsWith("tools/")) ? "active" : ""}" data-route="${item.id}">
                          <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
                        </button>
                      `
                    )
                    .join("")}
                </section>
              `
            )
            .join("")}
        </nav>
        <div class="sidebar-card">
          <strong>智慧连接校园</strong>
          <p>科技点亮未来</p>
          <div class="side-city"></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="top-left">
            <button class="menu-btn" aria-label="菜单">☰</button>
            <h1 class="page-title">${title}</h1>
          </div>
          <div class="top-actions">
            <div class="search-box">
              <span>⌕</span>
              <input id="moduleSearch" placeholder="搜索服务、资讯、应用..." autocomplete="off" />
              <div class="search-results" id="moduleSearchResults"></div>
            </div>
            <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换白天与夜晚主题" title="切换白天与夜晚主题">
              <span class="theme-toggle-icon" aria-hidden="true">${document.documentElement.dataset.theme === "day" ? "☀" : "☾"}</span>
              <span class="theme-toggle-text">${document.documentElement.dataset.theme === "day" ? "白天" : "夜晚"}</span>
            </button>
            <button class="bell-btn ${state.route === "notifications" ? "active" : ""}" data-route="notifications" aria-label="消息通知">
              <span class="bell-icon">♮</span>
              <span class="bell-dot"></span>
              <span class="bell-count">12</span>
            </button>
            <div class="user-chip">
              <span class="avatar">${firstName}</span>
              <div>
                <strong>${state.user?.name || "未登录"}</strong>
              </div>
              <span class="chevron">⌄</span>
            </div>
          </div>
        </header>
        ${content}
      </main>
    </div>
  `;
}

function bindNav() {
  if (!window.__smartCampusRouteDelegationBound) {
    window.__smartCampusRouteDelegationBound = true;
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest?.("[data-route]");
      if (!routeButton || !routeButton.closest("#app")) return;
      event.preventDefault();
      event.stopPropagation();
      setRoute(routeButton.dataset.route);
    }, true);
  }
  document.querySelectorAll("[data-route]").forEach((button) => {
    if (button.tagName === "BUTTON") button.type = "button";
  });
  document.querySelector("#themeToggle")?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "day" ? "night" : "day";
    applyTheme(nextTheme, true);
    renderShell();
  });
  if (window.matchMedia("(max-width: 760px)").matches) {
    const activeRoute = document.querySelector(".nav button.active");
    requestAnimationFrame(() => {
      activeRoute?.scrollIntoView({ block: "nearest", inline: "center" });
    });
  }
  const moduleSearch = document.querySelector("#moduleSearch");
  const moduleSearchResults = document.querySelector("#moduleSearchResults");
  if (moduleSearch && moduleSearchResults) {
    const allModules = moduleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));
    const renderModuleResults = () => {
      const keyword = moduleSearch.value.trim().toLowerCase();
      const results = allModules
        .filter((item) => {
          const text = `${item.label} ${item.desc} ${item.group}`.toLowerCase();
          return !keyword || text.includes(keyword);
        })
        .slice(0, 7);
      moduleSearchResults.innerHTML = results
        .map(
          (item) => `
            <button type="button" data-route="${item.id}">
              <span>${item.icon}</span>
              <strong>${item.label}</strong>
              <em>${item.group} · ${item.desc}</em>
            </button>
          `
        )
        .join("");
      moduleSearchResults.classList.toggle("show", Boolean(keyword));
      moduleSearchResults.querySelectorAll("[data-route]").forEach((button) => {
        button.type = "button";
      });
    };
    moduleSearch.addEventListener("input", renderModuleResults);
    moduleSearch.addEventListener("focus", renderModuleResults);
    if (!window.__smartCampusSearchBlurBound) {
      window.__smartCampusSearchBlurBound = true;
      document.addEventListener("click", (event) => {
        if (event.target.closest(".search-box")) return;
        document.querySelectorAll(".search-results.show").forEach((node) => node.classList.remove("show"));
      });
    }
  }
  const timetableFile = document.querySelector("#timetableFile");
  const chooseTimetableFile = document.querySelector("#chooseTimetableFile");
  if (timetableFile && chooseTimetableFile) {
    chooseTimetableFile.addEventListener("click", () => timetableFile.click());
    timetableFile.addEventListener("change", async () => {
      const file = timetableFile.files?.[0];
      if (!file) return;
      try {
        const result = await api("/api/timetable/import", {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            fileData: await readFileAsBase64(file)
          })
        });
        saveStoredCourses([...getStoredCourses(), ...result.courses]);
        toast(`已导入 ${result.count} 门课程`);
        renderShell();
      } catch (error) {
        toast(error.message);
      } finally {
        timetableFile.value = "";
      }
    });
  }
  document.querySelectorAll("[data-timetable-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.timetableAction;
      if (action === "clear") {
        saveStoredCourses([]);
        toast("已清空外部导入课程");
        renderShell();
      }
    });
  });
}

function bindMotionEffects() {
  document.body.dataset.route = state.route;
  return;
  const motionTargets = document.querySelectorAll(
    ".dash-card, .card, .module-card, .course-item, .notice-list div, .row, .exam-card, .library-zone-row, .engine-card, .ai-message"
  );
  motionTargets.forEach((node, index) => {
    node.classList.add("motion-reveal");
    node.style.setProperty("--motion-index", index % 12);
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("motion-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    motionTargets.forEach((node) => observer.observe(node));
  } else {
    motionTargets.forEach((node) => node.classList.add("motion-visible"));
  }

  document.querySelectorAll(".dash-card, .card, .module-card, .app-grid button, .tool-panel, .engine-card").forEach((node) => {
    node.addEventListener("pointermove", (event) => {
      const rect = node.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      node.style.setProperty("--card-x", `${x}%`);
      node.style.setProperty("--card-y", `${y}%`);
    });
  });

  const main = document.querySelector(".main");
  if (main) {
    main.addEventListener("pointermove", (event) => {
      const rect = main.getBoundingClientRect();
      main.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      main.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    });
  }

  document.querySelectorAll(".metric-value").forEach((node) => {
    if (node.dataset.motionCounted === "1") return;
    const value = Number(String(node.textContent).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;
    node.dataset.motionCounted = "1";
    const prefix = String(node.textContent).trim().startsWith("¥") ? "¥" : "";
    const start = performance.now();
    const duration = 760;
    const tick = (time) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = `${prefix}${(value * eased).toFixed(prefix ? 2 : 0)}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function renderShell() {
  stopLoginParticles();
  const renderVersion = ++renderShellVersion;
  const requestedRoute = routes[state.route] ? state.route : "dashboard";
  if (requestedRoute !== state.route) {
    state.route = requestedRoute;
    const nextUrl = routeToUrl(requestedRoute);
    if (location.pathname + location.hash !== nextUrl) {
      history.replaceState(null, "", nextUrl);
    }
  }

  if (!state.token) {
    renderLogin();
    return;
  }

  if (!state.user) {
    try {
      const result = await api("/api/me");
      if (renderVersion !== renderShellVersion) return;
      state.user = result.user;
    } catch (error) {
      if (renderVersion !== renderShellVersion) return;
      state.token = "";
      localStorage.removeItem("smart_taiyuan_token");
      renderLogin();
      return;
    }
  }

  const renderer = routes[requestedRoute] || routes.dashboard;
  try {
    const view = await renderer();
    if (renderVersion !== renderShellVersion || requestedRoute !== state.route) return;
    app.innerHTML = shell(view.content, view.title, view.subtitle);
    bindNav();
    view.afterRender?.();
    bindMotionEffects();
  } catch (error) {
    if (renderVersion !== renderShellVersion || requestedRoute !== state.route) return;
    app.innerHTML = shell(`<div class="empty">${error.message}</div>`, "加载失败", "请稍后重试");
    bindNav();
    bindMotionEffects();
  }
}

function toolsSubnav() {
  return `
    <nav class="tools-subnav" aria-label="学习工具快捷入口">
      <button type="button" data-route="tools/doc-convert">文档互转</button>
      <button type="button" data-route="tools/calculator">全能计算器</button>
      <button type="button" data-route="tools/translate">语言翻译</button>
    </nav>
  `;
}

function toolBackbar(title, desc) {
  return `
    <div class="tool-backbar dash-card">
      <button type="button" class="ghost-btn" data-route="tools">← 返回学习工具中心</button>
      <div>
        <h2>${title}</h2>
        <p>${desc}</p>
      </div>
    </div>
  `;
}

function docConvertPanel() {
  return `
    <section class="dash-card tool-panel converter-panel">
      <h2 class="section-title"><span>▣ 文档互转</span><a href="https://github.com/ONLYOFFICE/DocumentServer" target="_blank" rel="noreferrer">GitHub</a></h2>
      <p class="muted">支持 Word / Excel / PPT 近 1:1 高保真转换。安装 LibreOffice 后会优先走 Headless Office 渲染引擎；PDF、Markdown、HTML 仍可走内置转换。</p>
      <form class="form tool-form" id="convertForm">
        <label class="field">
          <span>上传文件</span>
          <input id="toolFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.html" />
        </label>
        <label class="field">
          <span>文件名</span>
          <input id="toolFilename" name="filename" placeholder="例如：高数试卷.docx / 数据表.xlsx / 论文.pdf" />
        </label>
        <div class="form-row">
          <label class="field">
            <span>源格式</span>
            <select name="sourceFormat">
              ${["docx", "doc", "xlsx", "xls", "pptx", "ppt", "pdf", "md", "html"].map((item) => `<option value="${item}">${item.toUpperCase()}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>目标格式</span>
            <select name="targetFormat">
              ${["pdf", "docx", "xlsx", "pptx", "html", "md"].map((item) => `<option value="${item}">${item.toUpperCase()}</option>`).join("")}
            </select>
          </label>
        </div>
        <label class="tool-check"><input type="checkbox" name="formulaSafe" checked /> 公式安全模式：保留 OMML / MathML / LaTeX，不走图片降级</label>
        <button class="primary-btn" type="submit">创建转换任务</button>
      </form>
      <div class="tool-result" id="convertResult">等待创建任务</div>
    </section>
  `;
}

function calculatorPanel() {
  return `
    <section class="dash-card tool-panel calculator-panel">
      <h2 class="section-title"><span>⌬ 全能计算器</span><a href="https://github.com/josdejong/mathjs" target="_blank" rel="noreferrer">math.js</a></h2>
      <form class="form tool-form" id="formulaForm">
        <label class="field">
          <span>数学公式</span>
          <input name="expression" value="sqrt(2^2 + 3^2) + sin(pi / 2)" />
        </label>
        <button class="primary-btn" type="submit">计算公式</button>
      </form>
      <form class="form tool-form engineering-form" id="engineeringForm">
        <label class="field">
          <span>技术计算类型</span>
          <select name="calcMode" id="calcMode">
            <option value="ohm">欧姆定律 / 功率</option>
            <option value="base">进制转换</option>
            <option value="unit">单位转换</option>
          </select>
        </label>
        <div class="engineering-fields" data-mode="ohm">
          <input name="voltage" placeholder="电压 V" />
          <input name="current" placeholder="电流 A" />
          <input name="resistance" placeholder="电阻 Ω" />
        </div>
        <div class="engineering-fields hidden" data-mode="base">
          <input name="baseValue" placeholder="数值，例如 FF" />
          <select name="fromBase"><option value="16">HEX</option><option value="10">DEC</option><option value="2">BIN</option><option value="8">OCT</option></select>
        </div>
        <div class="engineering-fields hidden" data-mode="unit">
          <input name="unitValue" placeholder="数值" />
          <select name="unitType"><option value="m">长度 m</option><option value="kg">质量 kg</option><option value="byte">数据 Byte</option></select>
        </div>
        <button class="ghost-btn" type="submit">技术计算</button>
      </form>
      <div class="tool-result calculator-result" id="calcResult">支持 sin/cos/log/sqrt/pow、常数 pi/e/c/g，以及工程换算。</div>
    </section>
  `;
}

function translatePanel() {
  return `
    <section class="dash-card tool-panel translate-panel">
      <h2 class="section-title"><span>◈ 语言翻译</span><a href="https://github.com/LibreTranslate/LibreTranslate" target="_blank" rel="noreferrer">LibreTranslate</a></h2>
      <form class="form tool-form" id="translateForm">
        <div class="form-row">
          <label class="field">
            <span>源语言</span>
            <select name="source">
              <option value="auto">自动检测</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </label>
          <label class="field">
            <span>目标语言</span>
            <select name="target">
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>文本</span>
          <textarea name="text">智慧校园支持课程表、考试报名和图书馆预约。</textarea>
        </label>
        <button class="primary-btn" type="submit">开始翻译</button>
      </form>
      <div class="tool-result translate-result" id="translateResult">正式版接 LibreTranslate API；当前先提供校内术语词库演示。</div>
    </section>
  `;
}

async function submitDocConvertForm(form, toolFile, resultBox, submitButton) {
  const file = toolFile?.files?.[0];
  if (!file) {
    if (resultBox) resultBox.innerHTML = `<strong>未创建任务</strong><p>请先点击“上传文件”，选择需要转换的 Word / Excel / PPT / PDF 文件。</p>`;
    toast("请先上传需要转换的文件");
    return;
  }

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "转换中...";
    }
    if (resultBox) resultBox.innerHTML = `<strong>正在创建转换任务</strong><p>文件正在上传并交给 LibreOffice 转换，请稍等。</p>`;
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.filename = payload.filename || file.name;
    payload.sourceFormat = payload.sourceFormat || file.name.split(".").pop().toLowerCase();
    payload.fileData = fileData;
    const result = await api("/api/tools/conversions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (resultBox) {
      resultBox.innerHTML = `
        <strong>${result.job.status}</strong>
        <span>${result.job.filename}：${result.job.sourceFormat.toUpperCase()} → ${result.job.targetFormat.toUpperCase()}</span>
        <p>${result.job.message}</p>
        ${result.job.downloadUrl ? `<a href="${conversionDownloadHref(result.job)}" target="_blank" rel="noreferrer">下载转换文件</a>` : ""}
      `;
    }
    toast("转换任务已创建");
  } catch (error) {
    if (resultBox) resultBox.innerHTML = `<strong>转换失败</strong><p>${error.message}</p>`;
    toast(error.message || "转换失败");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "创建转换任务";
    }
  }
}

function bindDocConvertTool() {
  const form = document.querySelector("#convertForm");
  if (!form) return;
  form.noValidate = true;
  const toolFile = document.querySelector("#toolFile");
  const resultBox = document.querySelector("#convertResult");
  const submitButton = form.querySelector("button[type='submit']");
  toolFile?.addEventListener("change", () => {
    const file = toolFile.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    document.querySelector("#toolFilename").value = file.name;
    const sourceSelect = document.querySelector("#convertForm [name='sourceFormat']");
    if ([...sourceSelect.options].some((option) => option.value === ext)) sourceSelect.value = ext;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    await submitDocConvertForm(event.currentTarget, toolFile, resultBox, submitButton);
    return;
    const file = toolFile?.files?.[0];
    if (!file) {
      if (resultBox) resultBox.innerHTML = `<strong>未创建任务</strong><p>请先点击“上传文件”，选择需要转换的 Word / Excel / PPT / PDF 文件。</p>`;
      toast("请先上传需要转换的文件");
      return;
    }
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.filename = payload.filename || file.name;
    payload.fileData = fileData;
    const result = await api("/api/tools/conversions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.querySelector("#convertResult").innerHTML = `
      <strong>${result.job.status}</strong>
      <span>${result.job.filename}：${result.job.sourceFormat.toUpperCase()} → ${result.job.targetFormat.toUpperCase()}</span>
      <p>${result.job.message}</p>
      ${result.job.downloadUrl ? `<a href="${conversionDownloadHref(result.job)}" target="_blank" rel="noreferrer">下载转换文件</a>` : ""}
    `;
    toast("转换任务已加入工具中心");
  });
}

function bindCalculatorTool() {
  const formulaForm = document.querySelector("#formulaForm");
  if (!formulaForm) return;
  formulaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const value = evaluateFormula(new FormData(event.currentTarget).get("expression"));
      document.querySelector("#calcResult").textContent = `公式结果：${value}`;
    } catch (error) {
      toast(error.message);
    }
  });
  const calcMode = document.querySelector("#calcMode");
  calcMode?.addEventListener("change", () => {
    document.querySelectorAll(".engineering-fields").forEach((node) => {
      node.classList.toggle("hidden", node.dataset.mode !== calcMode.value);
    });
  });
  document.querySelector("#engineeringForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      document.querySelector("#calcResult").textContent = `技术计算：${engineeringCompute(new FormData(event.currentTarget))}`;
    } catch (error) {
      toast(error.message);
    }
  });
}

function bindTranslateTool() {
  const form = document.querySelector("#translateForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/tools/translate", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
    });
    document.querySelector("#translateResult").innerHTML = `
      <strong>${result.provider}</strong>
      <span>${result.detectedSource} → ${result.target}</span>
      <p>${result.translatedText}</p>
      <small>${result.note}</small>
    `;
  });
}

const routes = {
  async dashboard() {
    const [data, timetable] = await Promise.all([api("/api/dashboard"), getUnifiedTimetable()]);
    const notices = data.latestNotifications;
    const today = currentDateInfo();
    const isDayTheme = document.documentElement.dataset.theme === "day";
    const weekInfo = currentWeekInfo();
    const todayDay = weekInfo.find((item) => item.active)?.day || weekDays[0];
    const todayCourses = timetable.courses
      .filter((course) => course.day === todayDay)
      .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
    return {
      title: "首页",
      subtitle: "查看校园服务概览和常用功能入口",
      content: `
        <section class="home-hero">
          <div class="hero-copy">
            <h2 id="dashboardGreeting">${currentGreeting()}，${studentSalutation()} 👋</h2>
            <p>探索智慧校园，开启高效学习与生活</p>
            <div class="hero-widgets">
              <div class="weather-card" id="dashboardWeather" role="button" tabindex="0" title="点击刷新实时天气">
                <span class="moon" data-weather-icon>${isDayTheme ? "☀" : "◐"}</span>
                <div class="weather-copy">
                  <strong data-weather-temp>--°C</strong>
                  <span><b data-weather-condition>正在获取实时天气</b><br /><span data-weather-location>系统定位中</span> · <span data-weather-wind>风力计算中</span></span>
                  <small data-weather-updated>准备更新</small>
                </div>
              </div>
              <div class="date-card">
                <strong>${today.monthDay}</strong>
                <span>${today.weekday}<br />农历五月初三</span>
              </div>
            </div>
          </div>
          <div class="hero-dots"><span></span><span></span><span></span></div>
        </section>
        <section class="dashboard-grid">
          <article class="dash-card schedule-card">
            <h2 class="section-title"><span>▣ 我的课表 · ${todayCourses.length} 门</span><button data-route="timetable">查看全部 ›</button></h2>
            <div class="week-row">
              ${weekInfo
                .map((item) => `<span class="${item.active ? "active" : ""}">${item.active ? item.label.replace(item.day, "今天") : item.label}</span>`)
                .join("")}
            </div>
            <div class="course-list">
              ${todayCourses
                .map((course) => `<div class="course-item"><span>${escapeHtml(course.time || "时间待定").replace("-", "<br>")}</span><strong>${escapeHtml(course.course || "未命名课程")}</strong><span>${escapeHtml(course.location || "教室待定")}</span><span>${escapeHtml(course.teacher || course.source || "教师待定")}</span></div>`)
                .join("") || `<div class="empty">今天暂无课程安排，前往课表查询可导入或调整课程。</div>`}
            </div>
          </article>
          <article class="dash-card apps-card">
            <h2 class="section-title"><span>⌘ 服务分区</span></h2>
            <div class="module-groups">
              ${moduleGroups
                .filter((group) => group.title !== "总览")
                .map(
                  (group) => `
                    <section class="module-group">
                      <div class="module-group-title">
                        <strong>${group.title}</strong>
                        <span>${group.items.length} 个入口</span>
                      </div>
                      <div class="module-grid">
                        ${group.items
                          .map(
                            (item) => `
                              <button class="module-card" data-route="${item.id}">
                                <span class="module-icon">${item.icon}</span>
                                <strong>${item.label}</strong>
                                <em>${item.desc}</em>
                              </button>
                            `
                          )
                          .join("")}
                      </div>
                    </section>
                  `
                )
                .join("")}
            </div>
          </article>
          <article class="dash-card notice-card">
            <h2 class="section-title"><span>▤ 校园通知</span><button data-route="notifications">查看全部 ›</button></h2>
            <div class="notice-list">
              ${[
                ["关于做好端午节放假安排的通知", "05-28"],
                ["智慧校园系统升级维护公告", "05-27"],
                ["2026届毕业生校招宣讲会安排", "05-26"],
                ["图书馆新书推荐（2026年第5期）", "05-25"],
                ["关于开展心理健康月系列活动的通知", "05-24"]
              ]
                .map((item) => `<div><span></span><p>${item[0]}</p><time>${item[1]}</time></div>`)
                .join("")}
            </div>
          </article>
          <article class="dash-card reserve-card">
            <h2 class="section-title"><span>▣ 实验室预约</span><button data-route="labs">查看全部 ›</button></h2>
            <div class="reserve-layout">
              <div class="reserve-summary">
                <div class="ring">
                  <div class="ring-value"><strong>12.5</strong><span>小时</span></div>
                </div>
                <div class="reserve-summary-copy">
                  <span>本周预约时长</span>
                  <strong>较上周增加 15%</strong>
                  <small>本周目标 16 小时</small>
                </div>
              </div>
              <div class="reserve-list">
                <div><span><time>05-30 · 14:00-16:00</time><b>人工智能实验室（A区501）</b></span><em>已预约</em></div>
                <div><span><time>05-31 · 09:00-11:30</time><b>网络安全实验室（B区205）</b></span><em class="warn">待使用</em></div>
                <div><span><time>06-02 · 15:30-17:30</time><b>大数据实验室（C区403）</b></span><em>已预约</em></div>
              </div>
            </div>
          </article>
          <article class="dash-card campus-card">
            <h2 class="section-title"><span>▧ 校园卡片</span></h2>
            <div class="student-card">
              <div class="student-card-top">
                <span>泰州学院</span>
                <em>校园一卡通</em>
              </div>
              <div class="student-card-main">
                <div class="student-card-person">
                  <strong>张同学</strong>
                  <p>学号：2023123456</p>
                </div>
                <div class="student-card-balance">
                  <small>账户余额</small>
                  <p><b>128.60</b><span>元</span></p>
                </div>
              </div>
              <div class="student-card-status">
                <span>校园卡 · 1234 5678</span>
                <i>状态正常</i>
              </div>
            </div>
            <div class="card-actions">
              <button class="pay-entry" data-provider="wechat" data-scene="校园卡充值" data-amount="50">微信充值</button>
              <button class="pay-entry" data-provider="alipay" data-scene="校园卡充值" data-amount="50">支付宝充值</button>
              <button>消费记录</button><button>更多服务</button>
            </div>
          </article>
          <article class="dash-card food-card">
            <h2 class="section-title"><span>♨ 今日食堂推荐</span><button data-route="canteen">查看全部 ›</button></h2>
            <div class="food-list">
              ${[
                ["红烧牛肉面", "一食堂二楼", "12.00", "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=500&q=80"],
                ["鸡排饭", "二食堂一楼", "15.00", "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=500&q=80"],
                ["麻辣香锅", "三食堂二楼", "18.00", "https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=500&q=80"]
              ]
                .map((item) => `<div class="food-tile"><img src="${item[3]}" alt="${item[0]}" /><strong>${item[0]}</strong><span>${item[1]}</span><b>¥ ${item[2]}</b></div>`)
                .join("")}
            </div>
          </article>
        </section>
        <footer class="site-footer">© 2026 泰州学院 智慧校园  |  服务电话：0523-6711111  |  技术支持：信息化管理办公室</footer>
      `,
      afterRender() {
        updateDashboardGreeting();
        updateDashboardWeather();
        const weatherCard = document.querySelector("#dashboardWeather");
        weatherCard?.addEventListener("click", () => updateDashboardWeather(true));
        weatherCard?.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") updateDashboardWeather(true);
        });
        clearInterval(window.dashboardWeatherTimer);
        window.dashboardWeatherTimer = setInterval(() => updateDashboardWeather(true), 10 * 60 * 1000);
        document.querySelectorAll(".pay-entry").forEach((button) => {
          button.addEventListener("click", async () => {
            try {
              await api("/api/payments/create", {
                method: "POST",
                body: JSON.stringify({
                  provider: button.dataset.provider,
                  scene: button.dataset.scene,
                  amount: Number(button.dataset.amount)
                })
              });
              toast(`${paymentName(button.dataset.provider)}支付单已创建`);
            } catch (error) {
              toast(error.message);
              if (String(error.message).includes("绑定")) setRoute("profile");
            }
          });
        });
      }
    };
  },

  async labs() {
    const data = await api("/api/labs");
    return {
      title: "实验室预约",
      subtitle: "选择实验室和空闲时段提交预约申请",
      content: `
        <section class="grid cols-2">
          ${data.labs
            .map(
              (lab) => `
                <article class="card lab-card">
                  <div class="card-photo lab-photo"></div>
                  <h2 class="section-title">${lab.name}<span class="badge ${statusClass(lab.status)}">${statusText(lab.status)}</span></h2>
                  <p class="muted">${lab.building} · 容量 ${lab.capacity} 人</p>
                  <p>${lab.equipment.join(" / ")}</p>
                  <form class="form reservation-form" data-lab-id="${lab.id}">
                    <label class="field">
                      <span>预约时段</span>
                      <select name="slot">
                        ${lab.freeSlots.map((slot) => `<option value="${slot}">${slot}</option>`).join("")}
                      </select>
                    </label>
                    <label class="field">
                      <span>预约用途</span>
                      <input name="reason" placeholder="例如：课程实验、竞赛训练、项目调试" />
                    </label>
                    <button class="primary-btn" type="submit">提交预约</button>
                  </form>
                </article>
              `
            )
            .join("")}
        </section>
      `,
      afterRender() {
        document.querySelectorAll(".reservation-form").forEach((form) => {
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            try {
              await api("/api/reservations", {
                method: "POST",
                body: JSON.stringify({
                  labId: form.dataset.labId,
                  slot: formData.get("slot"),
                  reason: formData.get("reason")
                })
              });
              toast("预约申请已提交");
              setRoute("progress");
            } catch (error) {
              toast(error.message);
            }
          });
        });
      }
    };
  },

  async progress() {
    const data = await api("/api/reservations");
    return {
      title: "申请进度",
      subtitle: "查看实验室预约审核状态和更新时间",
      content: `
        <section class="card">
          <h2 class="section-title">我的预约</h2>
          <div class="list">
            ${data.reservations
              .map(
                (item) => `
                  <article class="row">
                    <div class="row-main">
                      <p class="row-title">${item.labName}</p>
                      <p class="row-meta">${item.slot} · ${item.reason} · 更新于 ${item.updatedAt}</p>
                    </div>
                    <span class="badge ${statusClass(item.status)}">${statusText(item.status)}</span>
                  </article>
                `
              )
              .join("") || `<div class="empty">暂无预约记录</div>`}
          </div>
        </section>
      `
    };
  },

  async rooms() {
    const rooms = [
      { building: "明理楼", room: "A201", capacity: 68, time: "08:00-11:55", device: "投影 / 空调 / 插座", status: "可自习" },
      { building: "明理楼", room: "B305", capacity: 52, time: "14:00-17:45", device: "投影 / 白板", status: "可预约" },
      { building: "致知楼", room: "C404", capacity: 80, time: "18:30-21:30", device: "智慧屏 / 插座", status: "可自习" },
      { building: "图书馆", room: "研讨室 2", capacity: 12, time: "09:00-16:00", device: "会议屏 / 白板", status: "需预约" },
      { building: "实验楼", room: "E108", capacity: 44, time: "10:10-11:55", device: "机房 / 网络", status: "可预约" },
      { building: "笃行楼", room: "D302", capacity: 60, time: "16:00-21:30", device: "空调 / 插座", status: "可自习" }
    ];
    return {
      title: "空教室查询",
      subtitle: "按楼宇、时间和用途快速找到可用学习空间",
      content: `
        <section class="card">
          <h2 class="section-title">智能筛选</h2>
          <div class="tool-form room-filter">
            <label class="field"><span>关键词</span><input id="roomKeyword" placeholder="楼宇、教室、设备" /></label>
            <label class="field"><span>用途</span><select id="roomUsage"><option value="">全部</option><option value="自习">自习</option><option value="预约">预约</option></select></label>
          </div>
        </section>
        <section class="grid cols-3" id="roomList">
          ${rooms
            .map(
              (room) => `
                <article class="card room-card" data-room-text="${room.building} ${room.room} ${room.device} ${room.status}">
                  <h2 class="section-title">${room.building} ${room.room}<span class="badge success">${room.status}</span></h2>
                  <p class="muted">${room.time} · 容量 ${room.capacity} 人</p>
                  <p>${room.device}</p>
                  <button class="ghost-btn" data-room-book="${room.building} ${room.room}">收藏/预约</button>
                </article>
              `
            )
            .join("")}
        </section>
      `,
      afterRender() {
        const keyword = document.querySelector("#roomKeyword");
        const usage = document.querySelector("#roomUsage");
        const syncRooms = () => {
          const key = keyword.value.trim().toLowerCase();
          const use = usage.value;
          document.querySelectorAll(".room-card").forEach((card) => {
            const text = card.dataset.roomText.toLowerCase();
            card.hidden = Boolean((key && !text.includes(key)) || (use && !text.includes(use)));
          });
        };
        keyword.addEventListener("input", syncRooms);
        usage.addEventListener("change", syncRooms);
        document.querySelectorAll("[data-room-book]").forEach((button) => {
          button.addEventListener("click", () => toast(`${button.dataset.roomBook} 已加入常用空间`));
        });
      }
    };
  },

  async repair() {
    const repairs = await api("/api/repairs");
    return {
      title: "维修申报",
      subtitle: "提交实验室设备问题并跟踪维修进度",
      content: `
        <section class="grid cols-2">
          <form class="card form" id="repairForm">
            <h2 class="section-title">新增申报</h2>
            <label class="field"><span>实验室</span><input name="labName" placeholder="例如：软件工程实验室 301" /></label>
            <label class="field"><span>设备名称</span><input name="device" placeholder="例如：投影仪、电脑、门禁" /></label>
            <label class="field"><span>问题描述</span><textarea name="issue" placeholder="请描述故障现象"></textarea></label>
            <button class="primary-btn" type="submit">提交维修</button>
          </form>
          <div class="card">
            <h2 class="section-title">维修记录</h2>
            <div class="list">
              ${repairs.repairs
                .map(
                  (item) => `
                    <article class="row">
                      <div class="row-main">
                        <p class="row-title">${item.device}</p>
                        <p class="row-meta">${item.labName} · ${item.issue} · ${item.createdAt}</p>
                      </div>
                      <span class="badge ${statusClass(item.status)}">${statusText(item.status)}</span>
                    </article>
                  `
                )
                .join("") || `<div class="empty">暂无维修记录</div>`}
            </div>
          </div>
        </section>
      `,
      afterRender() {
        document.querySelector("#repairForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await api("/api/repairs", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(form.entries()))
          });
          toast("维修申报已提交");
          renderShell();
        });
      }
    };
  },

  async notifications() {
    const data = await api("/api/notifications");
    return {
      title: "消息通知",
      subtitle: "集中查看系统、预约、维修和外卖通知",
      content: `
        <section class="card">
          <div class="list">
            ${data.notifications
              .map(
                (item) => `
                  <article class="row">
                    <div class="row-main">
                      <p class="row-title">${item.title}</p>
                      <p class="row-meta">${item.body} · ${item.createdAt}</p>
                    </div>
                    <span class="badge ${item.read ? "" : "warning"}">${item.read ? "已读" : "未读"}</span>
                  </article>
                `
              )
              .join("")}
          </div>
        </section>
      `
    };
  },

  async news() {
    const data = await api("/api/campus-news");
    const liveCount = (data.sources || []).filter((item) => item.status === "live").length;
    const officialStatus = data.sourceStatus === "live" ? "官网已连接" : data.sourceStatus === "partial-no-official" ? "官网异常，显示其他公开源" : "兜底";
    return {
      title: "校园资讯",
      subtitle: "强制优先读取泰州学院官网，并聚合微信镜像、二级学院、团委和社团公开资讯",
      content: `
        <section class="news-page">
          <div class="dash-card news-source-card">
            <h2 class="section-title"><span>☷ 泰州学院多源校园资讯</span><button id="refreshCampusNews">刷新资讯</button></h2>
            <div class="source-meta">
              <span>强制官网源：https://www.tzu.edu.cn</span>
              <span>更新状态：${officialStatus}</span>
              <span>公开源在线：${liveCount}/${(data.sources || []).length}</span>
              <span>更新时间：${data.updatedAt}</span>
              <span>缓存：${Math.round(data.cacheSeconds / 60)} 分钟</span>
            </div>
            <p class="muted">本页聚合泰州学院官网、微泰院/官方微信镜像、团委社团、二级学院与部门公开页面。微信小程序私有内容需学校提供官方接口或后台审核导入，不抓取登录态和私有接口。</p>
            <div class="news-source-grid">
              ${(data.sources || []).map((source) => `
                <a class="news-source-chip ${source.status === "live" ? "ok" : source.status === "requires-official-api" ? "locked" : "error"}" href="${source.url || data.source}" target="_blank" rel="noreferrer">
                  <strong>${source.name}</strong>
                  <span>${source.status === "live" ? `${source.count || 0} 条` : source.status === "requires-official-api" ? "需官方接口" : "暂不可达"}</span>
                </a>
              `).join("")}
            </div>
            <form class="news-import-form" id="newsImportForm">
              <input name="title" placeholder="微信小程序/社团稿件标题" required />
              <input name="source" placeholder="来源，如：泰州学院小程序、活力经管" required />
              <input name="url" placeholder="公开原文链接" required />
              <select name="category">
                <option value="微信小程序">微信小程序</option>
                <option value="团委社团">团委社团</option>
                <option value="二级学院">二级学院</option>
                <option value="校园活动">校园活动</option>
              </select>
              <button class="ghost-btn" type="submit">导入审核稿件</button>
            </form>
          </div>
          <div class="news-list-grid">
            ${data.items.map((item) => `
              <article class="news-item dash-card">
                <div>
                  <span class="badge">${item.category}</span>
                  <time>${item.date || "最新"}</time>
                </div>
                <h3>${item.title}</h3>
                <p>${item.source}</p>
                <a href="${item.url}" target="_blank" rel="noreferrer">查看原文</a>
              </article>
            `).join("")}
          </div>
        </section>
      `,
      afterRender() {
        document.querySelector("#refreshCampusNews").addEventListener("click", async () => {
          toast("正在刷新泰州学院官网资讯");
          await api("/api/campus-news?refresh=1");
          renderShell();
        });
        document.querySelector("#newsImportForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          await api("/api/campus-news/import", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              source: formData.get("source"),
              url: formData.get("url"),
              category: formData.get("category")
            })
          });
          toast("稿件已导入校园资讯");
          renderShell();
        });
        window.clearTimeout(window.smartCampusNewsTimer);
        window.smartCampusNewsTimer = window.setTimeout(() => {
          if (state.route === "news") renderShell();
        }, 300000);
      }
    };
  },

  async exams() {
    const data = await api("/api/exams");
    const categories = ["全部", ...new Set(data.items.map((item) => item.category))];
    const activeCount = data.items.filter((item) => ["报名中", "全年可约", "备考中"].includes(item.status)).length;
    const statusRank = {
      "报名中": 1,
      "全年可约": 2,
      "报名未开始": 3,
      "备考中": 4,
      "待查分": 5,
      "可查分": 6,
      "关注公告": 7
    };
    return {
      title: "考试报名",
      subtitle: "大学生常用考试官方入口、报名时间、考试时间与成绩查询",
      content: `
        <section class="exam-page">
          <div class="dash-card exam-hero">
            <div>
              <p class="exam-kicker">每日官方源索引</p>
              <h2>考试报名一站式日历</h2>
              <p>统一收纳语言、升学、就业编制、财会金融、职业资格、校园竞赛等考试。状态按电脑日期实时计算；官网链接与舆情含金量每 15 天核查一次，所有报名和查分都跳转官方入口。</p>
              <div class="source-meta">
                <span>已收录：${data.items.length} 项</span>
                <span>可关注：${activeCount} 项</span>
                <span>更新时间：${data.updatedAt}</span>
                <span>链接核验：${data.auditAt || "待核验"}</span>
                <span>下次更新：${data.nextUpdateAt}</span>
              </div>
              <p class="exam-risk">${data.valueMethod || ""}</p>
            </div>
            <button class="primary-btn" id="refreshExams">核验官网与舆情</button>
          </div>

          <div class="exam-toolbar dash-card">
            <div class="exam-search">
              <span>⌕</span>
              <input id="examSearch" type="search" placeholder="搜索考试、类别、官方源..." />
            </div>
            <label class="exam-sort">
              <span>排序</span>
              <select id="examSort">
                <option value="time">按考试时间（实时）</option>
                <option value="value">按含金量</option>
                <option value="status">按状态</option>
              </select>
            </label>
            <div class="exam-filters">
              ${categories.map((category) => `<button class="exam-filter ${category === "全部" ? "active" : ""}" data-exam-category="${category}">${category}</button>`).join("")}
            </div>
          </div>

          <div class="exam-grid" id="examGrid">
            ${data.items.map((item) => `
              <article class="exam-card dash-card"
                data-category="${item.category}"
                data-search="${`${item.name} ${item.category} ${item.source}`.toLowerCase()}"
                data-exam-date="${item.nextExamDate || "9999-12-31"}"
                data-value="${item.valueScore || 0}"
                data-status-rank="${statusRank[item.status] || 9}">
                <div class="exam-card-head">
                  <div>
                    <span class="badge">${item.category}</span>
                    <h3>${item.name}</h3>
                  </div>
                  <span class="badge ${statusClass(item.status)}">${item.status}</span>
                </div>
                <div class="exam-meta-row">
                  <span>含金量：${item.valueLabel} · ${item.valueScore}</span>
                  <span>舆情样本：${item.publicOpinion?.sampleSize || "-"} · 置信度${item.publicOpinion?.confidence || "-"}</span>
                  <span>时间精度：${item.datePrecision}</span>
                  <span>官网链接：${item.linksReady ? "三入口已核验" : "部分待复核"}</span>
                </div>
                <div class="exam-timeline">
                  <div><span>报名时间</span><strong>${item.registrationTime}</strong></div>
                  <div><span>考试时间</span><strong>${item.examTime}</strong></div>
                  <div><span>查分时间</span><strong>${item.scoreTime}</strong></div>
                </div>
                <p class="exam-source">来源：${item.source}</p>
                <p class="exam-risk">${item.riskNote}</p>
                <p class="exam-risk">舆情方法：${item.publicOpinion?.method || "待更新"}</p>
                <div class="exam-actions">
                  <a href="${item.signupUrl}" target="_blank" rel="noreferrer">报名入口</a>
                  <a href="${item.scoreUrl}" target="_blank" rel="noreferrer">成绩查询</a>
                  <a href="${item.officialUrl}" target="_blank" rel="noreferrer">官网公告</a>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      `,
      afterRender() {
        const filters = [...document.querySelectorAll(".exam-filter")];
        const cards = [...document.querySelectorAll(".exam-card")];
        const grid = document.querySelector("#examGrid");
        const search = document.querySelector("#examSearch");
        const sort = document.querySelector("#examSort");
        let category = "全部";

        const updateCards = () => {
          const keyword = search.value.trim().toLowerCase();
          cards.forEach((card) => {
            const matchCategory = category === "全部" || card.dataset.category === category;
            const matchSearch = !keyword || card.dataset.search.includes(keyword);
            card.hidden = !(matchCategory && matchSearch);
          });
        };
        const sortCards = () => {
          const sorted = [...cards].sort((a, b) => {
            if (sort.value === "value") return Number(b.dataset.value) - Number(a.dataset.value);
            if (sort.value === "status") return Number(a.dataset.statusRank) - Number(b.dataset.statusRank);
            return a.dataset.examDate.localeCompare(b.dataset.examDate) || Number(b.dataset.value) - Number(a.dataset.value);
          });
          sorted.forEach((card) => grid.appendChild(card));
        };

        filters.forEach((button) => {
          button.addEventListener("click", () => {
            category = button.dataset.examCategory;
            filters.forEach((item) => item.classList.toggle("active", item === button));
            updateCards();
          });
        });
        search.addEventListener("input", updateCards);
        sort.addEventListener("change", sortCards);
        sortCards();
        document.querySelector("#refreshExams").addEventListener("click", async () => {
          toast("正在核验官网链接与舆情含金量，可能需要几十秒");
          await api("/api/exams?refresh=1&audit=1");
          renderShell();
        });
      }
    };
  },

  async rules() {
    const data = await api("/api/lab-rules");
    return {
      title: "实验室守则",
      subtitle: "查看实验室使用规范和安全要求",
      content: `
        <section class="card">
          <div class="list">
            ${data.rules
              .map(
                (rule, index) => `
                  <article class="row">
                    <div class="row-main">
                      <p class="row-title">守则 ${index + 1}</p>
                      <p class="row-meta">${rule}</p>
                    </div>
                  </article>
                `
              )
              .join("")}
          </div>
        </section>
      `
    };
  },

  async timetable() {
    const data = await getUnifiedTimetable();
    const importedCourses = getStoredCourses();
    const allCourses = data.courses;
    const todayDay = weekDays[(new Date().getDay() + 6) % 7];
    const todayCourses = allCourses.filter((course) => course.day === todayDay);
    const conflicts = courseConflicts(allCourses);
    return {
      title: "课表查询",
      subtitle: "智能课表、冲突检测、外部课程表导入",
      content: `
        <section class="timetable-page">
          <div class="timetable-main">
            <section class="timetable-summary">
              <div class="dash-card"><span>今日课程</span><strong>${todayCourses.length}</strong><p>${todayDay} 课程安排</p></div>
              <div class="dash-card"><span>本周课程</span><strong>${allCourses.length}</strong><p>含外部导入课程</p></div>
              <div class="dash-card"><span>智能提醒</span><strong>${conflicts.length}</strong><p>${conflicts.length ? "存在时间冲突" : "暂无时间冲突"}</p></div>
            </section>
            <section class="smart-timetable dash-card">
              <h2 class="section-title"><span>▦ 周课表</span><span class="timetable-toolbar"><button id="openTimetableImport">外部导入</button><button id="exportTimetable">导出 Excel</button></span></h2>
              <div class="week-board">
                ${weekDays.map((day) => `
                  <div class="day-column ${day === todayDay ? "today" : ""}">
                    <h3>${day}</h3>
                    <div class="day-courses">
                      ${allCourses.filter((course) => course.day === day).sort((a, b) => minutesOf(a.time) - minutesOf(b.time)).map((course) => `
                        <button type="button" class="course-block" data-course-edit="${escapeHtml(course.id)}" title="点击修改课程">
                          <time>${escapeHtml(course.time)}</time>
                          <strong>${escapeHtml(course.course)}</strong>
                          <span>${escapeHtml(course.location || "未填写教室")}</span>
                          <small>${escapeHtml(course.teacher || course.source || "")}</small>
                          <em>点击修改</em>
                        </button>
                      `).join("") || `<div class="empty-day">暂无课程</div>`}
                    </div>
                  </div>
                `).join("")}
              </div>
            </section>
          </div>
          <div class="timetable-edit-modal timetable-import-modal hidden" id="timetableImportModal">
            <div class="timetable-edit-card timetable-import-card">
              <div class="modal-title-row">
                <h2>外部导入</h2>
                <button type="button" data-timetable-import-close>×</button>
              </div>
              <p class="muted">请使用《智慧校园课表.xlsx》模板导入，表头固定为 day、time、course、location、teacher。</p>
              <input id="timetableFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
              <button class="primary-btn" id="chooseTimetableFile">选择文件导入</button>
              <div class="actions">
                <button class="ghost-btn" id="clearTimetable" data-timetable-action="clear">清空外部课表</button>
              </div>
              <div class="import-stats">
                <span><strong>${importedCourses.length}</strong> 外部课程</span>
                <span><strong>${conflicts.length}</strong> 冲突提醒</span>
              </div>
            </div>
          </div>
          <div class="timetable-edit-modal hidden" id="timetableEditModal">
            <form class="timetable-edit-card" id="timetableEditForm">
              <div class="modal-title-row">
                <h2>修改课程</h2>
                <button type="button" data-timetable-edit-close>×</button>
              </div>
              <input type="hidden" name="id" />
              <label class="field">
                <span>星期</span>
                <select name="day">
                  ${weekDays.map((day) => `<option value="${day}">${day}</option>`).join("")}
                </select>
              </label>
              <label class="field">
                <span>时间</span>
                <input name="time" placeholder="08:00-09:40" required />
              </label>
              <label class="field">
                <span>课程</span>
                <input name="course" placeholder="课程名称" required />
              </label>
              <label class="field">
                <span>地点</span>
                <input name="location" placeholder="教学楼 / 教室" />
              </label>
              <label class="field">
                <span>教师</span>
                <input name="teacher" placeholder="教师姓名" />
              </label>
              <div class="modal-actions">
                <button type="button" class="ghost-btn" data-timetable-edit-close>取消</button>
                <button type="submit" class="primary-btn">保存修改</button>
              </div>
            </form>
          </div>
        </section>
      `,
      afterRender() {
        bindTimetableImportModal();
        bindTimetableEditor();
        document.querySelector("#exportTimetable").addEventListener("click", async () => {
          const result = await api("/api/timetable/export", {
            method: "POST",
            body: JSON.stringify({ courses: allCourses })
          });
          const link = document.createElement("a");
          link.href = `/downloads/conversions/${encodeURIComponent(result.filename)}`;
          link.download = "智慧校园课表.xlsx";
          link.click();
        });
      }
    };
  },

  async library() {
    const data = await api("/api/library/layout");
    const selectedFloorId = localStorage.getItem("smart_campus_library_floor") || "1";
    const selectedFloor = data.floors.find((floor) => floor.id === selectedFloorId) || data.floors[1] || data.floors[0];
    const floorZones = data.zones.filter((zone) => zone.floorId === selectedFloor.id);
    const floorSeats = (data.seats || []).filter((seat) => seat.floorId === selectedFloor.id);
    const allAvailable = data.zones.reduce((sum, zone) => sum + Number(zone.available || 0), 0);
    const allCapacity = data.zones.reduce((sum, zone) => sum + Number(zone.capacity || 0), 0);
    const defaultZone = floorZones[0] || data.zones[0];
    const today = new Date().toISOString().slice(0, 10);
    return {
      title: "图书馆服务",
      subtitle: "楼层平面图、座位热力、研讨室与活动空间预约",
      content: `
        <section class="library-page">
          <div class="dash-card library-hero">
            <div>
              <p class="exam-kicker">LIBRARY SPACE MAP</p>
              <h2>图书馆空间预约</h2>
              <p>根据图书馆项目中的楼层平面图重新设计座位点位，支持在图上直接选择座位、研讨室或活动空间并提交预约。</p>
              <div class="source-meta">
                <span>楼层：${data.floors.length} 层</span>
                <span>点位：${(data.seats || []).length} 个</span>
                <span>剩余名额：${allAvailable}/${allCapacity}</span>
                <span>我的预约：${data.reservations.length} 条</span>
              </div>
            </div>
          </div>

          <div class="library-floor-tabs dash-card">
            ${data.floors.map((floor) => `
              <button class="${floor.id === selectedFloor.id ? "active" : ""}" data-library-floor="${floor.id}">
                <strong>${floor.name}</strong><span>${floor.summary}</span>
              </button>
            `).join("")}
          </div>

          <div class="library-layout">
            <section class="dash-card library-map-card">
              <h2 class="section-title"><span>▥ ${selectedFloor.name} 平面图</span><span class="badge">${selectedFloor.summary}</span></h2>
              <div class="library-map">
                <img src="${selectedFloor.image}" alt="${selectedFloor.name}图书馆平面图" />
                ${floorZones.map((zone) => `
                  <button class="library-zone-marker ${zone.available <= 5 ? "busy" : ""}" style="left:${zone.x}%;top:${zone.y}%;width:${zone.w}%;height:${zone.h}%;" data-zone-id="${zone.id}">
                    <span>${zone.name}</span>
                    <strong>${zone.available}</strong>
                  </button>
                `).join("")}
                ${floorSeats.map((seat) => `
                  <button class="library-seat-dot ${seat.status}" style="left:${seat.x}%;top:${seat.y}%;" data-seat-id="${seat.id}" data-zone-id="${seat.zoneId}" title="${seat.code} ${seat.status === "available" ? "可预约" : seat.status === "reserved" ? "已预约" : "使用中"}">
                    <span>${seat.code}</span>
                  </button>
                `).join("")}
              </div>
              <div class="library-map-legend">
                <span><i class="available"></i> 可预约</span>
                <span><i class="occupied"></i> 使用中</span>
                <span><i class="reserved"></i> 已预约</span>
              </div>
            </section>

            <aside class="library-side">
              <section class="dash-card library-book-card">
                <h2 class="section-title"><span>预约区域</span></h2>
                <form class="form" id="libraryReserveForm">
                  <label class="field">
                    <span>区域</span>
                    <select name="zoneId" id="libraryZoneSelect">
                      ${data.zones.map((zone) => `<option value="${zone.id}" ${zone.id === defaultZone?.id ? "selected" : ""}>${zone.name} · ${zone.type}</option>`).join("")}
                    </select>
                  </label>
                  <label class="field">
                    <span>日期</span>
                    <input name="date" type="date" value="${today}" />
                  </label>
                  <label class="field">
                    <span>时段</span>
                    <select name="slot" id="librarySlotSelect">
                      ${(defaultZone?.slots || []).map((slot) => `<option value="${slot}">${slot}</option>`).join("")}
                    </select>
                  </label>
                  <label class="field">
                    <span>座位/房间号</span>
                    <input name="seatCode" id="librarySeatCode" placeholder="请在平面图上选择座位" readonly required />
                    <input name="seatId" id="librarySeatId" type="hidden" />
                  </label>
                  <button class="primary-btn" type="submit">提交预约</button>
                </form>
              </section>

              <section class="dash-card">
                <h2 class="section-title"><span>楼层区域</span></h2>
                <div class="library-zone-list">
                  ${floorZones.map((zone) => `
                    <button class="library-zone-row" data-zone-id="${zone.id}">
                      <strong>${zone.name}</strong>
                      <span>${zone.type} · ${zone.available}/${zone.capacity} 可用 · 安静度 ${zone.quiet}</span>
                      <em>${zone.power}</em>
                    </button>
                  `).join("") || `<p class="muted">该楼层暂未配置预约区域。</p>`}
                </div>
              </section>
            </aside>
          </div>

          <section class="grid cols-2">
            <div class="dash-card">
              <h2 class="section-title"><span>我的预约</span></h2>
              <div class="list">
                ${data.reservations.map((item) => `
                  <article class="row">
                    <div class="row-main">
                      <p class="row-title">${item.zoneName}</p>
                      <p class="row-meta">${item.floorName} · ${item.date} ${item.slot} · ${item.seatCode || "自动分配"}</p>
                    </div>
                    <span class="badge success">${item.status === "approved" ? "已预约" : item.status}</span>
                  </article>
                `).join("") || `<article class="row"><div class="row-main"><p class="row-title">暂无预约</p><p class="row-meta">选择上方区域提交你的第一个图书馆预约。</p></div></article>`}
              </div>
            </div>
            <div class="dash-card">
              <h2 class="section-title"><span>预约规则</span></h2>
              <div class="list">
                ${data.rules.map((rule, index) => `<article class="row"><div class="row-main"><p class="row-title">规则 ${index + 1}</p><p class="row-meta">${rule}</p></div></article>`).join("")}
              </div>
            </div>
          </section>
        </section>
      `,
      afterRender() {
        const zones = data.zones;
        const seats = data.seats || [];
        const zoneSelect = document.querySelector("#libraryZoneSelect");
        const slotSelect = document.querySelector("#librarySlotSelect");
        const seatIdInput = document.querySelector("#librarySeatId");
        const seatCodeInput = document.querySelector("#librarySeatCode");
        const syncSlots = () => {
          const zone = zones.find((item) => item.id === zoneSelect.value);
          slotSelect.innerHTML = (zone?.slots || []).map((slot) => `<option value="${slot}">${slot}</option>`).join("");
          seatIdInput.value = "";
          seatCodeInput.value = "";
          document.querySelectorAll(".library-seat-dot.selected").forEach((dot) => dot.classList.remove("selected"));
        };

        document.querySelectorAll("[data-library-floor]").forEach((button) => {
          button.addEventListener("click", () => {
            localStorage.setItem("smart_campus_library_floor", button.dataset.libraryFloor);
            renderShell();
          });
        });
        document.querySelectorAll("[data-zone-id]").forEach((button) => {
          button.addEventListener("click", () => {
            zoneSelect.value = button.dataset.zoneId;
            syncSlots();
            document.querySelector(".library-book-card").scrollIntoView({ behavior: "smooth", block: "center" });
          });
        });
        document.querySelectorAll(".library-seat-dot").forEach((button) => {
          button.addEventListener("click", () => {
            const seat = seats.find((item) => item.id === button.dataset.seatId);
            if (!seat || seat.status !== "available") {
              toast("该座位当前不可预约");
              return;
            }
            zoneSelect.value = seat.zoneId;
            syncSlots();
            seatIdInput.value = seat.id;
            seatCodeInput.value = seat.code;
            document.querySelectorAll(".library-seat-dot.selected").forEach((dot) => dot.classList.remove("selected"));
            button.classList.add("selected");
            document.querySelector(".library-book-card").scrollIntoView({ behavior: "smooth", block: "center" });
          });
        });
        zoneSelect.addEventListener("change", syncSlots);
        document.querySelector("#libraryReserveForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          await api("/api/library/reservations", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
          });
          toast("图书馆预约成功");
          renderShell();
        });
      }
    };
  },

  async canteen() {
    const data = await api("/api/canteen/menu");
    return {
      title: "食堂外卖",
      subtitle: "提前预约点餐并选择配送取餐点",
      content: `
        <section class="grid cols-3">
          ${data.menu
            .map(
              (food) => `
                <article class="card food-card">
                  <div class="card-photo food-photo"></div>
                  <h2 class="section-title">${food.name}<span class="badge">${food.tag}</span></h2>
                  <p class="muted">${food.canteen}</p>
                  <p class="metric-value">¥${food.price}</p>
                  <form class="form order-form" data-food-id="${food.id}">
                    <label class="field">
                      <span>配送点</span>
                      <input name="deliveryPoint" value="宿舍楼下取餐点" />
                    </label>
                    <div class="pay-methods">
                      <label><input type="radio" name="paymentMethod" value="campusCard" checked /> 校园卡</label>
                      <label><input type="radio" name="paymentMethod" value="wechat" /> 微信</label>
                      <label><input type="radio" name="paymentMethod" value="alipay" /> 支付宝</label>
                    </div>
                    <button class="primary-btn" type="submit">立即支付并预约</button>
                  </form>
                </article>
              `
            )
            .join("")}
        </section>
      `,
      afterRender() {
        document.querySelectorAll(".order-form").forEach((form) => {
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            try {
              await api("/api/canteen/orders", {
                method: "POST",
                body: JSON.stringify({
                  foodId: form.dataset.foodId,
                  deliveryPoint: formData.get("deliveryPoint"),
                  paymentMethod: formData.get("paymentMethod")
                })
              });
              await api("/api/payments/create", {
                method: "POST",
                body: JSON.stringify({
                  provider: formData.get("paymentMethod"),
                  scene: "食堂外卖",
                  amount: 0
                })
              });
              toast(`${paymentName(formData.get("paymentMethod"))}支付入口已创建，外卖订单已提交`);
            } catch (error) {
              toast(error.message);
              if (String(error.message).includes("绑定")) setRoute("profile");
            }
          });
        });
      }
    };
  },

  async events() {
    const activities = [
      { name: "泰州学院 AI 创新训练营", org: "信息工程学院", time: "06-06 18:30", place: "致知楼报告厅", tag: "科技", quota: "剩余 42" },
      { name: "端午非遗手作体验", org: "校团委 / 学生社团", time: "06-08 14:00", place: "大学生活动中心", tag: "文化", quota: "剩余 28" },
      { name: "职业规划与简历诊断", org: "招生就业处", time: "06-10 15:30", place: "明理楼 B201", tag: "就业", quota: "剩余 16" },
      { name: "校园夜跑积分赛", org: "体育学院", time: "06-12 19:00", place: "田径场", tag: "运动", quota: "不限额" },
      { name: "青年志愿服务项目路演", org: "青年志愿者协会", time: "06-15 16:00", place: "图书馆报告厅", tag: "志愿", quota: "剩余 35" },
      { name: "英语演讲公开课", org: "外国语学院", time: "06-18 18:30", place: "笃行楼 D302", tag: "学习", quota: "剩余 24" }
    ];
    return {
      title: "校园活动",
      subtitle: "汇总学院、社团和校级活动，支持收藏与报名",
      content: `
        <section class="card tools-hero">
          <div>
            <h2>活动广场</h2>
            <p>按兴趣发现讲座、竞赛、社团、志愿服务和文体活动。</p>
          </div>
          <div class="tool-form event-filter">
            <label class="field"><span>搜索活动</span><input id="eventKeyword" placeholder="活动名、学院、地点" /></label>
            <label class="field"><span>类型</span><select id="eventTag"><option value="">全部</option><option>科技</option><option>文化</option><option>就业</option><option>运动</option><option>志愿</option><option>学习</option></select></label>
          </div>
        </section>
        <section class="grid cols-3">
          ${activities
            .map(
              (item) => `
                <article class="card event-card" data-event-text="${item.name} ${item.org} ${item.place} ${item.tag}">
                  <h2 class="section-title">${item.name}<span class="badge">${item.tag}</span></h2>
                  <p class="muted">${item.org}</p>
                  <div class="list compact">
                    <div class="row"><span>时间</span><strong>${item.time}</strong></div>
                    <div class="row"><span>地点</span><strong>${item.place}</strong></div>
                    <div class="row"><span>名额</span><strong>${item.quota}</strong></div>
                  </div>
                  <button class="primary-btn" data-event-sign="${item.name}">立即报名</button>
                </article>
              `
            )
            .join("")}
        </section>
      `,
      afterRender() {
        const keyword = document.querySelector("#eventKeyword");
        const tag = document.querySelector("#eventTag");
        const syncEvents = () => {
          const key = keyword.value.trim().toLowerCase();
          const selected = tag.value;
          document.querySelectorAll(".event-card").forEach((card) => {
            const text = card.dataset.eventText.toLowerCase();
            card.hidden = Boolean((key && !text.includes(key)) || (selected && !text.includes(selected)));
          });
        };
        keyword.addEventListener("input", syncEvents);
        tag.addEventListener("change", syncEvents);
        document.querySelectorAll("[data-event-sign]").forEach((button) => {
          button.addEventListener("click", () => toast(`${button.dataset.eventSign} 报名已提交`));
        });
      }
    };
  },

  async visitor() {
    const data = await api("/api/visitor/qrcode");
    return {
      title: "校外人员认证",
      subtitle: "向门卫出示身份二维码完成入校认证",
      content: `
        <section class="grid cols-2">
          <div class="card">
            <h2 class="section-title">身份二维码</h2>
            <div class="qr-box"><span>${data.qrPayload.slice(0, 22)}...</span></div>
            <p class="muted">有效期 ${data.expiresInSeconds} 秒。正式版会接入动态二维码组件和门卫核验端。</p>
          </div>
          <div class="card">
            <h2 class="section-title">认证信息</h2>
            <div class="list">
              <div class="row"><span>姓名</span><strong>${data.owner.name}</strong></div>
              <div class="row"><span>手机号</span><strong>${data.owner.phone}</strong></div>
              <div class="row"><span>认证状态</span><span class="badge success">${data.owner.verified ? "已认证" : "未认证"}</span></div>
            </div>
          </div>
        </section>
      `
    };
  },

  async ai() {
    if (localStorage.getItem("smart_campus_ai_schema") !== AI_PANEL_SCHEMA) {
      localStorage.removeItem("smart_campus_ai_config");
      localStorage.removeItem("smart_campus_ai_messages");
      localStorage.removeItem(AI_MESSAGES_KEY);
      localStorage.setItem("smart_campus_ai_schema", AI_PANEL_SCHEMA);
    }
    const storedConfig = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || "{}");
    const activeProvider = aiProviderPresets.find((item) => item.id === storedConfig.provider)
      || aiProviderPresets.find((item) => item.id === "deepseek")
      || aiProviderPresets[0];
    const storedMessages = JSON.parse(localStorage.getItem(AI_MESSAGES_KEY) || "[]");
    const hasMessages = storedMessages.length > 0;
    const greetingName = state.user?.name || "同学";
    const providerOptions = aiProviderPresets
      .map((provider) => `<option value="${provider.id}" ${provider.id === activeProvider.id ? "selected" : ""}>${provider.name} · ${provider.region}</option>`)
      .join("");
    return {
      title: "AI 助手",
      subtitle: "校园问答、学习规划、资料分析与多模型 API 配置",
      content: `
        <section class="ai-page">
          <aside class="ai-side-panel dash-card">
            <div class="ai-brand-row">
              <span class="ai-orbit">✦</span>
              <div><strong>智慧校园 AI</strong><p>${activeProvider.name} · ${storedConfig.model || activeProvider.model}</p></div>
            </div>
            <button class="ai-side-action active" data-ai-new-chat><span>＋</span>新对话</button>
            <button class="ai-side-action"><span>◷</span>历史会话</button>
            <div class="ai-capability-list">
              ${[
                ["知识库", "课程、论文、制度资料"],
                ["图片", "海报、头像、宣传图"],
                ["学习工具", "总结、PPT、润色、辅导"],
                ["AI 工作台", "模型、插件、自动化"]
              ]
                .map((item) => `<button><strong>${item[0]}</strong><span>${item[1]}</span></button>`)
                .join("")}
            </div>
            <div class="ai-vip-card">
              <strong>尊享版</strong>
              <span>解锁更多高级模型与权益</span>
              <button type="button">升级会员</button>
            </div>
            <div class="ai-recents">
              <p>最近会话</p>
              ${["你好！有什么可以帮您？", "PDF与图片数据分析请求", "论文主题与写作建议", "考试报名时间整理", "服务站选址与网络图"].map((item, index) => `<button class="${index === 0 ? "active" : ""}">${item}</button>`).join("")}
            </div>
            <div class="ai-user-footer">
              <span class="avatar">${state.user?.name?.slice(0, 1) || "张"}</span>
              <strong>${state.user?.name || "张同学"}</strong>
              <em>校园版</em>
            </div>
          </aside>

          <main class="ai-chat-panel dash-card">
            <header class="ai-chat-head">
              <div>
                <h2>AI 助手 <button class="ai-config-button" data-ai-config-open>⚙ API 配置</button></h2>
                <p>当前：${activeProvider.name} / ${storedConfig.model || activeProvider.model}。新版面板已隔离旧配置和旧会话，避免本地缓存冲突。</p>
              </div>
              <div class="ai-status-stack">
                <span>升级</span>
                <strong>${activeProvider.protocol}</strong>
              </div>
            </header>
            <div class="ai-top-icons">
              <button type="button">♮</button>
              <button type="button" data-ai-config-open>⚙</button>
              <span></span>
            </div>

            <div class="ai-message-stage ${hasMessages ? "has-messages" : "empty"}" id="aiMessageStage">
              <div class="ai-glow-core">${hasMessages ? "你好" : ""}</div>
              <div class="ai-landing">
                <h3>今天想让我帮你做什么？</h3>
                <p>学习、工作、创作，我都能为你提供专业的帮助</p>
              </div>
              <div class="ai-messages" id="aiMessages">
                ${storedMessages
                  .map(
                    (message) => `
                      <article class="ai-message ${message.role}">
                        <span>${message.role === "assistant" ? "AI" : "我"}</span>
                        <div><p>${escapeHtml(message.text)}</p><em>${message.time}</em></div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            </div>

            <div class="ai-suggestion-row">
              ${[
                ["📄", "总结文档"],
                ["🖼", "生成PPT"],
                ["✒", "润色文本"],
                ["🎓", "学习辅导"]
              ].map((item) => `<button data-ai-prompt="${item[1]}"><span>${item[0]}</span>${item[1]}</button>`).join("")}
            </div>

            <form class="ai-composer" id="aiComposer">
              <button type="button" title="上传文件">✦</button>
              <input name="prompt" placeholder="输入问题、总结文档、生成方案、辅助学习……" autocomplete="off" />
              <select name="scene">
                <option value="pro">专业版</option>
                <option value="study">学习</option>
                <option value="campus">校园</option>
                <option value="data">资料分析</option>
              </select>
              <button type="submit">➤</button>
            </form>
            <p class="ai-disclaimer">AI 可能出错；报名、缴费、考试时间和学校通知以官方系统为准。</p>
          </main>

          <div class="ai-config-modal hidden" id="aiConfigModal">
            <form class="ai-config-card" id="aiConfigForm">
              <div class="ai-config-head">
                <div><strong>AI 配置</strong><p>支持国内外主流模型，也支持学校自建大模型网关。</p></div>
                <button type="button" data-ai-config-close>×</button>
              </div>
              <label class="field">
                <span>AI 厂商</span>
                <select name="provider" id="aiProviderSelect">${providerOptions}</select>
              </label>
              <div class="form-row">
                <label class="field"><span>接口协议</span><input name="protocol" value="${storedConfig.protocol || activeProvider.protocol}" /></label>
                <label class="field"><span>模型名称</span><input name="model" value="${storedConfig.model || activeProvider.model}" /></label>
              </div>
              <label class="field"><span>Base URL</span><input name="baseUrl" value="${storedConfig.baseUrl || activeProvider.baseUrl}" /></label>
              <label class="field"><span>API Key</span><input name="apiKey" type="password" value="${storedConfig.apiKey || ""}" placeholder="sk-... / ak-... / 自建网关 token" /></label>
              <label class="field"><span>系统提示词</span><textarea name="systemPrompt">${storedConfig.systemPrompt || "你是泰州学院智慧校园 AI 助手，回答要准确、简洁，并提醒用户以学校官方通知为准。"}</textarea></label>
              <div class="ai-config-actions">
                <button class="ghost-btn" type="button" id="aiTestConfig">测试配置</button>
                <button class="primary-btn" type="submit">保存配置</button>
              </div>
              <p class="muted">当前为前端配置面板。生产环境请把密钥交给 Java/Python 后端加密保存，前端只保存配置名称。旧版本地配置已隔离，避免冲突。</p>
            </form>
          </div>
        </section>
      `,
      afterRender() {
        const modal = document.querySelector("#aiConfigModal");
        const providerSelect = document.querySelector("#aiProviderSelect");
        const configForm = document.querySelector("#aiConfigForm");
        const composer = document.querySelector("#aiComposer");
        const messageList = document.querySelector("#aiMessages");
        const stage = document.querySelector("#aiMessageStage");
        const getMessages = () => JSON.parse(localStorage.getItem(AI_MESSAGES_KEY) || "[]");
        const saveMessages = (messages) => localStorage.setItem(AI_MESSAGES_KEY, JSON.stringify(messages));
        const renderMessages = (messages) => {
          messageList.innerHTML = messages
            .map(
              (message) => `
                <article class="ai-message ${message.role}">
                  <span>${message.role === "assistant" ? "AI" : "我"}</span>
                  <div><p>${escapeHtml(message.text)}</p><em>${message.time}</em></div>
                </article>
              `
            )
            .join("");
          stage.classList.toggle("has-messages", messages.length > 0);
          stage.classList.toggle("empty", messages.length === 0);
          messageList.scrollTop = messageList.scrollHeight;
        };
        document.querySelectorAll("[data-ai-config-open]").forEach((button) => {
          button.addEventListener("click", () => modal.classList.remove("hidden"));
        });
        document.querySelector("[data-ai-config-close]").addEventListener("click", () => modal.classList.add("hidden"));
        providerSelect.addEventListener("change", () => {
          const provider = aiProviderPresets.find((item) => item.id === providerSelect.value);
          configForm.protocol.value = provider.protocol;
          configForm.baseUrl.value = provider.baseUrl;
          configForm.model.value = provider.model;
        });
        configForm.baseUrl.addEventListener("input", () => {
          if (configForm.baseUrl.value.includes("api.deepseek.com")) {
            providerSelect.value = "deepseek";
            configForm.protocol.value = "OpenAI 兼容";
            if (/^(gemini|claude|gpt)/i.test(configForm.model.value)) {
              configForm.model.value = "deepseek-v4-flash";
            }
          }
        });
        configForm.addEventListener("submit", (event) => {
          event.preventDefault();
          localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(Object.fromEntries(new FormData(configForm).entries())));
          modal.classList.add("hidden");
          toast("AI 配置已保存");
          renderShell();
        });
        document.querySelector("#aiTestConfig").addEventListener("click", () => {
          const config = Object.fromEntries(new FormData(configForm).entries());
          api("/api/ai/chat", {
            method: "POST",
            body: JSON.stringify({
              config,
              messages: [{ role: "user", text: "请只回复 OK，用于测试连接。" }]
            })
          })
            .then(() => toast("AI 连接测试成功"))
            .catch((error) => toast(error.message));
        });
        document.querySelector("[data-ai-new-chat]").addEventListener("click", () => {
          const messages = [];
          saveMessages(messages);
          renderMessages(messages);
        });
        document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
          button.addEventListener("click", () => {
            composer.prompt.value = button.dataset.aiPrompt;
            composer.prompt.focus();
          });
        });
        composer.addEventListener("submit", (event) => {
          event.preventDefault();
          const prompt = new FormData(composer).get("prompt").trim();
          if (!prompt) return;
          const config = {
            provider: activeProvider.id,
            protocol: activeProvider.protocol,
            baseUrl: activeProvider.baseUrl,
            model: activeProvider.model,
            systemPrompt: "你是泰州学院智慧校园 AI 助手，回答要准确、简洁，并提醒用户以学校官方通知为准。",
            ...JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || "{}")
          };
          const messages = getMessages();
          const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          messages.push({ role: "user", text: prompt, time });
          const pendingMessage = { role: "assistant", text: "正在思考中，请稍后", time };
          messages.push(pendingMessage);
          saveMessages(messages);
          composer.reset();
          renderMessages(messages);
          api("/api/ai/chat", {
            method: "POST",
            body: JSON.stringify({
              config,
              messages: messages.filter((item) => item !== pendingMessage)
            })
          })
            .then((result) => {
              pendingMessage.text = result.reply;
              pendingMessage.time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
              saveMessages(messages);
              renderMessages(messages);
              if (result.warning) toast(result.warning);
            })
            .catch((error) => {
              pendingMessage.text = `AI 调用失败：${error.message}`;
              pendingMessage.time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
              saveMessages(messages);
              renderMessages(messages);
            });
        });
        renderMessages(storedMessages);
      }
    };
  },

  async software() {
    const softwareCatalog = await fetch("/assets/software-catalog.json?v=codex-official-icon-v47-20260609").then((response) => {
      if (!response.ok) throw new Error("软件目录加载失败");
      return response.json();
    });
    const rawCategories = [...new Set(softwareCatalog.map((item) => item.category))];
    const categoriesWithoutAgent = rawCategories.filter((category) => category !== "Agent");
    const cadIndex = categoriesWithoutAgent.indexOf("CAD");
    if (cadIndex >= 0) categoriesWithoutAgent.splice(cadIndex + 1, 0, "Agent");
    else categoriesWithoutAgent.push("Agent");
    const categories = ["全部", ...categoriesWithoutAgent];
    const platformLabel = (item) => (item.platforms || []).join(" / ") || "Windows";
    return {
      title: "软件库",
      subtitle: "按专业方向查找常用软件、平台与版本",
      content: `
        <section class="software-page">
          <div class="dash-card software-toolbar">
            <label class="software-search"><span>⌕</span><input id="softwareKeyword" placeholder="搜索软件名称、用途、平台或版本..." /></label>
          </div>
          <div class="software-browser">
            <aside class="dash-card software-category-nav">
              <strong>软件分类</strong>
              <div class="software-filters">
                ${categories.map((category, index) => `<button class="${index === 0 ? "active" : ""}" data-software-category="${category}">${category}<span>${category === "全部" ? softwareCatalog.length : softwareCatalog.filter((item) => item.category === category).length}</span></button>`).join("")}
              </div>
            </aside>
            <div class="software-grid" id="softwareGrid">
              ${softwareCatalog.map((item) => `
                <article class="dash-card software-card" data-software-id="${item.id}" data-software-text="${escapeHtml(`${item.name} ${item.category} ${item.description} ${platformLabel(item)} ${(item.versions || []).map((version) => version.version).join(" ")}`)}" data-software-category="${item.category}">
                  <div class="software-icon image"><img src="${item.icon}" alt="${escapeHtml(item.name)} 图标" loading="lazy" /></div>
                  <div class="software-card-copy">
                    <div class="software-card-head"><h3>${escapeHtml(item.name)}</h3><span>${item.category}</span></div>
                    <p>${escapeHtml(item.description)}</p>
                    <small>${platformLabel(item)} · ${item.versions?.length || 0} 个版本</small>
                  </div>
                  <button type="button" data-software-detail="${item.id}">查看版本</button>
                </article>
              `).join("")}
            </div>
          </div>
          <div class="empty software-empty hidden" id="softwareEmpty">没有找到匹配的软件</div>
          <div class="modal hidden" id="softwareDetailModal">
            <div class="software-detail-card">
              <button type="button" class="modal-close" data-software-close aria-label="关闭">×</button>
              <div id="softwareDetailContent"></div>
            </div>
          </div>
        </section>
      `,
      afterRender() {
        const keyword = document.querySelector("#softwareKeyword");
        const empty = document.querySelector("#softwareEmpty");
        const modal = document.querySelector("#softwareDetailModal");
        const detailContent = document.querySelector("#softwareDetailContent");
        let activeCategory = "全部";
        const syncSoftware = () => {
          const query = keyword.value.trim().toLowerCase();
          let visible = 0;
          document.querySelectorAll(".software-card").forEach((card) => {
            const matchesCategory = activeCategory === "全部" || card.dataset.softwareCategory === activeCategory;
            const matchesQuery = !query || card.dataset.softwareText.toLowerCase().includes(query);
            card.hidden = !(matchesCategory && matchesQuery);
            if (!card.hidden) visible += 1;
          });
          empty.classList.toggle("hidden", visible > 0);
        };
        keyword.addEventListener("input", syncSoftware);
        document.querySelectorAll("[data-software-category]").forEach((button) => {
          button.addEventListener("click", () => {
            activeCategory = button.dataset.softwareCategory;
            document.querySelectorAll("[data-software-category]").forEach((item) => item.classList.toggle("active", item === button));
            syncSoftware();
          });
        });
        const updateSoftwareParam = (softwareId) => {
          const url = new URL(window.location.href);
          if (softwareId) url.searchParams.set("sw_id", softwareId);
          else url.searchParams.delete("sw_id");
          history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        };
        const closeSoftwareDetail = () => {
          modal.classList.add("hidden");
          updateSoftwareParam("");
        };
        const openSoftwareDetail = (softwareId) => {
          const item = softwareCatalog.find((software) => String(software.id) === String(softwareId));
          if (!item) return;
          const versions = item.versions || [];
          const visibleLimit = 5;
          detailContent.innerHTML = `
            <div class="software-detail-head">
              <img src="${item.icon}" alt="${escapeHtml(item.name)} 图标" />
              <div><span>${item.category}</span><h2>${escapeHtml(item.name)}</h2><p>${platformLabel(item)} · ${versions.length} 个版本</p></div>
            </div>
            <section class="software-detail-section">
              <h3>软件介绍</h3>
              <p class="software-detail-description">${escapeHtml(item.description)}</p>
            </section>
            <section class="software-detail-section">
              <div class="software-section-heading"><h3>可用版本</h3><span>${platformLabel(item)}</span></div>
              <div class="software-version-list">
                ${versions.map((version, index) => `
                  <div class="software-version-row ${index >= visibleLimit ? "software-version-hidden hidden" : ""}">
                    <div class="software-version-info">
                      <strong>${escapeHtml(version.version)}</strong>
                      <span>${escapeHtml(version.platform)}</span>
                    </div>
                    <div class="software-download-slots">
                      ${(() => {
                        if (item.officialUrl) {
                          return `
                            <a href="${item.officialUrl}" target="_blank" rel="noreferrer" class="software-download-slot official">
                              <span>官方网站</span><small>前往下载</small>
                            </a>
                          `;
                        }
                        const xlUrl = version.xunleiUrl || item.rjk3Url;
                        const qkUrl = version.quarkUrl || item.rjk3Url;
                        const isDirectXL = !!version.xunleiUrl;
                        const isDirectQK = !!version.quarkUrl;
                        return `
                          ${xlUrl ? `<a href="${xlUrl}" target="_blank" rel="noreferrer" class="software-download-slot${isDirectXL ? '' : ' fallback'}">
                            <span>${isDirectXL ? '迅雷网盘' : '软件详情'}</span><small>${isDirectXL ? '直接下载' : '查看下载'}</small>
                          </a>` : `<button type="button" class="software-download-slot" disabled>
                            <span>下载通道一</span><small>待接入</small>
                          </button>`}
                          ${qkUrl ? `<a href="${qkUrl}" target="_blank" rel="noreferrer" class="software-download-slot secondary${isDirectQK ? '' : ' fallback'}">
                            <span>${isDirectQK ? '夸克网盘' : '软件详情'}</span><small>${isDirectQK ? '直接下载' : '查看下载'}</small>
                          </a>` : `<button type="button" class="software-download-slot secondary" disabled>
                            <span>下载通道二</span><small>待接入</small>
                          </button>`}
                        `;
                      })()}
                    </div>
                  </div>
                `).join("") || "<p class=\"software-no-versions\">暂无版本信息</p>"}
              </div>
              ${versions.length > visibleLimit ? `<button type="button" class="software-show-more" data-software-show-more>查看更多版本（${versions.length - visibleLimit} 个）</button>` : ""}
            </section>
            <p class="software-legal-note">${item.officialUrl ? "该软件通过开发者官方网站提供下载，请在官网查看最新版本与使用说明。" : "点击下载按钮将跳转至软件详情页，在详情页中可获取下载信息。"}</p>
          `;
          detailContent.querySelector("[data-software-show-more]")?.addEventListener("click", (event) => {
            detailContent.querySelectorAll(".software-version-hidden").forEach((row) => row.classList.remove("hidden"));
            event.currentTarget.remove();
          });
          modal.classList.remove("hidden");
          updateSoftwareParam(item.id);
        };
        document.querySelectorAll("[data-software-detail]").forEach((button) => {
          button.addEventListener("click", () => openSoftwareDetail(button.dataset.softwareDetail));
        });
        document.querySelector("[data-software-close]").addEventListener("click", closeSoftwareDetail);
        modal.addEventListener("click", (event) => {
          if (event.target === modal) closeSoftwareDetail();
        });
        const requestedSoftwareId = new URLSearchParams(window.location.search).get("sw_id");
        if (requestedSoftwareId) openSoftwareDetail(requestedSoftwareId);
      }
    };
  },

  async tools() {
    return {
      title: "学习工具中心",
      subtitle: "选择一个工具进入独立页面",
      content: `
        <section class="tools-page tools-only">
          ${toolsSubnav()}
        </section>
      `
    };
    const data = await api("/api/tools/catalog");
    return {
      title: "学习工具中心",
      subtitle: "文档互转、工程计算、语言翻译的统一入口",
      content: `
        <section class="tools-page">
          <div class="dash-card tools-hero">
            <div>
              <p class="exam-kicker">Open Source Tool Hub</p>
              <h2>把收藏入口升级成学习生产力工具箱</h2>
              <p>文档转换优先接入一比一排版和公式安全链路；计算器支持公式、工程量和进制换算；翻译入口预留 LibreTranslate 自托管服务。</p>
            </div>
            <div class="tools-hero-metrics">
              <span><strong>${data.engines.length}</strong>开源引擎</span>
              <span><strong>3</strong>核心工具</span>
              <span><strong>1:1</strong>排版目标</span>
            </div>
          </div>

          ${toolsSubnav()}

          <div class="tools-grid">
            <section class="dash-card tool-panel converter-panel">
              <h2 class="section-title"><span>▧ 文档互转</span><a href="https://github.com/ONLYOFFICE/DocumentServer" target="_blank" rel="noreferrer">GitHub</a></h2>
              <p class="muted">支持 Word / Excel / PPT 近 1:1 高保真转换。安装 LibreOffice 后会优先走 Headless Office 渲染引擎；PDF、Markdown、HTML 仍可走内置转换。</p>
              <form class="form tool-form" id="convertForm">
                <label class="field">
                  <span>上传文件</span>
                  <input id="toolFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.html" />
                </label>
                <label class="field">
                  <span>文件名</span>
                  <input id="toolFilename" name="filename" placeholder="例如：高数试卷.docx / 数据表.xlsx / 论文.pdf" />
                </label>
                <div class="form-row">
                  <label class="field">
                    <span>源格式</span>
                    <select name="sourceFormat">
                      ${["docx", "doc", "xlsx", "xls", "pptx", "ppt", "pdf", "md", "html"].map((item) => `<option value="${item}">${item.toUpperCase()}</option>`).join("")}
                    </select>
                  </label>
                  <label class="field">
                    <span>目标格式</span>
                    <select name="targetFormat">
                      ${["pdf", "docx", "xlsx", "pptx", "html", "md"].map((item) => `<option value="${item}">${item.toUpperCase()}</option>`).join("")}
                    </select>
                  </label>
                </div>
                <label class="tool-check"><input type="checkbox" name="formulaSafe" checked /> 公式安全模式：保留 OMML / MathML / LaTeX，不走图片降级</label>
                <button class="primary-btn" type="submit">创建转换任务</button>
              </form>
              <div class="tool-result" id="convertResult">等待创建任务</div>
            </section>

            <section class="dash-card tool-panel calculator-panel">
              <h2 class="section-title"><span>⌬ 全能计算器</span><a href="https://github.com/josdejong/mathjs" target="_blank" rel="noreferrer">math.js</a></h2>
              <form class="form tool-form" id="formulaForm">
                <label class="field">
                  <span>数学公式</span>
                  <input name="expression" value="sqrt(2^2 + 3^2) + sin(pi / 2)" />
                </label>
                <button class="primary-btn" type="submit">计算公式</button>
              </form>
              <form class="form tool-form engineering-form" id="engineeringForm">
                <label class="field">
                  <span>技术计算类型</span>
                  <select name="calcMode" id="calcMode">
                    <option value="ohm">欧姆定律 / 功率</option>
                    <option value="base">进制转换</option>
                    <option value="unit">单位转换</option>
                  </select>
                </label>
                <div class="engineering-fields" data-mode="ohm">
                  <input name="voltage" placeholder="电压 V" />
                  <input name="current" placeholder="电流 A" />
                  <input name="resistance" placeholder="电阻 Ω" />
                </div>
                <div class="engineering-fields hidden" data-mode="base">
                  <input name="baseValue" placeholder="数值，如 FF" />
                  <select name="fromBase"><option value="16">HEX</option><option value="10">DEC</option><option value="2">BIN</option><option value="8">OCT</option></select>
                </div>
                <div class="engineering-fields hidden" data-mode="unit">
                  <input name="unitValue" placeholder="数值" />
                  <select name="unitType"><option value="m">长度 m</option><option value="kg">质量 kg</option><option value="byte">数据 Byte</option></select>
                </div>
                <button class="ghost-btn" type="submit">技术计算</button>
              </form>
              <div class="tool-result calculator-result" id="calcResult">支持 sin/cos/log/sqrt/pow、常数 pi/e/c/g，以及工程换算。</div>
            </section>

            <section class="dash-card tool-panel translate-panel">
              <h2 class="section-title"><span>◇ 语言翻译</span><a href="https://github.com/LibreTranslate/LibreTranslate" target="_blank" rel="noreferrer">LibreTranslate</a></h2>
              <form class="form tool-form" id="translateForm">
                <div class="form-row">
                  <label class="field">
                    <span>源语言</span>
                    <select name="source">
                      <option value="auto">自动检测</option>
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>目标语言</span>
                    <select name="target">
                      <option value="en">English</option>
                      <option value="zh">中文</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </select>
                  </label>
                </div>
                <label class="field">
                  <span>文本</span>
                  <textarea name="text">智慧校园支持课程表、考试报名和图书馆预约。</textarea>
                </label>
                <button class="primary-btn" type="submit">开始翻译</button>
              </form>
              <div class="tool-result translate-result" id="translateResult">正式版接 LibreTranslate API；当前先提供校内术语词库演示。</div>
            </section>
          </div>

          <section class="dash-card engine-panel">
            <h2 class="section-title"><span>▦ GitHub 引擎选型</span></h2>
            <div class="engine-list">
              ${data.engines
                .map(
                  (engine) => `
                    <article class="engine-card">
                      <div><strong>${engine.name}</strong><span>${engine.role}</span></div>
                      <p>${engine.reason}</p>
                      <a href="${engine.url}" target="_blank" rel="noreferrer">${engine.repoLabel}</a>
                    </article>
                  `
                )
                .join("")}
            </div>
          </section>
        </section>
      `,
      afterRender() {
        const toolFile = document.querySelector("#toolFile");
        toolFile.addEventListener("change", () => {
          const file = toolFile.files?.[0];
          if (!file) return;
          const ext = file.name.split(".").pop().toLowerCase();
          document.querySelector("#toolFilename").value = file.name;
          const sourceSelect = document.querySelector("#convertForm [name='sourceFormat']");
          if ([...sourceSelect.options].some((option) => option.value === ext)) sourceSelect.value = ext;
        });

        document.querySelector("#convertForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          const result = await api("/api/tools/conversions", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
          });
          document.querySelector("#convertResult").innerHTML = `
            <strong>${result.job.status}</strong>
            <span>${result.job.filename}：${result.job.sourceFormat.toUpperCase()} → ${result.job.targetFormat.toUpperCase()}</span>
            <p>${result.job.message}</p>
          `;
          toast("转换任务已加入工具中心");
        });

        document.querySelector("#formulaForm").addEventListener("submit", (event) => {
          event.preventDefault();
          try {
            const value = evaluateFormula(new FormData(event.currentTarget).get("expression"));
            document.querySelector("#calcResult").textContent = `公式结果：${value}`;
          } catch (error) {
            toast(error.message);
          }
        });

        const calcMode = document.querySelector("#calcMode");
        calcMode.addEventListener("change", () => {
          document.querySelectorAll(".engineering-fields").forEach((node) => {
            node.classList.toggle("hidden", node.dataset.mode !== calcMode.value);
          });
        });
        document.querySelector("#engineeringForm").addEventListener("submit", (event) => {
          event.preventDefault();
          try {
            document.querySelector("#calcResult").textContent = `技术计算：${engineeringCompute(new FormData(event.currentTarget))}`;
          } catch (error) {
            toast(error.message);
          }
        });

        document.querySelector("#translateForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          const result = await api("/api/tools/translate", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
          });
          document.querySelector("#translateResult").innerHTML = `
            <strong>${result.provider}</strong>
            <span>${result.detectedSource} → ${result.target}</span>
            <p>${result.translatedText}</p>
            <small>${result.note}</small>
          `;
        });
      }
    };
  },

  async "tools/doc-convert"() {
    return {
      title: "文档互转",
      subtitle: "PDF、Word、Excel、PPT 与 Markdown 的公式安全转换",
      content: `
        <section class="tools-page tool-detail-page">
          ${toolBackbar("文档互转", "保留原学习工具中心的文件上传、格式选择、公式安全转换和任务创建功能。")}
          <div class="tool-detail-grid">${docConvertPanel()}</div>
        </section>
      `,
      afterRender() {
        bindDocConvertTool();
      }
    };
  },

  async "tools/calculator"() {
    return {
      title: "全能计算器",
      subtitle: "数学公式、工程参数、进制与单位换算",
      content: `
        <section class="tools-page tool-detail-page">
          ${toolBackbar("全能计算器", "保留公式输入、预设计算类型、物理参数输入区和计算按钮。")}
          <div class="tool-detail-grid">${calculatorPanel()}</div>
        </section>
      `,
      afterRender() {
        bindCalculatorTool();
      }
    };
  },

  async "tools/translate"() {
    return {
      title: "语言翻译",
      subtitle: "源语言、目标语言、文本输入和翻译结果展示",
      content: `
        <section class="tools-page tool-detail-page">
          ${toolBackbar("语言翻译", "保留源/目标语言选择、文本输入、翻译按钮和结果展示区。")}
          <div class="tool-detail-grid">${translatePanel()}</div>
        </section>
      `,
      afterRender() {
        bindTranslateTool();
      }
    };
  },

  async profile() {
    const bindings = state.user.paymentBindings || {};
    return {
      title: "我的",
      subtitle: "管理个人信息、人员认证、在线客服和意见反馈",
      content: `
        <section class="grid cols-2">
          <div class="card">
            <h2 class="section-title">个人信息</h2>
            <div class="list">
              <div class="row"><span>姓名</span><strong>${state.user.name}</strong></div>
              <div class="row"><span>学院</span><strong>${state.user.college}</strong></div>
              <div class="row"><span>专业</span><strong>${state.user.major}</strong></div>
              <div class="row"><span>学号</span><strong>${state.user.studentNo}</strong></div>
              <div class="row"><span>人员认证</span><span class="badge success">${state.user.verified ? "已绑定" : "待绑定"}</span></div>
            </div>
          </div>
          <div class="card payment-bind-card">
            <h2 class="section-title">支付绑定</h2>
            <div class="payment-bind-list">
              <div class="payment-bind-item">
                <div><span class="pay-logo wechat">微</span><strong>微信</strong><p>用于校园卡充值、食堂点餐等支付场景</p></div>
                <button class="${bindings.wechat ? "ghost-btn" : "primary-btn"} bind-pay" data-provider="wechat">${bindings.wechat ? "已绑定" : "绑定微信"}</button>
              </div>
              <div class="payment-bind-item">
                <div><span class="pay-logo alipay">支</span><strong>支付宝</strong><p>用于校园卡充值、食堂点餐等支付场景</p></div>
                <button class="${bindings.alipay ? "ghost-btn" : "primary-btn"} bind-pay" data-provider="alipay">${bindings.alipay ? "已绑定" : "绑定支付宝"}</button>
              </div>
            </div>
            <p class="muted">当前为模拟绑定入口，正式版需要接入微信支付商户号、支付宝开放平台应用和服务端签名。</p>
          </div>
          <div class="card">
            <h2 class="section-title">在线客服</h2>
            <form class="form" id="supportForm">
              <label class="field"><span>问题标题</span><input name="title" placeholder="例如：预约失败" /></label>
              <label class="field"><span>咨询内容</span><textarea name="content" placeholder="请描述你遇到的问题"></textarea></label>
              <button class="primary-btn" type="submit">提交咨询</button>
            </form>
          </div>
          <div class="card">
            <h2 class="section-title">意见箱</h2>
            <form class="form" id="feedbackForm">
              <label class="field"><span>反馈内容</span><textarea name="content" placeholder="欢迎提出功能建议或体验问题"></textarea></label>
              <button class="primary-btn" type="submit">提交反馈</button>
            </form>
          </div>
          <div class="card">
            <h2 class="section-title">账号</h2>
            <p class="muted">退出登录会清除当前网页端令牌，不影响安卓 App 后续独立会话。</p>
            <button class="ghost-btn" id="logoutBtn">退出登录</button>
          </div>
        </section>
      `,
      afterRender() {
        document.querySelector("#supportForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          await api("/api/support/tickets", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
          });
          event.currentTarget.reset();
          toast("客服咨询已提交");
        });
        document.querySelector("#feedbackForm").addEventListener("submit", async (event) => {
          event.preventDefault();
          await api("/api/feedback", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
          });
          event.currentTarget.reset();
          toast("反馈已提交");
        });
        document.querySelectorAll(".bind-pay").forEach((button) => {
          button.addEventListener("click", async () => {
            if (button.textContent.includes("已绑定")) return;
            const result = await api("/api/payments/bind", {
              method: "POST",
              body: JSON.stringify({ provider: button.dataset.provider })
            });
            state.user = result.user;
            toast(`${paymentName(button.dataset.provider)}绑定成功`);
            renderShell();
          });
        });
        document.querySelector("#logoutBtn").addEventListener("click", () => {
          state.token = "";
          state.user = null;
          localStorage.removeItem("smart_taiyuan_token");
          renderLogin();
        });
      }
    };
  }
};

renderShell();
