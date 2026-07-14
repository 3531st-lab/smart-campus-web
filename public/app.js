const THEME_STORAGE_KEY = "smart_campus_color_theme_v1";
const { normalizePlacement: normalizeTimetablePlacement, gridPlacement: timetableGridPlacement } = window.TimetableCore;

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
  route: routeFromLocation(),
  unreadNotifications: 0,
  sidebarScrollTop: Number(sessionStorage.getItem("smart_campus_sidebar_scroll") || 0)
};

const APP_BUILD = "timetable-placement-v155-20260713";
window.__SMART_CAMPUS_BUILD__ = APP_BUILD;
const LEGAL_CONSENT_VERSION = "2026.06.20";
const LEGAL_CONSENT_STORAGE_KEY = "smart_campus_legal_consent_v1";
const LEGAL_OPERATOR_NAME = "智慧校园平台运营方";
const LEGAL_CONTACT = "请通过平台管理员或个人中心反馈渠道联系";
let renderShellVersion = 0;
let dashboardGreetingTimer = null;
let loginParticleCleanup = null;
let authView = "intro";
let notificationBadgeTimer = null;
const YOUTH_THEME_STORAGE_KEY = "smart_campus_youth_theme_v1";
const YOUTH_MUSIC_STORAGE_KEY = "smart_campus_youth_music_v1";
let youthAudio = null;

const youthThemes = {
  spring: {
    label: "春", icon: "✿", track: "春日来信", accent: "#ff8fb5",
    eyebrow: "SPRING · 花开有信",
    title: "花开正好，<br /><em>去遇见新的故事。</em>",
    summary: "春风翻开新一页，课程、朋友和期待都在慢慢发芽。",
    particle: "petal"
  },
  summer: {
    label: "夏", icon: "☀", track: "盛夏微风", accent: "#b9dc39",
    eyebrow: "SUMMER · 蝉鸣与风",
    title: "蝉鸣越过树梢，<br /><em>青春正好。</em>",
    summary: "学习、成长、朋友与热爱，都在这个夏天发生。",
    particle: "leaf"
  },
  autumn: {
    label: "秋", icon: "◆", track: "银杏小路", accent: "#f3aa37",
    eyebrow: "AUTUMN · 风有回信",
    title: "落叶写下秋天，<br /><em>收获正在发生。</em>",
    summary: "把认真收藏进每一页，也把温暖留在并肩走过的路上。",
    particle: "leaf"
  },
  winter: {
    label: "冬", icon: "❄", track: "初雪晚灯", accent: "#a7d8ff",
    eyebrow: "WINTER · 初雪如约",
    title: "雪落在肩头，<br /><em>灯火照亮归途。</em>",
    summary: "冬日很长，但教室的灯、朋友的笑和新的目标一直温暖。",
    particle: "snow"
  },
  sunset: {
    label: "夕阳", icon: "◒", track: "橘色晚风", accent: "#ff8a55",
    eyebrow: "SUNSET · 今日高光",
    title: "奔跑吧，<br /><em>趁晚霞还在。</em>",
    summary: "课程结束以后，操场、社团和热爱让今天继续闪光。",
    particle: "petal"
  },
  starry: {
    label: "星空", icon: "✦", track: "星河入梦", accent: "#9ca8ff",
    eyebrow: "STARRY · 梦在发光",
    title: "抬头看，<br /><em>梦正在发光。</em>",
    summary: "在星空下许下愿望，在每一次学习与探索里靠近未来。",
    particle: "star"
  }
};

function automaticYouthTheme(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 18 || hour < 5) return "starry";
  if (hour >= 16) return "sunset";
  const month = now.getMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function youthThemePreference() {
  const stored = localStorage.getItem(YOUTH_THEME_STORAGE_KEY) || "auto";
  return stored === "auto" || youthThemes[stored] ? stored : "auto";
}

function activeYouthTheme() {
  const preference = youthThemePreference();
  return preference === "auto" ? automaticYouthTheme() : preference;
}

function setYouthTheme(preference) {
  const wasPlaying = Boolean(youthAudio);
  localStorage.setItem(YOUTH_THEME_STORAGE_KEY, preference);
  renderIntro();
  if (wasPlaying) {
    startYouthAudio(activeYouthTheme());
    updateYouthRadio(activeYouthTheme());
  }
}

const moduleGroups = [
  {
    title: "总览",
    items: [{ id: "dashboard", label: "首页", icon: "home", desc: "校园服务总览" }]
  },
  {
    title: "教学服务",
    items: [
      { id: "timetable", label: "课表查询", icon: "calendar", desc: "智能课程表与外部导入" },
      { id: "progress", label: "成绩查询", icon: "chart", desc: "课程成绩与学业进度" },
      { id: "rooms", label: "空教室查询", icon: "door", desc: "自习空间快速检索" },
      { id: "exams", label: "考试报名", icon: "award", desc: "证书、竞赛与报名时间" },
      { id: "labs", label: "实验室预约", icon: "lab", desc: "实验室、设备与维修" },
      { id: "lab-approval", label: "预约审批", icon: "award", desc: "管理员审核实验室预约", adminOnly: true }
    ]
  },
  {
    title: "校园生活",
    items: [
      { id: "library", label: "图书馆服务", icon: "library", desc: "座位、研讨室与楼层图" },
      { id: "canteen", label: "食堂点餐", icon: "bowl", desc: "点餐、支付与配送点" },
      { id: "events", label: "校园活动", icon: "gift", desc: "活动报名与社团安排" },
      { id: "news", label: "校园资讯", icon: "news", desc: "官网、学院与社团动态" }
    ]
  },
  {
    title: "学习与工作",
    items: [
      { id: "ai", label: "AI 助手", icon: "sparkles", desc: "问答、写作、资料分析" },
      { id: "tools", label: "学习工具中心", icon: "toolbox", desc: "文档互转、计算、翻译、综测核算" },
      { id: "software", label: "软件库", icon: "grid", desc: "学习办公与开发软件" }
    ]
  },
  {
    title: "个人服务",
    items: [
      { id: "profile", label: "个人中心", icon: "user", desc: "账号、认证、支付绑定" }
    ]
  },
  {
    title: "权限管理",
    items: [
      { id: "student-admin", label: "学生身份库", icon: "database", desc: "学生、老师与管理员账号管理", adminOnly: true },
      { id: "class-timetable-admin", label: "班级课表导入", icon: "calendar", desc: "管理员按班级集中发布课表", adminOnly: true },
      { id: "ai-admin", label: "AI 模型配置", icon: "settings", desc: "AI 助手与课表 OCR 服务配置", adminOnly: true, superAdminOnly: true }
    ]
  }
];

const navItems = moduleGroups.flatMap((group) => group.items);
function canAccessStudentAdmin() {
  return ["admin", "super_admin"].includes(state.user?.role);
}

function isSuperAdmin() {
  return state.user?.role === "super_admin";
}

function canAccessModule(item) {
  if (item.superAdminOnly) return isSuperAdmin();
  if (item.adminOnly) return canAccessStudentAdmin();
  return true;
}

function visibleModuleGroups() {
  return moduleGroups
    .map((group) => ({ ...group, items: group.items.filter(canAccessModule) }))
    .filter((group) => group.items.length);
}

function iconSvg(name) {
  const icons = {
    home: `<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />`,
    calendar: `<path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />`,
    chart: `<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8" />`,
    door: `<path d="M6 20h12M8 20V5a1 1 0 0 1 1-1h8v16M13 12h.01" />`,
    award: `<circle cx="12" cy="8" r="4" /><path d="m8.8 11.2-1.3 6.3L12 15l4.5 2.5-1.3-6.3" />`,
    lab: `<path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3M8 15h8" />`,
    library: `<path d="M4 19V5M8 19V5M12 19V5M16 19V5M20 19V5M3 19h18" />`,
    bowl: `<path d="M4 12h16a8 8 0 0 1-16 0Z" /><path d="M7 12c0-2 2-2 2-4M12 12c0-2 2-2 2-4M17 12c0-2 2-2 2-4" />`,
    gift: `<path d="M20 12v8H4v-8M3 8h18v4H3zM12 8v12M8 8a2 2 0 1 1 4 0M16 8a2 2 0 1 0-4 0" />`,
    sparkles: `<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8zM19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z" />`,
    news: `<path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2z" /><path d="M8 8h7M8 12h7M8 16h4" />`,
    toolbox: `<path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12h16M12 12v3" />`,
    grid: `<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />`,
    user: `<circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />`,
    database: `<ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />`,
    settings: `<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.08a1.8 1.8 0 0 0-1.18-1.65 1.8 1.8 0 0 0-1.98.36l-.05.05a2.1 2.1 0 0 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-1.98 1.8 1.8 0 0 0-1.65-1.1H3a2.1 2.1 0 0 1 0-4.2h.08a1.8 1.8 0 0 0 1.65-1.18 1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.1 2.1 0 0 1 7.29 3.2l.05.05a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.42 2H10.5a2.1 2.1 0 0 1 4.2 0v.08a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05a2.1 2.1 0 0 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 1.98A1.8 1.8 0 0 0 22 9.42H22a2.1 2.1 0 0 1 0 4.2h-.08a1.8 1.8 0 0 0-1.65 1.1Z" />`,
    menu: `<path d="M4 7h16M4 12h16M4 17h16" />`,
    search: `<circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" />`,
    sun: `<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />`,
    moon: `<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />`,
    file: `<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" />`,
    calculator: `<rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8v3H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />`,
    languages: `<path d="M4 5h8M8 3v2M6 9c1.6 2.4 3.4 4 6 5M11 5c-.7 4-2.8 7-6 9M14 20l4-9 4 9M15.5 17h5" />`,
    copy: `<rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />`,
    refresh: `<path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />`,
    chevron: `<path d="m6 9 6 6 6-6" />`
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
}

function setUnreadNotificationCount(count) {
  const nextCount = Math.max(0, Number(count || 0));
  state.unreadNotifications = nextCount;
  document.querySelectorAll(".bell-count").forEach((node) => {
    node.textContent = String(nextCount);
    node.hidden = nextCount === 0;
  });
  document.querySelectorAll(".bell-dot").forEach((node) => {
    node.hidden = nextCount === 0;
  });
}

async function refreshUnreadNotificationCount() {
  if (!state.token || !state.user) return;
  try {
    const data = await api("/api/notifications");
    const unreadCount = (data.notifications || []).filter((item) => !item.read).length;
    setUnreadNotificationCount(unreadCount);
  } catch (error) {
    // Keep the last known badge when the network is temporarily unavailable.
  }
}

function startNotificationBadgeSync() {
  if (notificationBadgeTimer || !state.token) return;
  notificationBadgeTimer = setInterval(refreshUnreadNotificationCount, 15000);
}

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

function loadCommandRecent() {
  try {
    const stored = JSON.parse(localStorage.getItem(COMMAND_CENTER_STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveCommandRecent(commandId) {
  if (!commandId) return;
  const next = [commandId, ...loadCommandRecent().filter((id) => id !== commandId)].slice(0, 8);
  localStorage.setItem(COMMAND_CENTER_STORAGE_KEY, JSON.stringify(next));
}

function commandCenterCommands() {
  const moduleCommands = visibleModuleGroups().flatMap((group) => group.items.map((item) => ({
    id: `route:${item.id}`,
    route: item.id,
    label: item.label,
    desc: item.desc,
    group: group.title,
    icon: item.icon,
    keywords: `${item.label} ${item.desc} ${group.title} ${item.id}`
  })));
  const extraCommands = [
    { id: "tool:quality-score", route: "tools/quality-score", label: "综测核算", desc: "按细则核算综合素质测评分", group: "学习工具", icon: "award", keywords: "综测 综合素质 测评 核算 加分 扣分" },
    { id: "tool:calculator", route: "tools/calculator", label: "全能计算器", desc: "成绩、时间、比例和常用数值计算", group: "学习工具", icon: "calculator", keywords: "计算器 成绩 绩点 比例" },
    { id: "tool:translate", route: "tools/translate", label: "语言翻译", desc: "中英互译和学习文本处理", group: "学习工具", icon: "languages", keywords: "翻译 英语 中文 语言" },
    { id: "tool:doc-convert", route: "tools/doc-convert", label: "文档互转", desc: "文档格式转换与整理", group: "学习工具", icon: "file", keywords: "文档 word pdf excel 转换" },
    { id: "action:add-course", route: "timetable", label: "添加课程", desc: "进入课表后点击空白格添加或修改课程", group: "快捷操作", icon: "calendar", keywords: "添加课程 修改课程 删除课程 课表" },
    { id: "action:import-timetable", route: "timetable", label: "导入课表", desc: "支持 Excel 和图片识别导入个人课表", group: "快捷操作", icon: "file", keywords: "导入课表 图片 OCR Excel" },
    { id: "action:reserve-lab", route: "labs", label: "预约实验室", desc: "提交实验室预约并等待管理员审批", group: "快捷操作", icon: "lab", keywords: "实验室预约 预约 申请" },
    { id: "action:notifications", route: "notifications", label: "查看未读消息", desc: `${state.unreadNotifications || 0} 条未读通知`, group: "快捷操作", icon: "news", keywords: "消息 通知 未读 铃铛" },
    { id: "action:ai-config", route: "ai", label: "配置个人 AI", desc: "在 AI 助手右侧填写自己的 API Key", group: "快捷操作", icon: "sparkles", keywords: "AI API Key 模型 配置" },
    { id: "admin:student", route: "student-admin", label: "学生身份库", desc: "维护学生、老师、管理员账号", group: "权限管理", icon: "database", keywords: "学生身份库 账号 管理员 老师 学生" },
    { id: "admin:class-timetable", route: "class-timetable-admin", label: "班级课表导入", desc: "管理员按班级集中发布课表", group: "权限管理", icon: "calendar", keywords: "班级课表 管理员 集中导入" },
    { id: "admin:lab-approval", route: "lab-approval", label: "预约审批", desc: "管理员审批实验室预约申请", group: "教学服务", icon: "award", keywords: "实验室 审批 管理员 预约审批" }
  ].filter((item) => {
    const module = navItems.find((nav) => nav.id === item.route);
    return !module || canAccessModule(module);
  });
  const seen = new Set();
  return [...moduleCommands, ...extraCommands].filter((item) => {
    if (seen.has(item.route) && !item.id.startsWith("action:")) return false;
    seen.add(item.route);
    return true;
  });
}

function commandRecommendationIds() {
  const hour = new Date().getHours();
  if (hour < 11) return ["route:timetable", "action:notifications", "tool:quality-score", "route:ai"];
  if (hour < 17) return ["action:reserve-lab", "tool:calculator", "route:software", "route:news"];
  return ["route:ai", "tool:quality-score", "route:news", "action:notifications"];
}

function scoreCommand(command, keyword, recentIds, recommendedIds) {
  let score = 0;
  const text = `${command.label} ${command.desc} ${command.group} ${command.keywords}`.toLowerCase();
  if (!keyword) score += recommendedIds.includes(command.id) ? 30 : 0;
  if (recentIds.includes(command.id)) score += 60 - recentIds.indexOf(command.id) * 5;
  if (recommendedIds.includes(command.id)) score += 24;
  if (command.route === state.route || (command.route === "tools" && state.route.startsWith("tools/"))) score += 6;
  if (keyword) {
    if (command.label.toLowerCase().includes(keyword)) score += 90;
    if (text.includes(keyword)) score += 45;
    keyword.split(/\s+/).filter(Boolean).forEach((part) => {
      if (text.includes(part)) score += 12;
    });
  }
  return score;
}

function getCommandCenterResults(keyword = "") {
  const normalized = keyword.trim().toLowerCase();
  const recentIds = loadCommandRecent();
  const recommendedIds = commandRecommendationIds();
  return commandCenterCommands()
    .map((command) => ({ ...command, score: scoreCommand(command, normalized, recentIds, recommendedIds) }))
    .filter((command) => !normalized || command.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh-CN"))
    .slice(0, normalized ? 10 : 9);
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
const AI_PANEL_SCHEMA = "real-server-ai-v25-20260614";
const AI_CONFIG_KEY = "smart_campus_ai_config_panel_v2";
const AI_MESSAGES_KEY = "smart_campus_ai_messages_panel_v2";
const AI_CONVERSATIONS_KEY = "smart_campus_ai_conversations_v1";
const AI_ACTIVE_CONVERSATION_KEY = "smart_campus_ai_active_conversation_v1";
const AI_TRASH_KEY = "smart_campus_ai_conversation_trash_v1";
const COMMAND_CENTER_STORAGE_KEY = "smart_campus_command_recent_v1";
const app = document.querySelector("#app");

function aiConversationId() {
  return globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadAiConversations() {
  let conversations = [];
  try {
    conversations = JSON.parse(localStorage.getItem(AI_CONVERSATIONS_KEY) || "[]");
  } catch {
    conversations = [];
  }
  if (!Array.isArray(conversations)) conversations = [];
  if (!conversations.length) {
    let legacyMessages = [];
    try {
      legacyMessages = JSON.parse(localStorage.getItem(AI_MESSAGES_KEY) || "[]");
    } catch {
      legacyMessages = [];
    }
    const now = new Date().toISOString();
    conversations = [{
      id: aiConversationId(),
      title: legacyMessages.find((item) => item.role === "user")?.text?.slice(0, 24) || "新对话",
      messages: Array.isArray(legacyMessages) ? legacyMessages : [],
      createdAt: now,
      updatedAt: now
    }];
    localStorage.setItem(AI_CONVERSATIONS_KEY, JSON.stringify(conversations));
  }
  return conversations.slice(0, 50);
}

function saveAiConversations(conversations) {
  localStorage.setItem(AI_CONVERSATIONS_KEY, JSON.stringify(conversations.slice(0, 50)));
}

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
const TIMETABLE_SETTINGS_KEY = "smart_taiyuan_timetable_settings_v1";
const TIMETABLE_HIDDEN_KEY = "smart_taiyuan_timetable_hidden_v1";
const TIMETABLE_IMAGE_KEY = "smart_taiyuan_timetable_image_v1";
const TIMETABLE_SEMESTERS = ["2025-2026学年第二学期", "2025-2026学年第一学期", "2026-2027学年第一学期"];
const TIMETABLE_WEEKS = Array.from({ length: 20 }, (_, index) => index + 1);
const TIMETABLE_DEFAULT_WEEK_ONE_START = "2026-02-23";
const TIMETABLE_SCHEDULES = {
  summer: ["08:00", "08:50", "09:50", "10:40", "11:30", "14:30", "15:20", "16:20", "17:10", "19:00", "19:50", "20:40"],
  winter: ["08:00", "08:50", "09:50", "10:40", "11:30", "14:00", "14:50", "15:50", "16:40", "19:00", "19:50", "20:40"]
};
const TIMETABLE_COLORS = ["teal", "blue", "violet", "orange", "green", "rose"];

function getTimetableSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(TIMETABLE_SETTINGS_KEY) || "{}");
    return {
      semester: TIMETABLE_SEMESTERS.includes(stored.semester) ? stored.semester : TIMETABLE_SEMESTERS[0],
      week: Math.min(20, Math.max(1, Number(stored.week || 17))),
      schedule: stored.schedule === "winter" ? "winter" : "summer",
      weekOneStart: /^\d{4}-\d{2}-\d{2}$/.test(String(stored.weekOneStart || "")) ? stored.weekOneStart : TIMETABLE_DEFAULT_WEEK_ONE_START
    };
  } catch (error) {
    return { semester: TIMETABLE_SEMESTERS[0], week: 17, schedule: "summer", weekOneStart: TIMETABLE_DEFAULT_WEEK_ONE_START };
  }
}

function saveTimetableSettings(patch) {
  localStorage.setItem(TIMETABLE_SETTINGS_KEY, JSON.stringify({ ...getTimetableSettings(), ...patch }));
}

async function persistTimetableSettings(patch) {
  saveTimetableSettings(patch);
  if (!state.user || state.user.role === "guest") return getTimetableSettings();
  const result = await api("/api/timetable/settings", {
    method: "POST",
    body: JSON.stringify(patch)
  });
  const settings = result.settings || {};
  saveTimetableSettings(Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== "" && value !== 0)));
  return getTimetableSettings();
}

function timetableHiddenKey() {
  const userKey = state.user?.studentNo || state.user?.id || "guest";
  return `${TIMETABLE_HIDDEN_KEY}_${userKey}`;
}

function getLocalHiddenCourseIds() {
  try {
    return JSON.parse(localStorage.getItem(timetableHiddenKey()) || "[]").map(String);
  } catch (error) {
    return [];
  }
}

function saveLocalHiddenCourseIds(ids) {
  localStorage.setItem(timetableHiddenKey(), JSON.stringify([...new Set(ids.map(String))]));
}

function parseWeeks(value) {
  if (Array.isArray(value)) return value.map(Number).filter((week) => week >= 1 && week <= 20);
  const text = String(value || "").trim();
  if (!text || text === "全部" || text === "1-20") return TIMETABLE_WEEKS;
  const weeks = new Set();
  text.replace(/周/g, "").split(/[,\uFF0C、\s]+/).filter(Boolean).forEach((part) => {
    const range = part.split(/[-~至]/).map((item) => Number(item.trim()));
    if (range.length >= 2 && range[0] && range[1]) {
      const start = Math.min(range[0], range[1]);
      const end = Math.max(range[0], range[1]);
      for (let week = start; week <= end; week += 1) {
        if (week >= 1 && week <= 20) weeks.add(week);
      }
    } else {
      const week = Number(part);
      if (week >= 1 && week <= 20) weeks.add(week);
    }
  });
  return weeks.size ? [...weeks].sort((a, b) => a - b) : TIMETABLE_WEEKS;
}

function formatWeeks(weeks = TIMETABLE_WEEKS) {
  const list = parseWeeks(weeks);
  if (list.length === 20) return "1-20周";
  const ranges = [];
  let start = list[0];
  let previous = list[0];
  for (let index = 1; index <= list.length; index += 1) {
    if (list[index] === previous + 1) {
      previous = list[index];
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = list[index];
    previous = list[index];
  }
  return `${ranges.join("、")}周`;
}

function sectionFromTime(time) {
  const minutes = minutesOf(time);
  if (!minutes) return 1;
  const allStarts = TIMETABLE_SCHEDULES.summer.map((item, index) => ({ index: index + 1, value: minutesOf(item) }))
    .concat(TIMETABLE_SCHEDULES.winter.map((item, index) => ({ index: index + 1, value: minutesOf(item) })));
  return allStarts.reduce((best, item) => Math.abs(item.value - minutes) < Math.abs(best.value - minutes) ? item : best, allStarts[0]).index;
}

function normalizeCourseRecord(course, index = 0) {
  const { startSection, sectionCount } = normalizeTimetablePlacement(course, { fallbackStart: sectionFromTime(course.time) });
  const normalized = {
    ...course,
    id: course.id || `course-${Date.now()}-${index}`,
    day: normalizeDay(course.day || course.weekday || course["星期"]),
    semester: course.semester || course["学期"] || TIMETABLE_SEMESTERS[0],
    weeks: parseWeeks(course.weeks || course.week || course["周次"]),
    startSection,
    sectionCount,
    course: course.course || course.title || course.name || course["课程名称"] || course["课程"] || "",
    location: course.location || course.room || course["上课地点"] || course["地点"] || course["教室"] || "",
    teacher: course.teacher || course["任课教师"] || course["教师"] || course["老师"] || "",
    note: course.note || course.remark || course["备注"] || "",
    source: course.source || "自定义课表"
  };
  return {
    ...normalized,
    time: normalized.time || courseTimeLabel(normalized, getTimetableSettings().schedule),
    color: normalized.color || TIMETABLE_COLORS[Math.abs(String(normalized.course).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % TIMETABLE_COLORS.length]
  };
}

function getStoredCourses() {
  try {
    return JSON.parse(localStorage.getItem(timetableStorageKey()) || "[]").map((course) => ({
      ...normalizeCourseRecord(course),
      day: normalizeDay(course.day)
    }));
  } catch (error) {
    return [];
  }
}

function saveStoredCourses(courses) {
  localStorage.setItem(timetableStorageKey(), JSON.stringify(courses));
}

function timetableStorageKey() {
  const userKey = state.user?.studentNo || state.user?.id || "guest";
  return `${TIMETABLE_STORAGE_KEY}_${userKey}`;
}

function courseSignature(course = {}) {
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

function mergeCourseLists(...lists) {
  const seen = new Set();
  return lists.flat().filter(Boolean).map((course, index) => normalizeCourseRecord(course, index)).filter((course) => {
    const key = courseSignature(course);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function timetableCourseGradient(course, paletteIndex = 0) {
  const palette = [
    ["#149f9a", "#2670a4", "#58d2cd", "rgba(30, 166, 169, .18)"],
    ["#2573cf", "#264aa2", "#75b4ff", "rgba(48, 112, 216, .18)"],
    ["#715dd5", "#9953ba", "#b69bff", "rgba(126, 91, 214, .18)"],
    ["#d88b35", "#bd6260", "#ffc078", "rgba(211, 120, 67, .18)"],
    ["#299a67", "#23849a", "#6edaa7", "rgba(42, 151, 118, .18)"],
    ["#c15283", "#6f5bcd", "#f28eb6", "rgba(173, 83, 154, .18)"],
    ["#178ba8", "#3464b8", "#69cce0", "rgba(36, 133, 181, .18)"],
    ["#405fb8", "#7655c7", "#91a9ff", "rgba(77, 91, 194, .18)"],
    ["#b77939", "#a95573", "#e7a86b", "rgba(177, 103, 72, .18)"],
    ["#2d8b78", "#456fbd", "#74d1bb", "rgba(48, 133, 132, .18)"],
    ["#8b5bb2", "#4a6cb7", "#c195df", "rgba(111, 91, 183, .18)"],
    ["#3b789d", "#2a9a91", "#79bfd2", "rgba(45, 133, 153, .18)"],
    ["#4f82bd", "#326e91", "#89b8e8", "rgba(59, 119, 164, .18)"],
    ["#5e65bd", "#3b8b9b", "#929be6", "rgba(73, 113, 181, .18)"],
    ["#a5668f", "#6967b7", "#d39abb", "rgba(139, 92, 157, .18)"],
    ["#347f68", "#397da2", "#79bda2", "rgba(49, 126, 119, .18)"],
    ["#b06f48", "#8c617f", "#dfa078", "rgba(158, 99, 92, .18)"],
    ["#397aa7", "#5964b4", "#7db4dc", "rgba(67, 111, 173, .18)"],
    ["#317f8d", "#5d6ba9", "#78bdc4", "rgba(57, 119, 151, .18)"],
    ["#6974b6", "#477f91", "#a1a8dc", "rgba(83, 116, 166, .18)"]
  ];
  const colors = palette[Math.abs(Number(paletteIndex) || 0) % palette.length];
  return [
    `--course-start:${colors[0]}`,
    `--course-end:${colors[1]}`,
    `--course-accent:${colors[2]}`,
    `--course-glow:${colors[3]}`
  ].join(";");
}

function currentPersonalCourses() {
  return Array.isArray(window.__personalTimetableCourses) ? window.__personalTimetableCourses : getStoredCourses();
}

async function replacePersonalCourses(courses) {
  const cleanCourses = mergeCourseLists(courses);
  if (!state.user || state.user.role === "guest") {
    saveStoredCourses(cleanCourses);
    window.__personalTimetableCourses = cleanCourses;
    return cleanCourses;
  }
  const result = await api("/api/timetable/personal", {
    method: "POST",
    body: JSON.stringify({ courses: cleanCourses })
  });
  const syncedCourses = mergeCourseLists(result.courses || cleanCourses);
  window.__personalTimetableCourses = syncedCourses;
  saveStoredCourses([]);
  return syncedCourses;
}

async function upsertPersonalCourse(course) {
  if (!state.user || state.user.role === "guest") {
    saveLocalHiddenCourseIds(getLocalHiddenCourseIds().filter((id) => id !== String(course.id)));
    const courses = currentPersonalCourses();
    const nextCourses = course.id && courses.some((item) => item.id === course.id)
      ? courses.map((item) => (item.id === course.id ? { ...item, ...course } : item))
      : [...courses, course];
    return replacePersonalCourses(nextCourses);
  }
  const result = await api("/api/timetable/personal/course", {
    method: "POST",
    body: JSON.stringify({ course })
  });
  const syncedCourses = mergeCourseLists(result.courses || []);
  window.__personalTimetableCourses = syncedCourses;
  saveStoredCourses([]);
  return syncedCourses;
}

async function deletePersonalCourse(id) {
  if (!state.user || state.user.role === "guest") {
    saveLocalHiddenCourseIds([...getLocalHiddenCourseIds(), id]);
    return replacePersonalCourses(currentPersonalCourses().filter((item) => item.id !== id));
  }
  const result = await api("/api/timetable/personal/delete", {
    method: "POST",
    body: JSON.stringify({ id })
  });
  const syncedCourses = mergeCourseLists(result.courses || []);
  window.__personalTimetableCourses = syncedCourses;
  window.__hiddenTimetableCourseIds = (result.hiddenCourseIds || []).map(String);
  saveStoredCourses([]);
  return syncedCourses;
}

function getTimetableImage() {
  try {
    return JSON.parse(localStorage.getItem(TIMETABLE_IMAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function saveTimetableImage(image) {
  localStorage.setItem(TIMETABLE_IMAGE_KEY, JSON.stringify(image));
}

function clearTimetableImage() {
  localStorage.removeItem(TIMETABLE_IMAGE_KEY);
}

function compressTimetableImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片格式无法识别"));
      image.onload = () => {
        const maxWidth = 1100;
        const maxHeight = 1800;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          name: file.name,
          importedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          width: canvas.width,
          height: canvas.height,
          dataUrl: canvas.toDataURL("image/jpeg", 0.82)
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

function initYouthAtmosphere(themeId) {
  stopLoginParticles();
  const canvas = document.querySelector("#youthAtmosphere");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const kind = youthThemes[themeId].particle;
  const palette = {
    spring: ["#ffd1e2", "#ff9fc4", "#fff0f7"],
    summer: ["#ffffff", "#d7f5d0", "#f4ffdc"],
    autumn: ["#f6b43b", "#e8712c", "#ffd56b"],
    winter: ["#ffffff", "#dff4ff", "#bfe4ff"],
    sunset: ["#ffc2b4", "#ff8b83", "#ffe0c7"],
    starry: ["#eef1ff", "#aebdff", "#fff2b9"]
  }[themeId];
  const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  const pointerMotion = { x: 0, y: 0, lastX: innerWidth / 2, lastY: innerHeight / 2 };
  let width = 0;
  let height = 0;
  let frame = 0;
  let motes = [];

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = reducedMotion ? 18 : Math.min(64, Math.max(30, Math.round(width / 24)));
    motes = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1.5 + Math.random() * (kind === "snow" ? 4 : 7),
      speed: (themeId === "autumn" ? 0.4 : 0.18) + Math.random() * (themeId === "winter" ? 0.7 : 0.58),
      drift: (themeId === "summer" ? 0.18 : -0.15) + (Math.random() - 0.5) * 0.7,
      spin: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.6,
      depth: 0.45 + Math.random() * 1.1,
      color: palette[index % palette.length],
      phase: Math.random() * Math.PI * 2
    }));
  };

  const drawMote = (mote) => {
    context.save();
    context.translate(mote.x, mote.y);
    context.rotate(mote.spin);
    context.globalAlpha = mote.alpha;
    if (themeId === "starry") {
      context.fillStyle = mote.color;
      context.shadowColor = mote.color;
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(0, 0, Math.max(0.8, mote.size / 4), 0, Math.PI * 2);
      context.fill();
      context.fillRect(-mote.size, -0.35, mote.size * 2, 0.7);
      context.fillRect(-0.35, -mote.size, 0.7, mote.size * 2);
    } else if (themeId === "winter") {
      context.fillStyle = mote.color;
      context.shadowColor = "#d8efff";
      context.shadowBlur = 8;
      context.beginPath();
      context.arc(0, 0, Math.max(1, mote.size / 3), 0, Math.PI * 2);
      context.fill();
    } else if (themeId === "summer") {
      context.strokeStyle = mote.color;
      context.lineWidth = 0.7;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(mote.size * 1.35, mote.size * 1.35);
      context.stroke();
      context.fillStyle = mote.color;
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI * 2 * index) / 6;
        context.beginPath();
        context.arc(Math.cos(angle) * mote.size * .55, Math.sin(angle) * mote.size * .55, .65, 0, Math.PI * 2);
        context.fill();
      }
    } else if (themeId === "autumn") {
      context.fillStyle = mote.color;
      context.beginPath();
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const radius = index % 2 ? mote.size * .45 : mote.size;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    } else {
      context.fillStyle = mote.color;
      context.beginPath();
      context.ellipse(0, 0, mote.size, mote.size * 0.38, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    motes.forEach((mote) => {
      if (!reducedMotion) {
        const dx = mote.x - pointer.x;
        const dy = mote.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 150 && distance > 0) {
          const force = (1 - distance / 150) * .028;
          mote.x += pointerMotion.x * force + (dx / distance) * force * 8;
          mote.y += pointerMotion.y * force * .35;
        }
        mote.y += mote.speed * mote.depth;
        mote.x += mote.drift * mote.depth + Math.sin(mote.y * 0.008 + mote.phase) * (themeId === "summer" ? 0.42 : 0.25);
        mote.spin += themeId === "autumn" ? 0.025 : 0.009;
        if (mote.y > height + 20) {
          mote.y = -20;
          mote.x = Math.random() * width;
        }
      }
      drawMote(mote);
    });
    const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 230);
    glow.addColorStop(0, "rgba(255,255,255,.11)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    if (!reducedMotion && canvas.isConnected) frame = requestAnimationFrame(draw);
  };

  const move = (event) => {
    pointerMotion.x = event.clientX - pointerMotion.lastX;
    pointerMotion.y = event.clientY - pointerMotion.lastY;
    pointerMotion.lastX = event.clientX;
    pointerMotion.lastY = event.clientY;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const hero = document.querySelector(".youth-hero");
    if (hero) {
      hero.style.setProperty("--scene-x", `${((event.clientX / innerWidth) - .5) * -12}px`);
      hero.style.setProperty("--scene-y", `${((event.clientY / innerHeight) - .5) * -8}px`);
      hero.style.setProperty("--pointer-x", `${event.clientX}px`);
      hero.style.setProperty("--pointer-y", `${event.clientY}px`);
    }
  };
  resize();
  draw();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", move, { passive: true });
  loginParticleCleanup = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", move);
  };
}

function stopYouthAudio() {
  if (!youthAudio) return;
  const current = youthAudio;
  youthAudio = null;
  document.documentElement.dataset.youthMusic = "off";
  delete document.documentElement.dataset.youthTrack;
  const startVolume = current.element.volume;
  const startedAt = performance.now();
  const fade = () => {
    const progress = Math.min(1, (performance.now() - startedAt) / 420);
    current.element.volume = startVolume * (1 - progress);
    if (progress < 1) current.fadeFrame = requestAnimationFrame(fade);
    else {
      current.element.pause();
      current.element.src = "";
    }
  };
  fade();
}

function startYouthAudio(themeId) {
  const previous = youthAudio;
  if (previous?.themeId === themeId && !previous.element.paused) return;
  const element = new Audio("/assets/music/page-theme.mp3?v=custom-page-music-v128-20260620");
  element.loop = true;
  element.preload = "none";
  element.volume = 0;
  youthAudio = { element, themeId, fadeFrame: 0 };
  element.play().then(() => {
    document.documentElement.dataset.youthMusic = "playing";
    document.documentElement.dataset.youthTrack = themeId;
    const startedAt = performance.now();
    const fadeIn = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / 1100);
      element.volume = .34 * progress;
      if (progress < 1 && youthAudio?.element === element) youthAudio.fadeFrame = requestAnimationFrame(fadeIn);
    };
    fadeIn();
  }).catch(() => {
    if (youthAudio?.element === element) youthAudio = null;
    document.documentElement.dataset.youthMusic = "blocked";
    delete document.documentElement.dataset.youthTrack;
    updateYouthRadio(themeId);
  });
  if (previous) {
    const previousVolume = previous.element.volume;
    const startedAt = performance.now();
    const fadeOut = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / 900);
      previous.element.volume = previousVolume * (1 - progress);
      if (progress < 1) previous.fadeFrame = requestAnimationFrame(fadeOut);
      else {
        previous.element.pause();
        previous.element.src = "";
      }
    };
    fadeOut();
  }
  localStorage.setItem(YOUTH_MUSIC_STORAGE_KEY, "on");
}

function toggleYouthAudio(themeId) {
  if (youthAudio) {
    stopYouthAudio();
    localStorage.setItem(YOUTH_MUSIC_STORAGE_KEY, "off");
  } else {
    startYouthAudio(themeId);
  }
  updateYouthRadio(themeId);
}

function updateYouthRadio(themeId) {
  const button = document.querySelector("#youthRadioToggle");
  if (!button) return;
  button.closest(".youth-radio")?.classList.toggle("playing", Boolean(youthAudio));
  button.setAttribute("aria-label", youthAudio ? "暂停青春电台" : "播放青春电台");
  const icon = button.querySelector("[data-radio-icon]");
  if (icon) icon.textContent = youthAudio ? "Ⅱ" : "▶";
}

async function getUnifiedTimetable(sourceData = null) {
  const data = sourceData || await api("/api/timetable");
  const serverSettings = Object.fromEntries(Object.entries(data.settings || {}).filter(([, value]) => value !== "" && value !== 0));
  if (Object.keys(serverSettings).length) saveTimetableSettings(serverSettings);
  let personalCourses = mergeCourseLists(data.personalCourses || []);
  const localCourses = getStoredCourses();
  if (state.user?.role === "guest") {
    personalCourses = localCourses;
  } else if (localCourses.length) {
    personalCourses = await replacePersonalCourses(mergeCourseLists(personalCourses, localCourses));
  }
  window.__personalTimetableCourses = personalCourses;
  const hiddenCourseIds = state.user?.role === "guest"
    ? getLocalHiddenCourseIds()
    : (data.hiddenCourseIds || []).map(String);
  window.__hiddenTimetableCourseIds = hiddenCourseIds;
  const hiddenSet = new Set(hiddenCourseIds);
  // Personal records are full course overrides. Keep them first so edits such as
  // teacher and location are not hidden by the matching school timetable entry.
  const courses = mergeCourseLists(personalCourses, (data.courses || []).filter((course) => !hiddenSet.has(String(course.id))));
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
  const openModal = (course = {}) => {
    const settings = getTimetableSettings();
    const normalized = normalizeCourseRecord({
      semester: settings.semester,
      weeks: [settings.week],
      day: todayDayName(),
      startSection: 1,
      sectionCount: 2,
      ...course
    });
    if (course.id === "") normalized.id = "";
    form.elements.id.value = normalized.id || "";
    form.elements.semester.value = normalized.semester || settings.semester;
    form.elements.weeks.value = formatWeeks(normalized.weeks).replace(/周/g, "");
    form.elements.day.value = normalizeDay(normalized.day);
    form.elements.startSection.value = normalized.startSection || 1;
    form.elements.sectionCount.value = normalized.sectionCount || 2;
    form.elements.course.value = normalized.course || "";
    form.elements.location.value = normalized.location || "";
    form.elements.teacher.value = normalized.teacher || "";
    form.elements.note.value = normalized.note || "";
    form.querySelector("#deleteTimetableCourse")?.classList.toggle("hidden", !normalized.id);
    modal.classList.remove("hidden");
    form.elements.course.focus();
  };
  const findCurrentCourse = (id) => (window.__currentTimetableCourses || []).find((item) => item.id === id);
  document.querySelectorAll("[data-course-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      openModal(currentPersonalCourses().find((item) => item.id === button.dataset.courseEdit) || findCurrentCourse(button.dataset.courseEdit));
    });
  });
  document.querySelectorAll("[data-course-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const settings = getTimetableSettings();
      openModal({
        id: "",
        day: button.dataset.day,
        startSection: Number(button.dataset.section || 1),
        sectionCount: 2,
        semester: settings.semester,
        weeks: [settings.week]
      });
    });
  });
  document.querySelectorAll("[data-timetable-edit-close]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const id = String(formData.get("id") || "").trim();
    const updated = {
      id: id || `manual-${Date.now()}`,
      semester: String(formData.get("semester") || TIMETABLE_SEMESTERS[0]).trim(),
      weeks: parseWeeks(formData.get("weeks")),
      day: normalizeDay(formData.get("day")),
      startSection: Number(formData.get("startSection") || 1),
      sectionCount: Number(formData.get("sectionCount") || 2),
      course: String(formData.get("course") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      teacher: String(formData.get("teacher") || "").trim(),
      note: String(formData.get("note") || "").trim(),
      source: "手动维护"
    };
    updated.time = courseTimeLabel(updated, getTimetableSettings().schedule);
    if (!updated.course) {
      toast("请填写课程名称");
      return;
    }
    await upsertPersonalCourse(updated);
    closeModal();
    toast(id ? "课程已更新" : "课程已添加");
    renderShell();
  });
  form.querySelector("#deleteTimetableCourse")?.addEventListener("click", async () => {
    const id = form.elements.id.value;
    if (!id) return;
    await deletePersonalCourse(id);
    closeModal();
    toast("课程已删除");
    renderShell();
  });
}

