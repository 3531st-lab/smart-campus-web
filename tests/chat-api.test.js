const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const { createMemoryChatStore } = require("../server/chat-store");
const { handleChatRoute } = require("../server/chat-routes");
const { createMediaStore } = require("../server/media-store");

function fixtures() {
  const users = {
    owner: { id: "chat-owner", name: "群主同学", role: "student", status: "active", avatarColor: "#188aa3" },
    peer: { id: "chat-peer", name: "同班同学", role: "student", status: "active", avatarColor: "#8e6ee8" },
    outsider: { id: "chat-outsider", name: "隔壁班同学", role: "student", status: "active", avatarColor: "#ef9462" },
    admin: { id: "chat-admin", name: "平台管理员", role: "admin", status: "active", avatarColor: "#3974d6" },
    guest: { id: "chat-guest", name: "游客", role: "guest", status: "active", avatarColor: "#74839a" }
  };
  const store = createMemoryChatStore({
    users: Object.values(users),
    classes: [
      { id: "class-1", school: "泰州学院", college: "经济与管理学院", className: "24数字经济", status: "active" },
      { id: "class-2", school: "泰州学院", college: "计算机科学与技术学院", className: "24计算机", status: "active" }
    ],
    assignments: [
      { classId: "class-1", userId: users.owner.id, duty: "monitor", active: true },
      { classId: "class-1", userId: users.peer.id, duty: "member", active: true },
      { classId: "class-2", userId: users.outsider.id, duty: "member", active: true }
    ],
    groups: [
      { id: "class-group-1", type: "class", classId: "class-1", name: "24 数字经济", status: "active", frozen: false },
      { id: "class-group-2", type: "class", classId: "class-2", name: "隔壁班", status: "active", frozen: false },
      { id: "frozen-group", type: "custom", publicNo: "1200000000", name: "冻结测试", ownerId: users.owner.id, status: "active", frozen: true }
    ],
    members: [{ id: "frozen-owner", groupId: "frozen-group", userId: users.owner.id, role: "owner", active: true }]
  });
  return { store, users };
}

async function callRoute(store, route, user, body = {}, extras = {}) {
  const url = new URL(`http://campus.test${route.replace(/^\w+\s+/, "")}`);
  const response = {};
  const handled = await handleChatRoute({
    route,
    url,
    store,
    ...extras,
    requireUser: async () => {
      if (!user) {
        Object.assign(response, { status: 401, payload: { error: "请先登录" } });
        return null;
      }
      return user;
    },
    parseBody: async () => body,
    sendJson: (_res, status, payload) => Object.assign(response, { status, payload }),
    sendError: (_res, status, error) => Object.assign(response, { status, payload: { error } }),
    res: {}
  });
  assert.equal(handled, true);
  return response;
}

async function pngDataUrl() {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 24, g: 138, b: 163, alpha: 1 } } }).png().toBuffer();
  return { bytes, value: `data:image/png;base64,${bytes.toString("base64")}` };
}

test("chat API requires login and returns only safe group projections", async () => {
  const { store, users } = fixtures();
  const anonymous = await callRoute(store, "GET /api/chat/groups", null);
  assert.equal(anonymous.status, 401);

  const listed = await callRoute(store, "GET /api/chat/groups", users.owner);
  assert.equal(listed.status, 200);
  assert.ok(listed.payload.groups.some((group) => group.id === "class-group-1"));
  assert.ok(listed.payload.groups.some((group) => group.id === "frozen-group"));
  assert.equal(listed.payload.groups.find((group) => group.id === "class-group-1").college, "经济与管理学院");
  assert.equal(/phone|password|studentNo/i.test(JSON.stringify(listed.payload)), false);
});

