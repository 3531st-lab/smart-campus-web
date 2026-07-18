process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  createMemoryChatStore,
  createMysqlChatStore,
  inviteTokenDigest
} = require("../server/chat-store");

function fixtures(options = {}) {
  const users = [
    { id: "student-a", name: "甲同学", role: "student", status: "active" },
    { id: "student-b", name: "乙同学", role: "student", status: "active" },
    { id: "teacher-a", name: "甲老师", role: "teacher", status: "active" },
    { id: "platform-admin", name: "平台管理员", role: "admin", status: "active", school: "泰州学院", college: "经管学院", className: "24数字经济" },
    { id: "owner", name: "群主", role: "student", status: "active" },
    { id: "group-admin", name: "群管理员", role: "student", status: "active" },
    { id: "member", name: "群成员", role: "student", status: "active" },
    { id: "invitee", name: "受邀人", role: "student", status: "active" },
    { id: "outsider", name: "群外成员", role: "student", status: "active" },
    { id: "disabled-user", name: "停用成员", role: "student", status: "disabled" }
  ];
  const campusClasses = [
    { id: "class-a", school: "泰州学院", college: "经管学院", className: "24数字经济", groupId: "class-group-a", status: "active" },
    { id: "class-b", school: "泰州学院", college: "经管学院", className: "24物流管理", groupId: "class-group-b", status: "active" }
  ];
  const classAssignments = [
    { id: "ca-1", classId: "class-a", userId: "student-a", duty: "monitor", source: "student_identity", active: true },
    { id: "ca-2", classId: "class-a", userId: "teacher-a", duty: "subject_teacher", source: "teacher_assignment", active: true },
    { id: "ca-4", classId: "class-b", userId: "student-b", duty: "member", source: "student_identity", active: true }
  ];
  const chatGroups = [
    { id: "class-group-a", type: "class", classId: "class-a", publicNo: "1000000001", name: "24数字经济班级群", status: "active" },
    { id: "class-group-b", type: "class", classId: "class-b", publicNo: "1000000002", name: "24物流管理班级群", status: "active" }
  ];
  const seed = {
    users,
    campusClasses,
    classAssignments,
    chatGroups,
    chatMembers: [],
    chatJoinRequests: [],
    chatInvites: [],
    chatInviteTokens: []
  };
  let groupNumberIndex = 0;
  const groupNumbers = options.groupNumbers || ["1234567890", "1234567891", "1234567892"];
  let inviteTokenIndex = 0;
  const inviteTokens = options.inviteTokens || ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccc"];
  const store = createMemoryChatStore(seed, {
    groupNumberGenerator: () => groupNumbers[Math.min(groupNumberIndex++, groupNumbers.length - 1)],
    inviteTokenGenerator: () => inviteTokens[Math.min(inviteTokenIndex++, inviteTokens.length - 1)]
  });
  return { store, users: Object.fromEntries(users.map((user) => [user.id, user])) };
}

