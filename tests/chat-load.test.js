process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createMemoryChatStore } = require("../server/chat-store");

function createLargeGroupStore(total = 10_000) {
  const user = { id: "load-user", name: "Load User", role: "student", status: "active" };
  const group = { id: "load-group", type: "class", classId: "load-class", name: "Load Class", status: "active" };
  return createMemoryChatStore({
    users: [user],
    campusClasses: [{ id: "load-class", school: "Test", college: "Test", className: "Load", groupId: group.id, status: "active" }],
    classAssignments: [{ id: "load-assignment", classId: "load-class", userId: user.id, duty: "member", active: true }],
    chatGroups: [group],
    chatMessages: Array.from({ length: total }, (_, index) => ({
      id: `load-message-${index + 1}`,
      groupId: group.id,
      senderId: user.id,
      sequence: index + 1,
      text: `message ${index + 1}`,
      createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString()
    }))
  });
}

test("large group opens from a bounded latest-message page without offset pagination", async () => {
  const store = createLargeGroupStore();
  const latest = await store.listMessages({ groupId: "load-group", viewerId: "load-user", limit: 50, tail: true });

  assert.equal(latest.messages.length, 50);
  assert.deepEqual(latest.messages.map((message) => Number(message.sequence)), Array.from({ length: 50 }, (_, index) => 9951 + index));
  assert.equal(latest.nextSequence, 10_000);
  assert.equal(latest.hasMore, true);

  const source = fs.readFileSync(path.join(__dirname, "..", "server", "chat-store.js"), "utf8");
  assert.doesNotMatch(source, /\bOFFSET\b/i);
});

test("chat client and page retain bounded in-memory and rendered message windows", () => {
  const root = path.join(__dirname, "..");
  const client = fs.readFileSync(path.join(root, "public", "chat-client.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "public", "chat-page.js"), "utf8");

  assert.match(client, /MAX_CACHED_MESSAGES\s*=\s*220/);
  assert.match(page, /MAX_RENDERED_MESSAGES\s*=\s*160/);
});