test("chat messages are cursor-paginated, private across classes, and idempotent", async () => {
  const { store, users } = fixtures();
  const first = await callRoute(store, "POST /api/chat/groups/class-group-1/messages", users.owner, {
    clientRequestId: "chat-request-001",
    text: "大家下午好"
  });
  const retry = await callRoute(store, "POST /api/chat/groups/class-group-1/messages", users.owner, {
    clientRequestId: "chat-request-001",
    text: "大家下午好"
  });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.equal(first.payload.message.id, retry.payload.message.id);
  assert.equal(first.payload.message.sequence, retry.payload.message.sequence);
  assert.equal(first.payload.message.sender.name, users.owner.name);
  assert.equal("phone" in first.payload.message.sender, false);
  assert.equal("studentNo" in first.payload.message.sender, false);

  const history = await callRoute(store, "GET /api/chat/groups/class-group-1/messages?after=0&limit=1", users.peer);
  assert.equal(history.status, 200);
  assert.equal(history.payload.messages.length, 1);
  assert.equal(history.payload.nextSequence, 1);

  const crossClass = await callRoute(store, "GET /api/chat/groups/class-group-1/messages?after=0", users.outsider);
  assert.equal(crossClass.status, 403);
});

test("chat write freezes with 423 and read cursors stay user-scoped", async () => {
  const { store, users } = fixtures();
  const frozen = await callRoute(store, "POST /api/chat/groups/frozen-group/messages", users.owner, {
    clientRequestId: "frozen-request",
    text: "不能发送"
  });
  assert.equal(frozen.status, 423);

  const cursor = await callRoute(store, "PUT /api/chat/groups/class-group-1/read-cursor", users.peer, { sequence: 88 });
  assert.equal(cursor.status, 200);
  assert.deepEqual(cursor.payload.cursor, { groupId: "class-group-1", userId: users.peer.id, sequence: 88 });
  assert.equal(store.data.readCursors.length, 1);
});