function createMysqlHarness(initial = {}) {
  const state = {
    users: initial.users || [
      { id: "owner", name: "Owner", role: "student", status: "active" },
      { id: "invitee", name: "Invitee", role: "student", status: "active" },
      { id: "outsider", name: "Outsider", role: "student", status: "active" }
    ],
    groups: initial.groups || [{ id: "group-a", type: "custom", public_no: "1234567890", name: "Test", status: "active", frozen: 0, next_message_sequence: 0 }],
    members: initial.members || [{ id: "owner-member", group_id: "group-a", user_id: "owner", role: "owner", active: 1, joined_via: "created" }],
    messages: initial.messages || [],
    invites: initial.invites || [],
    requests: initial.requests || [],
    tokens: initial.tokens || []
  };
  const events = [];
  let snapshot = null;

  function resultRows(sql, params) {
    if (/FROM students WHERE id/.test(sql)) return state.users.filter((row) => String(row.id) === String(params[0]));
    if (/FROM chat_groups WHERE id/.test(sql)) return state.groups.filter((row) => String(row.id) === String(params[0]));
    if (/FROM chat_messages m/.test(sql)) return state.messages;
    if (/FROM chat_members/.test(sql)) {
      return state.members.filter((row) => (
        String(row.group_id) === String(params[0])
        && String(row.user_id) === String(params[1])
        && (!/active = 1/.test(sql) || Number(row.active) === 1)
        && (!/role IN/.test(sql) || ["owner", "admin"].includes(row.role))
      ));
    }
    if (/FROM chat_invites WHERE id/.test(sql)) return state.invites.filter((row) => String(row.id) === String(params[0]));
    if (/FROM chat_invites WHERE pending_key/.test(sql)) return state.invites.filter((row) => String(row.pending_key) === String(params[0]));
    if (/FROM chat_join_requests WHERE id/.test(sql)) return state.requests.filter((row) => String(row.id) === String(params[0]));
    if (/FROM chat_join_requests WHERE pending_key/.test(sql)) return state.requests.filter((row) => String(row.pending_key) === String(params[0]));
    if (/FROM chat_invite_tokens WHERE token_digest/.test(sql)) return state.tokens.filter((row) => String(row.token_digest) === String(params[0]));
    return null;
  }

  async function execute(sql, params = []) {
    events.push({ type: "sql", sql, params });
    const rows = resultRows(sql, params);
    if (rows) return [rows];
    if (/INSERT INTO chat_members/.test(sql)) {
      const existing = state.members.find((row) => String(row.group_id) === String(params[1]) && String(row.user_id) === String(params[2]));
      if (existing) {
        existing.active = 1;
        existing.joined_via = params[3] || "invite";
      } else state.members.push({ id: params[0], group_id: params[1], user_id: params[2], role: "member", joined_via: params[3] || "invite", active: 1 });
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO chat_join_requests/.test(sql)) {
      state.requests.push({ id: params[0], group_id: params[1], applicant_id: params[2], source: params[3], status: "pending", pending_key: params[4] });
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO chat_invites/.test(sql)) {
      state.invites.push({ id: params[0], group_id: params[1], inviter_id: params[2], invitee_id: params[3], status: "pending", pending_key: params[4], expires_at: params[5] });
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO chat_invite_tokens/.test(sql)) {
      state.tokens.push({ id: params[0], group_id: params[1], creator_id: params[2], token_digest: params[3], expires_at: params[4], max_uses: params[5], use_count: 0, revoked: 0 });
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_invite_tokens SET use_count/.test(sql)) {
      const token = state.tokens.find((row) => String(row.id) === String(params[0]));
      token.use_count += 1;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_invite_tokens SET revoked = 1 WHERE group_id/.test(sql)) {
      state.tokens
        .filter((row) => String(row.group_id) === String(params[0]) && !row.revoked)
        .forEach((row) => { row.revoked = 1; });
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_invite_tokens SET revoked = 1 WHERE id/.test(sql)) {
      const token = state.tokens.find((row) => String(row.id) === String(params[0]));
      if (token) token.revoked = 1;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_invites SET status = 'accepted'/.test(sql)) {
      const invite = state.invites.find((row) => String(row.id) === String(params[0]));
      invite.status = "accepted";
      invite.pending_key = null;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_join_requests SET status/.test(sql)) {
      const request = state.requests.find((row) => String(row.id) === String(params[2]));
      request.status = params[0];
      request.pending_key = null;
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE chat_groups SET next_message_sequence/.test(sql)) {
      const group = state.groups.find((row) => String(row.id) === String(params[0]));
      group.next_message_sequence = Number(group.next_message_sequence || 0) + 1;
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO chat_messages/.test(sql)) {
      if (params.length > 7 && /T/.test(String(params[7] || ""))) {
        throw new Error(`Incorrect datetime value: '${params[7]}' for column 'created_at'`);
      }
      state.messages.push({
        id: params[0],
        group_id: params[1],
        sequence: params[2],
        sender_id: params[3],
        client_request_id: params[4],
        text: params[5],
        sticker_id: params[6] || null,
        created_at: new Date().toISOString()
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  const connection = {
    async beginTransaction() {
      events.push({ type: "begin" });
      snapshot = structuredClone(state);
    },
    async commit() {
      events.push({ type: "commit" });
      snapshot = null;
    },
    async rollback() {
      events.push({ type: "rollback" });
      if (snapshot) Object.assign(state, structuredClone(snapshot));
      snapshot = null;
    },
    release() { events.push({ type: "release" }); },
    execute,
    query: execute
  };
  return {
    state,
    events,
    pool: {
      execute,
      async getConnection() { return connection; }
    }
  };
}

test("mandatory class membership derives from active assignments without platform-admin member rows", async () => {
  const { store, users } = fixtures();

  const groups = await store.listUserGroups(users["student-a"].id);
  assert.deepEqual(groups.map((group) => group.id), ["class-group-a"]);
  assert.equal(groups[0].college, "经管学院");

  const members = await store.listMembers("class-group-a", users["student-a"]);
  assert.deepEqual(members.map((member) => member.userId), ["student-a", "teacher-a"]);
  assert.equal(members.find((member) => member.userId === "student-a").role, "admin");
  assert.equal(members.some((member) => member.userId === "platform-admin"), false);
  assert.equal(store.data.members.some((member) => member.userId === "platform-admin"), false);
});

test("class groups deny cross-class users but allow platform governance without membership", async () => {
  const { store, users } = fixtures();

  await assert.rejects(() => store.getGroupForUser("class-group-a", users["student-b"]), /无权访问/);
  const groups = await store.listUserGroups(users["platform-admin"].id);
  assert.deepEqual(groups.map((group) => group.id), ["class-group-a", "class-group-b"]);
  const governed = await store.getGroupForUser("class-group-a", users["platform-admin"]);
  assert.equal(governed.governance, true);
  assert.equal(governed.membership, null);
});

test("custom group creation gives the creator owner membership and a unique decimal group number", async () => {
  const { store, users } = fixtures({ groupNumbers: ["1000000001", "2234567890"] });

  const group = await store.createCustomGroup({ name: "数字经济学习小组" }, users.owner);
  assert.match(group.publicNo, /^\d{10,}$/);
  assert.equal(group.publicNo, "2234567890");
  const members = await store.listMembers(group.id, users.owner);
  assert.deepEqual(members.map(({ userId, role }) => ({ userId, role })), [{ userId: "owner", role: "owner" }]);
});

test("ordinary group access follows owner admin and member roles and denies outsiders", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "校园摄影群" }, users.owner);
  store.data.members.push(
    { id: "member-admin", groupId: group.id, userId: users["group-admin"].id, role: "admin", active: true, joinedVia: "owner" },
    { id: "member-user", groupId: group.id, userId: users.member.id, role: "member", active: true, joinedVia: "invite" }
  );

  assert.equal((await store.getGroupForUser(group.id, users.owner)).membership.role, "owner");
  assert.equal((await store.getGroupForUser(group.id, users["group-admin"])).membership.role, "admin");
  assert.equal((await store.getGroupForUser(group.id, users.member)).membership.role, "member");
  await assert.rejects(() => store.getGroupForUser(group.id, users.outsider), /无权访问/);
});

test("group-number joins require owner or group-admin review and duplicate pending requests are idempotent", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "考研交流" }, users.owner);
  store.data.members.push({ id: "member-admin", groupId: group.id, userId: users["group-admin"].id, role: "admin", active: true, joinedVia: "owner" });

  const first = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number", groupNumber: group.publicNo });
  const duplicate = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number", groupNumber: group.publicNo });
  assert.equal(first.id, duplicate.id);
  assert.equal(first.status, "pending");
  assert.equal(store.data.joinRequests.length, 1);

  await assert.rejects(
    () => store.reviewJoinRequest({ requestId: first.id, decision: "approved", reviewer: users.member }),
    /无权审核/
  );
  const approved = await store.reviewJoinRequest({ requestId: first.id, decision: "approved", reviewer: users["group-admin"] });
  assert.equal(approved.status, "approved");
  assert.equal((await store.getGroupForUser(group.id, users.outsider)).membership.role, "member");
  const replay = await store.reviewJoinRequest({ requestId: first.id, decision: "approved", reviewer: users.owner });
  assert.equal(replay.status, "approved");
  assert.equal(store.data.members.filter((member) => member.groupId === group.id && member.userId === users.outsider.id && member.active).length, 1);
});