function todayDayName() {
  return weekDays[(new Date().getDay() + 6) % 7];
}

function bindTimetableImportModal() {
  const modal = document.querySelector("#timetableImportModal");
  const openButton = document.querySelector("#openTimetableImport");
  if (!modal || !openButton) return;
  const closeModal = () => modal.classList.add("hidden");
  openButton.addEventListener("click", () => modal.classList.remove("hidden"));
  document.querySelector("#downloadTimetableExample")?.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = "/downloads/templates/课表导入示例.xlsx";
    link.download = "课表导入示例.xlsx";
    link.click();
  });
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

function courseTimeLabel(course, scheduleMode = "summer") {
  const starts = TIMETABLE_SCHEDULES[scheduleMode] || TIMETABLE_SCHEDULES.summer;
  const placement = normalizeTimetablePlacement(course, { fallbackCount: 1 });
  const startIndex = placement.startSection - 1;
  const endIndex = Math.min(11, startIndex + placement.sectionCount - 1);
  return `${starts[startIndex]}-${starts[endIndex]}`;
}

function courseMatchesTimetable(course, settings) {
  return (course.semester || TIMETABLE_SEMESTERS[0]) === settings.semester && parseWeeks(course.weeks).includes(Number(settings.week));
}

function dateFromIso(value) {
  const [year, month, day] = String(value || TIMETABLE_DEFAULT_WEEK_ONE_START).split("-").map(Number);
  return new Date(year || 2026, (month || 2) - 1, day || 23);
}

function dayDateLabels(selectedWeek, weekOneStart = TIMETABLE_DEFAULT_WEEK_ONE_START) {
  const baseMonday = dateFromIso(weekOneStart);
  const monday = new Date(baseMonday);
  monday.setDate(baseMonday.getDate() + (Number(selectedWeek) - 1) * 7);
  return weekDays.map((day, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return {
      day,
      date: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
    };
  });
}

