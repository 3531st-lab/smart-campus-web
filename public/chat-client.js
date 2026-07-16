(function attachCampusChatClient(global) {
  const VISIBLE_POLL_MS = 5000;
  const HIDDEN_POLL_MS = 30000;

  function requestId() {
    if (global.crypto?.randomUUID) return `chat:${global.crypto.randomUUID()}`;
    return `chat:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  global.createChatClient = function createChatClient({ api, onEvent = () => {} }) {
    let activeGroupId = "";
    let messages = [];
    let lastSequence = 0;
    let pollTimer = null;
    let destroyed = false;
    let requestInFlight = false;

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
      messages = [...merged.values()].sort((left, right) => number(left.sequence) - number(right.sequence) || String(left.createdAt).localeCompare(String(right.createdAt)));
      lastSequence = messages.reduce((highest, message) => Math.max(highest, number(message.sequence)), lastSequence);
      return messages;
    }

    async function loadGroups() {
      const result = await api("/api/chat/groups");
      return result.groups || [];
    }

    async function loadMessages({ groupId = activeGroupId, after = 0, silent = false } = {}) {
      if (!groupId) return [];
      const result = await api(`/api/chat/groups/${encodeURIComponent(groupId)}/messages?after=${encodeURIComponent(after)}&limit=100`);
      if (String(groupId) !== String(activeGroupId)) return [];
      mergeMessages(result.messages || []);
      if (!silent) emit("messages");
      return result.messages || [];
    }

    async function selectGroup(groupId) {
      activeGroupId = String(groupId || "");
      messages = [];
      lastSequence = 0;
      emit("group-selected");
      await loadMessages({ after: 0 });
      await markRead();
      schedulePoll();
      return messages;
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
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return { loadGroups, selectGroup, loadMessages, send, retry, markRead, destroy, get activeGroupId() { return activeGroupId; }, get messages() { return [...messages]; } };
  };
})(window);