test("join reviewers cannot approve requests belonging to another group", async () => {
  const { store, users } = fixtures();
  const firstGroup = await store.createCustomGroup({ name: "第一群" }, users.owner);
  const secondGroup = await store.createCustomGroup({ name: "第二群" }, users["group-admin"]);
  const request = await store.createJoinRequest({ groupId: firstGroup.id, applicantId: users.outsider.id, source: "group_number", groupNumber: firstGroup.publicNo });

  await assert.rejects(
    () => store.reviewJoinRequest({ requestId: request.id, decision: "approved", reviewer: users["group-admin"] }),
    /无权审核/
  );
  assert.equal((await store.getGroupForUser(secondGroup.id, users["group-admin"])).membership.role, "owner");
});

test("direct invites require the intended invitee confirmation and acceptance is idempotent", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "创新创业群" }, users.owner);

  const first = await store.createInvite({ groupId: group.id, inviterId: users.owner.id, inviteeId: users.invitee.id });
  const duplicate = await store.createInvite({ groupId: group.id, inviterId: users.owner.id, inviteeId: users.invitee.id });
  assert.equal(first.id, duplicate.id);
  assert.equal(store.data.invites.length, 1);
  await assert.rejects(() => store.acceptInvite({ inviteId: first.id, inviteeId: users.outsider.id }), /仅限被邀请人/);

  const member = await store.acceptInvite({ inviteId: first.id, inviteeId: users.invitee.id });
  assert.equal(member.userId, users.invitee.id);
  const replay = await store.acceptInvite({ inviteId: first.id, inviteeId: users.invitee.id });
  assert.equal(replay.id, member.id);
  assert.equal(store.data.members.filter((item) => item.groupId === group.id && item.userId === users.invitee.id && item.active).length, 1);
});

