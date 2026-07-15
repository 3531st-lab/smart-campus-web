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
    { id: "platform-admin", name: "平台管理员", role: "admin", status: "active" },
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
    { id: "ca-3", classId: "class-a", userId: "platform-admin", duty: "class_admin", source: "student_identity", active: true },
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
  const store = createMemoryChatStore(seed, {
    groupNumberGenerator: () => groupNumbers[Math.min(groupNumberIndex++, groupNumbers.length - 1)]
  });
  return { store, users: Object.fromEntries(users.map((user) => [user.id, user])) };
}

test("mandatory class membership derives from active assignments without platform-admin member rows", async () => {
  const { store, users } = fixtures();

  const groups = await store.listUserGroups(users["student-a"].id);
  assert.deepEqual(groups.map((group) => group.id), ["class-group-a"]);

  const members = await store.listMembers("class-group-a", users["student-a"]);
  assert.deepEqual(members.map((member) => member.userId), ["student-a", "teacher-a"]);
  assert.equal(members.find((member) => member.userId === "student-a").role, "admin");
  assert.equal(members.some((member) => member.userId === "platform-admin"), false);
  assert.equal(store.data.members.some((member) => member.userId === "platform-admin"), false);
});

test("class groups deny cross-class users but allow platform governance without membership", async () => {
  const { store, users } = fixtures();

  await assert.rejects(() => store.getGroupForUser("class-group-a", users["student-b"]), /无权访问/);
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

  const first = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number" });
  const duplicate = await store.createJoinRequest({ groupId: group.id, applicantId: users.outsider.id, source: "group_number" });
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
  const request = await store.createJoinRequest({ groupId: firstGroup.id, applicantId: users.outsider.id, source: "group_number" });

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

  assert.equal(token.token, undefined);
  assert.equal(token.tokenDigest, undefined);
  assert.equal(store.data.inviteTokens.length, 1);
  assert.equal(store.data.inviteTokens[0].token, undefined);
  assert.equal(store.data.inviteTokens[0].tokenDigest, crypto.createHash("sha256").update(rawToken).digest("hex"));
  assert.equal(inviteTokenDigest(rawToken), store.data.inviteTokens[0].tokenDigest);
  assert.doesNotMatch(JSON.stringify(store.data), new RegExp(rawToken));
});

test("schema provides durable idempotent group member request invite and token contracts", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_groups[\s\S]*public_no VARCHAR\(32\)[\s\S]*owner_id VARCHAR\(64\)[\s\S]*UNIQUE KEY uq_chat_group_public_no \(public_no\)/);
  assert.match(schema, /ALTER TABLE chat_groups[\s\S]*ADD COLUMN IF NOT EXISTS public_no/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_members[\s\S]*UNIQUE KEY uq_chat_member \(group_id, user_id\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_join_requests[\s\S]*pending_key VARCHAR\(160\)[\s\S]*UNIQUE KEY uq_chat_join_pending \(pending_key\)/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS chat_invites[\s\S]*pending_key VARCHAR\(160\)[\s\S]*UNIQUE KEY uq_chat_invite_pending \(pending_key\)/);
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
