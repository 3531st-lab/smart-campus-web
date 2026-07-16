const defaultStore = require("./chat-store");
const defaultMediaStore = require("./media-store");
const defaultRealtime = require("./chat-realtime");
const QRCode = require("qrcode");

function stickerFavoriteId(pathname) {
  const match = pathname.match(/^\/api\/chat\/stickers\/([^/]+)\/favorite$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    const error = new Error("图片数据格式无效");
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length) {
    const error = new Error("图片数据为空");
    error.statusCode = 400;
    throw error;
  }
  return { mimeType: match[1].toLowerCase(), bytes };
}

function routeGroupId(pathname, suffix) {
  const match = pathname.match(new RegExp(`^/api/chat/groups/([^/]+)${suffix}$`));
  return match ? decodeURIComponent(match[1]) : "";
}

function routeJoinRequestId(pathname) {
  const match = pathname.match(/^\/api\/chat\/join-requests\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function routeInviteToken(pathname) {
  const match = pathname.match(/^\/api\/chat\/groups\/([^/]+)\/invite-token(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    groupId: decodeURIComponent(match[1]),
    tokenId: match[2] ? decodeURIComponent(match[2]) : ""
  };
}

function routeAdminGroupStatus(pathname) {
  const match = pathname.match(/^\/api\/admin\/chat\/groups\/([^/]+)\/status$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function routeAppealId(pathname) {
  const match = pathname.match(/^\/api\/admin\/chat\/appeals\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function inviteUrl(url, token) {
  return `${url.origin}/?chatInvite=${encodeURIComponent(token)}#chat`;
}

function chatError(error) {
  const status = Number(error?.statusCode);
  if (status >= 400 && status <= 599) return { status, message: error.message };
  return { status: 500, message: "群聊服务暂不可用，请稍后再试" };
}

async function handleChatRoute(context) {
  const { route, url, res, requireUser, parseBody, sendJson, sendError } = context;
  const store = context.store || defaultStore;
  const mediaStore = context.mediaStore || defaultMediaStore;
  const realtime = context.realtime || defaultRealtime;
  if (!route.includes(" /api/chat") && !route.includes(" /api/admin/chat")) return false;
  const routeName = `${String(route).split(" ")[0]} ${url.pathname}`;

  const user = await requireUser(context.req, res);
  if (!user) return true;

  try {
    if (routeName === "GET /api/admin/chat/groups") {
      const payload = await store.listGovernanceGroups(user);
      sendJson(res, 200, payload);
      return true;
    }

    const adminGroupId = routeAdminGroupStatus(url.pathname);
    if (route.startsWith("PUT /api/admin/chat/groups/") && adminGroupId) {
      const body = await parseBody(context.req);
      const group = await store.setGroupStatus({ groupId: adminGroupId, status: body.status, operator: user });
      sendJson(res, 200, { group });
      return true;
    }

    const appealId = routeAppealId(url.pathname);
    if (route.startsWith("PUT /api/admin/chat/appeals/") && appealId) {
      const body = await parseBody(context.req);
      const appeal = await store.reviewAppeal({ appealId, status: body.status, reviewer: user });
      sendJson(res, 200, { appeal });
      return true;
    }

    if (routeName === "GET /api/admin/chat/audit-logs") {
      const logs = await store.listAuditLogs(user, {
        groupId: url.searchParams.get("groupId") || "",
        limit: url.searchParams.get("limit") || 100
      });
      sendJson(res, 200, { logs });
      return true;
    }

    if (routeName === "GET /api/chat/groups") {
      sendJson(res, 200, { groups: await store.listUserGroups(user.id) });
      return true;
    }

    const realtimeGroupId = routeGroupId(url.pathname, "/realtime-token");
    if (route.startsWith("POST /api/chat/groups/") && realtimeGroupId) {
      await store.getGroupForUser(realtimeGroupId, user);
      const realtimeUrl = realtime.realtimeUrl();
      if (!realtimeUrl) {
        sendJson(res, 200, { configured: false });
        return true;
      }
      const expiresAt = Date.now() + Math.max(60_000, Number(process.env.CHAT_REALTIME_TOKEN_TTL_MS || 5 * 60_000));
      sendJson(res, 200, {
        configured: true,
        realtimeUrl,
        expiresAt,
        token: realtime.createRealtimeToken({ userId: user.id, groupId: realtimeGroupId, expiresAt })
      });
      return true;
    }

    if (routeName === "GET /api/chat/stickers") {
      sendJson(res, 200, await store.listStickers(user.id));
      return true;
    }

    if (routeName === "POST /api/chat/stickers") {
      const body = await parseBody(context.req);
      const image = parseImageDataUrl(body.dataUrl);
      const media = await mediaStore.saveImage({ ownerId: user.id, bytes: image.bytes, mimeType: image.mimeType, source: body.source || { type: "upload" } });
      const sticker = await store.createSticker({ ownerId: user.id, media, name: body.name, visibility: body.visibility || "private" });
      sendJson(res, 201, { sticker });
      return true;
    }

    const favoriteId = stickerFavoriteId(url.pathname);
    if (route.startsWith("POST /api/chat/stickers/") && favoriteId) {
      const body = await parseBody(context.req);
      const sticker = await store.favoriteSticker({ stickerId: favoriteId, userId: user.id, favorite: body.favorite !== false });
      sendJson(res, 200, { sticker });
      return true;
    }

    if (routeName === "GET /api/chat/sticker-sources/search") {
      sendJson(res, 200, { items: mediaStore.searchSources(url.searchParams.get("q") || "") });
      return true;
    }

    if (routeName === "POST /api/chat/reports") {
      const body = await parseBody(context.req);
      const report = await store.createReport({ reporterId: user.id, targetType: body.targetType, targetId: body.targetId, reason: body.reason });
      sendJson(res, 201, { report });
      return true;
    }

    if (routeName === "POST /api/chat/groups") {
      const body = await parseBody(context.req);
      const group = await store.createCustomGroup({
        name: body.name,
        description: body.description
      }, user);
      sendJson(res, 201, { group });
      return true;
    }

    if (routeName === "GET /api/chat/search") {
      const group = await store.searchGroupByNumber(url.searchParams.get("groupNo"), user.id);
      sendJson(res, 200, { group });
      return true;
    }

    if (routeName === "POST /api/chat/join-requests") {
      const body = await parseBody(context.req);
      const request = await store.createJoinRequest({
        groupId: body.groupId,
        applicantId: user.id,
        source: body.source,
        groupNumber: body.groupNumber,
        token: body.token
      });
      sendJson(res, 201, { request });
      return true;
    }

    const joinRequestId = routeJoinRequestId(url.pathname);
    if (route.startsWith("PUT /api/chat/join-requests/") && joinRequestId) {
      const body = await parseBody(context.req);
      const request = await store.reviewJoinRequest({
        requestId: joinRequestId,
        decision: body.decision,
        reviewer: user
      });
      sendJson(res, 200, { request });
      return true;
    }

    const inviteTokenPath = routeInviteToken(url.pathname);
    if (route.startsWith("POST /api/chat/groups/") && inviteTokenPath && !inviteTokenPath.tokenId) {
      const body = await parseBody(context.req);
      const token = await store.createInviteToken({
        groupId: inviteTokenPath.groupId,
        creatorId: user.id,
        maxUses: body.maxUses || 1,
        expiresAt: body.expiresAt || null
      });
      const urlValue = inviteUrl(url, token.token);
      const qrSvg = await QRCode.toString(urlValue, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320
      });
      sendJson(res, 201, {
        tokenId: token.id,
        token: token.token,
        expiresAt: token.expiresAt,
        maxUses: token.maxUses,
        inviteUrl: urlValue,
        qrSvg
      });
      return true;
    }

    if (route.startsWith("DELETE /api/chat/groups/") && inviteTokenPath?.tokenId) {
      const token = await store.revokeInviteToken({
        groupId: inviteTokenPath.groupId,
        tokenId: inviteTokenPath.tokenId,
        reviewerId: user.id
      });
      sendJson(res, 200, { token });
      return true;
    }

    const membersGroupId = routeGroupId(url.pathname, "/members");
    if (route.startsWith("GET /api/chat/groups/") && membersGroupId) {
      const members = await store.listMembers(membersGroupId, user);
      sendJson(res, 200, { members });
      return true;
    }

    const requestGroupId = routeGroupId(url.pathname, "/join-requests");
    if (route.startsWith("GET /api/chat/groups/") && requestGroupId) {
      const requests = await store.listJoinRequests(requestGroupId, user);
      sendJson(res, 200, { requests });
      return true;
    }

    const appealGroupId = routeGroupId(url.pathname, "/appeals");
    if (route.startsWith("POST /api/chat/groups/") && appealGroupId) {
      const body = await parseBody(context.req);
      const appeal = await store.createAppeal({
        groupId: appealGroupId,
        appellantId: user.id,
        reason: body.reason
      });
      sendJson(res, 201, { appeal });
      return true;
    }

    const messageGroupId = routeGroupId(url.pathname, "/messages");
    if (route.startsWith("POST /api/chat/groups/") && messageGroupId) {
      const body = await parseBody(context.req);
      const message = await store.createMessage({
        groupId: messageGroupId,
        senderId: user.id,
        clientRequestId: body.clientRequestId,
        text: body.text,
        stickerId: body.stickerId
      });
      void realtime.publishRealtimeEvent(messageGroupId, {
        type: "message.created",
        groupId: messageGroupId,
        sequence: message.sequence,
        messageId: message.id
      });
      sendJson(res, 201, { message });
      return true;
    }
    if (route.startsWith("GET /api/chat/groups/") && messageGroupId) {
      const page = await store.listMessages({
        groupId: messageGroupId,
        viewerId: user.id,
        after: url.searchParams.get("after") || 0,
        limit: url.searchParams.get("limit") || 50
      });
      sendJson(res, 200, page);
      return true;
    }

    const cursorGroupId = routeGroupId(url.pathname, "/read-cursor");
    if (route.startsWith("PUT /api/chat/groups/") && cursorGroupId) {
      const body = await parseBody(context.req);
      const cursor = await store.updateReadCursor({
        groupId: cursorGroupId,
        readerId: user.id,
        sequence: body.sequence
      });
      sendJson(res, 200, { cursor });
      return true;
    }
  } catch (error) {
    const safe = chatError(error);
    sendError(res, safe.status, safe.message);
    return true;
  }

  return false;
}

module.exports = { handleChatRoute };
