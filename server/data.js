const users = [
  {
    id: "u-1001",
    name: "张同学",
    phone: "13800000000",
    role: "student",
    college: "信息工程学院",
    major: "软件技术",
    studentNo: "20260001",
    verified: true,
    avatarColor: "#1f7a6d"
  }
];

const labs = [
  {
    id: "lab-301",
    name: "软件工程实验室 301",
    building: "明德楼",
    capacity: 48,
    equipment: ["云桌面", "投影", "GPU 工作站"],
    status: "available",
    freeSlots: ["周一 10:00-12:00", "周三 14:00-16:00", "周五 08:00-10:00"]
  },
  {
    id: "lab-402",
    name: "物联网综合实验室 402",
    building: "知行楼",
    capacity: 36,
    equipment: ["传感器套件", "边缘网关", "示波器"],
    status: "busy",
    freeSlots: ["周二 16:00-18:00", "周四 10:00-12:00"]
  },
  {
    id: "lab-510",
    name: "人工智能创新实验室 510",
    building: "致远楼",
    capacity: 30,
    equipment: ["AI 训练服务器", "数据采集终端", "大屏"],
    status: "available",
    freeSlots: ["周一 14:00-16:00", "周三 08:00-10:00"]
  }
];

const reservations = [
  {
    id: "r-2026052901",
    userId: "u-1001",
    labId: "lab-301",
    labName: "软件工程实验室 301",
    slot: "周三 14:00-16:00",
    reason: "课程项目小组实验",
    status: "approved",
    updatedAt: "2026-05-29 09:30"
  },
  {
    id: "r-2026052902",
    userId: "u-1001",
    labId: "lab-510",
    labName: "人工智能创新实验室 510",
    slot: "周一 14:00-16:00",
    reason: "智能推荐模型调试",
    status: "pending",
    updatedAt: "2026-05-29 11:20"
  }
];

const repairs = [
  {
    id: "fix-1008",
    userId: "u-1001",
    labName: "软件工程实验室 301",
    device: "投影仪",
    issue: "画面偶尔闪烁",
    status: "processing",
    createdAt: "2026-05-28 15:12"
  }
];

const notifications = [
  {
    id: "n-001",
    title: "实验室预约已通过",
    type: "预约通知",
    body: "软件工程实验室 301 已为你保留周三 14:00-16:00 时段。",
    read: false,
    createdAt: "2026-05-29 09:30"
  },
  {
    id: "n-002",
    title: "食堂外卖配送提醒",
    type: "外卖通知",
    body: "你的午餐订单预计 12:20 送达宿舍楼下取餐点。",
    read: true,
    createdAt: "2026-05-29 11:45"
  },
  {
    id: "n-003",
    title: "设备维修进度更新",
    type: "维修通知",
    body: "投影仪闪烁问题已派单，维修人员将在今天下午检查。",
    read: false,
    createdAt: "2026-05-29 10:05"
  }
];

const timetable = [
  {
    id: "c-001",
    day: "周一",
    time: "08:00-09:40",
    course: "Java Web 开发",
    location: "明德楼 301",
    teacher: "刘老师"
  },
  {
    id: "c-002",
    day: "周三",
    time: "10:00-11:40",
    course: "数据库应用",
    location: "知行楼 204",
    teacher: "王老师"
  },
  {
    id: "c-003",
    day: "周五",
    time: "14:00-15:40",
    course: "移动应用开发",
    location: "致远楼 510",
    teacher: "陈老师"
  }
];

const menu = [
  {
    id: "food-001",
    name: "椒麻鸡套餐",
    canteen: "一食堂",
    price: 18,
    tag: "热销",
    available: true
  },
  {
    id: "food-002",
    name: "番茄牛腩饭",
    canteen: "二食堂",
    price: 22,
    tag: "新菜",
    available: true
  },
  {
    id: "food-003",
    name: "轻食鸡胸沙拉",
    canteen: "一食堂",
    price: 16,
    tag: "低脂",
    available: true
  }
];

const labRules = [
  "进入实验室须完成身份认证，并遵守实验室预约时段。",
  "实验设备使用前应检查状态，发现故障及时提交维修申报。",
  "离开实验室前关闭电源、整理座位，保持环境整洁。",
  "未经许可不得私自移动、拆卸或外借实验设备。"
];

const supportTickets = [];
const feedbackItems = [];
const orders = [];

module.exports = {
  users,
  labs,
  reservations,
  repairs,
  notifications,
  timetable,
  menu,
  labRules,
  supportTickets,
  feedbackItems,
  orders
};
