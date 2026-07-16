const defaultStore = require("./chat-store");
const QRCode = require("qrcode");

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
  if (!route.includes(" /api/chat")) return false;
  const routeName = `${String(route).split(" ")[0]} ${url.pathname}`;

  const user = await requireUser(context.req, res);
  if (!user) return true;

  try {
    if (routeName === "GET /api/chat/groups") {
      sendJson(res, 200, { groups: await store.listUserGroups(user.id) });
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

    const messageGroupId = routeGroupId(url.pathname, "/messages");
    if (route.startsWith("POST /api/chat/groups/") && messageGroupId) {
      const body = await parseBody(context.req);
      const message = await store.createMessage({
        groupId: messageGroupId,
        senderId: user.id,
        clientRequestId: body.clientRequestId,
        text: body.text
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