function bindTimetableControls() {
  const semester = document.querySelector("#timetableSemester");
  const week = document.querySelector("#timetableWeek");
  const weekOneStart = document.querySelector("#timetableWeekOneStart");
  const saveWeekOneStart = document.querySelector("#saveTimetableWeekOneStart");
  const addButton = document.querySelector("#addTimetableCourse");
  semester?.addEventListener("change", async () => {
    await persistTimetableSettings({ semester: semester.value });
    renderShell();
  });
  week?.addEventListener("change", async () => {
    await persistTimetableSettings({ week: Number(week.value) });
    renderShell();
  });
  weekOneStart?.addEventListener("change", async () => {
    await persistTimetableSettings({ weekOneStart: weekOneStart.value || TIMETABLE_DEFAULT_WEEK_ONE_START });
    toast("第一周起始日期已更新");
    renderShell();
  });
  saveWeekOneStart?.addEventListener("click", () => {
    weekOneStart?.dispatchEvent(new Event("change"));
  });
  document.querySelectorAll("[data-timetable-week-step]").forEach((button) => {
    button.addEventListener("click", async () => {
      const settings = getTimetableSettings();
      const next = Math.min(20, Math.max(1, settings.week + Number(button.dataset.timetableWeekStep)));
      await persistTimetableSettings({ week: next });
      renderShell();
    });
  });
  document.querySelectorAll("[data-timetable-schedule]").forEach((button) => {
    button.addEventListener("click", async () => {
      await persistTimetableSettings({ schedule: button.dataset.timetableSchedule });
      renderShell();
    });
  });
  addButton?.addEventListener("click", () => {
    document.querySelector("[data-course-add]")?.click();
  });
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

function softwareInitials(name = "") {
  const text = String(name).trim();
  const latin = text.match(/[A-Za-z0-9]+/g);
  if (latin?.length) return latin.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return text.slice(0, 2) || "软";
}

function softwareAccent(item = {}) {
  const palette = ["#2f8cff", "#18b7a7", "#7c5cff", "#f59f31", "#e7587a", "#28a6d6"];
  const seed = String(item.name || item.category || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[seed % palette.length];
}

function softwareIconMarkup(item = {}, size = "card") {
  const initials = escapeHtml(softwareInitials(item.name));
  const accent = escapeHtml(softwareAccent(item));
  const icon = item.icon ? escapeHtml(item.icon) : "";
  const fallback = `<span class="software-icon-fallback" style="--software-accent:${accent}">${initials}</span>`;
  if (!icon) return fallback;
  return `<img src="${icon}" alt="${escapeHtml(item.name)} 图标" loading="lazy" referrerpolicy="no-referrer" data-software-icon="${size}" data-fallback="${initials}" data-accent="${accent}" />${fallback}`;
}

function bindSoftwareIconFallbacks(root = document) {
  root.querySelectorAll("img[data-software-icon]").forEach((img) => {
    const fallback = img.nextElementSibling;
    const showFallback = () => {
      img.hidden = true;
      if (fallback?.classList.contains("software-icon-fallback")) fallback.hidden = false;
    };
    if (fallback?.classList.contains("software-icon-fallback")) fallback.hidden = true;
    img.addEventListener("error", showFallback, { once: true });
    if (img.complete && img.naturalWidth === 0) showFallback();
  });
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
    cache: options.cache || "no-store",
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

function showRequiredPasswordSetup() {
  if (!state.user || state.user.role === "guest" || state.user.hasPassword || document.querySelector("#requiredPasswordSetup")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="required-password-modal" id="requiredPasswordSetup">
      <form class="required-password-card" id="requiredPasswordForm">
        <div>
          <span>首次手机号登录</span>
          <h2>请设置登录密码</h2>
          <p>完成设置后，后续即可使用已绑定手机号和密码登录。</p>
        </div>
        <label class="field"><span>新密码</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位，包含字母和数字" required /></label>
        <label class="field"><span>确认新密码</span><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></label>
        <button class="primary-btn" type="submit">设置密码并继续</button>
        <button class="ghost-btn" id="requiredPasswordLogout" type="button">退出登录</button>
      </form>
    </div>
  `);
  document.querySelector("#requiredPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirmPassword")) {
      toast("两次输入的密码不一致");
      return;
    }
    try {
      const result = await api("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ password: form.get("password") })
      });
      state.user = result.user;
      document.querySelector("#requiredPasswordSetup")?.remove();
      toast("密码设置成功");
      renderShell();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector("#requiredPasswordLogout").addEventListener("click", () => {
    state.token = "";
    state.user = null;
    localStorage.removeItem("smart_taiyuan_token");
    document.querySelector("#requiredPasswordSetup")?.remove();
    authView = "login";
    renderLogin();
  });
}

async function adminApi(path, options = {}) {
  return api(path, options);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",").pop());
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function accountRoleLabel(role) {
  return { super_admin: "总管理员", admin: "普通管理员", teacher: "老师", student: "学生", guest: "游客" }[role] || role;
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
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    state.sidebarScrollTop = sidebar.scrollTop;
    sessionStorage.setItem("smart_campus_sidebar_scroll", String(state.sidebarScrollTop));
  }
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
  if (String(event.key || "").startsWith(TIMETABLE_STORAGE_KEY) && ["dashboard", "timetable"].includes(state.route)) {
    renderShell();
  }
  if (event.key === THEME_STORAGE_KEY) {
    applyTheme(preferredTheme());
    renderShell();
  }
});

function legalDocumentMarkup(type) {
  if (type === "privacy") {
    return `
      <article class="legal-document">
        <p class="legal-document-note">版本：${LEGAL_CONSENT_VERSION} · 生效日期：2026年6月20日</p>
        <h3>智慧校园隐私政策</h3>
        <p>本政策说明 ${LEGAL_OPERATOR_NAME} 如何处理你在使用本平台时提交或产生的个人信息。我们遵循合法、正当、必要、诚信和最小化原则，不以同意一揽子处理非必要信息作为提供基础服务的条件。</p>
        <h4>一、我们处理的信息</h4>
        <p>1. 校园身份信息：姓名、学校、学院或专业、学号或工号、手机号、账号角色和认证状态，用于核验身份、登录和权限控制。</p>
        <p>2. 服务数据：个人课表、课程导入记录、实验室预约、消息通知、校园活动及用户主动填写的内容，用于提供对应功能并在不同终端间同步。</p>
        <p>3. 安全与运行信息：登录时间、操作日志、设备和浏览器基本信息、网络地址的安全特征、错误日志，用于防攻击、反滥用、排查故障和保障账号安全。</p>
        <p>4. AI 功能数据：你主动发送的提示词、文件、图片、对话内容以及自行配置的模型服务信息。API Key 应加密保存或仅保存在当前浏览器；平台不会要求管理员查看用户的明文密钥。</p>
        <h4>二、处理目的与方式</h4>
        <p>我们仅在完成登录认证、提供校园服务、同步用户设置、发送必要通知、保障安全、履行法定义务和取得你单独同意的其他目的范围内处理信息。改变处理目的、处理敏感个人信息或超出合理预期时，将另行告知并依法取得同意。</p>
        <h4>三、敏感个人信息</h4>
        <p>手机号、校园身份、学习与成长记录在特定场景下可能对个人权益产生较大影响。平台仅在实现身份认证、教学服务和安全管理所必需的范围内处理，并采取更严格的访问控制。请勿在 AI 对话、公开内容或普通备注中提交身份证号、银行卡、密码、验证码、健康信息等非必要敏感信息。</p>
        <h4>四、保存期限</h4>
        <p>短信验证码仅在验证有效期内使用；消息通知默认仅展示并清理最近 14 天内容；账号与校园身份信息在账号有效和提供服务所必需期间保存。超过目的所需期限后，我们将删除或匿名化处理，但法律法规另有规定或处理争议、安全审计所必需的除外。</p>
        <h4>五、委托处理、共享与第三方服务</h4>
        <p>短信、云数据库、文件存储、AI 模型等能力可能由第三方服务商提供。我们将依据功能需要展示服务商及处理目的，并通过合同、安全评估和最小权限限制其处理。除依法提供、保护重大权益或取得授权外，不出售个人信息。</p>
        <p>当你自行选择境外 AI 服务商时，相关内容可能由该服务商按照其条款处理。平台应在实际发生跨境提供前履行告知、单独同意及其他法定程序；未完成前不得默认向境外传输个人信息。</p>
        <h4>六、你的权利</h4>
        <p>你可以依法查询、复制、更正、补充、删除个人信息，撤回同意、限制或拒绝特定处理，并申请注销账号。撤回同意不影响此前基于同意已经开展的合法处理；必要身份信息被删除后，部分校园服务可能无法继续提供。</p>
        <h4>七、未成年人保护</h4>
        <p>未满 14 周岁的用户应由监护人阅读并同意专门的未成年人个人信息处理规则后使用；未完成相应监护人同意机制前，本平台不面向未满 14 周岁用户提供注册服务。其他未成年人应在监护人指导下使用。</p>
        <h4>八、安全事件与联系我们</h4>
        <p>我们采用传输加密、访问控制、密码哈希、日志审计、备份和漏洞修复等措施。发生可能影响个人权益的安全事件时，将依法采取补救措施并履行通知或报告义务。隐私请求与投诉方式：${LEGAL_CONTACT}。</p>
        <h4>九、政策更新</h4>
        <p>重大变更将以显著方式通知，并在依法需要时重新取得同意。你可在登录页随时查看当前版本。</p>
        <p class="legal-scroll-end">已阅读至隐私政策末尾</p>
      </article>
    `;
  }
  return `
    <article class="legal-document">
      <p class="legal-document-note">版本：${LEGAL_CONSENT_VERSION} · 生效日期：2026年6月20日</p>
      <h3>智慧校园用户协议</h3>
      <p>欢迎使用智慧校园平台。请在注册、登录或使用服务前认真阅读本协议。你点击同意并继续，即表示已理解并接受本协议；不同意时请停止登录和使用。</p>
      <h4>一、协议主体与适用范围</h4>
      <p>本协议由你与 ${LEGAL_OPERATOR_NAME} 共同订立，适用于网页端及后续移动端的课程、校园服务、AI 助手、成长档案、活动社区和数据看板等功能。平台目前属于校园数字化服务项目；除非运营主体获得学校正式授权并明确公示，不应被理解为学校官方教务系统或替代学校正式通知渠道。</p>
      <h4>二、账号与校园身份</h4>
      <p>你应提供真实、准确、完整的学校、专业、学号或工号及手机号信息，并妥善保管密码、验证码和登录设备。账号仅限本人使用，不得出借、转让、出售或用于绕过权限。发现冒用或异常登录时应立即联系管理员。</p>
      <h4>三、平台服务</h4>
      <p>平台可提供课表、成绩与空教室查询、考试报名信息、实验室预约、图书馆与校园活动信息、软件目录、AI 助手等服务。涉及考试、成绩、收费、学校处分和正式教学安排的内容，应以学校或主管部门的正式系统和公告为准。</p>
      <h4>四、使用规范</h4>
      <p>不得利用平台制作、复制、发布违法有害信息，不得实施网络攻击、恶意爬取、批量注册、撞库、越权访问、干扰服务、传播恶意程序、侵犯知识产权或他人个人信息。合理的学习研究、无障碍访问和经授权的接口调用不受不当限制。</p>
      <h4>五、AI 与自动化功能</h4>
      <p>AI 输出可能存在错误、遗漏或时效偏差，不构成医疗、法律、金融等专业意见，也不能代替教师、学校和主管部门决定。你应核验重要内容，不得将 AI 用于作弊、侵犯权益或违法用途。使用自有 API 时，还应遵守所选服务商条款和隐私规则。</p>
      <h4>六、知识产权</h4>
      <p>平台程序、界面和自制内容依法受保护。用户对其合法上传的原创内容保留权利，并仅授予平台为提供、维护和改进所选服务所必要的、非独占的使用许可。第三方软件、新闻和资源的权利归原权利人所有，下载与使用应遵守正版授权。</p>
      <h4>七、短信、费用和第三方服务</h4>
      <p>平台发送登录验证码本身不向用户额外收费，运营商可能按套餐规则收取通信费用。未来出现付费服务时，将在购买前明确价格、内容、退款条件和服务主体，不以默认勾选方式收费。</p>
      <h4>八、服务变更、中断与责任</h4>
      <p>平台可为维护、安全或合规需要调整服务，并尽量提前通知。因不可抗力、基础通信故障或第三方服务中断造成影响时，将及时修复并采取合理补救。本协议不排除或限制法律规定不得排除或限制的责任，也不影响消费者和个人信息主体依法享有的权利。</p>
      <h4>九、违规处置与账号退出</h4>
      <p>存在违法、侵权、安全风险或严重违反本协议的行为时，平台可依据事实和影响采取提醒、限制功能、暂停或终止服务，并保留必要证据。用户有权申诉和申请注销账号。</p>
      <h4>十、未成年人</h4>
      <p>未成年人应在监护人指导下阅读和使用。未满 14 周岁的用户，须由监护人依法作出同意后方可处理其个人信息；平台尚未提供相应机制时不得自行注册。</p>
      <h4>十一、协议更新与争议解决</h4>
      <p>重大更新将显著提示并在必要时重新取得同意。协议适用中华人民共和国法律。发生争议时应先友好协商；协商不成的，依法向有管辖权的人民法院提起诉讼。</p>
      <h4>十二、联系我们</h4>
      <p>账号申诉、侵权投诉、服务建议和法律通知：${LEGAL_CONTACT}。</p>
      <p class="legal-scroll-end">已阅读至用户协议末尾</p>
    </article>
  `;
}

function renderLogin() {
  stopLoginParticles();
  let smsChallenge = "";
  let smsCountdownTimer = null;
  app.innerHTML = `
    <main class="login-wrap">
      <canvas class="login-particles" id="loginParticles" aria-hidden="true"></canvas>
      <button class="login-back-btn" id="loginBackBtn" type="button">返回浏览页</button>
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
            <h2>欢迎回来</h2>
            <p>请使用学校登记信息完成安全登录</p>
          </div>
          <div class="login-role-switch" role="group" aria-label="选择登录身份">
            <button class="active" type="button" data-login-role="student">学生登录</button>
            <button type="button" data-login-role="teacher">老师登录</button>
            <input name="identityType" type="hidden" value="student" />
          </div>
          <div class="login-auth-switch" role="group" aria-label="选择验证方式">
            <button class="active" type="button" data-login-auth="sms">手机号登录</button>
            <button type="button" data-login-auth="password">密码登录</button>
            <input name="loginMode" type="hidden" value="sms" />
          </div>
          <div class="login-identity-grid">
            <label class="field login-field login-field-wide">
              <span>学校</span>
              <input name="school" value="泰州学院" autocomplete="organization" required />
            </label>
            <label class="field login-field">
              <span>专业</span>
              <input name="major" value="数字经济" autocomplete="organization-title" required />
            </label>
            <label class="field login-field">
              <span id="loginAccountLabel">学号</span>
              <input name="studentNo" placeholder="请输入学号" autocomplete="username" required />
            </label>
            <label class="field login-field login-field-wide" id="loginPhoneField">
              <span>手机号</span>
              <input name="phone" placeholder="请输入学校登记手机号" autocomplete="tel" inputmode="tel" maxlength="11" required />
            </label>
            <label class="field login-field login-field-wide" id="loginCodeField">
              <span>短信验证码</span>
              <span class="login-code-control">
                <input name="code" placeholder="请输入 6 位验证码" autocomplete="one-time-code" inputmode="numeric" maxlength="6" required />
                <button id="sendSmsCode" type="button">获取验证码</button>
              </span>
            </label>
            <label class="field login-field login-field-wide" id="loginPasswordField" hidden>
              <span>登录密码</span>
              <input name="password" type="password" placeholder="请输入已设置的密码" autocomplete="current-password" />
            </label>
          </div>
          <div class="login-legal-consent">
            <input id="loginLegalConsent" name="legalConsent" type="checkbox" disabled required />
            <label for="loginLegalConsent">我已完整阅读并同意</label>
            <button type="button" data-open-legal="terms">《用户协议》</button>
            <span>和</span>
            <button type="button" data-open-legal="privacy">《隐私政策》</button>
            <small id="loginLegalHint">请分别阅读两份文件至末尾后再勾选</small>
          </div>
          <button class="primary-btn login-submit" type="submit"><span>验证并登录</span><b aria-hidden="true">→</b></button>
          <button class="login-guest-btn" id="guestLoginBtn" type="button"><span>游客模式</span><small>免验证，只读体验</small></button>
        </form>
      </section>
      <section class="legal-reader" id="legalReader" role="dialog" aria-modal="true" aria-labelledby="legalReaderTitle" hidden>
        <div class="legal-reader-backdrop" data-close-legal></div>
        <div class="legal-reader-panel">
          <header>
            <div><span>登录前必读</span><h2 id="legalReaderTitle">服务条款与隐私说明</h2></div>
            <button type="button" data-close-legal aria-label="关闭协议阅读器">×</button>
          </header>
          <nav class="legal-reader-tabs" aria-label="法律文件">
            <button class="active" type="button" data-legal-tab="terms">用户协议 <span data-legal-state="terms">未读</span></button>
            <button type="button" data-legal-tab="privacy">隐私政策 <span data-legal-state="privacy">未读</span></button>
          </nav>
          <div class="legal-reader-content" id="legalReaderContent" tabindex="0"></div>
          <footer>
            <p id="legalReaderProgress">请滚动至文件末尾</p>
            <button class="legal-reader-confirm" id="legalReaderConfirm" type="button" disabled>完成本文件阅读</button>
          </footer>
        </div>
      </section>
    </main>
  `;

  initLoginParticles();
  let savedLegalConsent = null;
  try {
    savedLegalConsent = JSON.parse(localStorage.getItem(LEGAL_CONSENT_STORAGE_KEY) || "null");
  } catch {
    localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY);
  }
  const hasSavedLegalConsent = savedLegalConsent?.accepted === true
    && savedLegalConsent?.version === LEGAL_CONSENT_VERSION;
  const legalReadState = {
    terms: hasSavedLegalConsent,
    privacy: hasSavedLegalConsent,
    current: "terms",
    reachedEnd: false
  };
  const legalReader = document.querySelector("#legalReader");
  const legalContent = document.querySelector("#legalReaderContent");
  const legalConfirm = document.querySelector("#legalReaderConfirm");
  const legalProgress = document.querySelector("#legalReaderProgress");
  const legalCheckbox = document.querySelector("#loginLegalConsent");
  const legalHint = document.querySelector("#loginLegalHint");

  const legalConsentPayload = () => ({
    accepted: legalCheckbox.checked,
    version: LEGAL_CONSENT_VERSION,
    documents: ["user_agreement", "privacy_policy"],
    consentedAt: new Date().toISOString()
  });

  const syncLegalControls = () => {
    const bothRead = legalReadState.terms && legalReadState.privacy;
    legalCheckbox.disabled = !bothRead;
    legalHint.textContent = bothRead
      ? (legalCheckbox.checked ? `已同意当前版本（${LEGAL_CONSENT_VERSION}）` : "两份文件已读，请勾选同意后登录")
      : "请分别阅读两份文件至末尾后再勾选";
    Object.entries(legalReadState).forEach(([key, value]) => {
      if (!["terms", "privacy"].includes(key)) return;
      const badge = document.querySelector(`[data-legal-state="${key}"]`);
      if (badge) {
        badge.textContent = value ? "已读" : "未读";
        badge.classList.toggle("read", value);
      }
    });
  };

  const showLegalDocument = (type) => {
    legalReadState.current = type === "privacy" ? "privacy" : "terms";
    legalReadState.reachedEnd = false;
    legalContent.innerHTML = legalDocumentMarkup(legalReadState.current);
    legalContent.scrollTop = 0;
    legalConfirm.disabled = !legalReadState[legalReadState.current];
    legalConfirm.textContent = legalReadState[legalReadState.current] ? "本文件已阅读" : "完成本文件阅读";
    legalProgress.textContent = legalReadState[legalReadState.current] ? "本文件已完成阅读" : "请滚动至文件末尾";
    document.querySelectorAll("[data-legal-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.legalTab === legalReadState.current);
    });
    syncLegalControls();
  };

  const openLegalReader = (type) => {
    showLegalDocument(type);
    legalReader.hidden = false;
    document.body.classList.add("legal-reader-open");
    requestAnimationFrame(() => legalContent.focus());
  };

  const closeLegalReader = () => {
    legalReader.hidden = true;
    document.body.classList.remove("legal-reader-open");
  };

  document.querySelectorAll("[data-open-legal]").forEach((button) => {
    button.addEventListener("click", () => openLegalReader(button.dataset.openLegal));
  });
  document.querySelectorAll("[data-close-legal]").forEach((button) => button.addEventListener("click", closeLegalReader));
  document.querySelectorAll("[data-legal-tab]").forEach((button) => {
    button.addEventListener("click", () => showLegalDocument(button.dataset.legalTab));
  });
  legalContent.addEventListener("scroll", () => {
    const remaining = legalContent.scrollHeight - legalContent.scrollTop - legalContent.clientHeight;
    if (remaining <= 12) {
      legalReadState.reachedEnd = true;
      legalConfirm.disabled = false;
      legalProgress.textContent = "已到达文件末尾，可以完成阅读";
    }
  });
  legalConfirm.addEventListener("click", () => {
    if (!legalReadState.reachedEnd && !legalReadState[legalReadState.current]) return;
    legalReadState[legalReadState.current] = true;
    syncLegalControls();
    const nextType = legalReadState.current === "terms" ? "privacy" : "terms";
    if (!legalReadState[nextType]) showLegalDocument(nextType);
    else closeLegalReader();
  });
  legalCheckbox.checked = hasSavedLegalConsent;
  legalCheckbox.addEventListener("change", () => {
    if (legalCheckbox.checked && legalReadState.terms && legalReadState.privacy) {
      localStorage.setItem(LEGAL_CONSENT_STORAGE_KEY, JSON.stringify({
        accepted: true,
        version: LEGAL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString()
      }));
    } else {
      localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY);
    }
    syncLegalControls();
  });
  syncLegalControls();

  const ensureLegalConsent = () => {
    if (legalCheckbox.checked && legalReadState.terms && legalReadState.privacy) return true;
    openLegalReader(!legalReadState.terms ? "terms" : "privacy");
    toast("请先完整阅读并同意用户协议与隐私政策");
    return false;
  };

  document.querySelector(".login-submit")?.addEventListener("click", (event) => {
    if (!legalCheckbox.checked) {
      event.preventDefault();
      ensureLegalConsent();
    }
  });

  document.querySelector("#loginBackBtn")?.addEventListener("click", () => {
    authView = "intro";
    renderIntro();
  });
  document.querySelector("#loginThemeToggle")?.addEventListener("click", () => {
    if (smsCountdownTimer) clearInterval(smsCountdownTimer);
    const nextTheme = document.documentElement.dataset.theme === "day" ? "night" : "day";
    applyTheme(nextTheme, true);
    renderLogin();
  });
  document.querySelectorAll("[data-login-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#loginForm");
      const identityType = button.dataset.loginRole;
      form.elements.identityType.value = identityType;
      document.querySelectorAll("[data-login-role]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelector("#loginAccountLabel").textContent = identityType === "teacher" ? "工号" : "学号";
      form.elements.studentNo.placeholder = identityType === "teacher" ? "请输入教师工号" : "请输入学号";
      form.elements.studentNo.value = "";
      form.elements.code.value = "";
      smsChallenge = "";
      if (identityType === "teacher") toast("老师请使用学校身份库登记的工号与手机号登录");
    });
  });
  document.querySelectorAll("[data-login-auth]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#loginForm");
      const passwordMode = button.dataset.loginAuth === "password";
      form.elements.loginMode.value = passwordMode ? "password" : "sms";
      document.querySelectorAll("[data-login-auth]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelector("#loginPhoneField").hidden = false;
      document.querySelector("#loginCodeField").hidden = passwordMode;
      document.querySelector("#loginPasswordField").hidden = !passwordMode;
      form.elements.phone.required = true;
      form.elements.code.required = !passwordMode;
      form.elements.password.required = passwordMode;
      document.querySelector(".login-submit span").textContent = passwordMode ? "使用密码登录" : "验证并登录";
      if (passwordMode) toast("密码登录需填写已绑定手机号");
    });
  });
  document.querySelector("#sendSmsCode")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const formElement = document.querySelector("#loginForm");
    if (!ensureLegalConsent()) return;
    const invalidIdentityField = [...formElement.querySelectorAll('input:not([name="code"])')].find((input) => !input.checkValidity());
    if (invalidIdentityField) {
      invalidIdentityField.reportValidity();
      return;
    }
    const form = new FormData(formElement);
    button.disabled = true;
    button.textContent = "发送中...";
    try {
      const result = await api("/api/auth/sms/send", {
        method: "POST",
        body: JSON.stringify({
          school: form.get("school"),
          major: form.get("major"),
          studentNo: form.get("studentNo"),
          phone: form.get("phone"),
          identityType: form.get("identityType"),
          legalConsent: legalConsentPayload()
        })
      });
      smsChallenge = result.challenge;
      let remaining = result.retryAfter || 60;
      const codeInput = formElement.elements.code;
      if (result.developmentCode) {
        codeInput.value = result.developmentCode;
        toast(`本地开发验证码：${result.developmentCode}`);
      } else {
        toast("验证码已发送，请留意手机短信");
      }
      button.textContent = `${remaining} 秒后重发`;
      smsCountdownTimer = setInterval(() => {
        remaining -= 1;
        button.textContent = remaining > 0 ? `${remaining} 秒后重发` : "重新获取";
        if (remaining <= 0) {
          clearInterval(smsCountdownTimer);
          smsCountdownTimer = null;
          button.disabled = false;
        }
      }, 1000);
    } catch (error) {
      button.disabled = false;
      button.textContent = "获取验证码";
      toast(error.message);
    }
  });
  document.querySelector("#guestLoginBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!ensureLegalConsent()) return;
    button.disabled = true;
    try {
      const result = await api("/api/auth/guest", {
        method: "POST",
        body: JSON.stringify({ legalConsent: legalConsentPayload() })
      });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem("smart_taiyuan_token", result.token);
      renderShell();
      toast("已进入游客只读模式");
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  });
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ensureLegalConsent()) return;
    const form = new FormData(event.currentTarget);
    try {
      const passwordMode = form.get("loginMode") === "password";
      const result = await api(passwordMode ? "/api/auth/password/login" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(passwordMode ? {
          school: form.get("school"),
          major: form.get("major"),
          studentNo: form.get("studentNo"),
          phone: form.get("phone"),
          identityType: form.get("identityType"),
          password: form.get("password"),
          legalConsent: legalConsentPayload()
        } : {
          phone: form.get("phone"),
          code: form.get("code"),
          school: form.get("school"),
          major: form.get("major"),
          studentNo: form.get("studentNo"),
          identityType: form.get("identityType"),
          challenge: smsChallenge,
          legalConsent: legalConsentPayload()
        })
      });
      if (smsCountdownTimer) clearInterval(smsCountdownTimer);
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem("smart_taiyuan_token", result.token);
      renderShell();
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderLegacyIntro() {
  stopLoginParticles();
  const isDay = document.documentElement.dataset.theme === "day";
  app.innerHTML = `
    <main class="campus-intro">
      <canvas class="login-particles" id="loginParticles" aria-hidden="true"></canvas>
      <header class="intro-nav">
        <a class="intro-brand" href="#introTop" aria-label="智慧校园首页">
          <img src="/assets/campus-mark.png" alt="智慧校园标识" />
          <span><strong>智慧校园</strong><small>SMART CAMPUS</small></span>
        </a>
        <nav aria-label="浏览页导航">
          <a href="#introServices">校园服务</a>
          <a href="#introExperience">产品体验</a>
        </nav>
        <div class="intro-nav-actions">
          <button class="intro-theme-btn" id="introThemeBtn" type="button" aria-label="切换白天与夜晚主题">${isDay ? "白天" : "夜晚"}</button>
          <button class="intro-login-btn" data-enter-login type="button">进入登录</button>
        </div>
      </header>

      <section class="intro-hero" id="introTop">
        <div class="intro-hero-copy">
          <p class="intro-eyebrow"><span></span> 泰州学院一站式校园生活入口</p>
          <h1>把校园装进口袋，<br /><em>让青春更从容。</em></h1>
          <p class="intro-summary">从今天的课程，到下一场考试；从实验室预约，到灵感迸发的 AI 助手。智慧校园把学习与生活连接成一条轻松的路径。</p>
          <div class="intro-hero-actions">
            <button class="intro-primary" data-enter-login type="button">开始体验 <span>→</span></button>
            <a class="intro-secondary" href="#introServices">浏览校园服务</a>
          </div>
          <dl class="intro-metrics" aria-label="产品概览">
            <div><dt>15+</dt><dd>校园服务入口</dd></div>
            <div><dt>197</dt><dd>考试报名项目</dd></div>
            <div><dt>123</dt><dd>学习工作软件</dd></div>
          </dl>
        </div>

        <div class="intro-orbit" aria-label="智慧校园核心能力">
          <div class="intro-orbit-ring intro-orbit-ring-one"></div>
          <div class="intro-orbit-ring intro-orbit-ring-two"></div>
          <div class="intro-orbit-core">
            <img src="/assets/campus-mark.png" alt="" />
            <strong>校园生活</strong>
            <span>一站连接</span>
          </div>
          <article class="intro-orbit-card orbit-course"><small>今日安排</small><strong>我的课表</strong><span>实时同步课程变化</span></article>
          <article class="intro-orbit-card orbit-lab"><small>校园空间</small><strong>实验室预约</strong><span>查空闲 · 快速预约</span></article>
          <article class="intro-orbit-card orbit-ai"><small>学习搭档</small><strong>AI 助手</strong><span>问答 · 写作 · 分析</span></article>
          <article class="intro-orbit-card orbit-software"><small>学习与工作</small><strong>软件库</strong><span>专业工具轻松获取</span></article>
        </div>
      </section>

      <section class="intro-service-band" id="introServices">
        <div class="intro-section-heading">
          <p>从清晨第一节课，到夜晚最后一次灵感记录</p>
          <h2>校园每一刻，都有顺手的服务</h2>
        </div>
        <div class="intro-service-grid">
          <article><span>01</span><strong>学习安排</strong><p>课表、成绩、考试报名与空教室查询集中呈现，重要节点不错过。</p></article>
          <article><span>02</span><strong>校园生活</strong><p>实验室、图书馆、食堂与校园活动随时可查，安排更有把握。</p></article>
          <article><span>03</span><strong>成长工具</strong><p>AI 助手、软件库和学习工具，让课堂之外的创造更自由。</p></article>
        </div>
      </section>

      <section class="intro-experience" id="introExperience">
        <div class="intro-experience-media">
          <img src="/assets/campus-card-youth-v1.webp" alt="青春校园生活场景" decoding="async" />
          <div><span>青春校园</span><strong>不仅是办事，更是探索与成长。</strong></div>
        </div>
        <div class="intro-experience-copy">
          <p class="intro-eyebrow"><span></span> 为同学而设计</p>
          <h2>信息更清晰，行动更轻松</h2>
          <p>白天明快、夜晚沉静，两种主题随系统时间切换。常用服务保持在触手可及的位置，让每一次查询、预约和学习都少一点等待。</p>
          <ul>
            <li><strong>实时同步</strong><span>课程安排与首页课表保持一致</span></li>
            <li><strong>移动优先</strong><span>手机上也能快速完成常用操作</span></li>
            <li><strong>持续生长</strong><span>更多校园服务将不断加入</span></li>
          </ul>
          <button class="intro-primary" data-enter-login type="button">进入智慧校园 <span>→</span></button>
        </div>
      </section>

      <footer class="intro-footer">
        <div class="intro-brand">
          <img src="/assets/campus-mark.png" alt="" />
          <span><strong>智慧校园</strong><small>泰州学院统一服务平台</small></span>
        </div>
        <button data-enter-login type="button">开始我的校园旅程 →</button>
      </footer>
    </main>
  `;

  initLoginParticles();
  document.querySelector("#introThemeBtn")?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "day" ? "night" : "day";
    applyTheme(nextTheme, true);
    renderIntro();
  });
  document.querySelectorAll("[data-enter-login]").forEach((button) => {
    button.addEventListener("click", () => {
      authView = "login";
      renderLogin();
    });
  });
}

function renderIntro() {
  stopLoginParticles();
  const themeId = activeYouthTheme();
  const theme = youthThemes[themeId];
  const preference = youthThemePreference();
  const now = new Date();
  const autoLabel = `${now.getMonth() + 1}月${now.getDate()}日 · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const themeButtons = Object.entries(youthThemes).map(([id, item]) => `
    <button class="${preference === id ? "active" : ""}" data-youth-theme="${id}" type="button" title="${item.label}主题">
      <span style="--swatch:${item.accent}">${item.icon}</span><strong>${item.label}</strong>
    </button>
  `).join("");

  document.documentElement.dataset.youthTheme = themeId;
  app.innerHTML = `
    <main class="youth-intro youth-theme-${themeId}" style="--youth-accent:${theme.accent}">
      <section class="youth-hero" id="introTop">
        <div class="youth-scene" aria-hidden="true"></div>
        <div class="youth-vignette" aria-hidden="true"></div>
        <canvas class="youth-atmosphere" id="youthAtmosphere" aria-hidden="true"></canvas>
        <div class="youth-motion-layers" aria-hidden="true">
          <div class="youth-pointer-light"></div>
          <div class="youth-sun-glow"></div><div class="youth-light-rays"></div>
          <div class="youth-cloud cloud-one"></div><div class="youth-cloud cloud-two"></div>
          <div class="youth-wind wind-one"></div><div class="youth-wind wind-two"></div><div class="youth-wind wind-three"></div>
          <div class="youth-birds"><i></i><i></i><i></i></div>
          <div class="youth-shooting-stars">${Array.from({ length: 5 }, (_, index) => `<i style="--delay:${index * 2.7}s;--top:${12 + index * 11}%"></i>`).join("")}</div>
          <div class="youth-rain">${Array.from({ length: 22 }, (_, index) => `<i style="--left:${(index * 17) % 101}%;--delay:${(index % 9) * -.23}s;--duration:${1.1 + (index % 5) * .18}s"></i>`).join("")}</div>
          <div class="youth-fireflies">${Array.from({ length: 18 }, (_, index) => `<i style="--left:${(index * 31) % 96}%;--top:${35 + ((index * 19) % 56)}%;--delay:${(index % 8) * -.7}s"></i>`).join("")}</div>
          <div class="youth-constellations"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="youth-mist mist-one"></div><div class="youth-mist mist-two"></div>
          <div class="youth-foreground"></div>
          <div class="youth-film-grain"></div>
        </div>

        <header class="youth-nav">
          <a class="youth-brand" href="#introTop" aria-label="智慧校园首页">
            <img src="/assets/campus-mark.png" alt="" />
            <span><strong>智慧校园</strong><small>连接校园，启迪未来</small></span>
          </a>
          <nav aria-label="浏览页导航">
            <a href="#youthMoments">校园生活</a>
            <a href="#youthMoments">学习成长</a>
            <a href="#youthMoments">AI 助手</a>
          </nav>
          <div class="youth-nav-actions">
            <button class="youth-mode-trigger" id="youthModeTrigger" type="button" aria-expanded="false">
              <span>${theme.icon}</span><strong>${preference === "auto" ? `自动 · ${theme.label}` : theme.label}</strong><b>⌄</b>
            </button>
            <button class="youth-login" data-enter-login type="button">登录 / 注册</button>
          </div>
          <div class="youth-theme-popover" id="youthThemePopover" hidden>
            <button class="${preference === "auto" ? "active" : ""}" data-youth-theme="auto" type="button">
              <span class="auto-orbit">◉</span><strong>自动</strong><small>${autoLabel}<br />按日期与时间切换</small>
            </button>
            <div class="youth-theme-options">${themeButtons}</div>
          </div>
        </header>

        <div class="youth-copy">
          <p class="youth-eyebrow">${theme.eyebrow}</p>
          <h1>${theme.title}</h1>
          <p class="youth-summary">${theme.summary}</p>
          <div class="youth-actions">
            <button class="youth-primary" data-enter-login type="button">开启青春旅程 <span>→</span></button>
            <a class="youth-secondary" href="#youthMoments">看看校园生活</a>
          </div>
        </div>

        <div class="youth-signposts" aria-label="快捷服务">
          <button data-enter-login type="button"><span>▣</span><strong>今日课程</strong><small>查看课表与学习安排</small><b>→</b></button>
          <button data-enter-login type="button"><span>✦</span><strong>AI 助学</strong><small>智能问答，学习更高效</small><b>→</b></button>
          <button data-enter-login type="button"><span>⚑</span><strong>校园活动</strong><small>发现精彩，参与其中</small><b>→</b></button>
          <button data-enter-login type="button"><span>◎</span><strong>成长记录</strong><small>记录点滴，见证成长</small><b>→</b></button>
        </div>

        <a class="youth-scroll" href="#youthMoments"><span>向下探索</span><i></i></a>

        <aside class="youth-radio" aria-label="青春电台">
          <div class="youth-radio-cover"><span>${theme.icon}</span></div>
          <div class="youth-radio-copy"><small>青春电台</small><strong>${theme.label} · ${theme.track}</strong></div>
          <div class="youth-wave" aria-hidden="true">${Array.from({ length: 18 }, (_, index) => `<i style="--h:${8 + ((index * 7) % 19)}px"></i>`).join("")}</div>
          <button id="youthRadioToggle" type="button" aria-label="播放青春电台"><span data-radio-icon>▶</span></button>
        </aside>
      </section>

      <section class="youth-moments" id="youthMoments">
        <div class="youth-moments-heading">
          <p>${theme.icon} ${theme.label}日校园手记</p>
          <h2>让每一次点击，都连接更鲜活的校园生活。</h2>
          <button data-enter-login type="button">进入智慧校园 →</button>
        </div>
        <div class="youth-moment-list">
          <article><span>08:00</span><strong>从今天的第一节课出发</strong><p>课表、考试、空教室与学习计划，重要安排清晰可见。</p></article>
          <article><span>14:30</span><strong>在灵感出现时抓住它</strong><p>AI 助手、软件库与学习工具，让创造不被工具打断。</p></article>
          <article><span>18:20</span><strong>去遇见课堂之外的热爱</strong><p>活动、实验室、图书馆与校园资讯，让青春有更多可能。</p></article>
        </div>
      </section>
    </main>
  `;

  initYouthAtmosphere(themeId);
  updateYouthRadio(themeId);

  const trigger = document.querySelector("#youthModeTrigger");
  const popover = document.querySelector("#youthThemePopover");
  trigger?.addEventListener("click", () => {
    const nextHidden = !popover.hidden;
    popover.hidden = nextHidden;
    trigger.setAttribute("aria-expanded", String(!nextHidden));
  });
  document.querySelectorAll("button[data-youth-theme]").forEach((button) => {
    button.addEventListener("click", () => setYouthTheme(button.dataset.youthTheme));
  });
  document.querySelector("#youthRadioToggle")?.addEventListener("click", () => toggleYouthAudio(themeId));
  document.querySelectorAll("[data-enter-login]").forEach((button) => {
    button.addEventListener("click", () => {
      stopYouthAudio();
      authView = "login";
      renderLogin();
    });
  });
}

function shell(content, title, subtitle) {
  const accountName = state.user?.name || "未登录";
  const accountRole = accountRoleLabel(state.user?.role || "guest");
  const isDayTheme = document.documentElement.dataset.theme === "day";
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
          ${visibleModuleGroups()
            .map(
              (group) => `
                <section class="nav-section">
                  <p class="nav-label">${group.title}</p>
                  ${group.items
                    .map(
                      (item) => `
                        <button class="${state.route === item.id || (item.id === "tools" && state.route.startsWith("tools/")) ? "active" : ""}" data-route="${item.id}">
                          <span class="nav-icon">${iconSvg(item.icon)}</span><span>${item.label}</span>
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
            <button class="menu-btn" aria-label="菜单">${iconSvg("menu")}</button>
            <h1 class="page-title">${title}</h1>
          </div>
          <div class="top-actions">
            <div class="search-box">
              <span class="search-icon">${iconSvg("search")}</span>
              <input id="moduleSearch" placeholder="搜索校园功能..." autocomplete="off" aria-label="搜索校园功能" />
              <span class="search-shortcut">搜索</span>
              <div class="search-results command-center-panel" id="moduleSearchResults"></div>
            </div>
            <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换白天与夜晚主题" title="切换白天与夜晚主题">
              <span class="theme-toggle-icon" aria-hidden="true">${iconSvg(isDayTheme ? "sun" : "moon")}</span>
              <span class="theme-toggle-text">${isDayTheme ? "白天" : "夜晚"}</span>
            </button>
            <button class="bell-btn ${state.route === "notifications" ? "active" : ""}" data-route="notifications" aria-label="消息通知">
              <span class="bell-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img">
                  <path d="M15 17H9" />
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                  <path d="M10 21h4" />
                </svg>
              </span>
              <span class="bell-dot" ${state.unreadNotifications ? "" : "hidden"}></span>
              <span class="bell-count" ${state.unreadNotifications ? "" : "hidden"}>${state.unreadNotifications}</span>
            </button>
            <button class="user-chip" data-route="profile" type="button" aria-label="打开个人中心">
              <span class="avatar">${iconSvg("user")}</span>
              <span class="user-chip-copy">
                <strong>${accountName}</strong>
                <small>${accountRole}</small>
              </span>
              <span class="chevron">${iconSvg("chevron")}</span>
            </button>
          </div>
        </header>
        ${content}
      </main>
    </div>
  `;
}

function bindNav() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.scrollTop = state.sidebarScrollTop;
    sidebar.addEventListener("scroll", () => {
      state.sidebarScrollTop = sidebar.scrollTop;
      sessionStorage.setItem("smart_campus_sidebar_scroll", String(state.sidebarScrollTop));
    }, { passive: true });
  }
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
    const nav = document.querySelector(".nav");
    if (activeRoute && nav) {
      requestAnimationFrame(() => {
        nav.scrollLeft = Math.max(0, activeRoute.offsetLeft - (nav.clientWidth - activeRoute.clientWidth) / 2);
      });
    }
  }
  const moduleSearch = document.querySelector("#moduleSearch");
  const moduleSearchResults = document.querySelector("#moduleSearchResults");
  if (moduleSearch && moduleSearchResults) {
    let activeResultIndex = -1;
    const renderModuleResults = () => {
      const results = getCommandCenterResults(moduleSearch.value);
      activeResultIndex = results.length ? Math.min(Math.max(activeResultIndex, 0), results.length - 1) : -1;
      moduleSearchResults.innerHTML = results
        .map(
          (item, index) => `
            <button type="button" data-command-index="${index}" data-command-id="${item.id}" data-command-route="${item.route}" class="${index === activeResultIndex ? "active" : ""}">
              <span>${iconSvg(item.icon)}</span>
              <strong>${item.label}</strong>
              <em>${item.group} · ${item.desc}</em>
            </button>
          `
        )
        .join("") || '<p class="search-empty">没有找到匹配功能</p>';
      moduleSearchResults.classList.add("show");
      return results;
    };
    const runResult = (button) => {
      if (!button?.dataset.commandRoute) return;
      saveCommandRecent(button.dataset.commandId);
      moduleSearch.value = "";
      moduleSearchResults.classList.remove("show");
      setRoute(button.dataset.commandRoute);
    };
    moduleSearch.addEventListener("input", () => {
      activeResultIndex = 0;
      renderModuleResults();
    });
    moduleSearch.addEventListener("focus", () => {
      activeResultIndex = -1;
      renderModuleResults();
    });
    moduleSearch.addEventListener("keydown", (event) => {
      const results = Array.from(moduleSearchResults.querySelectorAll("[data-command-route]"));
      if (event.key === "Escape") {
        moduleSearch.value = "";
        moduleSearchResults.classList.remove("show");
        moduleSearch.blur();
        return;
      }
      if (!results.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowDown") activeResultIndex = (activeResultIndex + 1) % results.length;
      if (event.key === "ArrowUp") activeResultIndex = (activeResultIndex - 1 + results.length) % results.length;
      if (event.key === "Enter") return runResult(results[Math.max(0, activeResultIndex)]);
      results.forEach((result, index) => result.classList.toggle("active", index === activeResultIndex));
      results[activeResultIndex]?.scrollIntoView({ block: "nearest" });
    });
    moduleSearchResults.addEventListener("click", (event) => runResult(event.target.closest("[data-command-route]")));
    if (!window.__smartCampusSearchBlurBound) {
      window.__smartCampusSearchBlurBound = true;
      document.addEventListener("click", (event) => {
        if (event.target.closest(".search-box")) return;
        document.querySelectorAll(".search-results.show").forEach((node) => node.classList.remove("show"));
      });
    }
    if (!window.__smartCampusSearchShortcutBound) {
      window.__smartCampusSearchShortcutBound = true;
      document.addEventListener("keydown", (event) => {
        if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) return;
        event.preventDefault();
        document.querySelector("#moduleSearch")?.focus();
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
        window.__personalTimetableCourses = mergeCourseLists(result.savedCourses || result.courses || []);
        saveStoredCourses([]);
        toast(`已导入 ${result.count} 门课程`);
        renderShell();
      } catch (error) {
        toast(error.message);
      } finally {
        timetableFile.value = "";
      }
    });
  }
  const timetableImageFile = document.querySelector("#timetableImageFile");
  const chooseTimetableImage = document.querySelector("#chooseTimetableImage");
  if (timetableImageFile && chooseTimetableImage) {
    chooseTimetableImage.addEventListener("click", () => timetableImageFile.click());
    timetableImageFile.addEventListener("change", async () => {
      const file = timetableImageFile.files?.[0];
      if (!file) return;
      try {
        const image = await compressTimetableImage(file);
        saveTimetableImage(image);
        toast("课表图片已导入，正在自动识别课程");
        const settings = getTimetableSettings();
        const result = await api("/api/timetable/image/import", {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            imageData: image.dataUrl,
            semester: settings.semester,
            week: settings.week
          })
        });
        if (result.courses?.length) {
          window.__personalTimetableCourses = mergeCourseLists(result.savedCourses || result.courses || []);
          saveStoredCourses([]);
          toast(`图片识别完成，已导入 ${result.count} 门课程`);
        } else {
          toast(result.warning || "未识别到课程，可对照图片手动添加");
        }
        renderShell();
      } catch (error) {
        toast(`图片已保存，自动识别失败：${error.message}`);
        renderShell();
      } finally {
        timetableImageFile.value = "";
      }
    });
  }
  document.querySelectorAll("[data-timetable-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.timetableAction;
      if (action === "clear") {
        await replacePersonalCourses([]);
        toast("已清空外部导入课程");
        renderShell();
      }
      if (action === "clear-image") {
        clearTimetableImage();
        toast("课表图片已移除");
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
  const currentSidebar = document.querySelector(".sidebar");
  if (currentSidebar) state.sidebarScrollTop = currentSidebar.scrollTop;
  const renderVersion = ++renderShellVersion;
  const requestedRoute = routes[state.route] ? state.route : "dashboard";
  if (requestedRoute !== "dashboard" && window.dashboardReservationTimer) {
    clearInterval(window.dashboardReservationTimer);
    window.dashboardReservationTimer = null;
  }
  if (requestedRoute !== state.route) {
    state.route = requestedRoute;
    const nextUrl = routeToUrl(requestedRoute);
    if (location.pathname + location.hash !== nextUrl) {
      history.replaceState(null, "", nextUrl);
    }
  }

  if (!state.token) {
    if (notificationBadgeTimer) {
      clearInterval(notificationBadgeTimer);
      notificationBadgeTimer = null;
    }
    setUnreadNotificationCount(0);
    if (authView === "login") renderLogin();
    else renderIntro();
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
      authView = "intro";
      renderIntro();
      return;
    }
  }

  const requestedModule = navItems.find((item) => item.id === requestedRoute);
  if (requestedModule && !canAccessModule(requestedModule)) {
    state.route = "profile";
    history.replaceState(null, "", routeToUrl("profile"));
    toast(requestedModule.superAdminOnly ? "仅总管理员可以访问该页面" : "仅管理员可以访问该页面");
    return renderShell();
  }

  const renderer = routes[requestedRoute] || routes.dashboard;
  try {
    const view = await renderer();
    if (renderVersion !== renderShellVersion || requestedRoute !== state.route) return;
    app.innerHTML = shell(view.content, view.title, view.subtitle);
    bindNav();
    view.afterRender?.();
    bindMotionEffects();
    showRequiredPasswordSetup();
    startNotificationBadgeSync();
    refreshUnreadNotificationCount();
  } catch (error) {
    if (renderVersion !== renderShellVersion || requestedRoute !== state.route) return;
    app.innerHTML = shell(`<div class="empty">${escapeHtml(error.message)}</div>`, "加载失败", "请稍后重试");
    bindNav();
    bindMotionEffects();
  }
}

function reservationTrendLabel(summary = {}) {
  const current = Number(summary.weekApprovedHours || 0);
  const previous = Number(summary.previousWeekApprovedHours || 0);
  const change = Number(summary.weeklyChangePercent || 0);
  if (!current && !previous) return "本周暂无新增通过时长";
  if (current && !previous) return `本周新增 ${current.toFixed(1)} 小时`;
  if (change === 0) return "与上周持平";
  return `较上周${change > 0 ? "增加" : "减少"} ${Math.abs(change)}%`;
}

function dashboardReservationMarkup(summary = {}, reservations = []) {
  const approvalRate = Math.max(0, Math.min(100, Number(summary.approvalRate || 0)));
  const updatedAt = summary.updatedAt ? new Date(summary.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "刚刚";
  return `
    <div class="reserve-live-meta">
      <span><i></i> 实时预约数据</span>
      <time>${updatedLabel} 更新</time>
    </div>
    <div class="reserve-layout">
      <div class="reserve-summary">
        <div class="ring" style="--reserve-progress:${approvalRate}%">
          <div class="ring-value"><strong>${Number(summary.approvedHours || 0).toFixed(1)}</strong><span>累计小时</span></div>
        </div>
        <div class="reserve-summary-copy">
          <span>预约通过率 ${approvalRate}%</span>
          <strong>本周 ${Number(summary.weekApprovedHours || 0).toFixed(1)} 小时</strong>
          <small>${escapeHtml(reservationTrendLabel(summary))}</small>
        </div>
        <div class="reserve-kpis" aria-label="预约状态统计">
          <span><b>${Number(summary.pendingCount || 0)}</b><small>待审批</small></span>
          <span><b>${Number(summary.approvedCount || 0)}</b><small>已通过</small></span>
          <span><b>${Number(summary.totalCount || 0)}</b><small>总申请</small></span>
        </div>
      </div>
      <div class="reserve-list">
        ${(reservations || []).slice(0, 3).map((item) => `
          <div>
            <span><time>${escapeHtml(item.slot || "时段待定")}</time><b>${escapeHtml(item.labName || "实验室")}</b></span>
            <em class="${statusClass(item.status)}">${escapeHtml(statusText(item.status))}</em>
          </div>
        `).join("") || `<div class="empty">暂无预约记录，提交预约后会实时显示在这里。</div>`}
      </div>
    </div>
  `;
}

async function refreshDashboardReservationPanel() {
  const panel = document.querySelector("#dashboardReservationBody");
  if (!panel || state.route !== "dashboard") return;
  try {
    const data = await api("/api/dashboard/reservations");
    if (state.route !== "dashboard" || !document.body.contains(panel)) return;
    panel.innerHTML = dashboardReservationMarkup(data.reservationSummary, data.recentReservations);
  } catch (error) {
    panel.querySelector(".reserve-live-meta span")?.classList.add("is-offline");
  }
}

function toolsSubnav() {
  return `
    <nav class="tools-subnav" aria-label="学习工具快捷入口">
      <button type="button" class="${state.route === "tools/doc-convert" ? "active" : ""}" data-route="tools/doc-convert"><span class="tools-subnav-icon">${iconSvg("file")}</span><strong>文档互转</strong></button>
      <button type="button" class="${state.route === "tools/calculator" ? "active" : ""}" data-route="tools/calculator"><span class="tools-subnav-icon">${iconSvg("calculator")}</span><strong>全能计算器</strong></button>
      <button type="button" class="${state.route === "tools/translate" ? "active" : ""}" data-route="tools/translate"><span class="tools-subnav-icon">${iconSvg("languages")}</span><strong>语言翻译</strong></button>
      <button type="button" class="${state.route === "tools/quality-score" ? "active" : ""}" data-route="tools/quality-score"><span class="tools-subnav-icon">${iconSvg("award")}</span><strong>综测核算</strong></button>
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
      <h2 class="section-title"><span>${iconSvg("toolbox")} 文档互转</span><a href="https://github.com/ONLYOFFICE/DocumentServer" target="_blank" rel="noreferrer">GitHub</a></h2>
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
      <h2 class="section-title"><span>${iconSvg("chart")} 全能计算器</span><a href="https://github.com/josdejong/mathjs" target="_blank" rel="noreferrer">math.js</a></h2>
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

function legacyQualityScorePanel() {
  return `
    <section class="dash-card tool-panel quality-score-panel">
      <h2 class="section-title"><span>${iconSvg("award")} 综测核算</span><small>简单版</small></h2>
      <p class="muted">按“基础分 × 权重 + 加分 - 扣分”的方式快速估算综合素质测评总分，适合先做个人预估，最终结果以学院正式细则和老师审核为准。</p>
      <form class="form tool-form quality-score-form" id="qualityScoreForm">
        <div class="quality-score-grid">
          <label class="field">
            <span>德育表现</span>
            <input name="moral" type="number" min="0" max="100" step="0.1" value="90" />
          </label>
          <label class="field">
            <span>智育成绩</span>
            <input name="academic" type="number" min="0" max="100" step="0.1" value="85" />
          </label>
          <label class="field">
            <span>体育健康</span>
            <input name="sport" type="number" min="0" max="100" step="0.1" value="88" />
          </label>
          <label class="field">
            <span>美育实践</span>
            <input name="aesthetic" type="number" min="0" max="100" step="0.1" value="80" />
          </label>
          <label class="field">
            <span>劳育服务</span>
            <input name="labor" type="number" min="0" max="100" step="0.1" value="86" />
          </label>
          <label class="field">
            <span>竞赛/荣誉加分</span>
            <input name="bonus" type="number" min="0" step="0.1" value="0" />
          </label>
          <label class="field">
            <span>违纪/缺勤扣分</span>
            <input name="deduct" type="number" min="0" step="0.1" value="0" />
          </label>
        </div>
        <div class="quality-weight-card">
          <strong>默认权重</strong>
          <span>德育 15%</span>
          <span>智育 60%</span>
          <span>体育 10%</span>
          <span>美育 5%</span>
          <span>劳育 10%</span>
        </div>
        <button class="primary-btn" type="submit">开始核算</button>
      </form>
      <div class="quality-score-result" id="qualityScoreResult">
        <div>
          <span>预估总分</span>
          <strong>--</strong>
        </div>
        <p>填写各项分数后点击核算，这里会显示等级、构成和提醒。</p>
      </div>
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
    if (resultBox) resultBox.innerHTML = `<strong>转换失败</strong><p>${escapeHtml(error.message)}</p>`;
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

function legacyComputeQualityScore(values) {
  const scoreOf = (name) => {
    const value = Number(values.get(name));
    if (!Number.isFinite(value)) throw new Error("请把各项分数填写完整");
    return Math.min(100, Math.max(0, value));
  };
  const parts = [
    { key: "moral", label: "德育", weight: 0.15, score: scoreOf("moral") },
    { key: "academic", label: "智育", weight: 0.6, score: scoreOf("academic") },
    { key: "sport", label: "体育", weight: 0.1, score: scoreOf("sport") },
    { key: "aesthetic", label: "美育", weight: 0.05, score: scoreOf("aesthetic") },
    { key: "labor", label: "劳育", weight: 0.1, score: scoreOf("labor") }
  ];
  const bonus = Math.max(0, Number(values.get("bonus") || 0));
  const deduct = Math.max(0, Number(values.get("deduct") || 0));
  const base = parts.reduce((sum, item) => sum + item.score * item.weight, 0);
  const total = Math.max(0, Math.min(100, base + bonus - deduct));
  const grade = total >= 90 ? "优秀" : total >= 80 ? "良好" : total >= 70 ? "中等" : total >= 60 ? "合格" : "需提升";
  return {
    total: Number(total.toFixed(2)),
    base: Number(base.toFixed(2)),
    bonus: Number(bonus.toFixed(2)),
    deduct: Number(deduct.toFixed(2)),
    grade,
    parts: parts.map((item) => ({
      ...item,
      contribution: Number((item.score * item.weight).toFixed(2))
    }))
  };
}

function legacyBindQualityScoreTool() {
  const form = document.querySelector("#qualityScoreForm");
  const resultBox = document.querySelector("#qualityScoreResult");
  if (!form || !resultBox) return;
  const render = () => {
    try {
      const result = computeQualityScore(new FormData(form));
      resultBox.innerHTML = `
        <div class="quality-score-main">
          <span>预估总分</span>
          <strong>${result.total}</strong>
          <em>${result.grade}</em>
        </div>
        <div class="quality-score-bars">
          ${result.parts
            .map(
              (item) => `
                <p style="--score:${item.score}%">
                  <span>${item.label}</span>
                  <b>${item.score} 分 · 折算 ${item.contribution}</b>
                </p>
              `
            )
            .join("")}
        </div>
        <small>基础折算 ${result.base}，加分 ${result.bonus}，扣分 ${result.deduct}。该结果仅作个人预估，正式综测以学院审核为准。</small>
      `;
    } catch (error) {
      toast(error.message);
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });
  form.querySelectorAll("input").forEach((input) => input.addEventListener("input", render));
  render();
}

const QUALITY_SCORE_STORAGE_KEY = "smart_campus_quality_score_2025_v2";
const QUALITY_SCORE_RULES = {
  version: "泰州学院经济与管理学院学生综合素质测评操作细则（2025新版）",
  modules: [
    { id: "moral", name: "德育素质", short: "德育", max: 28, baseMax: 18, bonusMax: 10, deductMax: 28, min: 0, owner: "班长、团支书、副班长" },
    { id: "academic", name: "智育素质", short: "智育", max: 48, baseMax: 38, bonusMax: 10, deductMax: 48, min: 0, owner: "副班长、组织委员、学习委员" },
    { id: "sport", name: "体育素质", short: "体育", max: 8, baseMax: 5, bonusMax: 8, deductMax: 8, min: 0, owner: "体育委员、心理委员" },
    { id: "aesthetic", name: "美育素质", short: "美育", max: 8, baseMax: 3, bonusMax: 8, deductMax: 8, min: 0, owner: "文娱委员、宣传委员" },
    { id: "labor", name: "劳育素质", short: "劳育", max: 8, baseMax: 4, bonusMax: 8, deductMax: 8, min: -8, owner: "实践委员、生活委员" }
  ],
  presets: {
    bonus: [
      { module: "moral", name: "德育：阳光引航主题学习全勤", points: 1, proof: "班级考勤或活动记录" },
      { module: "moral", name: "德育：核心价值观实践活动", points: 0.5, proof: "PU 截图，最高 4 分" },
      { module: "moral", name: "德育：入党积极分子", points: 0.5, proof: "政治身份认定材料" },
      { module: "moral", name: "德育：发展对象/预备党员", points: 1, proof: "政治身份认定材料" },
      { module: "moral", name: "德育：正式党员", points: 2, proof: "政治身份认定材料" },
      { module: "moral", name: "德育：院级荣誉称号", points: 1, proof: "荣誉证书或公示文件" },
      { module: "moral", name: "德育：校级/乡镇/街道荣誉", points: 2, proof: "荣誉证书或公示文件" },
      { module: "moral", name: "德育：省部级荣誉", points: 6, proof: "荣誉证书或公示文件" },
      { module: "academic", name: "智育：核心及以上论文/作品第一作者", points: 5, proof: "见刊截图、知网/万方链接" },
      { module: "academic", name: "智育：省级学术期刊论文第一作者", points: 2, proof: "见刊截图、检索链接" },
      { module: "academic", name: "智育：发明专利", points: 5, proof: "授权证明" },
      { module: "academic", name: "智育：实用新型/外观设计专利", points: 2, proof: "授权证明" },
      { module: "academic", name: "智育：计算机软件著作权", points: 1, proof: "软著证书" },
      { module: "academic", name: "智育：I 类国家级一等奖竞赛", points: 20, proof: "竞赛获奖证书，最终封顶 10 分" },
      { module: "academic", name: "智育：I 类省级一等奖竞赛", points: 9, proof: "竞赛获奖证书" },
      { module: "academic", name: "智育：大创省级重点结项主持人", points: 6, proof: "项目结项证明" },
      { module: "academic", name: "智育：CET-4 初次达标（大一下）", points: 0.5, proof: "成绩单" },
      { module: "academic", name: "智育：CET-6 初次达标（大二上）", points: 0.8, proof: "成绩单" },
      { module: "academic", name: "智育：计算机二级初次获得", points: 0.6, proof: "证书，按年级学期调整" },
      { module: "academic", name: "智育：专业资格证书", points: 1.5, proof: "证书，普通话/驾照不计" },
      { module: "academic", name: "智育：学术/创新创业讲座", points: 0.2, proof: "PU 截图，最高 2 分" },
      { module: "sport", name: "体育：体育/心理活动参与", points: 0.1, proof: "PU 截图或组织证明，最高 1 分" },
      { module: "sport", name: "体育：校级比赛一等奖/第 1 名", points: 1, proof: "获奖证书" },
      { module: "sport", name: "体育：院级比赛一等奖/第 1 名", points: 0.5, proof: "获奖证书" },
      { module: "sport", name: "体育：入选校级运动队", points: 1, proof: "队伍训练证明" },
      { module: "aesthetic", name: "美育：国家级纸媒作品第一作者", points: 3, proof: "作品截图、发刊地与链接" },
      { module: "aesthetic", name: "美育：校级艺术展演一等奖", points: 1, proof: "获奖证书" },
      { module: "aesthetic", name: "美育：艺术活动参与", points: 0.1, proof: "PU 截图或组织证明，最高 1 分" },
      { module: "labor", name: "劳育：学生组织主要负责人", points: 4, proof: "任职证明" },
      { module: "labor", name: "劳育：班长/团支书/学委/副部", points: 2, proof: "任职证明" },
      { module: "labor", name: "劳育：校级文明宿舍", points: 2, proof: "校内文件或通报" },
      { module: "labor", name: "劳育：院级宿舍表扬", points: 0.1, proof: "院内文件，最高 1 分" },
      { module: "labor", name: "劳育：省级社会实践团队负责人", points: 4, proof: "实践团队证明" }
    ],
    deduct: [
      { module: "moral", name: "德育：无故缺席思想政治教育活动", points: 3, proof: "考勤记录" },
      { module: "moral", name: "德育：不当网络言论被通报", points: 2, proof: "通报材料" },
      { module: "moral", name: "德育：违反班规", points: 0.5, proof: "班规记录" },
      { module: "moral", name: "德育：学院通报批评", points: 2, proof: "学院通报" },
      { module: "moral", name: "德育：警告处分", points: 3, proof: "处分决定" },
      { module: "moral", name: "德育：记过处分", points: 5, proof: "处分决定" },
      { module: "academic", name: "智育：上课迟到", points: 0.5, proof: "课堂考勤" },
      { module: "academic", name: "智育：旷课", points: 1, proof: "课堂考勤" },
      { module: "academic", name: "智育：虚假事/病假", points: 2, proof: "核查记录" },
      { module: "academic", name: "智育：代课或替他人上课", points: 2, proof: "核查记录" },
      { module: "sport", name: "体育：体育/心理活动缺席或不配合", points: 0.5, proof: "活动记录" },
      { module: "sport", name: "体育：跑操迟到/缺席", points: 0.5, proof: "跑操签到记录" },
      { module: "sport", name: "体育：违背体育精神", points: 4, proof: "比赛通报" },
      { module: "aesthetic", name: "美育：公共场合形象不符合要求", points: 1, proof: "记录或通报" },
      { module: "labor", name: "劳育：无故不服从劳动安排", points: 1, proof: "劳动安排记录" },
      { module: "labor", name: "劳育：宿舍校级通报", points: 1, proof: "校级通报" },
      { module: "labor", name: "劳育：宿舍院级通报", points: 0.1, proof: "院级通报" },
      { module: "labor", name: "劳育：活动后卫生不合格个别成员", points: 1, proof: "卫生检查通报" }
    ]
  },
  zeroRules: ["违反宪法、反对四项基本原则", "参与有损祖国尊严、荣誉、利益或危害社会秩序的活动", "违反国家法律法规并受到司法及有关部门处罚"],
  process: ["学生提交原始证明材料，班级按学期以个人文件夹形式留档", "班级综合测评工作小组审核、评议并汇总", "学院综合测评工作领导小组审定", "班级公示不少于 3 个工作日", "基础材料留档 1 学年，结果报送学生工作处备案"]
};

function qualityModule(id) {
  return QUALITY_SCORE_RULES.modules.find((item) => item.id === id) || QUALITY_SCORE_RULES.modules[0];
}

function qualityModuleOptions(selected = "moral") {
  return QUALITY_SCORE_RULES.modules
    .map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${item.short}</option>`)
    .join("");
}

function qualityPresetOptions(type) {
  return QUALITY_SCORE_RULES.presets[type]
    .map((item, index) => `<option value="${index}">${escapeHtml(item.name)}（${item.points} 分）</option>`)
    .join("");
}

function qualityModuleWorkbenchHtml() {
  const descriptions = {
    moral: "思想品德、荣誉称号、集体贡献、违纪风险",
    academic: "绩点折算、竞赛论文、证书等级、课堂表现",
    sport: "体育成绩、体育活动、比赛获奖、跑操考勤",
    aesthetic: "艺术课程、文艺活动、作品发表、公共形象",
    labor: "劳动课程、志愿时长、社会实践、职务贡献"
  };
  const formulas = {
    moral: "班主任/辅导员均值 + 工作组评分 + 加分 - 扣分",
    academic: "绩点 / 最高绩点 x 38 + 创新创业加分 - 学习扣分",
    sport: "体育课或体测 x 5% + 体育表现加分 - 扣分",
    aesthetic: "艺术课 x 3% + 美育表现加分 - 扣分",
    labor: "劳动课或志愿实践基础 + 劳育加分 - 扣分"
  };
  return `
    <div class="quality-module-workbench" aria-label="德智体美劳五个核算模块">
      ${QUALITY_SCORE_RULES.modules.map((module) => `
        <article class="quality-module-card" data-quality-focus="${module.id}">
          <div class="quality-module-card-head">
            <span>${module.short}</span>
            <strong>${module.max} 分</strong>
          </div>
          <p>${descriptions[module.id]}</p>
          <em>${formulas[module.id]}</em>
          <div class="quality-module-card-foot">
            <small>基础 ${module.baseMax} · 加分封顶 ${module.bonusMax} · 扣分上限 ${module.deductMax}</small>
            <button type="button" data-quality-focus-button="${module.id}">进入模块</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function qualityEvidenceImportHtml() {
  return `
    <div class="quality-section quality-evidence-section">
      <div class="quality-section-head">
        <div>
          <h3>证明材料智能识别</h3>
          <p>上传证书、PU截图、获奖证明或活动证明图片，系统先生成待确认建议；确认后才会写入对应模块，避免误判直接加分。</p>
        </div>
        <button class="ghost-btn" type="button" id="qualityEvidenceChoose">上传图片</button>
      </div>
      <input id="qualityEvidenceFile" type="file" accept="image/*,.pdf" hidden />
      <div class="quality-evidence-grid">
        <div class="quality-evidence-preview" id="qualityEvidencePreview">
          <strong>可识别材料</strong>
          <span>荣誉证书、竞赛获奖、英语/计算机等级、志愿服务、文艺体育活动、论文专利等。</span>
          <small>后续接入 OCR/视觉模型后，可自动读取图片文字并匹配细则项目。</small>
        </div>
        <div class="quality-evidence-suggestions" id="qualityEvidenceSuggestions">
          <strong>识别建议</strong>
          <span>上传材料后，这里会显示模块、项目、建议分值和证明名称。</span>
        </div>
      </div>
    </div>
  `;
}

function qualityCompletionHints(result) {
  const hints = [];
  result.parts.forEach((part) => {
    const hasProof = result.proofList.some((item) => item.includes(part.short));
    if ((part.rawBonus > 0 || part.rawDeduct > 0) && !hasProof) hints.push(`${part.short}已有加扣分，但证明材料不完整`);
    if (part.rawBonus > part.bonusMax) hints.push(`${part.short}加分超过封顶，建议保留最高价值证明`);
  });
  if (!result.proofList.length) hints.push("暂无证明材料，正式提交前请补齐证书、截图或公示文件");
  if (!hints.length) hints.push("材料链条较完整，可继续核对班级公示与学院审核流程");
  return hints;
}

function qualitySuggestEvidence(text = "") {
  const source = text.toLowerCase();
  const suggestions = [];
  const push = (module, name, points, proof) => suggestions.push({ module, name, points, count: 1, total: points, proof });
  if (/cet|四级|六级|英语/.test(source)) push("academic", "智育：英语等级证明待确认", 0.5, text || "英语等级考试成绩单");
  if (/计算机|二级|一级|office|ms/.test(source)) push("academic", "智育：计算机等级证书待确认", 0.6, text || "计算机等级证书");
  if (/竞赛|比赛|获奖|大创|论文|专利|软著/.test(source)) push("academic", "智育：竞赛/论文/专利成果待确认", 1, text || "获奖或成果证明");
  if (/荣誉|优秀|三好|干部|团员|党员|表彰/.test(source)) push("moral", "德育：荣誉称号或政治身份待确认", 1, text || "荣誉证书或公示文件");
  if (/体育|运动|跑操|篮球|足球|排球|羽毛球/.test(source)) push("sport", "体育：活动或比赛证明待确认", 0.5, text || "体育活动/比赛证明");
  if (/文艺|美育|艺术|书画|摄影|歌|舞|主持/.test(source)) push("aesthetic", "美育：文艺活动或作品证明待确认", 0.5, text || "美育活动/作品证明");
  if (/志愿|义工|劳动|实践|社区|服务|时长/.test(source)) push("labor", "劳育：志愿服务或社会实践证明待确认", 1, text || "志愿服务/社会实践证明");
  if (!suggestions.length) {
    push("moral", "待确认材料：请按证明内容选择模块", 0, text || "上传材料");
  }
  return suggestions.slice(0, 4);
}

function renderQualityEvidenceSuggestions(container, suggestions) {
  container.innerHTML = `
    <strong>识别建议</strong>
    ${suggestions.map((item, index) => `
      <article>
        <span>${qualityModule(item.module).short}</span>
        <b>${escapeHtml(item.name)}</b>
        <em>建议 ${item.points} 分 · ${escapeHtml(item.proof)}</em>
        <button type="button" data-quality-apply-suggestion="${index}">确认加入</button>
      </article>
    `).join("")}
  `;
  container.__qualitySuggestions = suggestions;
}

function qualityScorePanel() {
  return `
    <section class="dash-card tool-panel quality-score-panel">
      <div class="quality-hero">
        <div>
          <span class="eyebrow">2025 新版细则 · 五育综合评价</span>
          <h2>${iconSvg("award")} 综测核算</h2>
          <p>按泰州学院经济与管理学院综测细则拆分德育、智育、体育、美育、劳育，支持基础分、加分、扣分、封顶、材料提醒和结果导出。</p>
        </div>
        <div class="quality-rule-summary" aria-label="综测权重">
          ${QUALITY_SCORE_RULES.modules.map((item) => `<span><b>${item.short}</b><em>${item.max} 分</em></span>`).join("")}
        </div>
      </div>
      <form class="form tool-form quality-score-form" id="qualityScoreForm">
        <div class="quality-toolbar">
          <label class="field"><span>测评学期</span><select name="term"><option>2025-2026学年第二学期</option><option>2025-2026学年第一学期</option><option>2026-2027学年第一学期</option></select></label>
          <label class="field"><span>年级</span><select name="gradeLevel"><option value="1">大一</option><option value="2">大二</option><option value="3">大三</option><option value="4">大四</option></select></label>
          <label class="field"><span>学期段</span><select name="semesterPart"><option value="first">上学期</option><option value="second" selected>下学期</option></select></label>
          <button class="ghost-btn" type="button" data-quality-action="sample">填入示例</button>
          <button class="ghost-btn" type="button" data-quality-action="save">保存草稿</button>
          <button class="ghost-btn" type="button" data-quality-action="export">导出明细</button>
          <button class="ghost-btn danger" type="button" data-quality-action="reset">清空</button>
        </div>

        ${qualityModuleWorkbenchHtml()}
        ${qualityEvidenceImportHtml()}

        <div class="quality-section">
          <div class="quality-section-head"><h3>基础分录入</h3><p>基础分直接按细则公式折算，输入原始评分或成绩即可。</p></div>
          <div class="quality-score-grid">
            <label class="field"><span>班主任评分（0-9）</span><input name="moralTeacher" type="number" min="0" max="9" step="0.1" value="8.5" /></label>
            <label class="field"><span>辅导员评分（0-9）</span><input name="moralAdvisor" type="number" min="0" max="9" step="0.1" value="8.5" /></label>
            <label class="field"><span>班级工作组评分（0-9）</span><input name="moralGroup" type="number" min="0" max="9" step="0.1" value="8.5" /></label>
            <label class="field"><span>本人平均学分绩点</span><input name="gpa" type="number" min="0" max="5" step="0.001" value="3.2" /></label>
            <label class="field"><span>班级/年级最高绩点</span><input name="maxGpa" type="number" min="0.01" max="5" step="0.001" value="4.0" /></label>
            <label class="field"><span>体育课/体测成绩</span><input name="sportScore" type="number" min="0" max="100" step="0.1" value="85" /></label>
            <label class="field switch-field"><span>体育免测</span><input name="sportExempt" type="checkbox" /><em>免测基础分按 3 分</em></label>
            <label class="field"><span>公共艺术课程成绩</span><input name="artScore" type="number" min="0" max="100" step="0.1" value="90" /></label>
            <label class="field switch-field"><span>美育学分已修满</span><input name="artFull" type="checkbox" /><em>已修满按 3 分</em></label>
            <label class="field"><span>劳动教育成绩</span><input name="laborScore" type="number" min="0" max="100" step="0.1" value="90" /></label>
            <label class="field"><span>志愿/义务劳动时长</span><input name="volunteerHours" type="number" min="0" step="0.5" value="0" /></label>
            <label class="field"><span>假期社会实践次数</span><input name="practiceCount" type="number" min="0" max="2" step="1" value="0" /></label>
          </div>
        </div>

        <div class="quality-section quality-auto-section">
          <div class="quality-section-head"><h3>常见项目自动换算</h3><p>这些项目来自细则正文，系统会按年级/学期自动查表并纳入智育加分。</p></div>
          <div class="quality-score-grid">
            <label class="field">
              <span>英语等级初次达标</span>
              <select name="englishCert"><option value="">未填</option><option value="cet4">CET-4</option><option value="cet6">CET-6</option></select>
            </label>
            <label class="field">
              <span>计算机证书初次获得</span>
              <select name="computerCert"><option value="">未填</option><option value="level1">计算机一级</option><option value="level2">计算机二级</option></select>
            </label>
            <label class="field"><span>专业资格证数量</span><input name="professionalCertCount" type="number" min="0" step="1" value="0" /></label>
            <label class="field"><span>职业资格证数量</span><input name="careerCertCount" type="number" min="0" step="1" value="0" /></label>
            <label class="field"><span>学术/创新创业讲座次数</span><input name="lectureCount" type="number" min="0" step="1" value="0" /></label>
            <label class="field"><span>第二学位课程门数</span><input name="secondDegreeCourseCount" type="number" min="0" step="1" value="0" /></label>
          </div>
        </div>

        <div class="quality-formula-grid">
          <article><strong>德育</strong><span>班主任/辅导员均值 + 工作组评分 + 加分 - 扣分，最高 28 分</span></article>
          <article><strong>智育</strong><span>本人绩点 / 最高绩点 × 38 + 创新创业加分 - 学习表现扣分，最高 48 分</span></article>
          <article><strong>体育</strong><span>体育课或体测成绩 × 5% + 体育表现加分 - 扣分，最高 8 分</span></article>
          <article><strong>美育</strong><span>公共艺术课程成绩 × 3% + 美育表现加分 - 扣分，最高 8 分</span></article>
          <article><strong>劳育</strong><span>劳动课或志愿实践基础 + 劳育表现加分 - 扣分，可为负，最低 -8 分</span></article>
        </div>

        <div class="quality-section">
          <div class="quality-section-head"><h3>加分项目</h3><p>按 PDF 预设快速选择，也可手动改分。系统会按上限自动封顶。</p></div>
          <div class="quality-items" id="qualityBonusList" data-quality-list="bonus"></div>
          <button class="ghost-btn" type="button" data-add-quality-row="bonus">+ 添加加分项</button>
        </div>

        <div class="quality-section">
          <div class="quality-section-head"><h3>扣分项目</h3><p>扣分按细则逐项累计，同时受各模块扣分上限控制。</p></div>
          <div class="quality-items" id="qualityDeductList" data-quality-list="deduct"></div>
          <button class="ghost-btn" type="button" data-add-quality-row="deduct">+ 添加扣分项</button>
        </div>

        <div class="quality-section quality-risk-section">
          <div><h3>特殊风险与流程</h3><p>这些条款不会被普通加扣分替代，系统会在结果中单独提示。</p></div>
          <div class="quality-risk-grid">
            ${QUALITY_SCORE_RULES.zeroRules.map((rule, index) => `<label><input type="checkbox" name="zeroRule" value="${index}" /> ${rule}</label>`).join("")}
            <label><input type="checkbox" name="fakeMaterial" /> 测评过程中弄虚作假（德育素质记零）</label>
          </div>
        </div>

        <button class="primary-btn quality-submit" type="submit">实时核算综测</button>
      </form>
      <div class="quality-score-result" id="qualityScoreResult">
        <div class="quality-score-main"><span>综合测评总分</span><strong>--</strong><em>等待核算</em></div>
        <p>填写基础分和加扣分后，这里会展示五育构成、封顶提示、材料清单和流程提醒。</p>
      </div>
      <div class="quality-process-card">
        <strong>正式测评流程</strong>
        ${QUALITY_SCORE_RULES.process.map((item, index) => `<span>${index + 1}. ${item}</span>`).join("")}
      </div>
    </section>
  `;
}

function numberFromForm(values, name, fallback = 0) {
  const value = Number(values.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function laborVolunteerScore(hours) {
  if (hours <= 0) return 0;
  if (hours <= 10) return -2;
  if (hours <= 20) return -1.5;
  if (hours <= 30) return 1;
  if (hours <= 40) return 2;
  return 3;
}

function qualityTermSlot(values) {
  const grade = String(values.get("gradeLevel") || "1");
  const part = values.get("semesterPart") === "first" ? "first" : "second";
  return `${grade}-${part}`;
}

function englishCertificateScore(cert, slot) {
  const table = {
    cet4: { "1-first": 1, "1-second": 0.5 },
    cet6: { "1-first": 0, "1-second": 1, "2-first": 0.8, "2-second": 0.5, "3-first": 0.2, "3-second": 0.2 }
  };
  return table[cert]?.[slot] || 0;
}

function computerCertificateScore(cert, slot) {
  const table = {
    level1: { "1-first": 0.5, "1-second": 0.3 },
    level2: { "1-first": 1, "1-second": 0.8, "2-first": 0.6, "2-second": 0.4, "3-first": 0.2, "3-second": 0.1 }
  };
  return table[cert]?.[slot] || 0;
}

function collectQualityAutoBonusRows(values) {
  const slot = qualityTermSlot(values);
  const rows = [];
  const englishCert = values.get("englishCert");
  const englishScore = englishCertificateScore(englishCert, slot);
  if (englishCert && englishScore > 0) {
    rows.push({ type: "bonus", module: "academic", name: `智育：${englishCert === "cet4" ? "CET-4" : "CET-6"} 初次达标自动换算`, points: englishScore, count: 1, total: englishScore, proof: "英语等级考试成绩单" });
  }
  if (englishCert && englishScore <= 0) {
    rows.push({ type: "bonus", module: "academic", name: `智育：${englishCert === "cet4" ? "CET-4" : "CET-6"} 当前年级学期不加分`, points: 0, count: 1, total: 0, proof: "按细则查表为 0" });
  }
  const computerCert = values.get("computerCert");
  const computerScore = computerCertificateScore(computerCert, slot);
  if (computerCert && computerScore > 0) {
    rows.push({ type: "bonus", module: "academic", name: `智育：${computerCert === "level1" ? "计算机一级" : "计算机二级"} 初次获得自动换算`, points: computerScore, count: 1, total: computerScore, proof: "计算机等级证书" });
  }
  if (computerCert && computerScore <= 0) {
    rows.push({ type: "bonus", module: "academic", name: `智育：${computerCert === "level1" ? "计算机一级" : "计算机二级"} 当前年级学期不加分`, points: 0, count: 1, total: 0, proof: "按细则查表为 0" });
  }
  const professional = Math.max(0, numberFromForm(values, "professionalCertCount"));
  if (professional) {
    rows.push({ type: "bonus", module: "academic", name: "智育：专业资格证书", points: 1.5, count: professional, total: Number((professional * 1.5).toFixed(2)), proof: "专业资格证书，普通话/驾照不计" });
  }
  const career = Math.max(0, numberFromForm(values, "careerCertCount"));
  if (career) {
    rows.push({ type: "bonus", module: "academic", name: "智育：职业资格证书", points: 1, count: career, total: Number(career.toFixed(2)), proof: "职业资格证书" });
  }
  const lectures = Math.max(0, numberFromForm(values, "lectureCount"));
  if (lectures) {
    rows.push({ type: "bonus", module: "academic", name: "智育：学术/创新创业/职业规划讲座", points: 0.2, count: lectures, total: Math.min(2, Number((lectures * 0.2).toFixed(2))), proof: "PU 截图，最高 2 分" });
  }
  const secondDegree = Math.max(0, numberFromForm(values, "secondDegreeCourseCount"));
  if (secondDegree) {
    rows.push({ type: "bonus", module: "academic", name: "智育：第二学位专业相关课程", points: 1, count: secondDegree, total: Number(secondDegree.toFixed(2)), proof: "第二学历专业相关课程成绩，公共选修课不计" });
  }
  return rows;
}

function qualityRowHtml(type, item = {}) {
  const moduleId = item.module || "moral";
  const presetIndex = Number.isInteger(item.presetIndex) ? item.presetIndex : "";
  return `
    <article class="quality-item-row" data-quality-row="${type}">
      <select class="quality-preset"><option value="">自定义项目</option>${qualityPresetOptions(type)}</select>
      <select class="quality-module">${qualityModuleOptions(moduleId)}</select>
      <input class="quality-desc" value="${escapeHtml(item.name || "")}" placeholder="${type === "bonus" ? "加分项目名称" : "扣分项目名称"}" />
      <input class="quality-points" type="number" min="0" step="0.1" value="${item.points ?? 0}" />
      <input class="quality-count" type="number" min="0" step="1" value="${item.count || 1}" />
      <input class="quality-proof" value="${escapeHtml(item.proof || "")}" placeholder="证明材料 / 备注" />
      <button type="button" class="icon-btn quality-remove" aria-label="删除项目">×</button>
      <input type="hidden" class="quality-preset-index" value="${presetIndex}" />
    </article>
  `;
}

function collectQualityRows(type) {
  return [...document.querySelectorAll(`[data-quality-row="${type}"]`)].map((row) => {
    const points = Math.max(0, Number(row.querySelector(".quality-points")?.value || 0));
    const count = Math.max(0, Number(row.querySelector(".quality-count")?.value || 0));
    return {
      type,
      module: row.querySelector(".quality-module")?.value || "moral",
      name: row.querySelector(".quality-desc")?.value?.trim() || (type === "bonus" ? "未命名加分项" : "未命名扣分项"),
      points,
      count,
      total: Number((points * count).toFixed(2)),
      proof: row.querySelector(".quality-proof")?.value?.trim() || ""
    };
  }).filter((item) => item.total > 0 || item.name !== (type === "bonus" ? "未命名加分项" : "未命名扣分项"));
}

function computeQualityScore(values) {
  const warnings = [];
  const moralTeacher = clampNumber(numberFromForm(values, "moralTeacher"), 0, 9);
  const moralAdvisor = clampNumber(numberFromForm(values, "moralAdvisor"), 0, 9);
  const moralGroup = clampNumber(numberFromForm(values, "moralGroup"), 0, 9);
  const gpa = Math.max(0, numberFromForm(values, "gpa"));
  const maxGpa = Math.max(0.01, numberFromForm(values, "maxGpa", 1));
  const sportScore = clampNumber(numberFromForm(values, "sportScore"), 0, 100);
  const artScore = clampNumber(numberFromForm(values, "artScore"), 0, 100);
  const laborScore = clampNumber(numberFromForm(values, "laborScore"), 0, 100);
  const volunteerHours = Math.max(0, numberFromForm(values, "volunteerHours"));
  const practiceCount = clampNumber(numberFromForm(values, "practiceCount"), 0, 2);
  const base = {
    moral: ((moralTeacher + moralAdvisor) / 2) + moralGroup,
    academic: Math.min(38, (gpa / maxGpa) * 38),
    sport: values.get("sportExempt") === "on" ? 3 : (sportScore / 100) * 5,
    aesthetic: values.get("artFull") === "on" ? 3 : (artScore / 100) * 3,
    labor: Math.max(laborScore / 100 * 4, laborVolunteerScore(volunteerHours) + Math.min(1, practiceCount * 0.5))
  };
  if (moralTeacher < 7.5 || moralAdvisor < 7.5 || moralGroup < 7.5) warnings.push("德育三项评分中存在低于 7.5 分的情况，细则要求向学院工作组说明原因。");
  if (gpa > maxGpa) warnings.push("本人绩点高于最高绩点，智育基础分已按 38 分封顶。");
  const bonusRows = [...collectQualityAutoBonusRows(values), ...collectQualityRows("bonus")];
  const deductRows = collectQualityRows("deduct");
  const parts = QUALITY_SCORE_RULES.modules.map((module) => {
    const rawBonus = bonusRows.filter((row) => row.module === module.id).reduce((sum, row) => sum + row.total, 0);
    const rawDeduct = deductRows.filter((row) => row.module === module.id).reduce((sum, row) => sum + row.total, 0);
    const bonus = Math.min(module.bonusMax, rawBonus);
    const deduct = Math.min(module.deductMax, rawDeduct);
    if (rawBonus > module.bonusMax) warnings.push(`${module.short}加分 ${rawBonus.toFixed(1)} 分超过上限，已按 ${module.bonusMax} 分计。`);
    if (rawDeduct > module.deductMax) warnings.push(`${module.short}扣分 ${rawDeduct.toFixed(1)} 分超过上限，已按 ${module.deductMax} 分计。`);
    const score = clampNumber((base[module.id] || 0) + bonus - deduct, module.min, module.max);
    return {
      ...module,
      base: Number((base[module.id] || 0).toFixed(2)),
      rawBonus: Number(rawBonus.toFixed(2)),
      rawDeduct: Number(rawDeduct.toFixed(2)),
      bonus: Number(bonus.toFixed(2)),
      deduct: Number(deduct.toFixed(2)),
      score: Number(score.toFixed(2)),
      capped: rawBonus > module.bonusMax || rawDeduct > module.deductMax
    };
  });
  const zeroHits = values.getAll("zeroRule").map((index) => QUALITY_SCORE_RULES.zeroRules[Number(index)]).filter(Boolean);
  const fakeMaterial = values.get("fakeMaterial") === "on";
  let total = parts.reduce((sum, item) => sum + item.score, 0);
  if (zeroHits.length) {
    total = 0;
    warnings.push("存在综合测评记零事项，系统已将总分按 0 分提示。");
  }
  if (fakeMaterial) {
    const moral = parts.find((item) => item.id === "moral");
    if (moral) moral.score = 0;
    total = parts.reduce((sum, item) => sum + item.score, 0);
    warnings.push("勾选了弄虚作假：细则要求德育素质测评记零。");
  }
  const grade = total >= 90 ? "优秀" : total >= 80 ? "良好" : total >= 70 ? "中等" : total >= 60 ? "合格" : "需提升";
  const proofList = [...bonusRows, ...deductRows].filter((item) => item.proof).map((item) => `${qualityModule(item.module).short}：${item.name} - ${item.proof}`);
  return {
    total: Number(clampNumber(total, 0, 100).toFixed(2)),
    grade,
    parts,
    bonusRows,
    deductRows,
    warnings,
    zeroHits,
    proofList
  };
}

function renderQualityResult(resultBox, result) {
  resultBox.innerHTML = `
    <div class="quality-score-main">
      <span>综合测评总分</span>
      <strong>${result.total}</strong>
      <em>${result.grade}</em>
    </div>
    <div class="quality-result-body">
      <div class="quality-module-grid">
        ${result.parts.map((item) => `
          <article style="--score:${Math.max(0, item.score / item.max * 100)}%">
            <header><strong>${item.short}</strong><span>${item.score}/${item.max}</span></header>
            <p>基础 ${item.base} · 加 ${item.bonus} · 扣 ${item.deduct}</p>
            <i></i>
          </article>
        `).join("")}
      </div>
      <div class="quality-alerts ${result.warnings.length ? "" : "is-ok"}">
        <strong>${result.warnings.length ? "核算提醒" : "核算状态良好"}</strong>
        ${(result.warnings.length ? result.warnings : ["未触发封顶、记零或特殊风险提醒。"]).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="quality-proof-list">
        <strong>证明材料清单</strong>
        ${(result.proofList.length ? result.proofList : ["暂无材料项，请为加扣分项目补充证明材料。"]).slice(0, 8).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="quality-proof-list quality-completion-list">
        <strong>完整度建议</strong>
        ${qualityCompletionHints(result).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function exportQualityResult(result) {
  const rows = [
    ["模块", "基础分", "加分", "扣分", "模块得分"],
    ...result.parts.map((item) => [item.name, item.base, item.bonus, item.deduct, item.score]),
    [],
    ["项目类型", "模块", "名称", "单项分", "次数", "合计", "证明材料"],
    ...result.bonusRows.map((item) => ["加分", qualityModule(item.module).short, item.name, item.points, item.count, item.total, item.proof]),
    ...result.deductRows.map((item) => ["扣分", qualityModule(item.module).short, item.name, item.points, item.count, item.total, item.proof]),
    [],
    ["总分", result.total, "等级", result.grade]
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `综测核算明细-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindQualityScoreTool() {
  const form = document.querySelector("#qualityScoreForm");
  const resultBox = document.querySelector("#qualityScoreResult");
  if (!form || !resultBox) return;
  const render = () => {
    try {
      const result = computeQualityScore(new FormData(form));
      renderQualityResult(resultBox, result);
      return result;
    } catch (error) {
      toast(error.message || "综测核算失败");
      return null;
    }
  };
  const addRow = (type, item = {}) => {
    document.querySelector(`[data-quality-list="${type}"]`)?.insertAdjacentHTML("beforeend", qualityRowHtml(type, item));
  };
  const setActiveModule = (moduleId) => {
    form.dataset.activeQualityModule = moduleId;
    document.querySelectorAll("[data-quality-focus]").forEach((card) => {
      card.classList.toggle("active", card.dataset.qualityFocus === moduleId);
    });
  };
  const loadSaved = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUALITY_SCORE_STORAGE_KEY) || "null");
      if (!saved) return false;
      Object.entries(saved.fields || {}).forEach(([key, value]) => {
        const node = form.elements[key];
        if (!node) return;
        if (!("type" in node)) return;
        if (node.type === "checkbox") node.checked = Boolean(value);
        else node.value = value;
      });
      (saved.bonusRows || []).forEach((row) => addRow("bonus", row));
      (saved.deductRows || []).forEach((row) => addRow("deduct", row));
      return true;
    } catch {
      return false;
    }
  };
  if (!loadSaved()) {
    addRow("bonus", QUALITY_SCORE_RULES.presets.bonus[20]);
    addRow("deduct", {});
  }
  setActiveModule("moral");
  document.querySelectorAll("[data-quality-focus-button]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveModule(button.dataset.qualityFocusButton);
      document.querySelector("#qualityBonusList")?.closest(".quality-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`已切换到${qualityModule(button.dataset.qualityFocusButton).short}模块，新增项目会默认归入该模块`);
    });
  });
  const evidenceFile = document.querySelector("#qualityEvidenceFile");
  const evidenceChoose = document.querySelector("#qualityEvidenceChoose");
  const evidencePreview = document.querySelector("#qualityEvidencePreview");
  const evidenceSuggestions = document.querySelector("#qualityEvidenceSuggestions");
  evidenceChoose?.addEventListener("click", () => evidenceFile?.click());
  evidenceFile?.addEventListener("change", () => {
    const file = evidenceFile.files?.[0];
    if (!file || !evidencePreview || !evidenceSuggestions) return;
    const suggestions = qualitySuggestEvidence(file.name);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        evidencePreview.innerHTML = `<img src="${reader.result}" alt="证明材料预览" /><strong>${escapeHtml(file.name)}</strong><span>已生成待确认识别建议，请核对后加入。</span>`;
      };
      reader.readAsDataURL(file);
    } else {
      evidencePreview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>PDF 或文档材料已读取文件名，后续接 OCR 后可读取正文。</span><small>请先按建议确认模块和分值。</small>`;
    }
    renderQualityEvidenceSuggestions(evidenceSuggestions, suggestions);
    toast("已生成材料识别建议，请确认后加入加分项");
  });
  evidenceSuggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quality-apply-suggestion]");
    if (!button) return;
    const item = evidenceSuggestions.__qualitySuggestions?.[Number(button.dataset.qualityApplySuggestion)];
    if (!item) return;
    setActiveModule(item.module);
    addRow("bonus", item);
    render();
    toast("识别建议已加入加分项目，请核对分值和证明材料");
  });
  form.addEventListener("input", render);
  form.addEventListener("change", (event) => {
    const row = event.target.closest("[data-quality-row]");
    if (event.target.classList.contains("quality-preset") && row) {
      const type = row.dataset.qualityRow;
      const preset = QUALITY_SCORE_RULES.presets[type][Number(event.target.value)];
      if (preset) {
        row.querySelector(".quality-module").value = preset.module;
        row.querySelector(".quality-desc").value = preset.name;
        row.querySelector(".quality-points").value = preset.points;
        row.querySelector(".quality-count").value = 1;
        row.querySelector(".quality-proof").value = preset.proof;
      }
    }
    render();
  });
  form.addEventListener("click", (event) => {
    const addType = event.target.closest("[data-add-quality-row]")?.dataset.addQualityRow;
    if (addType) addRow(addType, { module: form.dataset.activeQualityModule || "moral" });
    if (event.target.closest(".quality-remove")) event.target.closest("[data-quality-row]")?.remove();
    const action = event.target.closest("[data-quality-action]")?.dataset.qualityAction;
    if (action === "sample") {
      document.querySelector("#qualityBonusList").innerHTML = "";
      document.querySelector("#qualityDeductList").innerHTML = "";
      [1, 5, 20, 28].forEach((index) => addRow("bonus", QUALITY_SCORE_RULES.presets.bonus[index]));
      [6].forEach((index) => addRow("deduct", QUALITY_SCORE_RULES.presets.deduct[index]));
      toast("已填入示例项目");
    }
    if (action === "save") {
      const fields = Object.fromEntries([...new FormData(form).entries()].filter(([key]) => key !== "zeroRule"));
      form.querySelectorAll("input[type='checkbox']").forEach((input) => {
        if (input.name !== "zeroRule") fields[input.name] = input.checked;
      });
      localStorage.setItem(QUALITY_SCORE_STORAGE_KEY, JSON.stringify({ fields, bonusRows: collectQualityRows("bonus"), deductRows: collectQualityRows("deduct") }));
      toast("综测草稿已保存");
    }
    if (action === "export") {
      const result = render();
      if (result) exportQualityResult(result);
    }
    if (action === "reset" && confirm("确定清空当前综测核算内容？")) {
      localStorage.removeItem(QUALITY_SCORE_STORAGE_KEY);
      form.reset();
      document.querySelector("#qualityBonusList").innerHTML = "";
      document.querySelector("#qualityDeductList").innerHTML = "";
      addRow("bonus", {});
      addRow("deduct", {});
      toast("已清空");
    }
    render();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });
  render();
}

const routes = {
  async dashboard() {
    const data = await api("/api/dashboard");
    const timetable = await getUnifiedTimetable(data.timetable);
    const recentCampusNews = data.recentCampusNews || [];
    const reservationSummary = data.reservationSummary || { approvedHours: 0, approvedCount: 0, pendingCount: 0, totalCount: 0, approvalRate: 0 };
    const recentReservations = data.recentReservations || [];
    setUnreadNotificationCount(data.summary?.unreadNotifications || 0);
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
            <h2 class="section-title"><span>${iconSvg("calendar")} 我的课表 · ${todayCourses.length} 门</span><button data-route="timetable">查看全部 ›</button></h2>
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
            <h2 class="section-title"><span>${iconSvg("grid")} 服务分区</span></h2>
            <div class="module-groups">
              ${visibleModuleGroups()
                .filter((group) => !["总览", "个人服务", "权限管理"].includes(group.title))
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
                                <span class="module-icon">${iconSvg(item.icon)}</span>
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
          <article class="dash-card notice-card campus-news-preview">
            <h2 class="section-title"><span>${iconSvg("news")} 校园资讯</span><button data-route="news">查看全部 ›</button></h2>
            <div class="notice-list">
              ${recentCampusNews.slice(0, 5)
                .map((item) => `<div><span></span><p><b>${escapeHtml(item.title || "校园资讯")}</b><small>${escapeHtml(item.source || item.category || "泰州学院")}</small></p><time>${escapeHtml(item.date || String(item.fullDate || "").slice(5) || "--")}</time></div>`)
                .join("") || `<div class="empty">近 3 天暂无校园资讯</div>`}
            </div>
          </article>
          <article class="dash-card reserve-card">
            <h2 class="section-title"><span>${iconSvg("lab")} 实验室预约</span><button data-route="labs">查看全部 ›</button></h2>
            <div id="dashboardReservationBody" aria-live="polite">
              ${dashboardReservationMarkup(reservationSummary, recentReservations)}
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
        clearInterval(window.dashboardReservationTimer);
        window.dashboardReservationTimer = setInterval(refreshDashboardReservationPanel, 30 * 1000);
        document.querySelectorAll(".pay-entry").forEach((button) => {
          button.addEventListener("click", async () => {
            try {
              const payment = await api("/api/payments/create", {
                method: "POST",
                body: JSON.stringify({
                  provider: button.dataset.provider,
                  scene: button.dataset.scene,
                  amount: Number(button.dataset.amount)
                })
              });
              if (payment.checkoutUrl) {
                location.assign(payment.checkoutUrl);
                return;
              }
              if (payment.message) toast(payment.message);
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
              renderShell();
            } catch (error) {
              toast(error.message);
            }
          });
        });
      }
    };
  },

  async "lab-approval"() {
    if (!canAccessStudentAdmin()) throw new Error("仅管理员可访问预约审批");
    const data = await api("/api/admin/reservations");
    const reservations = data.reservations || [];
    const counts = {
      all: reservations.length,
      pending: reservations.filter((item) => item.status === "pending").length,
      approved: reservations.filter((item) => item.status === "approved").length,
      rejected: reservations.filter((item) => item.status === "rejected").length
    };
    return {
      title: "预约审批",
      subtitle: "集中审核实验室预约申请",
      content: `
        <section class="card lab-approval-page">
          <div class="lab-approval-heading">
            <div>
              <span class="eyebrow">教学服务 · 管理员专属</span>
              <h2>实验室预约审批</h2>
              <p class="muted">核对申请人、预约时段与使用用途后完成审批。</p>
            </div>
            <span class="badge warning">${counts.pending} 项待处理</span>
          </div>
          <div class="lab-approval-stats">
            <button class="lab-approval-filter active" type="button" data-approval-filter="all"><strong>${counts.all}</strong><span>全部申请</span></button>
            <button class="lab-approval-filter" type="button" data-approval-filter="pending"><strong>${counts.pending}</strong><span>待审核</span></button>
            <button class="lab-approval-filter" type="button" data-approval-filter="approved"><strong>${counts.approved}</strong><span>已通过</span></button>
            <button class="lab-approval-filter" type="button" data-approval-filter="rejected"><strong>${counts.rejected}</strong><span>未通过</span></button>
          </div>
          <div class="list lab-approval-list">
            ${reservations.map((item) => `
              <article class="row lab-approval-row" data-approval-status="${escapeHtml(item.status)}">
                <div class="row-main">
                  <p class="row-title">${escapeHtml(item.labName)} <span class="badge ${statusClass(item.status)}">${statusText(item.status)}</span></p>
                  <p class="row-meta">${escapeHtml(item.slot)} · ${escapeHtml(item.reason || "未填写用途")}</p>
                  <p class="row-meta">申请人：${escapeHtml(item.userName || item.studentNo || item.userId)} · 学号/工号：${escapeHtml(item.studentNo || "-")} · ${escapeHtml(item.updatedAt || "")}</p>
                  ${item.adminNote ? `<p class="row-meta">审批意见：${escapeHtml(item.adminNote)}</p>` : ""}
                </div>
                ${item.status === "pending" ? `
                  <div class="row-actions">
                    <button class="ghost-btn" type="button" data-reservation-review="${item.id}" data-review-status="approved">通过</button>
                    <button class="ghost-btn danger" type="button" data-reservation-review="${item.id}" data-review-status="rejected">驳回</button>
                  </div>
                ` : ""}
              </article>
            `).join("") || `<div class="empty">暂无预约申请</div>`}
            <div class="empty lab-approval-filter-empty" hidden>该分类暂无预约申请</div>
          </div>
        </section>
      `,
      afterRender() {
        document.querySelectorAll("[data-approval-filter]").forEach((button) => {
          button.addEventListener("click", () => {
            const filter = button.dataset.approvalFilter;
            let visibleCount = 0;
            document.querySelectorAll("[data-approval-filter]").forEach((item) => item.classList.toggle("active", item === button));
            document.querySelectorAll("[data-approval-status]").forEach((row) => {
              const visible = filter === "all" || row.dataset.approvalStatus === filter;
              row.hidden = !visible;
              if (visible) visibleCount += 1;
            });
            const empty = document.querySelector(".lab-approval-filter-empty");
            if (empty) empty.hidden = visibleCount !== 0;
          });
        });
        document.querySelectorAll("[data-reservation-review]").forEach((button) => {
          button.addEventListener("click", async () => {
            try {
              await api("/api/admin/reservations/review", {
                method: "POST",
                body: JSON.stringify({
                  id: button.dataset.reservationReview,
                  status: button.dataset.reviewStatus,
                  adminNote: button.dataset.reviewStatus === "approved" ? "管理员已通过预约申请" : "管理员已驳回预约申请"
                })
              });
              toast(button.dataset.reviewStatus === "approved" ? "预约已通过" : "预约已驳回");
              renderShell();
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
    const notifications = data.notifications || [];
    const unreadCount = Number(data.unreadCount ?? notifications.filter((item) => !item.read).length);
    setUnreadNotificationCount(unreadCount);
    return {
      title: "消息通知",
      subtitle: "查看预约审批与校园服务消息",
      content: `
        <section class="card notification-center">
          <header class="notification-toolbar">
            <div>
              <strong>消息通知</strong>
              <span>未读 <b id="notificationUnreadCount">${unreadCount}</b> 条 · 保存最近 ${data.retentionDays || 14} 天，最多 ${data.maxItems || 100} 条</span>
            </div>
            <button type="button" class="ghost-btn" id="markAllNotificationsRead" ${unreadCount ? "" : "disabled"}>全部标为已读</button>
          </header>
          <div class="list notification-list">
            ${notifications
              .map(
                (item) => `
                  <article class="row notification-row ${item.read ? "" : "unread"}" data-notification-id="${escapeHtml(item.id)}" data-read="${item.read ? "1" : "0"}" ${item.read ? "" : 'role="button" tabindex="0"'}>
                    <span class="notification-status-dot" aria-hidden="true"></span>
                    <div class="row-main">
                      <p class="row-title">${escapeHtml(item.title)}</p>
                      <p class="row-meta">${escapeHtml(item.body)} · ${escapeHtml(item.createdAt)}</p>
                    </div>
                    <span class="badge ${item.read ? "" : "warning"}">${item.read ? "已读" : "未读"}</span>
                  </article>
                `
              )
              .join("") || `<div class="empty">暂无消息通知</div>`}
          </div>
        </section>
      `,
      afterRender() {
        const unreadNode = document.querySelector("#notificationUnreadCount");
        const allButton = document.querySelector("#markAllNotificationsRead");
        const applyUnreadCount = (count) => {
          setUnreadNotificationCount(count);
          if (unreadNode) unreadNode.textContent = String(count);
          if (allButton) allButton.disabled = count === 0;
        };
        const markRowRead = async (row) => {
          if (!row || row.dataset.read === "1") return;
          const result = await api("/api/notifications/read", {
            method: "POST",
            body: JSON.stringify({ id: row.dataset.notificationId })
          });
          row.dataset.read = "1";
          row.classList.remove("unread");
          row.removeAttribute("role");
          row.removeAttribute("tabindex");
          const badge = row.querySelector(".badge");
          if (badge) {
            badge.classList.remove("warning");
            badge.textContent = "已读";
          }
          applyUnreadCount(Number(result.unreadCount || 0));
        };
        document.querySelectorAll(".notification-row").forEach((row) => {
          row.addEventListener("click", () => markRowRead(row));
          row.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            markRowRead(row);
          });
        });
        allButton?.addEventListener("click", async () => {
          allButton.disabled = true;
          const result = await api("/api/notifications/read", {
            method: "POST",
            body: JSON.stringify({ all: true })
          });
          document.querySelectorAll(".notification-row").forEach((row) => {
            row.dataset.read = "1";
            row.classList.remove("unread");
            row.removeAttribute("role");
            row.removeAttribute("tabindex");
            const badge = row.querySelector(".badge");
            if (badge) {
              badge.classList.remove("warning");
              badge.textContent = "已读";
            }
          });
          applyUnreadCount(Number(result.unreadCount || 0));
          toast("消息已全部标为已读");
        });
      }
    };
  },

  async news() {
    const data = await api("/api/campus-news");
    const liveCount = (data.sources || []).filter((item) => item.status === "live").length;
    const officialStatus = data.sourceStatus === "live"
      ? "全部官网已连接"
      : data.sourceStatus === "partial-no-official"
        ? "部分来源暂不可达"
        : data.sourceStatus === "stale"
          ? "网络波动，正在显示缓存"
          : data.sourceStatus === "warming"
            ? "正在连接官网来源"
          : "官网暂不可达";
    const newsCategories = [...new Set((data.items || []).map((item) => item.category).filter(Boolean))];
    return {
      title: "校园资讯",
      subtitle: "聚合泰州学院官网、二级学院、团委与职能部门公开资讯",
      content: `
        <section class="news-page">
          <div class="dash-card news-source-card">
            <h2 class="section-title"><span>${iconSvg("news")} 泰州学院多源校园资讯</span><button id="refreshCampusNews">刷新资讯</button></h2>
            <div class="source-meta">
              <span>强制官网源：https://www.tzu.edu.cn</span>
              <span>更新状态：${officialStatus}</span>
              <span>公开源在线：${liveCount}/${(data.sources || []).length}</span>
              <span>更新时间：${data.updatedAt || "后台获取中"}</span>
              <span>缓存：${Math.round(data.cacheSeconds / 60)} 分钟</span>
              ${data.refreshing ? "<span>后台更新中</span>" : ""}
            </div>
            <p class="muted">本页聚合泰州学院官网、二级学院、团委和职能部门公开页面，只读取公开文章链接；登录态、内部门户与私有接口不参与抓取。</p>
            <div class="news-source-grid">
              ${(data.sources || []).map((source) => `
                <a class="news-source-chip ${source.status === "live" ? "ok" : source.status === "requires-official-api" ? "locked" : "error"}" href="${escapeHtml(source.url || data.source)}" target="_blank" rel="noreferrer">
                  <strong>${escapeHtml(source.name)}</strong>
                  <span>${source.status === "live" ? `${source.count || 0} 条` : source.status === "requires-official-api" ? "需官方接口" : "暂不可达"}</span>
                </a>
              `).join("")}
            </div>
            ${canAccessStudentAdmin() ? `<form class="news-import-form" id="newsImportForm">
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
            </form>` : ""}
          </div>
          <div class="dash-card news-filter-bar">
            <label class="news-filter-search"><span>${iconSvg("search")}</span><input id="campusNewsSearch" placeholder="搜索标题或来源..." /></label>
            <select id="campusNewsCategory" aria-label="按类别筛选">
              <option value="">全部类别</option>
              ${newsCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
            </select>
            <span id="campusNewsResultCount">共 ${(data.items || []).length} 条</span>
          </div>
          <div class="news-list-grid" id="campusNewsList" aria-live="polite"></div>
          <nav class="news-pagination" id="campusNewsPagination" aria-label="校园资讯分页">
            <button type="button" data-news-page-action="previous" aria-label="上一页" title="上一页">‹</button>
            <div id="campusNewsPageNumbers"></div>
            <button type="button" data-news-page-action="next" aria-label="下一页" title="下一页">›</button>
          </nav>
        </section>
      `,
      afterRender() {
        const newsSearch = document.querySelector("#campusNewsSearch");
        const newsCategory = document.querySelector("#campusNewsCategory");
        const newsCount = document.querySelector("#campusNewsResultCount");
        const newsList = document.querySelector("#campusNewsList");
        const pagination = document.querySelector("#campusNewsPagination");
        const pageNumbers = document.querySelector("#campusNewsPageNumbers");
        const allItems = data.items || [];
        const pageSize = 12;
        let currentPage = 1;
        let searchTimer = 0;
        let refreshPollTimer = 0;
        const pageTokens = (totalPages) => {
          if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
          let start = Math.max(2, currentPage - 1);
          let end = Math.min(totalPages - 1, currentPage + 1);
          if (currentPage <= 4) end = 5;
          if (currentPage >= totalPages - 3) start = totalPages - 4;
          const tokens = [1];
          if (start > 2) tokens.push("ellipsis-start");
          for (let page = start; page <= end; page += 1) tokens.push(page);
          if (end < totalPages - 1) tokens.push("ellipsis-end");
          tokens.push(totalPages);
          return tokens;
        };
        const renderNewsPage = () => {
          const query = newsSearch.value.trim().toLowerCase();
          const category = newsCategory.value;
          const matches = allItems.filter((item) => (
            (!query || `${item.title || ""} ${item.source || ""}`.toLowerCase().includes(query))
            && (!category || item.category === category)
          ));
          const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
          currentPage = Math.min(currentPage, totalPages);
          const startIndex = (currentPage - 1) * pageSize;
          const pageItems = matches.slice(startIndex, startIndex + pageSize);
          newsList.innerHTML = pageItems.length
            ? pageItems.map((item) => `
                <article class="news-item dash-card">
                  <div>
                    <span class="badge">${escapeHtml(item.category || "校园资讯")}</span>
                    <time>${escapeHtml(item.date || "最新")}</time>
                  </div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.source)}</p>
                  <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看原文</a>
                </article>
              `).join("")
            : '<div class="news-empty-state">没有找到符合条件的校园资讯</div>';
          newsCount.textContent = matches.length
            ? `共 ${matches.length} 条 · 第 ${currentPage}/${totalPages} 页`
            : "共 0 条";
          pagination.hidden = matches.length <= pageSize;
          pagination.querySelector('[data-news-page-action="previous"]').disabled = currentPage <= 1;
          pagination.querySelector('[data-news-page-action="next"]').disabled = currentPage >= totalPages;
          pageNumbers.innerHTML = pageTokens(totalPages).map((token) => typeof token === "number"
            ? `<button type="button" data-news-page="${token}" class="${token === currentPage ? "active" : ""}" aria-label="第 ${token} 页" ${token === currentPage ? 'aria-current="page"' : ""}>${token}</button>`
            : '<span class="news-page-ellipsis" aria-hidden="true">…</span>').join("");
        };
        newsSearch.addEventListener("input", () => {
          window.clearTimeout(searchTimer);
          searchTimer = window.setTimeout(() => { currentPage = 1; renderNewsPage(); }, 160);
        });
        newsCategory.addEventListener("change", () => { currentPage = 1; renderNewsPage(); });
        pagination.addEventListener("click", (event) => {
          const pageButton = event.target.closest("[data-news-page]");
          const actionButton = event.target.closest("[data-news-page-action]");
          if (pageButton) currentPage = Number(pageButton.dataset.newsPage || 1);
          else if (actionButton?.dataset.newsPageAction === "previous") currentPage -= 1;
          else if (actionButton?.dataset.newsPageAction === "next") currentPage += 1;
          else return;
          renderNewsPage();
          document.querySelector(".news-filter-bar")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        renderNewsPage();
        if (data.refreshing) {
          let refreshAttempts = 0;
          const pollForRefreshedNews = async () => {
            if (location.hash !== "#news") return;
            refreshAttempts += 1;
            try {
              const refreshedNews = await api("/api/campus-news");
              if (!refreshedNews.refreshing) {
                renderShell();
                return;
              }
            } catch {
              // Keep the current cached view and retry quietly.
            }
            if (refreshAttempts < 8) refreshPollTimer = window.setTimeout(pollForRefreshedNews, 1200);
          };
          refreshPollTimer = window.setTimeout(pollForRefreshedNews, 1200);
        }
        document.querySelector("#refreshCampusNews").addEventListener("click", async (event) => {
          const button = event.currentTarget;
          if (button.disabled) return;
          button.disabled = true;
          button.textContent = "刷新中...";
          toast("正在刷新泰州学院官网资讯");
          try {
            window.clearTimeout(refreshPollTimer);
            await api("/api/campus-news?refresh=1");
            renderShell();
          } catch (error) {
            toast(error.message || "资讯刷新失败，请稍后重试");
            button.disabled = false;
            button.textContent = "刷新资讯";
          }
        });
        document.querySelector("#newsImportForm")?.addEventListener("submit", async (event) => {
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
    const examPageSize = 12;
    const renderExamCard = (item) => `
      <article class="exam-card dash-card">
        <div class="exam-card-head">
          <div>
            <span class="badge">${escapeHtml(item.category)}</span>
            <h3>${escapeHtml(item.name)}</h3>
          </div>
          <span class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
        </div>
        <div class="exam-meta-row">
          <span>含金量：${escapeHtml(item.valueLabel)} · ${Number(item.valueScore) || 0}</span>
          <span>舆情样本：${item.publicOpinion?.sampleSize || "-"} · 置信度${escapeHtml(item.publicOpinion?.confidence || "-")}</span>
          <span>时间精度：${escapeHtml(item.datePrecision)}</span>
          <span>官网链接：${item.linksReady ? "三入口已核验" : "部分待复核"}</span>
        </div>
        <div class="exam-timeline">
          <div><span>报名时间</span><strong>${escapeHtml(item.registrationTime)}</strong></div>
          <div><span>考试时间</span><strong>${escapeHtml(item.examTime)}</strong></div>
          <div><span>查分时间</span><strong>${escapeHtml(item.scoreTime)}</strong></div>
        </div>
        <p class="exam-source">来源：${escapeHtml(item.source)}</p>
        <p class="exam-risk">${escapeHtml(item.riskNote)}</p>
        <p class="exam-risk">舆情方法：${escapeHtml(item.publicOpinion?.method || "待更新")}</p>
        <div class="exam-actions">
          <a href="${escapeHtml(item.signupUrl)}" target="_blank" rel="noreferrer">报名入口</a>
          <a href="${escapeHtml(item.scoreUrl)}" target="_blank" rel="noreferrer">成绩查询</a>
          <a href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noreferrer">官网公告</a>
        </div>
      </article>
    `;
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
              <span class="search-icon">${iconSvg("search")}</span>
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
              ${categories.map((category) => `<button class="exam-filter ${category === "全部" ? "active" : ""}" data-exam-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
            </div>
          </div>

          <div class="exam-results-bar">
            <span id="examResultSummary" aria-live="polite"></span>
            <span>仅加载当前页，浏览更流畅</span>
          </div>
          <div class="exam-grid" id="examGrid"></div>
          <nav class="exam-pagination" id="examPagination" aria-label="考试报名分页"></nav>
        </section>
      `,
      afterRender() {
        const filters = [...document.querySelectorAll(".exam-filter")];
        const grid = document.querySelector("#examGrid");
        const search = document.querySelector("#examSearch");
        const sort = document.querySelector("#examSort");
        const summary = document.querySelector("#examResultSummary");
        const pagination = document.querySelector("#examPagination");
        let category = "全部";
        let page = 1;

        const sortedItems = () => {
          const keyword = search.value.trim().toLowerCase();
          return data.items.filter((item) => {
            const matchCategory = category === "全部" || item.category === category;
            const searchText = `${item.name} ${item.category} ${item.source}`.toLowerCase();
            return matchCategory && (!keyword || searchText.includes(keyword));
          }).sort((a, b) => {
            if (sort.value === "value") return Number(b.valueScore) - Number(a.valueScore);
            if (sort.value === "status") return (statusRank[a.status] || 9) - (statusRank[b.status] || 9);
            return String(a.nextExamDate || "9999-12-31").localeCompare(String(b.nextExamDate || "9999-12-31"))
              || Number(b.valueScore) - Number(a.valueScore);
          });
        };

        const pageNumbers = (current, total) => {
          const candidates = [1, total, current - 2, current - 1, current, current + 1, current + 2]
            .filter((value) => value >= 1 && value <= total);
          return [...new Set(candidates)].sort((a, b) => a - b);
        };

        const renderExamPage = (resetPage = false) => {
          if (resetPage) page = 1;
          const items = sortedItems();
          const totalPages = Math.max(1, Math.ceil(items.length / examPageSize));
          page = Math.min(page, totalPages);
          const start = (page - 1) * examPageSize;
          const visibleItems = items.slice(start, start + examPageSize);
          grid.innerHTML = visibleItems.length
            ? visibleItems.map(renderExamCard).join("")
            : `<div class="exam-empty">没有找到符合条件的考试，请更换关键词或分类。</div>`;
          summary.textContent = items.length
            ? `显示 ${start + 1}-${start + visibleItems.length} 项，共 ${items.length} 项`
            : "共 0 项";

          const numbers = pageNumbers(page, totalPages);
          const controls = [];
          controls.push(`<button type="button" data-exam-page="prev" ${page === 1 ? "disabled" : ""} aria-label="上一页">‹</button>`);
          numbers.forEach((number, index) => {
            if (index > 0 && number - numbers[index - 1] > 1) controls.push('<span class="exam-page-gap">…</span>');
            controls.push(`<button type="button" data-exam-page="${number}" class="${number === page ? "active" : ""}" ${number === page ? 'aria-current="page"' : ""}>${number}</button>`);
          });
          controls.push(`<button type="button" data-exam-page="next" ${page === totalPages ? "disabled" : ""} aria-label="下一页">›</button>`);
          pagination.innerHTML = controls.join("");
          pagination.hidden = items.length <= examPageSize;
        };

        filters.forEach((button) => {
          button.addEventListener("click", () => {
            category = button.dataset.examCategory;
            filters.forEach((item) => item.classList.toggle("active", item === button));
            renderExamPage(true);
          });
        });
        search.addEventListener("input", () => renderExamPage(true));
        sort.addEventListener("change", () => renderExamPage(true));
        pagination.addEventListener("click", (event) => {
          const button = event.target.closest("button[data-exam-page]");
          if (!button || button.disabled) return;
          const action = button.dataset.examPage;
          if (action === "prev") page -= 1;
          else if (action === "next") page += 1;
          else page = Number(action);
          renderExamPage();
          document.querySelector(".exam-results-bar")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        renderExamPage();
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
    const settings = getTimetableSettings();
    const importedCourses = currentPersonalCourses();
    const importedImage = getTimetableImage();
    const allCourses = data.courses.map((course) => ({
      ...course,
      time: courseTimeLabel(course, settings.schedule)
    }));
    const coursePalette = new Map(
      [...new Set(allCourses.map((course) => String(course.course || course.id)))].sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((name, index) => [name, index])
    );
    const visibleCourses = allCourses.filter((course) => courseMatchesTimetable(course, settings));
    const todayDay = todayDayName();
    const todayCourses = visibleCourses.filter((course) => course.day === todayDay);
    const conflicts = courseConflicts(visibleCourses);
    const dateLabels = dayDateLabels(settings.week, settings.weekOneStart);
    const scheduleTimes = TIMETABLE_SCHEDULES[settings.schedule] || TIMETABLE_SCHEDULES.summer;
    const sectionOptions = Array.from({ length: 12 }, (_, index) => index + 1);
    const canManageTimetableCalendar = canAccessStudentAdmin();
    window.__currentTimetableCourses = allCourses;
    return {
      title: "课表查询",
      subtitle: "学期周次、夏冬作息、中文导入与自定义课程管理",
      content: `
        <section class="timetable-page">
          <div class="timetable-main">
            <section class="timetable-studio dash-card">
              <div class="timetable-studio-copy">
                <h2>我的课表</h2>
              </div>
              <div class="timetable-control-grid">
                <label>
                  <span>学期</span>
                  <select id="timetableSemester">
                    ${TIMETABLE_SEMESTERS.map((semester) => `<option value="${semester}" ${semester === settings.semester ? "selected" : ""}>${semester}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>周数</span>
                  <div class="week-switcher">
                    <button type="button" data-timetable-week-step="-1">‹</button>
                    <select id="timetableWeek">
                      ${TIMETABLE_WEEKS.map((week) => `<option value="${week}" ${week === settings.week ? "selected" : ""}>第 ${week} 周</option>`).join("")}
                    </select>
                    <button type="button" data-timetable-week-step="1">›</button>
                  </div>
                </label>
                ${canManageTimetableCalendar ? `
                  <label class="week-one-start-field">
                    <span>第一周周一</span>
                    <div class="week-one-start-control">
                      <input id="timetableWeekOneStart" type="date" value="${escapeHtml(settings.weekOneStart)}" />
                      <button id="saveTimetableWeekOneStart" class="ghost-btn" type="button">保存并同步</button>
                    </div>
                    <small>管理员指定后，所有周次日期按此推算</small>
                  </label>
                ` : ""}
                <div class="schedule-switch">
                  <span>作息</span>
                  <div>
                    <button type="button" class="${settings.schedule === "summer" ? "active" : ""}" data-timetable-schedule="summer">夏季 14:30</button>
                    <button type="button" class="${settings.schedule === "winter" ? "active" : ""}" data-timetable-schedule="winter">冬季 14:00</button>
                  </div>
                </div>
              </div>
            </section>
            ${importedImage ? `
              <section class="dash-card timetable-image-panel">
                <div class="timetable-image-head">
                  <div>
                    <span class="timetable-board-kicker">图片课表参考</span>
                    <h2>${escapeHtml(importedImage.name || "我的课表截图")}</h2>
                    <p>${escapeHtml(importedImage.importedAt || "")} 导入，可对照下方网格点击添加课程。</p>
                  </div>
                  <button class="ghost-btn" data-timetable-action="clear-image" type="button">移除图片</button>
                </div>
                <div class="timetable-image-frame">
                  <img src="${importedImage.dataUrl}" alt="导入的课表截图" />
                </div>
              </section>
            ` : ""}
            <section class="smart-timetable dash-card">
              <div class="timetable-board-head">
                <div>
                  <span class="timetable-board-kicker">第 ${settings.week} 周 · ${settings.semester}</span>
                  <h2>${iconSvg("calendar")} 周课表</h2>
                </div>
                <span class="timetable-toolbar">
                  <button id="addTimetableCourse" type="button">添加课程</button>
                  <button id="openTimetableImport" type="button">导入课表</button>
                  <button id="exportTimetable" type="button">导出 Excel</button>
                </span>
              </div>
              <div class="timetable-note-row">
                <span>第一周：${escapeHtml(settings.weekOneStart)}</span>
                <span>${settings.schedule === "summer" ? "夏季作息：下午第 6 节 14:30 开始" : "冬季作息：下午第 6 节 14:00 开始"} · 晚课第 10-12 节固定 19:00 开始</span>
                <span>点击空白格添加课程，点击课程块修改</span>
              </div>
              <div class="timetable-grid-wrap">
                <div class="timetable-grid">
                  <div class="grid-corner">节次</div>
                  ${dateLabels.map(({ day, date }) => `<div class="grid-day ${day === todayDay ? "today" : ""}"><strong>${day}</strong><span>${date}</span></div>`).join("")}
                  ${sectionOptions.map((section) => `
                    <div class="grid-time" style="grid-column: 1; grid-row: ${section + 1};">
                      <strong>${section}</strong>
                      <span>${scheduleTimes[section - 1]}</span>
                    </div>
                    ${weekDays.map((day, dayIndex) => `
                      <button type="button" class="grid-slot" data-course-add data-day="${day}" data-section="${section}" style="grid-column: ${dayIndex + 2}; grid-row: ${section + 1};" aria-label="添加 ${day} 第 ${section} 节课程"></button>
                    `).join("")}
                  `).join("")}
                  ${visibleCourses.map((course) => {
                    const dayIndex = Math.max(0, weekDays.indexOf(normalizeDay(course.day)));
                    const { gridRowStart, gridRowSpan } = timetableGridPlacement(course);
                    return `
                      <button type="button" class="timetable-course-card" data-course-edit="${escapeHtml(course.id)}" style="grid-column: ${dayIndex + 2}; grid-row: ${gridRowStart} / span ${gridRowSpan}; ${timetableCourseGradient(course, coursePalette.get(String(course.course || course.id)) || 0)}">
                        <span>${escapeHtml(courseTimeLabel(course, settings.schedule))}</span>
                        <strong>${escapeHtml(course.course)}</strong>
                        <em>${escapeHtml(course.location || "未填写教室")}</em>
                        <small class="course-teacher">任课教师：${escapeHtml(course.teacher || "待补充")}</small>
                      </button>
                    `;
                  }).join("")}
                </div>
              </div>
            </section>
          </div>
          <div class="timetable-edit-modal timetable-import-modal hidden" id="timetableImportModal">
            <div class="timetable-edit-card timetable-import-card">
              <div class="modal-title-row">
                <h2>中文课表导入</h2>
                <button type="button" data-timetable-import-close>×</button>
              </div>
              <p class="muted">支持 Excel / CSV 导入，也支持上传手机课表截图自动识别。图片识别需要服务端已配置 AI 视觉模型。</p>
              <div class="import-format-card">
                <strong>示例</strong>
                <span>2025-2026学年第二学期｜1-16｜周一｜1｜2｜高等数学｜明德楼301｜刘老师｜可空</span>
                <span>周次支持：1-20、1,3,5、1-8；连续节数可填 2 或 3。</span>
              </div>
              <input id="timetableFile" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden />
              <input id="timetableImageFile" type="file" accept="image/png,image/jpeg,image/webp" hidden />
              <div class="import-action-row">
                <button class="primary-btn" id="chooseTimetableFile" type="button">选择 Excel 导入</button>
                <button class="ghost-btn" id="chooseTimetableImage" type="button">图片自动识别</button>
                <button class="ghost-btn" id="downloadTimetableExample" type="button">下载导入示例</button>
              </div>
              <div class="actions">
                <button class="ghost-btn" id="clearTimetable" data-timetable-action="clear" type="button">清空本地课表</button>
              </div>
              <div class="import-stats">
                <span><strong>${importedCourses.length}</strong> 本地课程</span>
                <span><strong>${conflicts.length}</strong> 冲突提醒</span>
              </div>
            </div>
          </div>
          <div class="timetable-edit-modal hidden" id="timetableEditModal">
            <form class="timetable-edit-card" id="timetableEditForm">
              <div class="modal-title-row">
                <h2>添加 / 修改课程</h2>
                <button type="button" data-timetable-edit-close>×</button>
              </div>
              <input type="hidden" name="id" />
              <label class="field">
                <span>学期</span>
                <select name="semester">
                  ${TIMETABLE_SEMESTERS.map((semester) => `<option value="${semester}">${semester}</option>`).join("")}
                </select>
              </label>
              <label class="field">
                <span>周次</span>
                <input name="weeks" placeholder="例如：1-16 或 1,3,5" />
              </label>
              <label class="field">
                <span>星期</span>
                <select name="day">
                  ${weekDays.map((day) => `<option value="${day}">${day}</option>`).join("")}
                </select>
              </label>
              <div class="field-pair">
                <label class="field">
                  <span>开始节次</span>
                  <select name="startSection">
                    ${sectionOptions.map((section) => `<option value="${section}">第 ${section} 节</option>`).join("")}
                  </select>
                </label>
                <label class="field">
                  <span>连续节数</span>
                  <select name="sectionCount">
                    <option value="1">1 节</option>
                    <option value="2">2 节</option>
                    <option value="3">3 节</option>
                    <option value="4">4 节</option>
                  </select>
                </label>
              </div>
              <label class="field">
                <span>课程名称</span>
                <input name="course" placeholder="请输入课程名称" required />
              </label>
              <label class="field">
                <span>上课地点</span>
                <input name="location" placeholder="教学楼 / 教室" />
              </label>
              <label class="field">
                <span>任课教师</span>
                <input name="teacher" placeholder="教师姓名" />
              </label>
              <label class="field">
                <span>备注</span>
                <input name="note" placeholder="单双周、实验课、考试周等" />
              </label>
              <div class="modal-actions">
                <button type="button" class="ghost-btn hidden" id="deleteTimetableCourse">删除课程</button>
                <button type="button" class="ghost-btn" data-timetable-edit-close>取消</button>
                <button type="submit" class="primary-btn">保存课程</button>
              </div>
            </form>
          </div>
        </section>
      `,
      afterRender() {
        bindTimetableControls();
        bindTimetableImportModal();
        bindTimetableEditor();
        const exportButton = document.querySelector("#exportTimetable");
        exportButton.addEventListener("click", async () => {
          if (exportButton.disabled) return;
          exportButton.disabled = true;
          try {
            const result = await api("/api/timetable/export", {
              method: "POST",
              body: JSON.stringify({ courses: visibleCourses })
            });
            if (!result.fileBase64) throw new Error("课表文件生成失败");
            const binary = atob(result.fileBase64);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = "智慧校园中文课表.xlsx";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
          } catch (error) {
            toast(error.message || "课表导出失败，请稍后重试");
          } finally {
            exportButton.disabled = false;
          }
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
              const orderResult = await api("/api/canteen/orders", {
                method: "POST",
                body: JSON.stringify({
                  foodId: form.dataset.foodId,
                  deliveryPoint: formData.get("deliveryPoint"),
                  paymentMethod: formData.get("paymentMethod")
                })
              });
              const payment = await api("/api/payments/create", {
                method: "POST",
                body: JSON.stringify({
                  provider: formData.get("paymentMethod"),
                  scene: "食堂外卖",
                  orderId: orderResult.order.id
                })
              });
              if (payment.checkoutUrl) {
                location.assign(payment.checkoutUrl);
                return;
              }
              if (payment.message) toast(payment.message);
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
    const serverAi = await api("/api/ai/status");
    if (localStorage.getItem("smart_campus_ai_schema") !== AI_PANEL_SCHEMA) {
      localStorage.removeItem("smart_campus_ai_config");
      localStorage.removeItem("smart_campus_ai_messages");
      localStorage.removeItem(AI_MESSAGES_KEY);
      localStorage.setItem("smart_campus_ai_schema", AI_PANEL_SCHEMA);
    }
    const storedConfig = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || "{}");
    const activeProvider = aiProviderPresets.find((item) => item.id === storedConfig.provider)
      || aiProviderPresets.find((item) => item.id === serverAi.provider)
      || aiProviderPresets.find((item) => item.id === "deepseek")
      || aiProviderPresets[0];
    const conversations = loadAiConversations();
    let activeConversationId = localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
    let activeConversation = conversations.find((item) => item.id === activeConversationId);
    if (!activeConversation) {
      activeConversation = conversations[0];
      activeConversationId = activeConversation.id;
      localStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, activeConversationId);
    }
    const storedMessages = Array.isArray(activeConversation.messages) ? activeConversation.messages : [];
    const hasMessages = storedMessages.length > 0;
    let trashedConversations = [];
    try {
      trashedConversations = JSON.parse(localStorage.getItem(AI_TRASH_KEY) || "[]");
    } catch {
      trashedConversations = [];
    }
    const providerOptions = aiProviderPresets
      .map((provider) => `<option value="${provider.id}" ${provider.id === activeProvider.id ? "selected" : ""}>${provider.name} · ${provider.region}</option>`)
      .join("");
    return {
      title: "AI 助手",
      subtitle: "真实模型驱动的通用问答、写作、编程、学习与分析助手",
      content: `
        <section class="ai-page ai-agent-workspace">
          <aside class="ai-side-panel dash-card">
            <div class="ai-conversation-head">
              <div><span class="ai-panel-icon">${iconSvg("sparkles")}</span><strong>会话</strong></div>
              <button type="button" title="收起会话栏">${iconSvg("grid")}</button>
            </div>
            <button class="ai-side-action active" data-ai-new-chat><span>＋</span>新建对话</button>
            <div class="ai-recents">
              <p>最近会话</p>
              ${conversations.map((conversation) => `
                <div class="ai-conversation-item ${conversation.id === activeConversationId ? "active" : ""}">
                  <button type="button" data-ai-conversation="${conversation.id}"><span>${escapeHtml(conversation.title || "新对话")}</span><time>${new Date(conversation.updatedAt || Date.now()).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></button>
                  <button type="button" data-ai-delete-conversation="${conversation.id}" title="移入回收站">×</button>
                </div>
              `).join("")}
            </div>
            <button class="ai-recycle-action" type="button" data-ai-empty-trash>${iconSvg("database")}<span>回收站${trashedConversations.length ? ` · ${trashedConversations.length}` : ""}</span></button>
          </aside>

          <main class="ai-chat-panel dash-card">
            <header class="ai-chat-head">
              <div class="ai-active-model">
                <span class="ai-model-mark">${iconSvg("sparkles")}</span>
                <div><h2>全能 AI 助手</h2><p>${activeProvider.name} · ${storedConfig.model || serverAi.model}</p></div>
              </div>
              <button class="ai-service-pill" type="button" data-ai-config-open><i class="${storedConfig.apiKey || serverAi.configured ? "online" : ""}"></i>${storedConfig.apiKey || serverAi.configured ? "服务正常" : "等待配置"}</button>
            </header>

            <div class="ai-message-stage ${hasMessages ? "has-messages" : "empty"}" id="aiMessageStage">
              <div class="ai-landing">
                <span class="ai-landing-mark">${iconSvg("sparkles")}</span>
                <h3>今天想让我帮你做什么？</h3>
                <p>学习、工作、创作与分析，都可以从这里开始</p>
              </div>
              <div class="ai-messages" id="aiMessages">
                ${storedMessages.map((message) => `
                  <article class="ai-message ${message.role}">
                    <span>${message.role === "assistant" ? "AI" : "我"}</span>
                    <div><p>${escapeHtml(message.text)}</p><em>${message.time}</em></div>
                  </article>
                `).join("")}
              </div>
            </div>

            <div class="ai-suggestion-row">
              ${[["总结文档", "news"], ["生成 PPT", "grid"], ["润色文本", "sparkles"], ["学习辅导", "award"]].map(([label, icon]) => `<button data-ai-prompt="${label}">${iconSvg(icon)}<span>${label}</span></button>`).join("")}
            </div>

            <form class="ai-composer" id="aiComposer">
              <textarea name="prompt" rows="2" placeholder="输入问题，或使用 / 唤起指令" autocomplete="off"></textarea>
              <div class="ai-composer-tools">
                <button type="button" data-ai-mode="chat" class="active">${iconSvg("news")}聊天</button>
                <button type="button" data-ai-prompt="图片生成">${iconSvg("grid")}图片生成</button>
                <button type="button" data-ai-file-open>${iconSvg("toolbox")}文件上传</button>
                <button type="button" data-ai-prompt="制定学习规划">${iconSvg("calendar")}学习规划</button>
                <button type="button" data-ai-prompt="生成 PPT">${iconSvg("chart")}生成 PPT</button>
              </div>
              <input id="aiFileInput" type="file" accept=".txt,.md,.csv,.json,.js,.ts,.html,.css" hidden />
              <button class="ai-send-button" type="submit" title="发送">${iconSvg("sparkles")}</button>
            </form>
            <p class="ai-disclaimer">内容由 AI 生成，请注意甄别参考。</p>
          </main>

          <aside class="ai-config-modal" id="aiConfigModal">
            <form class="ai-config-card" id="aiConfigForm">
              <div class="ai-config-head">
                <div><strong>模型与 API 配置</strong><p>当前浏览器的个人配置</p></div>
                <button type="button" data-ai-config-close title="收起配置">×</button>
              </div>
              <section class="ai-current-model-card">
                <span class="ai-provider-avatar">${activeProvider.name.slice(0, 1)}</span>
                <div><strong>${activeProvider.name}</strong><p>${storedConfig.model || activeProvider.model}</p></div>
                <span class="badge success">当前</span>
              </section>
              <label class="field"><span>模型服务商</span><select name="provider" id="aiProviderSelect">${providerOptions}</select></label>
              <div class="ai-provider-list">
                ${aiProviderPresets.filter((provider) => ["openai", "anthropic", "gemini", "deepseek", "qwen", "kimi", "zhipu", "doubao"].includes(provider.id)).map((provider) => `
                  <button type="button" class="${provider.id === activeProvider.id ? "active" : ""}" data-ai-provider="${provider.id}">
                    <span>${provider.name.slice(0, 1)}</span><strong>${provider.name.replace(/\s*\/.*$/, "")}</strong><i></i>
                  </button>
                `).join("")}
              </div>
              <label class="field"><span>API Key</span><input name="apiKey" type="password" value="${escapeHtml(storedConfig.apiKey || "")}" placeholder="输入你的 API Key" autocomplete="off" /></label>
              <label class="field"><span>模型名称</span><input name="model" value="${storedConfig.model || activeProvider.model}" /></label>
              <label class="field"><span>Base URL</span><input name="baseUrl" value="${storedConfig.baseUrl || activeProvider.baseUrl}" /></label>
              <input name="protocol" type="hidden" value="${storedConfig.protocol || activeProvider.protocol}" />
              <div class="ai-config-actions">
                <button class="ghost-btn" type="button" id="aiTestConfig">检查连接</button>
                <button class="primary-btn" type="submit">保存个人配置</button>
              </div>
              <div class="ai-connection-status">
                <strong>连接状态</strong>
                <p><span>API 调用</span><b>${storedConfig.apiKey || serverAi.configured ? "可测试" : "待配置"}</b></p>
                <p><span>密钥存储</span><b>当前浏览器</b></p>
                <p><span>Agent 能力</span><b>持续扩展</b></p>
              </div>
              <p class="ai-key-note">密钥保存在此浏览器中，调用时经本站服务器转发，不会写入项目代码或管理员配置。</p>
            </form>
          </aside>
        </section>
      `,
      afterRender() {
        const modal = document.querySelector("#aiConfigModal");
        const providerSelect = document.querySelector("#aiProviderSelect");
        const configForm = document.querySelector("#aiConfigForm");
        const composer = document.querySelector("#aiComposer");
        const messageList = document.querySelector("#aiMessages");
        const stage = document.querySelector("#aiMessageStage");
        const fileInput = document.querySelector("#aiFileInput");
        const getActiveConversation = () => {
          const list = loadAiConversations();
          const id = localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
          return list.find((item) => item.id === id) || list[0];
        };
        const getMessages = () => getActiveConversation()?.messages || [];
        const saveMessages = (messages) => {
          const list = loadAiConversations();
          const id = localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
          const conversation = list.find((item) => item.id === id) || list[0];
          conversation.messages = messages;
          conversation.updatedAt = new Date().toISOString();
          const firstPrompt = messages.find((item) => item.role === "user")?.text?.trim();
          if (firstPrompt && (!conversation.title || conversation.title === "新对话")) conversation.title = firstPrompt.slice(0, 24);
          saveAiConversations(list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
          localStorage.setItem(AI_MESSAGES_KEY, JSON.stringify(messages));
        };
        const renderMessages = (messages) => {
          messageList.innerHTML = messages
            .map(
              (message, index) => `
                <article class="ai-message ${message.role}">
                  <span>${message.role === "assistant" ? "AI" : "我"}</span>
                  <div>
                    ${message.pending ? `
                      <div class="ai-thinking-progress" role="status" aria-live="polite">
                        <div><span class="ai-thinking-spinner"></span><strong>${message.text || "正在处理"}</strong></div>
                        <ol><li>理解问题</li><li>读取会话上下文</li><li>组织回答</li></ol>
                      </div>
                    ` : `
                      ${message.role === "assistant" && message.durationMs
                        ? `<div class="ai-thinking-summary">${iconSvg("sparkles")}<span>思考了 ${(message.durationMs / 1000).toFixed(1)} 秒</span></div>`
                        : ""}
                      <p>${escapeHtml(message.text)}</p>
                      <div class="ai-message-meta"><em>${message.time}</em></div>
                      <div class="ai-message-actions">
                        <button type="button" data-ai-copy-message="${index}" title="复制" aria-label="复制">${iconSvg("copy")}</button>
                        ${message.role === "assistant" ? `<button type="button" data-ai-regenerate="${index}" title="重新生成" aria-label="重新生成">${iconSvg("refresh")}</button>` : ""}
                      </div>
                    `}
                  </div>
                </article>
              `
            )
            .join("");
          stage.classList.toggle("has-messages", messages.length > 0);
          stage.classList.toggle("empty", messages.length === 0);
          requestAnimationFrame(() => {
            stage.scrollTop = stage.scrollHeight;
          });
        };
        const requestAssistant = async (messages, pendingMessage) => {
          try {
            const result = await api("/api/ai/chat", {
              method: "POST",
              body: JSON.stringify({
                config: JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || "{}"),
                messages: messages.filter((item) => item !== pendingMessage)
              })
            });
            pendingMessage.text = result.reply;
            pendingMessage.pending = false;
            pendingMessage.durationMs = Date.now() - pendingMessage.startedAt;
            pendingMessage.time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
            saveMessages(messages);
            renderMessages(messages);
            if (result.warning) toast(result.warning);
          } catch (error) {
            pendingMessage.text = `AI 调用失败：${error.message}`;
            pendingMessage.pending = false;
            pendingMessage.durationMs = Date.now() - pendingMessage.startedAt;
            pendingMessage.time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
            saveMessages(messages);
            renderMessages(messages);
          }
        };
        document.querySelectorAll("[data-ai-config-open]").forEach((button) => {
          button.addEventListener("click", () => {
            modal.classList.remove("hidden");
            modal.classList.add("drawer-open");
          });
        });
        document.querySelector("[data-ai-config-close]").addEventListener("click", () => {
          modal.classList.remove("drawer-open");
          modal.classList.add("hidden");
        });
        providerSelect.addEventListener("change", () => {
          const provider = aiProviderPresets.find((item) => item.id === providerSelect.value);
          configForm.protocol.value = provider.protocol;
          configForm.baseUrl.value = provider.baseUrl;
          configForm.model.value = provider.model;
          document.querySelectorAll("[data-ai-provider]").forEach((button) => button.classList.toggle("active", button.dataset.aiProvider === provider.id));
        });
        document.querySelectorAll("[data-ai-provider]").forEach((button) => {
          button.addEventListener("click", () => {
            providerSelect.value = button.dataset.aiProvider;
            providerSelect.dispatchEvent(new Event("change"));
          });
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
          modal.classList.remove("drawer-open");
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
          const list = loadAiConversations();
          const now = new Date().toISOString();
          const conversation = { id: aiConversationId(), title: "新对话", messages: [], createdAt: now, updatedAt: now };
          list.unshift(conversation);
          saveAiConversations(list);
          localStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, conversation.id);
          renderShell();
        });
        document.querySelectorAll("[data-ai-conversation]").forEach((button) => {
          button.addEventListener("click", () => {
            localStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, button.dataset.aiConversation);
            renderShell();
          });
        });
        document.querySelectorAll("[data-ai-delete-conversation]").forEach((button) => {
          button.addEventListener("click", () => {
            const list = loadAiConversations();
            if (list.length === 1) {
              toast("至少保留一个会话");
              return;
            }
            const index = list.findIndex((item) => item.id === button.dataset.aiDeleteConversation);
            if (index < 0) return;
            const [removed] = list.splice(index, 1);
            let trash = [];
            try { trash = JSON.parse(localStorage.getItem(AI_TRASH_KEY) || "[]"); } catch { trash = []; }
            localStorage.setItem(AI_TRASH_KEY, JSON.stringify([removed, ...trash].slice(0, 30)));
            if (localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY) === removed.id) localStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, list[0].id);
            saveAiConversations(list);
            toast("会话已移入回收站");
            renderShell();
          });
        });
        document.querySelector("[data-ai-empty-trash]")?.addEventListener("click", () => {
          const trash = JSON.parse(localStorage.getItem(AI_TRASH_KEY) || "[]");
          if (!trash.length) {
            toast("回收站为空");
            return;
          }
          localStorage.removeItem(AI_TRASH_KEY);
          toast("回收站已清空");
          renderShell();
        });
        document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
          button.addEventListener("click", () => {
            composer.prompt.value = button.dataset.aiPrompt;
            composer.prompt.dispatchEvent(new Event("input"));
            composer.prompt.focus();
          });
        });
        document.querySelector("[data-ai-file-open]")?.addEventListener("click", () => fileInput.click());
        fileInput?.addEventListener("change", async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            toast("文本文件不能超过 2MB");
            fileInput.value = "";
            return;
          }
          try {
            const text = await file.text();
            composer.prompt.value = `请分析文件《${file.name}》并给出重点、结论和建议：\n\n${text.slice(0, 16000)}`;
            composer.prompt.dispatchEvent(new Event("input"));
            composer.prompt.focus();
            toast(`已读取 ${file.name}`);
          } catch {
            toast("无法读取该文件");
          }
          fileInput.value = "";
        });
        composer.prompt.addEventListener("input", () => {
          composer.prompt.style.height = "auto";
          composer.prompt.style.height = `${Math.min(150, Math.max(40, composer.prompt.scrollHeight))}px`;
        });
        messageList.addEventListener("click", async (event) => {
          const copyButton = event.target.closest("[data-ai-copy-message]");
          if (copyButton) {
            const message = getMessages()[Number(copyButton.dataset.aiCopyMessage)];
            if (!message) return;
            try {
              await navigator.clipboard.writeText(message.text);
              toast("内容已复制");
            } catch {
              toast("复制失败，请手动选择文字");
            }
            return;
          }
          const regenerateButton = event.target.closest("[data-ai-regenerate]");
          if (!regenerateButton) return;
          const messages = getMessages();
          const assistantIndex = Number(regenerateButton.dataset.aiRegenerate);
          let userIndex = assistantIndex - 1;
          while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
          if (userIndex < 0) return;
          messages.splice(userIndex + 1);
          const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          const pendingMessage = { role: "assistant", text: "正在重新生成", time, pending: true, startedAt: Date.now() };
          messages.push(pendingMessage);
          saveMessages(messages);
          renderMessages(messages);
          requestAssistant(messages, pendingMessage);
        });
        composer.prompt.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            composer.requestSubmit();
          }
        });
        composer.addEventListener("submit", (event) => {
          event.preventDefault();
          const prompt = new FormData(composer).get("prompt").trim();
          if (!prompt) return;
          const messages = getMessages();
          const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          messages.push({ role: "user", text: prompt, time });
          const pendingMessage = { role: "assistant", text: "正在思考并组织回答", time, pending: true, startedAt: Date.now() };
          messages.push(pendingMessage);
          saveMessages(messages);
          composer.reset();
          renderMessages(messages);
          requestAssistant(messages, pendingMessage);
        });
        renderMessages(storedMessages);
      }
    };
  },

  async software() {
    const softwareCatalog = await fetch("/assets/software-catalog.json?v=software-real-icons-v107-20260619").then((response) => {
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
            <label class="software-search"><span class="search-icon">${iconSvg("search")}</span><input id="softwareKeyword" placeholder="搜索软件名称、用途、平台或版本..." /></label>
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
                  <div class="software-icon image">${softwareIconMarkup(item)}</div>
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
        bindSoftwareIconFallbacks();
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
              <div class="software-detail-icon">${softwareIconMarkup(item, "detail")}</div>
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
          bindSoftwareIconFallbacks(detailContent);
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
              <h2 class="section-title"><span>${iconSvg("chart")} 全能计算器</span><a href="https://github.com/josdejong/mathjs" target="_blank" rel="noreferrer">math.js</a></h2>
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

  async "tools/quality-score"() {
    return {
      title: "综测核算",
      subtitle: "依据 2025 新版细则的德智体美劳全流程核算工具",
      content: `
        <section class="tools-page tool-detail-page">
          ${toolBackbar("综测核算", "按学院综测细则录入基础分、加分、扣分与证明材料，自动处理封顶、记零风险、公示流程和明细导出。")}
          <div class="tool-detail-grid">${qualityScorePanel()}</div>
        </section>
      `,
      afterRender() {
        bindQualityScoreTool();
      }
    };
  },

  async "class-timetable-admin"() {
    return {
      title: "班级课表导入",
      subtitle: "管理员按班级集中发布课表",
      content: `
        <section class="student-admin-page">
          <div class="card student-admin-toolbar">
            <div>
              <span class="admin-kicker">集中导入</span>
              <h2>班级课表发布中心</h2>
              <p>这个页面和学生个人导入分开：个人导入只自己可见；班级导入会按学生身份库中的班级字段匹配发布范围。</p>
            </div>
            <div class="admin-current-role"><span>当前权限</span><strong>${accountRoleLabel(state.user.role)}</strong><small>管理员专属入口</small></div>
          </div>
          <div class="admin-work-grid">
            <div class="card">
              <h2 class="section-title">导入范围</h2>
              <form class="form student-entry-form">
                <label class="field"><span>学校</span><input value="泰州学院" /></label>
                <label class="field"><span>学院</span><input placeholder="例如：经济与管理学院" /></label>
                <label class="field"><span>专业</span><input placeholder="例如：数字经济" /></label>
                <label class="field"><span>班级</span><input placeholder="例如：数字经济2401班" /></label>
                <button class="primary-btn" type="button" disabled>选择课表文件后发布</button>
              </form>
            </div>
            <div class="card">
              <h2 class="section-title">Excel 模板</h2>
              <div class="admin-import-guide">
                <p>班级集中导入使用身份库的学校、学院、专业、班级作为匹配条件，课表字段与个人课表一致。</p>
                <code>学期、周次、星期、开始节次、连续节数、课程名称、上课地点、任课教师、备注</code>
              </div>
              <a class="ghost-btn admin-template-download" href="/downloads/templates/课表导入示例.xlsx" download="课表导入示例.xlsx">下载当前课表示例</a>
              <div class="admin-import-result">班级字段已接入身份库数据库，后续批量发布会按班级匹配对应学生。</div>
            </div>
          </div>
        </section>
      `
    };
  },

  async "ai-admin"() {
    let config = null;
    let loadError = "";
    try {
      config = await adminApi("/api/admin/ai-config");
    } catch (error) {
      loadError = error.message;
      config = { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", requestsPerMinute: 12, systemPrompt: "" };
    }
    const providerOptions = [
      ["openai", "OpenAI / Responses API"],
      ["qwen", "通义千问 Qwen-VL"],
      ["doubao", "火山方舟 / 豆包"],
      ["glm", "智谱 GLM"],
      ["custom", "自定义兼容接口"]
    ];
    return {
      title: "AI 模型配置",
      subtitle: "仅总管理员可见，用于 AI 助手与课表图片 OCR",
      content: `
        <section class="ai-admin-page">
          <div class="card ai-admin-hero">
            <div>
              <span class="admin-kicker">总管理员专属</span>
              <h2>AI 助手与课表 OCR 配置</h2>
              <p>这里保存服务端模型参数。普通管理员、老师、学生和游客不会看到该入口，也不能调用保存接口。</p>
            </div>
            <div class="ai-admin-status ${config.configured ? "ready" : ""}">
              <span>${config.configured ? "已配置" : "未配置"}</span>
              <strong>${escapeHtml(config.model || "未选择模型")}</strong>
              <small>${escapeHtml(config.provider || "openai")} · ${escapeHtml(config.baseUrl || "")}</small>
            </div>
          </div>
          ${loadError ? `<div class="card admin-alert">${escapeHtml(loadError)}</div>` : ""}
          <div class="ai-admin-grid">
            <form class="card form ai-admin-form" id="aiAdminForm">
              <h2 class="section-title">模型服务</h2>
              <label class="field"><span>服务商</span><select name="provider">${providerOptions.map(([value, label]) => `<option value="${value}" ${config.provider === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
              <label class="field"><span>接口地址</span><input name="baseUrl" value="${escapeHtml(config.baseUrl || "")}" placeholder="https://api.openai.com/v1" required /></label>
              <label class="field"><span>模型名称</span><input name="model" value="${escapeHtml(config.model || "")}" placeholder="gpt-5.5 / qwen-vl-plus / glm-4v-plus" required /></label>
              <label class="field"><span>API Key</span><input name="apiKey" type="password" placeholder="${config.keySaved ? "已保存，留空则不修改" : "请输入服务商 API Key"}" autocomplete="off" /></label>
              <label class="field"><span>每分钟请求上限</span><input name="requestsPerMinute" type="number" min="1" max="120" value="${Number(config.requestsPerMinute || 12)}" /></label>
              <label class="field"><span>系统提示词</span><textarea name="systemPrompt" rows="5" placeholder="定义 AI 助手的回答风格和边界">${escapeHtml(config.systemPrompt || "")}</textarea></label>
              <div class="ai-admin-actions">
                <button class="primary-btn" type="submit">保存配置</button>
                <button class="ghost-btn" type="button" id="testAiConfig">测试连接</button>
              </div>
              <div class="admin-import-result" id="aiAdminResult">保存后立即生效，课表图片自动识别会使用同一模型。</div>
            </form>
            <div class="card ai-admin-guide">
              <h2 class="section-title">推荐填写</h2>
              <div class="ai-provider-presets">
                <button type="button" data-ai-preset="openai" data-base-url="https://api.openai.com/v1" data-model="gpt-5.5"><strong>OpenAI</strong><span>识图与推理效果强，适合高准确率 OCR。</span></button>
                <button type="button" data-ai-preset="qwen" data-base-url="https://dashscope.aliyuncs.com/compatible-mode/v1" data-model="qwen-vl-plus"><strong>通义千问</strong><span>国内访问稳定，中文课表识别友好。</span></button>
                <button type="button" data-ai-preset="doubao" data-base-url="https://ark.cn-beijing.volces.com/api/v3" data-model="doubao-vision-pro"><strong>豆包视觉</strong><span>适合国内服务商统一部署。</span></button>
                <button type="button" data-ai-preset="glm" data-base-url="https://open.bigmodel.cn/api/paas/v4" data-model="glm-4v-plus"><strong>智谱 GLM</strong><span>可用于中文图片理解与问答。</span></button>
              </div>
              <div class="ai-admin-note">
                <strong>安全说明</strong>
                <p>密钥只保存在服务端配置文件中，前端不会显示完整内容。正式上线建议在 Vercel 环境变量中配置同名参数，并限制后台账号权限。</p>
              </div>
            </div>
          </div>
        </section>
      `,
      afterRender() {
        const form = document.querySelector("#aiAdminForm");
        const resultNode = document.querySelector("#aiAdminResult");
        document.querySelectorAll("[data-ai-preset]").forEach((button) => {
          button.addEventListener("click", () => {
            form.elements.provider.value = button.dataset.aiPreset;
            form.elements.baseUrl.value = button.dataset.baseUrl;
            form.elements.model.value = button.dataset.model;
            resultNode.textContent = `已填入 ${button.querySelector("strong")?.textContent || "推荐"} 配置，请补充 API Key 后保存。`;
          });
        });
        form?.addEventListener("submit", async (event) => {
          event.preventDefault();
          resultNode.textContent = "正在保存配置...";
          try {
            const payload = Object.fromEntries(new FormData(form).entries());
            const saved = await adminApi("/api/admin/ai-config", {
              method: "PUT",
              body: JSON.stringify(payload)
            });
            resultNode.textContent = saved.persistent === false
              ? `配置已在当前实例生效：${saved.provider} · ${saved.model}。生产环境请使用环境变量永久保存。`
              : `保存成功：${saved.provider} · ${saved.model}`;
            toast(saved.persistent === false ? "配置已临时生效，请设置环境变量" : "AI 模型配置已保存");
          } catch (error) {
            resultNode.textContent = error.message;
            toast(error.message);
          }
        });
        document.querySelector("#testAiConfig")?.addEventListener("click", async () => {
          resultNode.textContent = "正在测试连接...";
          try {
            const result = await adminApi("/api/admin/ai-config/test", { method: "POST" });
            resultNode.textContent = `测试成功：${result.reply || "OK"}`;
            toast("AI 连接正常");
          } catch (error) {
            resultNode.textContent = error.message;
            toast(error.message);
          }
        });
      }
    };
  },

  async "student-admin"() {
    let health = null;
    let students = [];
    let totalCount = 0;
    let studentCount = 0;
    let roleCounts = { student: 0, teacher: 0, admin: 0, super_admin: 0 };
    let currentAccountState = { query: "", role: "student", page: 1, pageSize: 20, totalPages: 1 };
    let canManageRoles = false;
    let loadError = "";
    try {
      const studentResult = await adminApi("/api/admin/students?role=student&page=1&pageSize=20");
      health = { mode: studentResult.storageMode || "mysql", connected: studentResult.storageConnected !== false };
      students = studentResult.students;
      roleCounts = { ...roleCounts, ...(studentResult.roleCounts || {}) };
      studentCount = studentResult.totalCount ?? studentResult.count ?? students.length;
      totalCount = studentResult.accountCount ?? Object.values(roleCounts).reduce((sum, count) => sum + Number(count || 0), 0);
      currentAccountState.totalPages = studentResult.totalPages || 1;
      canManageRoles = studentResult.canManageRoles;
    } catch (error) {
      loadError = error.message;
    }
    const studentRows = students.map((student) => `
      <tr>
        <td><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.college || "未填写学院")}</small></td>
        <td>${escapeHtml(student.school)}<small>${escapeHtml(student.major)}</small></td>
        <td>${escapeHtml(student.className || "未填写")}</td>
        <td>${escapeHtml(student.studentNo)}</td>
        <td>${escapeHtml(student.phoneMasked || "未绑定")}</td>
        <td>${canManageRoles ? `<select class="student-role-select" data-student-no="${escapeHtml(student.studentNo)}"><option value="student" ${student.role === "student" ? "selected" : ""}>学生</option><option value="teacher" ${student.role === "teacher" ? "selected" : ""}>老师</option><option value="admin" ${student.role === "admin" ? "selected" : ""}>普通管理员</option><option value="super_admin" ${student.role === "super_admin" ? "selected" : ""}>总管理员</option></select>` : `<strong>${accountRoleLabel(student.role)}</strong>`}</td>
        <td><span class="badge ${student.status === "active" ? "success" : ""}">${student.status === "active" ? "正常" : "停用"}</span></td>
        <td><span class="badge ${student.hasPassword ? "success" : ""}">${student.hasPassword ? "已设置" : "待手机号设置"}</span></td>
        <td class="student-account-actions"><button class="ghost-btn student-password-reset-btn" data-student-no="${escapeHtml(student.studentNo)}">重置密码</button>${student.role === "super_admin" ? "" : `<button class="ghost-btn student-status-btn" data-student-no="${escapeHtml(student.studentNo)}" data-next-status="${student.status === "active" ? "disabled" : "active"}">${student.status === "active" ? "停用" : "启用"}</button>`}</td>
      </tr>
    `).join("");
    return {
      title: "学生身份库",
      subtitle: "通过 MySQL 管理学生身份、登录资格和批量导入",
      content: `
        <section class="student-admin-page">
          <div class="card student-admin-toolbar">
            <div>
              <span class="admin-kicker">身份库管理</span>
              <h2>学生登录资格中心</h2>
              <p>身份信息仅在服务端核验，手机号在列表中自动脱敏。</p>
            </div>
            <div class="admin-current-role"><span>当前权限</span><strong>${accountRoleLabel(state.user.role)}</strong><small>${canManageRoles ? "可管理全部账号和角色" : "可管理学生与老师"}</small></div>
          </div>

          ${loadError ? `<div class="card admin-alert">${escapeHtml(loadError)}</div>` : ""}
          <div class="admin-stat-grid">
            <div class="card"><span>存储模式</span><strong>${health?.mode === "mysql" ? "MySQL" : health ? "本地演示" : "等待连接"}</strong><small>${health?.connected ? "连接正常" : health?.message || "输入管理员密钥后查看"}</small></div>
            <div class="card"><span>账号总数</span><strong>${totalCount.toLocaleString("zh-CN")}</strong><small>MySQL 实时统计 · 当前列表展示 ${students.length} 条</small></div>
            <div class="card"><span>安全策略</span><strong>四项核验</strong><small>学校、专业、学号/工号、手机号</small></div>
          </div>

          <div class="admin-work-grid">
            <div class="card">
              <h2 class="section-title">单个账号录入 / 更新</h2>
              <form class="form student-entry-form" id="studentEntryForm">
                <label class="field"><span>姓名</span><input name="name" required /></label>
                <label class="field"><span>学校</span><input name="school" value="泰州学院" required /></label>
                <label class="field"><span>学院</span><input name="college" /></label>
                <label class="field"><span>专业</span><input name="major" required /></label>
                <label class="field"><span>班级</span><input name="className" placeholder="例如：数字经济2401班" /></label>
                <label class="field"><span>学号 / 工号</span><input name="studentNo" required /></label>
                <label class="field"><span>手机号</span><input name="phone" inputmode="tel" maxlength="11" required /></label>
                <label class="field"><span>账号角色</span><select name="role"><option value="student">学生</option><option value="teacher">老师</option>${canManageRoles ? `<option value="admin">普通管理员</option><option value="super_admin">总管理员</option>` : ""}</select></label>
                <button class="primary-btn" type="submit">保存账号</button>
              </form>
            </div>
            <div class="card">
              <h2 class="section-title">Excel 批量导入</h2>
              <div class="admin-import-guide">
                <p>支持 xlsx、xls 和 csv 文件。教师账号请在“学号”列填写工号。首行列名：</p>
                <code>姓名、学校、学院、专业、班级、学号、手机号、状态、角色</code>
              </div>
              <div class="admin-template-example">
                <div class="admin-template-example-copy">
                  <strong>导入示例（虚构信息）</strong>
                  <span>林晨曦 · 示例大学 · 数字经济 · 数经2401班 · DEMO2026001 · 学生</span>
                </div>
                <a class="ghost-btn admin-template-download" href="/downloads/templates/%E6%99%BA%E6%85%A7%E6%A0%A1%E5%9B%AD%E8%BA%AB%E4%BB%BD%E5%BA%93%E5%AF%BC%E5%85%A5%E7%A4%BA%E4%BE%8B.xlsx" download="智慧校园身份库导入示例.xlsx">下载 Excel 示例</a>
              </div>
              <form class="form" id="studentImportForm">
                <label class="field"><span>选择学生名单</span><input name="file" type="file" accept=".xlsx,.xls,.csv" required /></label>
                <button class="primary-btn" type="submit">导入身份库</button>
              </form>
              <div class="admin-import-result" id="studentImportResult">重复的学校 + 学号将更新原记录。</div>
            </div>
          </div>

          <div class="card student-list-card">
            <div class="student-list-head">
              <div><h2 class="section-title">账号列表</h2><p>停用后，该账号无法获取登录验证码。</p></div>
              <span class="student-list-status" id="studentListStatus" aria-live="polite">已加载</span>
              <form id="studentSearchForm"><input name="query" placeholder="搜索姓名、专业、班级、学号、工号或手机号" /><button class="ghost-btn" type="submit">搜索</button></form>
            </div>
            <div class="student-role-filters" aria-label="按账号角色筛选">
              <button class="active" type="button" data-account-role="student">学生 <span>${studentCount.toLocaleString("zh-CN")}</span></button>
              <button type="button" data-account-role="teacher">老师 <span>${Number(roleCounts.teacher || 0).toLocaleString("zh-CN")}</span></button>
              ${canManageRoles ? `<button type="button" data-account-role="admin">普通管理员 <span>${Number(roleCounts.admin || 0).toLocaleString("zh-CN")}</span></button><button type="button" data-account-role="super_admin">总管理员 <span>${Number(roleCounts.super_admin || 0).toLocaleString("zh-CN")}</span></button>` : ""}
            </div>
            <div class="table-wrap">
              <table class="student-table">
                <thead><tr><th>账号</th><th>学校 / 专业</th><th>班级</th><th>学号 / 工号</th><th>手机号</th><th>角色</th><th>状态</th><th>密码</th><th>操作</th></tr></thead>
                <tbody>${studentRows || `<tr><td colspan="9" class="empty">身份库暂无账号</td></tr>`}</tbody>
              </table>
            </div>
            <div class="student-list-pagination" aria-label="账号列表分页">
              <button class="ghost-btn" id="studentPagePrev" type="button" disabled>上一页</button>
              <span id="studentPageSummary">第 1 / ${currentAccountState.totalPages} 页 · 共 ${studentCount.toLocaleString("zh-CN")} 个学生账号</span>
              <button class="ghost-btn" id="studentPageNext" type="button" ${currentAccountState.totalPages <= 1 ? "disabled" : ""}>下一页</button>
            </div>
          </div>
        </section>
      `,
      afterRender() {
        document.querySelector("#studentEntryForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await adminApi("/api/admin/students", {
              method: "POST",
              body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
            });
            toast("学生身份已保存");
            await loadFilteredStudents({ page: 1 });
            event.currentTarget.reset();
          } catch (error) {
            toast(error.message);
          }
        });
        document.querySelector("#studentImportForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const file = event.currentTarget.elements.file.files?.[0];
          if (!file) return;
          const resultNode = document.querySelector("#studentImportResult");
          const submitButton = event.currentTarget.querySelector("button[type='submit']");
          if (submitButton) submitButton.disabled = true;
          resultNode.textContent = "正在解析并导入...";
          const startedAt = performance.now();
          try {
            const result = await adminApi("/api/admin/students/import", {
              method: "POST",
              body: JSON.stringify({ filename: file.name, fileBase64: await fileToBase64(file) })
            });
            const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
            resultNode.textContent = `成功 ${result.success} 条，失败 ${result.failed} 条，用时 ${elapsed} 秒。${result.errors.slice(0, 3).join("；")}`;
            toast("学生名单导入完成");
            await loadFilteredStudents({ role: "student", page: 1 });
          } catch (error) {
            resultNode.textContent = error.message;
          } finally {
            if (submitButton) submitButton.disabled = false;
          }
        });
        document.querySelector("#studentSearchForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const query = new FormData(event.currentTarget).get("query");
          try {
            await loadFilteredStudents({ query, role: document.querySelector(".student-role-filters button.active")?.dataset.accountRole || "", page: 1 });
          } catch (error) {
            toast(error.message);
          }
        });
        function renderFilteredStudents(result) {
          const tbody = document.querySelector(".student-table tbody");
          tbody.innerHTML = result.students.map((student) => `
            <tr><td><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.college || "未填写学院")}</small></td><td>${escapeHtml(student.school)}<small>${escapeHtml(student.major)}</small></td><td>${escapeHtml(student.className || "未填写")}</td><td>${escapeHtml(student.studentNo)}</td><td>${escapeHtml(student.phoneMasked)}</td><td>${canManageRoles ? `<select class="student-role-select" data-student-no="${escapeHtml(student.studentNo)}"><option value="student" ${student.role === "student" ? "selected" : ""}>学生</option><option value="teacher" ${student.role === "teacher" ? "selected" : ""}>老师</option><option value="admin" ${student.role === "admin" ? "selected" : ""}>普通管理员</option><option value="super_admin" ${student.role === "super_admin" ? "selected" : ""}>总管理员</option></select>` : `<strong>${accountRoleLabel(student.role)}</strong>`}</td><td><span class="badge ${student.status === "active" ? "success" : ""}">${student.status === "active" ? "正常" : "停用"}</span></td><td><span class="badge ${student.hasPassword ? "success" : ""}">${student.hasPassword ? "已设置" : "待手机号设置"}</span></td><td class="student-account-actions"><button class="ghost-btn student-password-reset-btn" data-student-no="${escapeHtml(student.studentNo)}">重置密码</button>${student.role === "super_admin" ? "" : `<button class="ghost-btn student-status-btn" data-student-no="${escapeHtml(student.studentNo)}" data-next-status="${student.status === "active" ? "disabled" : "active"}">${student.status === "active" ? "停用" : "启用"}</button>`}</td></tr>
          `).join("") || `<tr><td colspan="9" class="empty">该筛选条件下暂无账号</td></tr>`;
          bindStudentStatusButtons();
          bindStudentRoleSelects();
          bindStudentPasswordResetButtons();
        }
        function updateAccountListMeta(result) {
          currentAccountState = {
            ...currentAccountState,
            page: result.page || currentAccountState.page,
            pageSize: result.pageSize || currentAccountState.pageSize,
            totalPages: result.totalPages || 1
          };
          roleCounts = { ...roleCounts, ...(result.roleCounts || {}) };
          document.querySelectorAll(".student-role-filters button").forEach((button) => {
            const count = Number(roleCounts[button.dataset.accountRole] || 0);
            let countNode = button.querySelector("span");
            if (!countNode) {
              countNode = document.createElement("span");
              button.append(countNode);
            }
            countNode.textContent = count.toLocaleString("zh-CN");
          });
          const summary = document.querySelector("#studentPageSummary");
          if (summary) summary.textContent = `第 ${currentAccountState.page} / ${currentAccountState.totalPages} 页 · 当前条件共 ${Number(result.totalCount || 0).toLocaleString("zh-CN")} 个账号`;
          const previous = document.querySelector("#studentPagePrev");
          const next = document.querySelector("#studentPageNext");
          if (previous) previous.disabled = currentAccountState.page <= 1;
          if (next) next.disabled = currentAccountState.page >= currentAccountState.totalPages;
        }
        function setAccountListBusy(busy, message = "正在加载...") {
          document.querySelector(".student-list-card")?.classList.toggle("is-loading", busy);
          const statusNode = document.querySelector("#studentListStatus");
          if (statusNode) statusNode.textContent = busy ? message : "已加载";
          document.querySelectorAll(".student-role-filters button").forEach((button) => { button.disabled = busy; });
          const previous = document.querySelector("#studentPagePrev");
          const next = document.querySelector("#studentPageNext");
          if (previous) previous.disabled = busy || currentAccountState.page <= 1;
          if (next) next.disabled = busy || currentAccountState.page >= currentAccountState.totalPages;
        }
        async function loadFilteredStudents({ query = currentAccountState.query, role = currentAccountState.role, page = currentAccountState.page } = {}) {
          currentAccountState = { ...currentAccountState, query: String(query || ""), role: String(role || ""), page: Math.max(1, Number(page) || 1) };
          const activeButton = document.querySelector(`.student-role-filters button[data-account-role="${currentAccountState.role}"]`);
          document.querySelectorAll(".student-role-filters button").forEach((button) => button.classList.toggle("active", button === activeButton));
          const params = new URLSearchParams({
            query: currentAccountState.query,
            role: currentAccountState.role,
            page: String(currentAccountState.page),
            pageSize: String(currentAccountState.pageSize)
          });
          setAccountListBusy(true, currentAccountState.page > 1 ? `正在加载第 ${currentAccountState.page} 页...` : "正在切换账号分类...");
          try {
            const result = await adminApi(`/api/admin/students?${params}`);
            renderFilteredStudents(result);
            updateAccountListMeta(result);
          } finally {
            setAccountListBusy(false);
          }
        }
        document.querySelectorAll(".student-role-filters button").forEach((button) => {
          button.addEventListener("click", async () => {
            try {
              await loadFilteredStudents({
                query: document.querySelector("#studentSearchForm [name='query']")?.value || "",
                role: button.dataset.accountRole,
                page: 1
              });
            } catch (error) {
              toast(error.message);
            }
          });
        });
        function bindStudentStatusButtons() {
          document.querySelectorAll(".student-status-btn").forEach((button) => {
            button.addEventListener("click", async () => {
              try {
                await adminApi("/api/admin/students/status", {
                  method: "PUT",
                  body: JSON.stringify({ studentNo: button.dataset.studentNo, status: button.dataset.nextStatus })
                });
                toast(button.dataset.nextStatus === "disabled" ? "学生已停用" : "学生已启用");
                await loadFilteredStudents();
              } catch (error) {
                toast(error.message);
              }
            });
          });
        }
        bindStudentStatusButtons();
        function bindStudentPasswordResetButtons() {
          document.querySelectorAll(".student-password-reset-btn").forEach((button) => {
            if (button.dataset.bound === "true") return;
            button.dataset.bound = "true";
            button.addEventListener("click", async () => {
              try {
                const result = await adminApi("/api/admin/students/password-reset", {
                  method: "POST",
                  body: JSON.stringify({ studentNo: button.dataset.studentNo })
                });
                toast("密码已清除，请用户通过手机号登录后重新设置");
                await loadFilteredStudents();
              } catch (error) {
                toast(error.message);
              }
            });
          });
        }
        bindStudentPasswordResetButtons();
        function bindStudentRoleSelects() {
          document.querySelectorAll(".student-role-select").forEach((select) => {
            if (select.dataset.bound === "true") return;
            select.dataset.bound = "true";
            select.addEventListener("change", async () => {
              try {
                await adminApi("/api/admin/students/role", {
                  method: "PUT",
                  body: JSON.stringify({ studentNo: select.dataset.studentNo, role: select.value })
                });
                toast("账号角色已更新");
                await loadFilteredStudents();
              } catch (error) {
                toast(error.message);
                await loadFilteredStudents();
              }
            });
          });
        }
        bindStudentRoleSelects();
        document.querySelector("#studentPagePrev")?.addEventListener("click", async () => {
          if (currentAccountState.page <= 1) return;
          try {
            await loadFilteredStudents({ page: currentAccountState.page - 1 });
          } catch (error) {
            toast(error.message);
          }
        });
        document.querySelector("#studentPageNext")?.addEventListener("click", async () => {
          if (currentAccountState.page >= currentAccountState.totalPages) return;
          try {
            await loadFilteredStudents({ page: currentAccountState.page + 1 });
          } catch (error) {
            toast(error.message);
          }
        });
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
              <div class="row"><span>${state.user.role === "teacher" ? "工号" : "学号"}</span><strong>${state.user.studentNo}</strong></div>
              <div class="row"><span>账号角色</span><strong>${accountRoleLabel(state.user.role)}</strong></div>
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
            <h2 class="section-title">登录密码 <span class="badge ${state.user.hasPassword ? "success" : ""}">${state.user.hasPassword ? "已设置" : "未设置"}</span></h2>
            <p class="muted">首次需通过手机号验证码登录并设置密码。密码会加盐加密保存，管理员只能清除，无法查看原密码。</p>
            <form class="form" id="passwordForm">
              <label class="field"><span>新密码</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 位，包含字母和数字" required /></label>
              <label class="field"><span>确认新密码</span><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></label>
              <button class="primary-btn" type="submit">${state.user.hasPassword ? "更新密码" : "设置密码"}</button>
            </form>
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
        document.querySelector("#passwordForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (form.get("password") !== form.get("confirmPassword")) {
            toast("两次输入的密码不一致");
            return;
          }
          try {
            const result = await api("/api/account/password", {
              method: "POST",
              body: JSON.stringify({ password: form.get("password") })
            });
            state.user = result.user;
            toast("登录密码已安全更新");
            renderShell();
          } catch (error) {
            toast(error.message);
          }
        });
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
          authView = "intro";
          renderIntro();
        });
      }
    };
  }
};

renderShell();
