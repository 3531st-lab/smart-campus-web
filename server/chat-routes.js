const defaultStore = require("./chat-store");

function routeGroupId(pathname, suffix) {
  const match = pathname.match(new RegExp(`^/api/chat/groups/([^/]+)${suffix}$`));
  return match ? decodeURIComponent(match[1]) : "";
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

  const user = await requireUser(context.req, res);
  if (!user) return true;

  try {
    if (route === "GET /api/chat/groups") {
      sendJson(res, 200, { groups: await store.listUserGroups(user.id) });
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