test("accepted invite replay never reactivates a member who later left the group", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "invite replay" }, users.owner);
  const invite = await store.createInvite({ groupId: group.id, inviterId: users.owner.id, inviteeId: users.invitee.id });

  await store.acceptInvite({ inviteId: invite.id, inviteeId: users.invitee.id });
  const member = store.data.members.find((item) => item.groupId === group.id && item.userId === users.invitee.id);
  member.active = false;
  member.joinedVia = "left";

  const replay = await store.acceptInvite({ inviteId: invite.id, inviteeId: users.invitee.id });
  assert.equal(replay.active, false);
  assert.equal(member.active, false);
  assert.equal(member.joinedVia, "left");
});

test("group-number join requests require a matching public group number", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "verified group number" }, users.owner);

  await assert.rejects(
    () => store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number" }),
    /群号|来源|凭证/
  );
  await assert.rejects(
    () => store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number", groupNumber: "0000000000" }),
    /群号|来源|凭证/
  );

  const request = await store.createJoinRequest({
    groupId: group.id,
    applicantId: users.outsider.id,
    source: "group_number",
    groupNumber: group.publicNo
  });
  assert.equal(request.status, "pending");
});

test("QR join requests validate a generated unexpired token and consume one use only once", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "verified qr" }, users.owner);
  const created = await store.createInviteToken({
    groupId: group.id,
    creatorId: users.owner.id,
    token: "attacker-known-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxUses: 1
  });

  assert.match(created.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(created.token, "attacker-known-token");
  assert.equal(store.data.inviteTokens[0].token, undefined);
  assert.doesNotMatch(JSON.stringify(store.data), /attacker-known-token/);

  await assert.rejects(
    () => store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "qr", token: "wrong-token" }),
    /二维码|凭证|失效/
  );
  const request = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "qr", token: created.token });
  const duplicate = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "qr", token: created.token });
  assert.equal(request.id, duplicate.id);
  assert.equal(store.data.inviteTokens[0].useCount, 1);
});

