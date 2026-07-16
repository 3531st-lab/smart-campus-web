const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.CHAT_REALTIME_TOKEN_SECRET = "test-realtime-token-secret-which-is-long-enough";
process.env.CHAT_REALTIME_INTERNAL_SECRET = "test-realtime-internal-secret-which-is-long-enough";
const realtime = require("../server/chat-realtime");

test("realtime tokens expire and are bound to the intended group", () => {
  const token = realtime.createRealtimeToken({ userId: "student-1", groupId: "group-1", expiresAt: 50_000 });
  assert.equal(realtime.verifyRealtimeToken(token, { groupId: "group-1", now: 49_999 }).userId, "student-1");
  assert.equal(realtime.verifyRealtimeToken(token, { groupId: "wrong-group", now: 49_999 }), null);
  assert.equal(realtime.verifyRealtimeToken(token, { groupId: "group-1", now: 50_000 }), null);
});

test("internal realtime publishes use an isolated signed payload and reject replay changes", () => {
  const event = { type: "message.created", groupId: "group-1", sequence: 2, messageId: "message-2" };
  const signed = realtime.createInternalSignature({ groupId: "group-1", event, timestamp: 10_000, nonce: "nonce-1" });
  assert.equal(realtime.verifyInternalSignature({ groupId: "group-1", event, ...signed, now: 10_200 }), true);
  assert.equal(realtime.verifyInternalSignature({ groupId: "group-1", event: { ...event, sequence: 3 }, ...signed, now: 10_200 }), false);
  assert.equal(realtime.verifyInternalSignature({ groupId: "group-1", event, ...signed, now: 80_001 }), false);
});

test("client keeps polling fallback and merges duplicate realtime notices by persisted sequence", () => {
  const client = fs.readFileSync(path.join(__dirname, "..", "public", "chat-client.js"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "..", "realtime", "src", "index.js"), "utf8");
  assert.match(client, /schedulePoll\(\)/);
  assert.match(client, /scheduleReconnect\(\)/);
  assert.match(client, /message\.created/);
  assert.match(client, /mergeEvents/);
  assert.match(worker, /CHAT_REALTIME_INTERNAL_SECRET/);
  assert.match(worker, /nonce:/);
  assert.match(worker, /acceptWebSocket/);
});
