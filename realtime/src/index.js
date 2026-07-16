function base64urlToText(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

function textToBase64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return textToBase64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

async function verifyConnectionToken(token, groupId, secret) {
  const [encoded, signature, ...rest] = String(token || "").split(".");
  if (!encoded || !signature || rest.length || !safeEqual(signature, await hmac(encoded, secret))) return null;
  try {
    const payload = JSON.parse(base64urlToText(encoded));
    if (payload.v !== 1 || payload.groupId !== groupId || !payload.userId || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

async function verifyInternal(request, groupId, event, env) {
  const timestamp = Number(request.headers.get("x-chat-realtime-timestamp"));
  const nonce = String(request.headers.get("x-chat-realtime-nonce") || "");
  const signature = String(request.headers.get("x-chat-realtime-signature") || "");
  if (!nonce || !signature || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) return null;
  const body = JSON.stringify({ groupId, event });
  return safeEqual(signature, await hmac(`${timestamp}.${nonce}.${body}`, env.CHAT_REALTIME_INTERNAL_SECRET)) ? { nonce, timestamp } : null;
}

export class ChatRoom {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade required", { status: 426 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/event" && request.method === "POST") {
      const { nonce, event } = await request.json();
      if (!nonce || !event) return new Response("Bad event", { status: 400 });
      const seenKey = `nonce:${nonce}`;
      if (await this.state.storage.get(seenKey)) return Response.json({ delivered: true, replay: true });
      await this.state.storage.put(seenKey, Date.now());
      const serialized = JSON.stringify(event);
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(serialized); } catch (_error) { socket.close(1011, "broadcast failed"); }
      }
      return Response.json({ delivered: true });
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage() {}
  webSocketClose(socket) { socket.close(1000, "closed"); }
  webSocketError(socket) { socket.close(1011, "socket error"); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const connect = url.pathname.match(/^\/groups\/([^/]+)\/connect$/);
    if (connect && request.method === "GET") {
      const groupId = decodeURIComponent(connect[1]);
      const token = await verifyConnectionToken(url.searchParams.get("token"), groupId, env.CHAT_REALTIME_TOKEN_SECRET);
      if (!token) return new Response("Unauthorized", { status: 401 });
      const id = env.CHAT_ROOMS.idFromName(groupId);
      return env.CHAT_ROOMS.get(id).fetch("https://room/connect", { headers: { Upgrade: request.headers.get("Upgrade") || "" } });
    }
    const publish = url.pathname.match(/^\/internal\/groups\/([^/]+)\/events$/);
    if (publish && request.method === "POST") {
      const groupId = decodeURIComponent(publish[1]);
      const payload = await request.json();
      const verified = await verifyInternal(request, groupId, payload.event, env);
      if (!verified) return new Response("Unauthorized", { status: 401 });
      const id = env.CHAT_ROOMS.idFromName(groupId);
      return env.CHAT_ROOMS.get(id).fetch("https://room/event", { method: "POST", body: JSON.stringify({ nonce: verified.nonce, event: payload.event }) });
    }
    return new Response("Not found", { status: 404 });
  }
};
