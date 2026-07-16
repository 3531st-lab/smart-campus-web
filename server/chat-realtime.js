const crypto = require("node:crypto");

const TOKEN_TTL_MS = Math.max(60_000, Number(process.env.CHAT_REALTIME_TOKEN_TTL_MS || 5 * 60_000));
const PUBLISH_TIMEOUT_MS = Math.max(500, Number(process.env.CHAT_REALTIME_PUBLISH_TIMEOUT_MS || 2_000));

function secret(name, fallback) {
  return String(process.env[name] || fallback || "").trim();
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64url(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hmac(value, signingSecret) {
  return crypto.createHmac("sha256", signingSecret).update(String(value)).digest("base64url");
}

function tokenSecret() {
  return secret("CHAT_REALTIME_TOKEN_SECRET", secret("AUTH_SECRET", "smart-campus-local-realtime-token"));
}

function internalSecret() {
  return secret("CHAT_REALTIME_INTERNAL_SECRET", secret("AUTH_SECRET", "smart-campus-local-realtime-internal"));
}

function createRealtimeToken({ userId, groupId, expiresAt = Date.now() + TOKEN_TTL_MS }) {
  if (!userId || !groupId) throw new Error("实时连接缺少用户或群组");
  const payload = {
    v: 1,
    userId: String(userId),
    groupId: String(groupId),
    exp: Number(expiresAt),
    nonce: crypto.randomUUID()
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded, tokenSecret())}`;
}

function verifyRealtimeToken(token, { groupId, now = Date.now() } = {}) {
  const [encoded, signature, ...rest] = String(token || "").split(".");
  if (!encoded || !signature || rest.length || !timingSafeEqual(signature, hmac(encoded, tokenSecret()))) return null;
  try {
    const payload = JSON.parse(decodeBase64url(encoded));
    if (payload.v !== 1 || !payload.userId || !payload.groupId || !Number.isFinite(Number(payload.exp))) return null;
    if (Number(payload.exp) <= Number(now) || (groupId && String(payload.groupId) !== String(groupId))) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function createInternalSignature({ groupId, event, timestamp = Date.now(), nonce = crypto.randomUUID() }) {
  const body = JSON.stringify({ groupId: String(groupId), event });
  const signed = `${timestamp}.${nonce}.${body}`;
  return { timestamp: Number(timestamp), nonce, signature: hmac(signed, internalSecret()), body };
}

function verifyInternalSignature({ groupId, event, timestamp, nonce, signature, now = Date.now(), maxAgeMs = 60_000 }) {
  const age = Math.abs(Number(now) - Number(timestamp));
  if (!nonce || !signature || !Number.isFinite(age) || age > maxAgeMs) return false;
  const body = JSON.stringify({ groupId: String(groupId), event });
  return timingSafeEqual(signature, hmac(`${timestamp}.${nonce}.${body}`, internalSecret()));
}

function realtimeUrl() {
  return String(process.env.CHAT_REALTIME_URL || "").trim().replace(/\/+$/, "");
}

async function publishRealtimeEvent(groupId, event, { fetchImpl = global.fetch } = {}) {
  const baseUrl = realtimeUrl();
  if (!baseUrl || typeof fetchImpl !== "function") return { delivered: false, reason: "not-configured" };
  const signed = createInternalSignature({ groupId, event });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/internal/groups/${encodeURIComponent(groupId)}/events`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-chat-realtime-timestamp": String(signed.timestamp),
        "x-chat-realtime-nonce": signed.nonce,
        "x-chat-realtime-signature": signed.signature
      },
      body: signed.body
    });
    return { delivered: response.ok, status: response.status };
  } catch (_error) {
    return { delivered: false, reason: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  createRealtimeToken,
  verifyRealtimeToken,
  createInternalSignature,
  verifyInternalSignature,
  publishRealtimeEvent,
  realtimeUrl
};