test("ordinary groups expose limited search, reviewed joins, and renewable QR applications", async () => {
  const { store, users } = fixtures();
  const created = await callRoute(store, "POST /api/chat/groups", users.owner, {
    name: "校园摄影交流",
    description: "作品交流与活动约拍"
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.group.type, "custom");
  assert.match(created.payload.group.publicNo, /^\d{10,}$/);

  const initialMembers = await callRoute(store, `GET /api/chat/groups/${created.payload.group.id}/members`, users.owner);
  assert.equal(initialMembers.status, 200);
  assert.equal(initialMembers.payload.members.length, 1);
  assert.equal(initialMembers.payload.members[0].name, users.owner.name);
  assert.equal(/phone|password|studentNo/i.test(JSON.stringify(initialMembers.payload)), false);

  const search = await callRoute(store, `GET /api/chat/search?groupNo=${created.payload.group.publicNo}`, users.outsider);
  assert.equal(search.status, 200);
  assert.deepEqual(Object.keys(search.payload.group).sort(), ["avatar", "id", "memberCount", "name", "type"]);
  assert.equal("publicNo" in search.payload.group, false);

  const numberJoin = await callRoute(store, "POST /api/chat/join-requests", users.outsider, {
    groupId: created.payload.group.id,
    source: "group_number",
    groupNumber: created.payload.group.publicNo
  });
  assert.equal(numberJoin.status, 201);
  const pending = await callRoute(store, `GET /api/chat/groups/${created.payload.group.id}/join-requests`, users.owner);
  assert.equal(pending.status, 200);
  assert.equal(pending.payload.requests.length, 1);
  assert.equal(pending.payload.requests[0].applicant.id, users.outsider.id);
  assert.equal(/phone|password|studentNo/i.test(JSON.stringify(pending.payload)), false);
  const hiddenFromOutsider = await callRoute(store, `GET /api/chat/groups/${created.payload.group.id}/join-requests`, users.peer);
  assert.equal(hiddenFromOutsider.status, 403);
  const approved = await callRoute(store, `PUT /api/chat/join-requests/${numberJoin.payload.request.id}`, users.owner, { decision: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.payload.request.status, "approved");

  const firstToken = await callRoute(store, `POST /api/chat/groups/${created.payload.group.id}/invite-token`, users.owner, {});
  assert.equal(firstToken.status, 201);
  assert.match(firstToken.payload.qrSvg, /<svg/);
  assert.match(firstToken.payload.inviteUrl, /chatInvite=/);
  const refreshedToken = await callRoute(store, `POST /api/chat/groups/${created.payload.group.id}/invite-token`, users.owner, {});
  assert.equal(refreshedToken.status, 201);
  assert.notEqual(firstToken.payload.tokenId, refreshedToken.payload.tokenId);

  const staleQr = await callRoute(store, "POST /api/chat/join-requests", users.peer, {
    groupId: created.payload.group.id,
    source: "qr",
    token: firstToken.payload.token
  });
  assert.equal(staleQr.status, 400);

  const qrJoin = await callRoute(store, "POST /api/chat/join-requests", users.peer, {
    source: "qr",
    token: refreshedToken.payload.token
  });
  assert.equal(qrJoin.status, 201);
  const qrApproved = await callRoute(store, `PUT /api/chat/join-requests/${qrJoin.payload.request.id}`, users.owner, { decision: "approved" });
  assert.equal(qrApproved.status, 200);
});

test("platform administrators govern frozen groups without joining them and review one active appeal", async () => {
  const { store, users } = fixtures();
  const created = await callRoute(store, "POST /api/chat/groups", users.owner, { name: "治理测试群" });
  const groupId = created.payload.group.id;
  const sent = await callRoute(store, `POST /api/chat/groups/${groupId}/messages`, users.owner, {
    clientRequestId: "governance-message-001",
    text: "冻结前的消息"
  });
  assert.equal(sent.status, 201);

  const managed = await callRoute(store, "GET /api/admin/chat/groups", users.admin);
  assert.equal(managed.status, 200);
  assert.ok(managed.payload.groups.some((group) => group.id === groupId));
  const frozen = await callRoute(store, `PUT /api/admin/chat/groups/${groupId}/status`, users.admin, { status: "frozen" });
  assert.equal(frozen.status, 200);
  assert.equal(frozen.payload.group.status, "frozen");
  assert.equal(store.data.members.some((member) => member.userId === users.admin.id), false);

  const history = await callRoute(store, `GET /api/chat/groups/${groupId}/messages?after=0`, users.owner);
  assert.equal(history.status, 200);
  assert.equal(history.payload.messages[0].text, "冻结前的消息");
  const blockedMessage = await callRoute(store, `POST /api/chat/groups/${groupId}/messages`, users.owner, {
    clientRequestId: "governance-message-002",
    text: "不应发送"
  });
  const blockedToken = await callRoute(store, `POST /api/chat/groups/${groupId}/invite-token`, users.owner, {});
  assert.equal(blockedMessage.status, 423);
  assert.equal(blockedToken.status, 423);

  const appeal = await callRoute(store, `POST /api/chat/groups/${groupId}/appeals`, users.owner, { reason: "已制定群规，请恢复学习讨论" });
  assert.equal(appeal.status, 201);
  const duplicate = await callRoute(store, `POST /api/chat/groups/${groupId}/appeals`, users.owner, { reason: "重复申诉" });
  assert.equal(duplicate.status, 409);
  const reviewing = await callRoute(store, `PUT /api/admin/chat/appeals/${appeal.payload.appeal.id}`, users.admin, { status: "reviewing" });
  assert.equal(reviewing.status, 200);
  const approved = await callRoute(store, `PUT /api/admin/chat/appeals/${appeal.payload.appeal.id}`, users.admin, { status: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.payload.appeal.status, "approved");

  const restored = await callRoute(store, `POST /api/chat/groups/${groupId}/messages`, users.owner, {
    clientRequestId: "governance-message-003",
    text: "恢复后的消息"
  });
  assert.equal(restored.status, 201);
  const members = await callRoute(store, `GET /api/chat/groups/${groupId}/members`, users.owner);
  assert.equal(members.status, 200);
  assert.equal(members.payload.members.some((member) => member.userId === users.admin.id), false);
  const audit = await callRoute(store, "GET /api/admin/chat/audit-logs?limit=100", users.admin);
  assert.equal(audit.status, 200);
  assert.ok(audit.payload.logs.some((log) => log.action === "group_frozen"));
  assert.ok(audit.payload.logs.some((log) => log.action === "appeal_approved_and_group_restored"));
});

test("图片表情会校验图片内容、授权来源与收藏归属，消息不暴露外站热链", async (context) => {
  const { store, users } = fixtures();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "campus-chat-stickers-"));
  context.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const mediaStore = createMediaStore({ rootDir });
  const image = await pngDataUrl();

  const spoofed = await callRoute(store, "POST /api/chat/stickers", users.owner, { dataUrl: image.value.replace("image/png", "image/jpeg"), name: "伪装图片" }, { mediaStore });
  assert.equal(spoofed.status, 400);
  const unlicensed = await callRoute(store, "POST /api/chat/stickers", users.owner, { dataUrl: image.value, name: "来源不全", source: { type: "network", sourceUrl: "https://example.test/sticker" } }, { mediaStore });
  assert.equal(unlicensed.status, 400);

  const uploaded = await callRoute(store, "POST /api/chat/stickers", users.owner, { dataUrl: image.value, name: "学习加油" }, { mediaStore });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.payload.sticker.url, /^\/uploads\/chat-stickers\//);
  assert.equal(/example\.test|sourceUrl|license/i.test(JSON.stringify(uploaded.payload.sticker)), false);

  const inaccessibleFavorite = await callRoute(store, `POST /api/chat/stickers/${uploaded.payload.sticker.id}/favorite`, users.peer, {}, { mediaStore });
  assert.equal(inaccessibleFavorite.status, 404);
  const favorite = await callRoute(store, `POST /api/chat/stickers/${uploaded.payload.sticker.id}/favorite`, users.owner, {}, { mediaStore });
  assert.equal(favorite.status, 200);
  assert.equal(favorite.payload.sticker.favorite, true);
  const list = await callRoute(store, "GET /api/chat/stickers", users.owner, {}, { mediaStore });
  assert.equal(list.status, 200);
  assert.ok(list.payload.unicode.length >= 12);
  assert.equal(list.payload.stickers[0].favorite, true);

  const sent = await callRoute(store, "POST /api/chat/groups/class-group-1/messages", users.owner, { clientRequestId: "sticker-message-001", text: "", stickerId: uploaded.payload.sticker.id }, { mediaStore });
  assert.equal(sent.status, 201);
  assert.equal(sent.payload.message.sticker.id, uploaded.payload.sticker.id);
  assert.equal(/example\.test|sourceUrl|license/i.test(JSON.stringify(sent.payload.message)), false);
  const history = await callRoute(store, "GET /api/chat/groups/class-group-1/messages?after=0", users.peer, {}, { mediaStore });
  assert.equal(history.status, 200);
  assert.equal(history.payload.messages[0].sticker.url, uploaded.payload.sticker.url);

  const report = await callRoute(store, "POST /api/chat/reports", users.peer, { targetType: "sticker", targetId: uploaded.payload.sticker.id, reason: "用于测试审核流程" }, { mediaStore });
  assert.equal(report.status, 201);
  const sources = await callRoute(store, "GET /api/chat/sticker-sources/search?q=学习", users.owner, {}, { mediaStore });
  assert.equal(sources.status, 200);
  assert.deepEqual(sources.payload.items, []);

  const digest = crypto.createHash("sha256").update(image.bytes).digest("hex");
  const blockedStore = createMediaStore({ rootDir, blockedDigests: new Set([digest]) });
  await assert.rejects(() => blockedStore.saveImage({ ownerId: users.owner.id, bytes: image.bytes, mimeType: "image/png", source: { type: "upload" } }), /安全策略/);
});
