(function attachCampusChatPage(global) {
  const safe = (value, escapeHtml) => escapeHtml(String(value ?? ""));

  function avatar(name, escapeHtml) {
    return safe(String(name || "群").trim().slice(0, 1) || "群", escapeHtml);
  }

  function timeLabel(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "刚刚";
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function groupMarkup(groups, activeGroupId, escapeHtml) {
    const classes = groups.filter((group) => group.type === "class");
    const ordinary = groups.filter((group) => group.type !== "class");
    const section = (title, items, kind) => `
      <section class="chat-group-section">
        <div class="chat-group-section-title"><span>${title}</span><small>${items.length}</small></div>
        <div class="chat-group-items">
          ${items.map((group) => `
            <button type="button" class="chat-group-item ${String(group.id) === String(activeGroupId) ? "active" : ""}" data-chat-group-id="${safe(group.id, escapeHtml)}">
              <span class="chat-group-avatar ${kind}">${avatar(group.name, escapeHtml)}</span>
              <span class="chat-group-copy"><strong>${safe(group.name, escapeHtml)}</strong><small>${group.frozen ? "群聊已冻结，暂不能发言" : safe(group.description || (group.type === "class" ? "同班同学的专属交流空间" : "校园兴趣群"), escapeHtml)}</small></span>
              ${group.frozen ? '<span class="chat-group-state">冻结</span>' : ""}
            </button>
          `).join("") || '<p class="chat-empty-groups">暂无群聊</p>'}
        </div>
      </section>`;
    return `${section("班级群", classes, "class")}${section("我的群聊", ordinary, "ordinary")}`;
  }

  function messageMarkup(message, currentUserId, escapeHtml) {
    const mine = String(message.sender?.id) === String(currentUserId) || message.sender?.id === "self";
    const state = message.failed ? '<button type="button" class="chat-retry" data-chat-retry="true">重新发送</button>' : (message.optimistic ? '<span class="chat-pending">发送中</span>' : "");
    return `
      <article class="chat-message ${mine ? "mine" : "other"} ${message.failed ? "failed" : ""}" data-chat-client-id="${safe(message.clientRequestId || "", escapeHtml)}">
        ${mine ? "" : `<span class="chat-message-avatar" style="--avatar-color:${safe(message.sender?.avatarColor || "#3f6dff", escapeHtml)}">${avatar(message.sender?.name, escapeHtml)}</span>`}
        <div class="chat-message-bubble-wrap">
          ${mine ? "" : `<div class="chat-message-sender">${safe(message.sender?.name || "同学", escapeHtml)}${message.sender?.classDuty && message.sender.classDuty !== "member" ? `<small>${safe(message.sender.classDuty, escapeHtml)}</small>` : ""}</div>`}
          <div class="chat-message-bubble">${safe(message.text, escapeHtml).replace(/\n/g, "<br />")}</div>
          <div class="chat-message-meta"><time>${timeLabel(message.createdAt)}</time>${state}</div>
        </div>
      </article>`;
  }

  global.CampusChatPage = {
    async render(context) {
      const { api, user, escapeHtml, iconSvg, toast } = context;
      return {
        title: "群聊",
        subtitle: "班级群与校园兴趣群",
        content: `
          <section class="chat-page" data-mobile-pane="groups" aria-label="校园群聊">
            <aside class="chat-group-list dash-card">
              <header class="chat-list-head"><div><span class="chat-title-icon">${iconSvg("news")}</span><h2>群聊</h2></div><button type="button" class="chat-create-placeholder" title="普通群创建将在下一步开放" disabled>＋</button></header>
              <label class="chat-group-search"><span>${iconSvg("search")}</span><input id="chatGroupSearch" type="search" placeholder="搜索我的群聊" /></label>
              <div class="chat-group-scroll" id="chatGroupItems" aria-live="polite"><div class="chat-loading">正在加载群聊…</div></div>
            </aside>
            <main class="chat-message-stage dash-card">
              <header class="chat-message-head" id="chatMessageHead"><button class="chat-mobile-back" type="button" data-chat-pane="groups" aria-label="返回群聊列表">‹</button><div><span>选择一个群聊</span><small>班级沟通从这里开始</small></div></header>
              <div class="chat-message-scroll" id="chatMessages" aria-live="polite"><div class="chat-empty-stage"><span>${iconSvg("news")}</span><h2>欢迎来到校园群聊</h2><p>班级群会自动出现，选择左侧群聊即可开始交流。</p></div></div>
              <form class="chat-composer" id="chatComposer">
                <textarea id="chatMessageInput" rows="2" maxlength="4000" placeholder="选择群聊后即可发送消息" disabled></textarea>
                <div class="chat-composer-foot"><span id="chatComposerHint">支持 Enter 发送，Shift + Enter 换行</span><button data-chat-send type="submit" disabled>发送</button></div>
              </form>
            </main>
            <aside class="chat-detail-panel dash-card" id="chatDetails">
              <header><button class="chat-mobile-back" type="button" data-chat-pane="messages" aria-label="返回消息">‹</button><h2>群信息</h2></header>
              <div class="chat-detail-empty"><span>${iconSvg("user")}</span><p>选择群聊后查看群信息</p></div>
            </aside>
          </section>`,
        afterRender() {
          global.__campusChatCleanup?.();
          const page = document.querySelector(".chat-page");
          const list = document.querySelector("#chatGroupItems");
          const search = document.querySelector("#chatGroupSearch");
          const messagesNode = document.querySelector("#chatMessages");
          const messageHead = document.querySelector("#chatMessageHead");
          const detail = document.querySelector("#chatDetails");
          const composer = document.querySelector("#chatComposer");
          const input = document.querySelector("#chatMessageInput");
          const sendButton = composer.querySelector("[data-chat-send]");
          let groups = [];
          let activeGroup = null;
          let keepBottom = true;

          const client = global.createChatClient({
            api,
            onEvent(event) {
              if (event.type === "messages" || event.type === "group-selected") renderMessages(event.messages || client.messages);
            }
          });

          function renderGroups() {
            const query = search.value.trim().toLocaleLowerCase();
            const visible = !query ? groups : groups.filter((group) => `${group.name} ${group.description || ""}`.toLocaleLowerCase().includes(query));
            list.innerHTML = groupMarkup(visible, activeGroup?.id, escapeHtml);
          }

          function renderDetails() {
            if (!activeGroup) {
              detail.innerHTML = `<header><button class="chat-mobile-back" type="button" data-chat-pane="messages" aria-label="返回消息">‹</button><h2>群信息</h2></header><div class="chat-detail-empty"><span>${iconSvg("user")}</span><p>选择群聊后查看群信息</p></div>`;
              return;
            }
            detail.innerHTML = `
              <header><button class="chat-mobile-back" type="button" data-chat-pane="messages" aria-label="返回消息">‹</button><h2>群信息</h2></header>
              <div class="chat-detail-content">
                <span class="chat-detail-avatar ${activeGroup.type === "class" ? "class" : "ordinary"}">${avatar(activeGroup.name, escapeHtml)}</span>
                <h3>${safe(activeGroup.name, escapeHtml)}</h3>
                <p>${safe(activeGroup.description || (activeGroup.type === "class" ? "学校、学院与班级成员自动加入。" : "自主创建的校园兴趣群。"), escapeHtml)}</p>
                <dl><div><dt>群类型</dt><dd>${activeGroup.type === "class" ? "班级群" : "普通群"}</dd></div>${activeGroup.publicNo ? `<div><dt>群号</dt><dd>${safe(activeGroup.publicNo, escapeHtml)}</dd></div>` : ""}<div><dt>群状态</dt><dd>${activeGroup.frozen ? "已冻结" : "正常"}</dd></div></dl>
                ${activeGroup.frozen ? '<div class="chat-frozen-note">该群暂时冻结，消息保留但不能发送。</div>' : '<button type="button" class="chat-detail-action" data-chat-pane="details">查看群成员与设置</button>'}
              </div>`;
          }

          function renderMessages(messages) {
            if (!activeGroup) return;
            const wasNearBottom = messagesNode.scrollHeight - messagesNode.scrollTop - messagesNode.clientHeight < 72;
            messagesNode.innerHTML = messages.length
              ? messages.map((message) => messageMarkup(message, user?.id, escapeHtml)).join("")
              : `<div class="chat-empty-stage"><span>${iconSvg("news")}</span><h2>还没有消息</h2><p>和同学打个招呼，开始第一段对话吧。</p></div>`;
            if (keepBottom || wasNearBottom) messagesNode.scrollTop = messagesNode.scrollHeight;
            keepBottom = false;
          }

          async function selectGroup(groupId) {
            const selected = groups.find((group) => String(group.id) === String(groupId));
            if (!selected) return;
            activeGroup = selected;
            page.dataset.mobilePane = "messages";
            keepBottom = true;
            renderGroups();
            renderDetails();
            messageHead.innerHTML = `<button class="chat-mobile-back" type="button" data-chat-pane="groups" aria-label="返回群聊列表">‹</button><div><strong>${safe(selected.name, escapeHtml)}</strong><small>${selected.frozen ? "群聊已冻结" : selected.type === "class" ? "班级成员自动同步" : "校园兴趣群"}</small></div><button type="button" class="chat-head-detail" data-chat-pane="details" aria-label="查看群信息">${iconSvg("user")}</button>`;
            input.disabled = Boolean(selected.frozen);
            sendButton.disabled = Boolean(selected.frozen);
            input.placeholder = selected.frozen ? "该群已冻结，不能发送消息" : "输入消息，Enter 发送";
            try {
              await client.selectGroup(selected.id);
            } catch (error) {
              toast(error.message || "群消息加载失败");
              messagesNode.innerHTML = `<div class="chat-empty-stage error"><h2>消息加载失败</h2><p>${safe(error.message || "请稍后重试", escapeHtml)}</p></div>`;
            }
          }

          list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-chat-group-id]");
            if (button) selectGroup(button.dataset.chatGroupId);
          });
          search.addEventListener("input", renderGroups);
          page.addEventListener("click", (event) => {
            const pane = event.target.closest("[data-chat-pane]")?.dataset.chatPane;
            if (pane) page.dataset.mobilePane = pane;
            const retry = event.target.closest("[data-chat-retry]");
            if (!retry) return;
            const row = retry.closest("[data-chat-client-id]");
            const pending = client.messages.find((message) => message.clientRequestId === row?.dataset.chatClientId);
            if (pending) client.retry(pending).catch((error) => toast(error.message || "重新发送失败"));
          });
          messagesNode.addEventListener("scroll", () => { keepBottom = messagesNode.scrollTop + messagesNode.clientHeight >= messagesNode.scrollHeight - 72; });
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              composer.requestSubmit();
            }
          });
          composer.addEventListener("submit", (event) => {
            event.preventDefault();
            const text = input.value.trim();
            if (!text || !activeGroup) return;
            input.value = "";
            keepBottom = true;
            client.send(text).catch((error) => toast(error.message || "消息发送失败，可点击重新发送"));
          });

          (async () => {
            try {
              groups = await client.loadGroups();
              renderGroups();
              if (groups[0]) await selectGroup(groups[0].id);
            } catch (error) {
              list.innerHTML = `<div class="chat-loading error">${safe(error.message || "群聊加载失败", escapeHtml)}</div>`;
            }
          })();

          global.__campusChatCleanup = () => client.destroy();
        }
      };
    }
  };
})(window);