test("invite token digests cannot be reused by another group", async () => {
  const { store, users } = fixtures({ inviteTokens: ["same-token-value", "same-token-value"] });
  const first = await store.createCustomGroup({ name: "first token group" }, users.owner);
  const second = await store.createCustomGroup({ name: "second token group" }, users["group-admin"]);
  await store.createInviteToken({ groupId: first.id, creatorId: users.owner.id });
  await assert.rejects(
    () => store.createInviteToken({ groupId: second.id, creatorId: users["group-admin"].id }),
    /二维码|令牌|已存在/
  );
});

test("invites expire before they can add a member", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "expired invite" }, users.owner);
  const invite = await store.createInvite({
    groupId: group.id,
    inviterId: users.owner.id,
    inviteeId: users.invitee.id,
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  });

  await assert.rejects(
    () => store.acceptInvite({ inviteId: invite.id, inviteeId: users.invitee.id }),
    /失效|过期/
  );
  assert.equal(store.data.members.some((item) => item.groupId === group.id && item.userId === users.invitee.id && item.active), false);
});

test("members from another ordinary group cannot invite or read members", async () => {
  const { store, users } = fixtures();
  const firstGroup = await store.createCustomGroup({ name: "第一群" }, users.owner);
  await store.createCustomGroup({ name: "第二群" }, users["group-admin"]);

  await assert.rejects(
    () => store.createInvite({ groupId: firstGroup.id, inviterId: users["group-admin"].id, inviteeId: users.invitee.id }),
    /无权邀请/
  );
  await assert.rejects(() => store.listMembers(firstGroup.id, users["group-admin"]), /无权访问/);
});

test("frozen groups are readable but not joinable or inviteable and disabled groups are unavailable", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "临时群" }, users.owner);
  const stored = store.data.groups.find((item) => item.id === group.id);
  stored.status = "frozen";

  const frozen = await store.getGroupForUser(group.id, users.owner);
  assert.equal(frozen.canWrite, false);
  assert.equal(frozen.status, "frozen");
  await assert.rejects(
    () => store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number" }),
    /群聊已冻结/
  );
  await assert.rejects(
    () => store.createInvite({ groupId: group.id, inviterId: users.owner.id, inviteeId: users.invitee.id }),
    /群聊已冻结/
  );

  stored.status = "disabled";
  await assert.rejects(() => store.getGroupForUser(group.id, users.owner), /群聊不可用/);
});

test("inactive accounts cannot create groups request joins or accept invites", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "有效群" }, users.owner);
  await assert.rejects(() => store.createCustomGroup({ name: "停用群" }, users["disabled-user"]), /账号不可用/);
  await assert.rejects(
    () => store.createJoinRequest({ groupId: group.id, applicantId: users["disabled-user"].id, source: "group_number" }),
    /账号不可用/
  );
});

