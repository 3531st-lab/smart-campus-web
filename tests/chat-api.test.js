const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryChatStore } = require("../server/chat-store");
const { handleChatRoute } = require("../server/chat-routes");

function fixtures() {
  const users = {
    owner: { id: "chat-owner", name: "群主同学", role: "student", status: "active", avatarColor: "#188aa3" },
    peer: { id: "chat-peer", name: "同班同学", role: "student", status: "active", avatarColor: "#8e6ee8" },
    outsider: { id: "chat-outsider", name: "隔壁班同学", role: "student", status: "active", avatarColor: "#ef9462" },
    guest: { id: "chat-guest", name: "游客", role: "guest", status: "active", avatarColor: "#74839a" }
  };
  const store = createMemoryChatStore({
    users: Object.values(users),
    classes: [{ id: "class-1" }, { id: "class-2" }],
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

async function callRoute(store, route, user, body = {}) {
  const url = new URL(`http://campus.test${route.replace(/^\w+\s+/, "")}`);
  const response = {};
  const handled = await handleChatRoute({
    route,
    url,
    store,
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

test("chat API requires login and returns only safe group projections", async () => {
  const { store, users } = fixtures();
  const anonymous = await callRoute(store, "GET /api/chat/groups", null);
  assert.equal(anonymous.status, 401);

  const listed = await callRoute(store, "GET /api/chat/groups", users.owner);
  assert.equal(listed.status, 200);
  assert.ok(listed.payload.groups.some((group) => group.id === "class-group-1"));
  assert.ok(listed.payload.groups.some((group) => group.id === "frozen-group"));
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
