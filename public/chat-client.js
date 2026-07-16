(function attachCampusChatClient(global) {
  const VISIBLE_POLL_MS = 5000;
  const HIDDEN_POLL_MS = 30000;
  const MAX_RECONNECT_MS = 30000;
  const MAX_CACHED_MESSAGES = 220;

  function requestId() {
    if (global.crypto?.randomUUID) return `chat:${global.crypto.randomUUID()}`;
    return `chat:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function mergeEvents(existing = [], incoming = []) {
    const events = new Map(existing.map((event) => [`${event.groupId}:${event.sequence}:${event.messageId || ""}`, event]));
    incoming.forEach((event) => {
      if (!event || !event.groupId || !Number.isFinite(number(event.sequence))) return;
      events.set(`${event.groupId}:${event.sequence}:${event.messageId || ""}`, event);
    });
    return [...events.values()].sort((left, right) => number(left.sequence) - number(right.sequence));
  }

  function boundedMessages(items = []) {
    return items.slice(Math.max(0, items.length - MAX_CACHED_MESSAGES));
  }

  global.createChatClient = function createChatClient({ api, onEvent = () => {} }) {
    let activeGroupId = "";
    let messages = [];
    let lastSequence = 0;
    let pollTimer = null;
    let destroyed = false;
    let requestInFlight = false;
    let websocket = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let realtimeEvents = [];

    const emit = (type, payload = {}) => onEvent({ type, activeGroupId, messages: [...messages], lastSequence, ...payload });

    function mergeMessages(incoming = []) {
      const merged = new Map(messages.map((item) => [String(item.id), item]));
      incoming.forEach((message) => {
        if (!message?.id) return;
        const next = { ...message, optimistic: false, failed: false };
        if (next.clientRequestId) {
          for (const [key, current] of merged.entries()) {
            if (current?.optimistic && current.clientRequestId === next.clientRequestId) {
              merged.delete(key);
            }
          }
        }
        const current = merged.get(String(next.id));
        merged.set(String(next.id), { ...current, ...next });
      });
      messages = boundedMessages([...merged.values()].sort((left, right) => number(left.sequence) - number(right.sequence) || String(left.createdAt).localeCompare(String(right.createdAt))));
      lastSequence = messages.reduce((highest, message) => Math.max(highest, number(message.sequence)), lastSequence);
      return messages;
    }

    async function loadGroups() {
      const result = await api("/api/chat/groups");
      return result.groups || [];
    }

    async function loadMessages({ groupId = activeGroupId, after = 0, silent = false, tail = false } = {}) {
      if (!groupId) return [];
      const result = await api(`/api/chat/groups/${encodeURIComponent(groupId)}/messages?after=${encodeURIComponent(after)}&limit=100${tail ? "&tail=1" : ""}`);
      if (String(groupId) !== String(activeGroupId)) return [];
      mergeMessages(result.messages || []);
      if (!silent) emit("messages");
      return result.messages || [];
    }

    async function selectGroup(groupId) {
      closeRealtime();
      activeGroupId = String(groupId || "");
      messages = [];
      lastSequence = 0;
      realtimeEvents = [];
      emit("group-selected");
      await loadMessages({ after: 0, tail: true });
      await markRead();
      schedulePoll();
      void openRealtime();
      return messages;
    }

    function closeRealtime() {
      if (reconnectTimer) global.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (websocket && websocket.readyState <= 1) websocket.close(1000, "group changed");
      websocket = null;
    }

    function scheduleReconnect() {
      if (destroyed || !activeGroupId || reconnectTimer) return;
      const delay = Math.min(MAX_RECONNECT_MS, 1000 * (2 ** reconnectAttempts));
      reconnectAttempts += 1;
      reconnectTimer = global.setTimeout(() => {
        reconnectTimer = null;
        void openRealtime();
      }, delay);
    }

    async function openRealtime() {
      if (destroyed || !activeGroupId || !global.WebSocket || websocket?.readyState === 1) return;
      const selectedGroupId = activeGroupId;
      try {
        const credentials = await api(`/api/chat/groups/${encodeURIComponent(selectedGroupId)}/realtime-token`, { method: "POST" });
        if (destroyed || selectedGroupId !== activeGroupId || !credentials.configured || !credentials.realtimeUrl || !credentials.token) return;
        const url = new URL(credentials.realtimeUrl);
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/groups/${encodeURIComponent(selectedGroupId)}/connect`;
        url.searchParams.set("token", credentials.token);
        const socket = new global.WebSocket(url.toString());
        websocket = socket;
        socket.onopen = () => {
          reconnectAttempts = 0;
          emit("realtime-open");
        };
        socket.onmessage = async (message) => {
          try {
            const event = JSON.parse(message.data);
            if (event.type !== "message.created" || String(event.groupId) !== String(activeGroupId)) return;
            const before = realtimeEvents;
            realtimeEvents = mergeEvents(realtimeEvents, [event]);
            if (before.length === realtimeEvents.length && before.some((item) => item.sequence === event.sequence && item.messageId === event.messageId)) return;
            await loadMessages({ groupId: activeGroupId, after: lastSequence, silent: false });
            await markRead();
          } catch (error) {
            emit("realtime-error", { error });
          }
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
          if (websocket === socket) websocket = null;
          scheduleReconnect();
        };
      } catch (error) {
        emit("realtime-error", { error });
        scheduleReconnect();
      }
    }

    async function poll() {
      if (destroyed || !activeGroupId || requestInFlight) return;
      requestInFlight = true;
      try {
        const incoming = await loadMessages({ after: lastSequence, silent: true });
        if (incoming.length) {
          emit("messages");
          await markRead();
        }
      } catch (error) {
        emit("poll-error", { error });
      } finally {
        requestInFlight = false;
      }
    }

    function schedulePoll() {
      if (pollTimer) global.clearTimeout(pollTimer);
      if (destroyed || !activeGroupId) return;
      const delay = document.visibilityState === "hidden" ? HIDDEN_POLL_MS : VISIBLE_POLL_MS;
      pollTimer = global.setTimeout(async () => {
        await poll();
        schedulePoll();
      }, delay);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") poll();
      schedulePoll();
    }

    async function markRead() {
      if (!activeGroupId || !lastSequence || document.visibilityState === "hidden") return;
      try {
        await api(`/api/chat/groups/${encodeURIComponent(activeGroupId)}/read-cursor`, {
          method: "PUT",
          body: JSON.stringify({ sequence: lastSequence })
        });
      } catch (error) {
        emit("read-error", { error });
      }
    }

    async function send(text, retryOf = null, stickerId = "") {
      const content = String(text || "").trim();
      const resolvedStickerId = retryOf?.sticker?.id || String(stickerId || "").trim();
      if (!activeGroupId || (!content && !resolvedStickerId)) return null;
      const clientRequestId = retryOf?.clientRequestId || requestId();
      const optimistic = retryOf || {
        id: `optimistic:${clientRequestId}`,
        groupId: activeGroupId,
        clientRequestId,
        text: content,
        sticker: resolvedStickerId ? { id: resolvedStickerId, kind: "image", name: "图片表情", url: "" } : null,
        createdAt: new Date().toISOString(),
        sequence: lastSequence + 0.1,
        optimistic: true,
        failed: false,
        sender: { id: "self", name: "我" }
      };
      messages = messages.filter((message) => message.clientRequestId !== clientRequestId);
      messages.push({ ...optimistic, optimistic: true, failed: false });
      emit("messages");
      try {
        const result = await api(`/api/chat/groups/${encodeURIComponent(activeGroupId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ clientRequestId, text: content, stickerId: resolvedStickerId || undefined })
        });
        mergeMessages([result.message]);
        emit("messages");
        await markRead();
        return result.message;
      } catch (error) {
        messages = messages.map((message) => message.clientRequestId === clientRequestId
          ? { ...message, optimistic: false, failed: true, errorMessage: error.message || "发送失败" }
          : message);
        emit("messages", { error });
        throw error;
      }
    }

    function retry(message) {
      return send(message?.text, message, message?.sticker?.id || "");
    }

    function destroy() {
      destroyed = true;
      if (pollTimer) global.clearTimeout(pollTimer);
      pollTimer = null;
      closeRealtime();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return { loadGroups, selectGroup, loadMessages, send, retry, markRead, destroy, get activeGroupId() { return activeGroupId; }, get messages() { return [...messages]; } };
  };
  global.CampusChatRealtime = { mergeEvents, boundedMessages };
})(window);