test("invite tokens persist only SHA-256 digests and safe metadata", async () => {
  const { store, users } = fixtures();
  const group = await store.createCustomGroup({ name: "二维码群" }, users.owner);
  const rawToken = "qr-token-that-must-never-be-stored";
  const token = await store.createInviteToken({ groupId: group.id, creatorId: users.owner.id, token: rawToken, maxUses: 1 });

  assert.match(token.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(token.token, rawToken);
  assert.equal(token.tokenDigest, undefined);
  assert.equal(store.data.inviteTokens.length, 1);
  assert.equal(store.data.inviteTokens[0].token, undefined);
  assert.equal(store.data.inviteTokens[0].tokenDigest, crypto.createHash("sha256").update(token.token).digest("hex"));
  assert.equal(inviteTokenDigest(token.token), store.data.inviteTokens[0].tokenDigest);
  assert.doesNotMatch(JSON.stringify(store.data), new RegExp(rawToken));
});

test("schema provides durable idempotent group member request invite and token contracts", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_groups[\s\S]*public_no VARCHAR\(32\)[\s\S]*owner_id VARCHAR\(64\)[\s\S]*UNIQUE KEY uq_chat_group_public_no \(public_no\)/);
  assert.match(schema, /ALTER TABLE chat_groups[\s\S]*ADD COLUMN IF NOT EXISTS public_no/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_members[\s\S]*UNIQUE KEY uq_chat_member \(group_id, user_id\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_join_requests[\s\S]*pending_key VARCHAR\(160\)[\s\S]*UNIQUE KEY uq_chat_join_pending \(pending_key\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_invites[\s\S]*pending_key VARCHAR\(160\)[\s\S]*UNIQUE KEY uq_chat_invite_pending \(pending_key\)/);
  assert.match(schema, /ALTER TABLE chat_invites[\s\S]*ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_invite_tokens[\s\S]*token_digest CHAR\(64\)[\s\S]*UNIQUE KEY uq_chat_invite_token_digest \(token_digest\)/);
  assert.doesNotMatch(schema, /raw_token|token_plaintext/);
});

test("MySQL custom group creation retries a concurrent public-number collision", async () => {
  const attempts = [];
  let insertCount = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (/SELECT id FROM chat_groups WHERE public_no/.test(sql)) return [[]];
      if (/INSERT INTO chat_groups/.test(sql)) {
        attempts.push(params[1]);
        insertCount += 1;
        if (insertCount === 1) {
          const error = new Error("Duplicate entry for uq_chat_group_public_no");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO chat_members/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const pool = {
    async execute(sql, params = []) {
      if (/FROM students WHERE id/.test(sql)) {
        return [[{ id: params[0], name: "群主", role: "student", status: "active" }]];
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
    async getConnection() {
      return connection;
    }
  };
  let index = 0;
  const numbers = ["2234567890", "2234567891"];
  const store = createMysqlChatStore(pool, { groupNumberGenerator: () => numbers[index++] });

  const group = await store.createCustomGroup({ name: "并发建群" }, { id: "owner" });
  assert.equal(group.publicNo, "2234567891");
  assert.deepEqual(attempts, numbers);
});

test("MySQL accepts either a user id or a user object for the same group creation path", async () => {
  const attempts = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (/SELECT id FROM chat_groups WHERE public_no/.test(sql)) return [[]];
      if (/INSERT INTO chat_groups/.test(sql)) {
        attempts.push(params[3]);
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO chat_members/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const pool = {
    async execute(sql, params = []) {
      if (/FROM students WHERE id/.test(sql)) return [[{ id: params[0], name: "Owner", role: "student", status: "active" }]];
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
    async getConnection() { return connection; }
  };
  const store = createMysqlChatStore(pool, { groupNumberGenerator: () => "2234567890" });

  const fromId = await store.createCustomGroup({ name: "id caller" }, "owner");
  const fromObject = await store.createCustomGroup({ name: "object caller" }, { id: "owner" });
  assert.equal(fromId.ownerId, "owner");
  assert.equal(fromObject.ownerId, "owner");
  assert.deepEqual(attempts, ["owner", "owner"]);
});

test("MySQL rejects disabled groups even when a stale frozen flag is also present", async () => {
  const { pool } = createMysqlHarness({
    groups: [{ id: "group-a", type: "custom", public_no: "1234567890", name: "Disabled", status: "disabled", frozen: 1 }]
  });
  const store = createMysqlChatStore(pool);

  await assert.rejects(() => store.getGroupForUser("group-a", "owner"), /群聊不可用/);
});

test("MySQL custom-group message reads use a concrete no-match class key", async () => {
  const harness = createMysqlHarness();
  const store = createMysqlChatStore(harness.pool);

  const page = await store.listMessages({ groupId: "group-a", viewerId: "owner", tail: true });
  assert.deepEqual(page.messages, []);
  const messageQuery = harness.events.find((event) => event.type === "sql" && /FROM chat_messages m/.test(event.sql));
  assert.equal(messageQuery.params[0], "");
  assert.notEqual(messageQuery.params[0], null);
});

test("MySQL message writes let the database generate TIMESTAMP values", async () => {
  const harness = createMysqlHarness();
  const store = createMysqlChatStore(harness.pool);

  const message = await store.createMessage({
    groupId: "group-a",
    senderId: "owner",
    clientRequestId: "message-request-0001",
    text: "你好"
  });

  assert.equal(message.text, "你好");
  const insert = harness.events.find((event) => event.type === "sql" && /INSERT INTO chat_messages/.test(event.sql));
  assert.doesNotMatch(insert.sql, /created_at/);
  assert.equal(insert.params.length, 7);
});

test("MySQL invite replay and expired invites do not reactivate members and rollback cleanly", async () => {
  const accepted = createMysqlHarness({
    members: [
      { id: "owner-member", group_id: "group-a", user_id: "owner", role: "owner", active: 1, joined_via: "created" },
      { id: "invitee-member", group_id: "group-a", user_id: "invitee", role: "member", active: 0, joined_via: "left" }
    ],
    invites: [{ id: "accepted-invite", group_id: "group-a", inviter_id: "owner", invitee_id: "invitee", status: "accepted", pending_key: null, expires_at: new Date(Date.now() + 60_000).toISOString() }]
  });
  const acceptedStore = createMysqlChatStore(accepted.pool);
  const replay = await acceptedStore.acceptInvite({ inviteId: "accepted-invite", inviteeId: "invitee" });
  assert.equal(replay.active, false);
  assert.equal(accepted.state.members.find((row) => row.id === "invitee-member").active, 0);
  assert.equal(accepted.events.some((event) => event.type === "sql" && /INSERT INTO chat_members/.test(event.sql)), false);

  const expired = createMysqlHarness({
    invites: [{ id: "expired-invite", group_id: "group-a", inviter_id: "owner", invitee_id: "invitee", status: "pending", pending_key: "group-a:invitee", expires_at: new Date(Date.now() - 60_000).toISOString() }]
  });
  const expiredStore = createMysqlChatStore(expired.pool);
  await assert.rejects(() => expiredStore.acceptInvite({ inviteId: "expired-invite", inviteeId: "invitee" }), /过期/);
  assert.equal(expired.state.members.some((row) => row.user_id === "invitee"), false);
  assert.equal(expired.events.some((event) => event.type === "rollback"), true);
});

test("MySQL join requests validate QR proof inside a transaction and roll back invalid requests", async () => {
  const harness = createMysqlHarness();
  const store = createMysqlChatStore(harness.pool);

  await assert.rejects(
    () => store.createJoinRequest({ groupId: "group-a", applicantId: "outsider", source: "qr", token: "not-issued" }),
    /二维码凭证无效/
  );
  assert.equal(harness.state.requests.length, 0);
  assert.equal(harness.events.some((event) => event.type === "rollback"), true);
  const sql = harness.events.filter((event) => event.type === "sql").map((event) => event.sql).join("\n");
  assert.match(sql, /chat_groups WHERE id = \? FOR UPDATE/);
  assert.match(sql, /chat_join_requests WHERE pending_key = \? FOR UPDATE/);
  assert.match(sql, /chat_invite_tokens WHERE token_digest = \? FOR UPDATE/);
});

test("MySQL accepts only a group-bound QR token or matching group number and consumes one QR use", async () => {
  const rawToken = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const qrHarness = createMysqlHarness({
    tokens: [{ id: "token-a", group_id: "group-a", creator_id: "owner", token_digest: inviteTokenDigest(rawToken), expires_at: new Date(Date.now() + 60_000).toISOString(), max_uses: 1, use_count: 0, revoked: 0 }]
  });
  const qrStore = createMysqlChatStore(qrHarness.pool);
  const request = await qrStore.createJoinRequest({ groupId: "group-a", applicantId: "outsider", source: "qr", token: rawToken });
  assert.equal(request.status, "pending");
  assert.equal(qrHarness.state.requests.length, 1);
  assert.equal(qrHarness.state.tokens[0].use_count, 1);

  const numberHarness = createMysqlHarness();
  const numberStore = createMysqlChatStore(numberHarness.pool);
  await assert.rejects(
    () => numberStore.createJoinRequest({ groupId: "group-a", applicantId: "outsider", source: "group_number", groupNumber: "9999999999" }),
    /群号与目标群不一致/
  );
  assert.equal(numberHarness.state.requests.length, 0);
  assert.equal(numberHarness.events.some((event) => event.type === "rollback"), true);
});

test("MySQL rejects a generated token digest collision across groups", async () => {
  const harness = createMysqlHarness({
    groups: [
      { id: "group-a", type: "custom", public_no: "1234567890", name: "A", status: "active", frozen: 0 },
      { id: "group-b", type: "custom", public_no: "1234567891", name: "B", status: "active", frozen: 0 }
    ],
    members: [
      { id: "owner-a", group_id: "group-a", user_id: "owner", role: "owner", active: 1, joined_via: "created" },
      { id: "owner-b", group_id: "group-b", user_id: "owner", role: "owner", active: 1, joined_via: "created" }
    ]
  });
  const store = createMysqlChatStore(harness.pool, { inviteTokenGenerator: () => "ffffffffffffffffffffffffffffffff" });

  await store.createInviteToken({ groupId: "group-a", creatorId: "owner" });
  await assert.rejects(() => store.createInviteToken({ groupId: "group-b", creatorId: "owner" }), /二维码令牌已存在/);
  assert.equal(harness.state.tokens.length, 1);
});

test("MySQL generates a one-time QR token without persisting caller supplied token text", async () => {
  const harness = createMysqlHarness();
  const generated = "dddddddddddddddddddddddddddddddd";
  const store = createMysqlChatStore(harness.pool, { inviteTokenGenerator: () => generated });

  const token = await store.createInviteToken({
    groupId: "group-a",
    creatorId: "owner",
    token: "caller-controlled-secret",
    maxUses: 2
  });

  assert.equal(token.token, generated);
  assert.equal(token.tokenDigest, undefined);
  assert.equal(harness.state.tokens[0].token_digest, inviteTokenDigest(generated));
  assert.doesNotMatch(JSON.stringify(harness.state), /caller-controlled-secret/);
  assert.equal(harness.events.filter((event) => event.type === "sql" && /chat_invite_tokens WHERE token_digest/.test(event.sql))[0].sql.includes("FOR UPDATE"), true);
});

test("MySQL store sanitizes connection and SQL failures", async () => {
  const pool = {
    async execute() {
      throw new Error("SELECT password_hash FROM students at mysql.internal:3306");
    }
  };
  const store = createMysqlChatStore(pool);
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () => store.listUserGroups("student-a"),
      (error) => error.message === "群聊服务暂不可用" && !/SELECT|mysql|password_hash/.test(error.message)
    );
  } finally {
    console.error = originalError;
  }
});

test("MySQL store repairs a missing chat schema once and retries the request", async () => {
  let groupQueryCount = 0;
  let recoveryCount = 0;
  const pool = {
    async execute(sql) {
      if (/FROM students WHERE id/.test(sql)) {
        return [[{
          id: "student-a",
          name: "Student A",
          role: "student",
          status: "active",
          school: "Test University",
          college: "Test College",
          class_name: "Class 1"
        }]];
      }
      if (/FROM chat_groups cg/.test(sql)) {
        groupQueryCount += 1;
        if (groupQueryCount === 1) {
          const error = new Error("Table 'smart_campus.chat_groups' doesn't exist");
          error.code = "ER_NO_SUCH_TABLE";
          throw error;
        }
        return [[]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const store = createMysqlChatStore(pool, {
    recoverMissingSchema: async () => {
      recoveryCount += 1;
    }
  });

  assert.deepEqual(await store.listUserGroups("student-a"), []);
  assert.equal(recoveryCount, 1);
  assert.equal(groupQueryCount, 2);
});

test("MySQL governance audit uses a TiDB-compatible literal LIMIT", async () => {
  const calls = [];
  const pool = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM students WHERE id/.test(sql)) {
        return [[{
          id: "platform-admin",
          name: "平台管理员",
          role: "admin",
          status: "active",
          school: "泰州学院",
          college: "经管学院",
          class_name: "24数字经济"
        }]];
      }
      if (/FROM chat_audit_logs/.test(sql)) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const store = createMysqlChatStore(pool);

  assert.deepEqual(await store.listAuditLogs({ id: "platform-admin" }, { limit: 100 }), []);
  const auditQuery = calls.find((call) => /FROM chat_audit_logs/.test(call.sql));
  assert.match(auditQuery.sql, /LIMIT 100$/);
  assert.doesNotMatch(auditQuery.sql, /LIMIT \?/);
  assert.deepEqual(auditQuery.params, []);
});
