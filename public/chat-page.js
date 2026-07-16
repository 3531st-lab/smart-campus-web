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
          <div class="chat-message-bubble">${message.sticker?.kind === "image" && message.sticker.url ? `<img class="chat-message-sticker" src="${safe(message.sticker.url, escapeHtml)}" alt="${safe(message.sticker.name || "图片表情", escapeHtml)}" loading="lazy" />` : (message.sticker?.kind === "image" ? '<span class="chat-sticker-pending">图片表情发送中</span>' : "")}${safe(message.text, escapeHtml).replace(/\n/g, "<br />")}</div>
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
              <header class="chat-list-head"><div><span class="chat-title-icon">${iconSvg("news")}</span><h2>群聊</h2></div><div class="chat-list-actions"><button type="button" class="chat-create-placeholder" data-chat-join title="通过群号申请加入">${iconSvg("search")}</button><button type="button" class="chat-create-placeholder" data-chat-create title="创建普通群">＋</button></div></header>
              <label class="chat-group-search"><span>${iconSvg("search")}</span><input id="chatGroupSearch" type="search" placeholder="搜索我的群聊" /></label>
              <div class="chat-group-scroll" id="chatGroupItems" aria-live="polite"><div class="chat-loading">正在加载群聊…</div></div>
            </aside>
            <main class="chat-message-stage dash-card">
              <header class="chat-message-head" id="chatMessageHead"><button class="chat-mobile-back" type="button" data-chat-pane="groups" aria-label="返回群聊列表">‹</button><div><span>选择一个群聊</span><small>班级沟通从这里开始</small></div></header>
              <div class="chat-message-scroll" id="chatMessages" aria-live="polite"><div class="chat-empty-stage"><span>${iconSvg("news")}</span><h2>欢迎来到校园群聊</h2><p>班级群会自动出现，选择左侧群聊即可开始交流。</p></div></div>
              <form class="chat-composer" id="chatComposer">
                <textarea id="chatMessageInput" rows="2" maxlength="4000" placeholder="选择群聊后即可发送消息" disabled></textarea>
                <div class="chat-sticker-panel" id="chatStickerPanel" hidden></div>
                <input id="chatStickerUpload" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden />
                <div class="chat-composer-foot"><div class="chat-composer-tools"><button type="button" data-chat-sticker-toggle title="表情">☺</button><button type="button" data-chat-sticker-upload title="上传图片表情">＋</button><span id="chatComposerHint">支持 Enter 发送，Shift + Enter 换行</span></div><button data-chat-send type="submit" disabled>发送</button></div>
              </form>
            </main>
            <aside class="chat-detail-panel dash-card" id="chatDetails">
              <header><button class="chat-mobile-back" type="button" data-chat-pane="messages" aria-label="返回消息">‹</button><h2>群信息</h2></header>
              <div class="chat-detail-empty"><span>${iconSvg("user")}</span><p>选择群聊后查看群信息</p></div>
            </aside>
            <div class="chat-modal-root" id="chatModalRoot" hidden></div>
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
          const stickerPanel = document.querySelector("#chatStickerPanel");
          const stickerUpload = document.querySelector("#chatStickerUpload");
          const createButton = page.querySelector("[data-chat-create]");
          const joinButton = page.querySelector("[data-chat-join]");
          const modalRoot = document.querySelector("#chatModalRoot");
          let groups = [];
          let activeGroup = null;
          let keepBottom = true;
          let selectedSticker = null;
          let stickerData = null;

          const client = global.createChatClient({
            api,
            onEvent(event) {
              if (event.type === "messages" || event.type === "group-selected") renderMessages(event.messages || client.messages);
            }
          });

          function closeModal() {
            modalRoot.hidden = true;
            modalRoot.innerHTML = "";
          }

          function openModal(content, label) {
            modalRoot.innerHTML = `<div class="chat-modal-backdrop" data-chat-modal-close></div><section class="chat-modal" role="dialog" aria-modal="true" aria-label="${safe(label, escapeHtml)}">${content}</section>`;
            modalRoot.hidden = false;
            modalRoot.querySelector("input, textarea, button")?.focus();
          }

          async function refreshGroups(preferredId = activeGroup?.id) {
            groups = await client.loadGroups();
            renderGroups();
            if (preferredId && groups.some((group) => String(group.id) === String(preferredId))) {
              await selectGroup(preferredId);
            }
          }

          function openCreateGroup() {
            openModal(`
              <header class="chat-modal-head"><div><h2>创建普通群</h2><p>创建后生成群号；群成员通过申请加入。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
              <form class="chat-modal-form" id="chatCreateGroupForm">
                <label>群名称<input name="name" maxlength="40" required placeholder="例如：校园摄影交流" /></label>
                <label>群简介<textarea name="description" maxlength="180" rows="3" placeholder="可填写群聊主题和规则"></textarea></label>
                <div class="chat-modal-actions"><button type="button" data-chat-modal-close>取消</button><button class="primary" type="submit">创建群聊</button></div>
              </form>`, "创建普通群");
            modalRoot.querySelector("#chatCreateGroupForm").addEventListener("submit", async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const submit = event.currentTarget.querySelector("[type=submit]");
              submit.disabled = true;
              try {
                const result = await api("/api/chat/groups", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) });
                closeModal();
                await refreshGroups(result.group.id);
                toast(`已创建“${result.group.name}”，群号 ${result.group.publicNo}`);
              } catch (error) {
                toast(error.message || "创建群聊失败");
                submit.disabled = false;
              }
            });
          }

          function openJoinGroup() {
            openModal(`
              <header class="chat-modal-head"><div><h2>通过群号加入</h2><p>提交申请后，需要群主或群管理员审核。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
              <form class="chat-modal-form" id="chatJoinGroupForm">
                <label>群号<input name="groupNo" inputmode="numeric" pattern="[0-9]{10,}" maxlength="20" required placeholder="输入 10 位以上群号" /></label>
                <div class="chat-search-result" id="chatGroupSearchResult" aria-live="polite"></div>
                <div class="chat-modal-actions"><button type="button" data-chat-modal-close>取消</button><button class="primary" type="submit">查找群聊</button></div>
              </form>`, "通过群号加入");
            const form = modalRoot.querySelector("#chatJoinGroupForm");
            const resultNode = modalRoot.querySelector("#chatGroupSearchResult");
            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              const groupNo = new FormData(form).get("groupNo");
              const submit = form.querySelector("[type=submit]");
              submit.disabled = true;
              try {
                const result = await api(`/api/chat/search?groupNo=${encodeURIComponent(groupNo)}`);
                resultNode.innerHTML = `<div><strong>${safe(result.group.name, escapeHtml)}</strong><small>${result.group.memberCount} 位成员</small></div><button type="button" class="primary" data-chat-apply-group="${safe(result.group.id, escapeHtml)}" data-chat-group-no="${safe(groupNo, escapeHtml)}">提交申请</button>`;
              } catch (error) {
                resultNode.innerHTML = `<p class="chat-inline-error">${safe(error.message || "未找到群聊", escapeHtml)}</p>`;
              } finally {
                submit.disabled = false;
              }
            });
          }

          async function openQrInvite() {
            if (!activeGroup) return;
            try {
              const result = await api(`/api/chat/groups/${encodeURIComponent(activeGroup.id)}/invite-token`, { method: "POST", body: JSON.stringify({ maxUses: 1 }) });
              const qrSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.qrSvg)}`;
              openModal(`
                <header class="chat-modal-head"><div><h2>群二维码</h2><p>扫码后提交申请，二维码仅可使用一次。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
                <div class="chat-qr-content"><img src="${qrSrc}" alt="${safe(activeGroup.name, escapeHtml)} 群二维码" /><p>每次生成新二维码会自动作废上一张。</p><label>邀请链接<input id="chatInviteUrl" value="${safe(result.inviteUrl, escapeHtml)}" readonly /></label></div>
                <div class="chat-modal-actions"><button type="button" data-chat-modal-close>完成</button><button type="button" class="primary" data-chat-copy-invite>复制链接</button></div>`, "群二维码");
            } catch (error) {
              toast(error.message || "二维码生成失败");
            }
          }

          async function openMembers() {
            if (!activeGroup) return;
            try {
              const result = await api(`/api/chat/groups/${encodeURIComponent(activeGroup.id)}/members`);
              const members = Array.isArray(result.members) ? result.members : [];
              const roleLabel = { owner: "群主", admin: "群管理员", member: "成员" };
              const dutyLabel = { monitor: "班长", league_secretary: "团支书", class_admin: "班级管理员", head_teacher: "班主任" };
              openModal(`
                <header class="chat-modal-head"><div><h2>群成员</h2><p>共 ${members.length} 位成员，仅展示群聊所需的公开身份。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
                <div class="chat-member-list">${members.map((member) => `
                  <div class="chat-member-row">
                    <span class="chat-member-avatar" style="--member-color:${safe(member.avatarColor || "#3478f6", escapeHtml)}">${avatar(member.name, escapeHtml)}</span>
                    <div><strong>${safe(member.name || "校园用户", escapeHtml)}</strong><small>${safe(dutyLabel[member.classDuty] || roleLabel[member.role] || "成员", escapeHtml)}</small></div>
                  </div>`).join("") || '<p class="chat-modal-empty">暂无群成员</p>'}</div>
                <div class="chat-modal-actions"><button type="button" class="primary" data-chat-modal-close>完成</button></div>`, "群成员");
            } catch (error) {
              toast(error.message || "群成员加载失败");
            }
          }

          async function openReviewRequests() {
            if (!activeGroup) return;
            try {
              const result = await api(`/api/chat/groups/${encodeURIComponent(activeGroup.id)}/join-requests`);
              const requests = Array.isArray(result.requests) ? result.requests : [];
              openModal(`
                <header class="chat-modal-head"><div><h2>入群审核</h2><p>核对申请人后再决定是否加入群聊。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
                <div class="chat-review-list">${requests.map((request) => `
                  <div class="chat-review-row" data-chat-review-row="${safe(request.id, escapeHtml)}">
                    <span class="chat-member-avatar" style="--member-color:${safe(request.applicant?.avatarColor || "#3478f6", escapeHtml)}">${avatar(request.applicant?.name, escapeHtml)}</span>
                    <div class="chat-review-copy"><strong>${safe(request.applicant?.name || "校园用户", escapeHtml)}</strong><small>${request.source === "qr" ? "通过二维码申请" : "通过群号申请"}</small></div>
                    <div class="chat-review-actions"><button type="button" data-chat-review-id="${safe(request.id, escapeHtml)}" data-chat-review-decision="rejected">拒绝</button><button type="button" class="primary" data-chat-review-id="${safe(request.id, escapeHtml)}" data-chat-review-decision="approved">同意</button></div>
                  </div>`).join("") || '<p class="chat-modal-empty">暂无待审核申请</p>'}</div>
                <div class="chat-modal-actions"><button type="button" data-chat-modal-close>关闭</button></div>`, "入群审核");
            } catch (error) {
              toast(error.message || "入群申请加载失败");
            }
          }

          function openAppeal() {
            if (!activeGroup) return;
            openModal(`
              <header class="chat-modal-head"><div><h2>提交解冻申诉</h2><p>请说明群聊用途与后续管理措施，管理员审核后会恢复或维持冻结状态。</p></div><button type="button" data-chat-modal-close aria-label="关闭">×</button></header>
              <form class="chat-modal-form" id="chatAppealForm">
                <label>申诉原因<textarea name="reason" maxlength="500" rows="4" required placeholder="例如：用于班级学习资料沟通，已明确群规并安排群管理员。"></textarea></label>
                <div class="chat-modal-actions"><button type="button" data-chat-modal-close>取消</button><button class="primary" type="submit">提交申诉</button></div>
              </form>`, "提交解冻申诉");
            modalRoot.querySelector("#chatAppealForm").addEventListener("submit", async (event) => {
              event.preventDefault();
              const submit = event.currentTarget.querySelector("[type=submit]");
              submit.disabled = true;
              try {
                await api(`/api/chat/groups/${encodeURIComponent(activeGroup.id)}/appeals`, {
                  method: "POST",
                  body: JSON.stringify({ reason: new FormData(event.currentTarget).get("reason") })
                });
                closeModal();
                toast("申诉已提交，等待平台管理员审核");
              } catch (error) {
                submit.disabled = false;
                toast(error.message || "申诉提交失败");
              }
            });
          }

          async function applyInviteFromUrl() {
            const pageUrl = new URL(global.location.href);
            const token = pageUrl.searchParams.get("chatInvite");
            if (!token) return;
            try {
              await api("/api/chat/join-requests", { method: "POST", body: JSON.stringify({ source: "qr", token }) });
              pageUrl.searchParams.delete("chatInvite");
              global.history.replaceState(null, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
              toast("入群申请已提交，等待群管理员审核");
            } catch (error) {
              toast(error.message || "二维码入群申请失败");
            }
          }

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
                ${activeGroup.frozen ? `<div class="chat-frozen-note">该群暂时冻结，消息保留但不能发送。</div>${activeGroup.type === "custom" && String(activeGroup.ownerId) === String(user?.id) ? '<button type="button" class="chat-detail-action" data-chat-appeal>提交解冻申诉</button>' : ""}` : `<div class="chat-detail-actions"><button type="button" class="chat-detail-action" data-chat-members>查看群成员</button>${activeGroup.type === "custom" && String(activeGroup.ownerId) === String(user?.id) ? '<button type="button" class="chat-detail-action" data-chat-review>入群审核</button><button type="button" class="chat-detail-action" data-chat-qr>生成入群二维码</button>' : ""}</div>`}
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

          async function loadStickers() {
            if (stickerData) return stickerData;
            stickerData = await api("/api/chat/stickers");
            return stickerData;
          }

          function renderStickers() {
            const unicode = (stickerData?.unicode || []).map((item) => `<button type="button" class="chat-sticker-button unicode" data-chat-unicode="${safe(item.emoji, escapeHtml)}" title="${safe(item.name, escapeHtml)}">${safe(item.emoji, escapeHtml)}</button>`).join("");
            const images = (stickerData?.stickers || []).map((item) => `<button type="button" class="chat-sticker-button image ${String(selectedSticker?.id) === String(item.id) ? "selected" : ""}" data-chat-sticker-id="${safe(item.id, escapeHtml)}" title="${safe(item.name, escapeHtml)}"><img src="${safe(item.url, escapeHtml)}" alt="${safe(item.name, escapeHtml)}" loading="lazy" /></button>`).join("");
            stickerPanel.innerHTML = `<div class="chat-sticker-panel-head"><strong>基础表情</strong><button type="button" data-chat-sticker-close>关闭</button></div><div class="chat-sticker-grid">${unicode || '<span>暂无基础表情</span>'}</div><div class="chat-sticker-panel-head"><strong>我的图片表情</strong><button type="button" data-chat-sticker-upload>上传</button></div><div class="chat-sticker-grid images">${images || '<span class="chat-sticker-empty">上传的图片表情仅你自己可见</span>'}</div>`;
          }

          async function toggleStickerPanel() {
            if (stickerPanel.hidden) {
              try {
                await loadStickers();
                renderStickers();
                stickerPanel.hidden = false;
              } catch (error) { toast(error.message || "表情加载失败"); }
            } else stickerPanel.hidden = true;
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
          createButton.addEventListener("click", openCreateGroup);
          joinButton.addEventListener("click", openJoinGroup);
          search.addEventListener("input", renderGroups);
          page.addEventListener("click", (event) => {
            if (event.target.closest("[data-chat-modal-close]")) {
              closeModal();
              return;
            }
            const applyGroup = event.target.closest("[data-chat-apply-group]");
            if (applyGroup) {
              api("/api/chat/join-requests", {
                method: "POST",
                body: JSON.stringify({ groupId: applyGroup.dataset.chatApplyGroup, groupNumber: applyGroup.dataset.chatGroupNo, source: "group_number" })
              }).then(() => {
                closeModal();
                toast("入群申请已提交，等待群管理员审核");
              }).catch((error) => toast(error.message || "提交申请失败"));
              return;
            }
            if (event.target.closest("[data-chat-qr]")) {
              openQrInvite();
              return;
            }
            if (event.target.closest("[data-chat-members]")) {
              openMembers();
              return;
            }
            if (event.target.closest("[data-chat-review]")) {
              openReviewRequests();
              return;
            }
            if (event.target.closest("[data-chat-appeal]")) {
              openAppeal();
              return;
            }
            const reviewButton = event.target.closest("[data-chat-review-id]");
            if (reviewButton) {
              reviewButton.disabled = true;
              api(`/api/chat/join-requests/${encodeURIComponent(reviewButton.dataset.chatReviewId)}`, {
                method: "PUT",
                body: JSON.stringify({ decision: reviewButton.dataset.chatReviewDecision })
              }).then(async () => {
                toast(reviewButton.dataset.chatReviewDecision === "approved" ? "已同意入群申请" : "已拒绝入群申请");
                await openReviewRequests();
              }).catch((error) => {
                reviewButton.disabled = false;
                toast(error.message || "审核操作失败");
              });
              return;
            }
            if (event.target.closest("[data-chat-copy-invite]")) {
              const value = modalRoot.querySelector("#chatInviteUrl")?.value || "";
              navigator.clipboard?.writeText(value).then(() => toast("邀请链接已复制")).catch(() => toast("复制失败，请手动复制链接"));
              return;
            }
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
          composer.addEventListener("click", async (event) => {
            const toggle = event.target.closest("[data-chat-sticker-toggle]");
            if (toggle) { event.preventDefault(); await toggleStickerPanel(); return; }
            const upload = event.target.closest("[data-chat-sticker-upload]");
            if (upload) { event.preventDefault(); stickerUpload.click(); return; }
            if (event.target.closest("[data-chat-sticker-close]")) { stickerPanel.hidden = true; return; }
            const unicode = event.target.closest("[data-chat-unicode]");
            if (unicode) { input.value += unicode.dataset.chatUnicode || ""; input.focus(); return; }
            const image = event.target.closest("[data-chat-sticker-id]");
            if (image) {
              selectedSticker = (stickerData?.stickers || []).find((item) => String(item.id) === String(image.dataset.chatStickerId)) || null;
              renderStickers();
              input.focus();
            }
          });
          stickerUpload.addEventListener("change", async () => {
            const file = stickerUpload.files?.[0];
            stickerUpload.value = "";
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) { toast("图片不能超过 4MB"); return; }
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const result = await api("/api/chat/stickers", { method: "POST", body: JSON.stringify({ dataUrl: reader.result, name: file.name.replace(/\.[^.]+$/, "") || "我的表情" }) });
                stickerData = null;
                await loadStickers();
                selectedSticker = result.sticker;
                renderStickers();
                toast("图片表情已保存，仅你自己可见");
              } catch (error) { toast(error.message || "图片表情上传失败"); }
            };
            reader.readAsDataURL(file);
          });
          composer.addEventListener("submit", (event) => {
            event.preventDefault();
            const text = input.value.trim();
            if ((!text && !selectedSticker) || !activeGroup) return;
            input.value = "";
            keepBottom = true;
            const sticker = selectedSticker;
            selectedSticker = null;
            stickerPanel.hidden = true;
            client.send(text, null, sticker?.id || "").catch((error) => toast(error.message || "消息发送失败，可点击重新发送"));
          });

          (async () => {
            try {
              await applyInviteFromUrl();
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
    },

    async renderAdmin(context) {
      const { api, escapeHtml, toast } = context;
      return {
        title: "群聊管理",
        subtitle: "平台管理员审核群聊状态与解冻申诉",
        content: `
          <section class="chat-admin-page" id="chatAdminPage">
            <section class="dash-card chat-admin-hero"><div><span>群聊治理</span><h2>群聊管理中心</h2><p>冻结群聊仍保留历史消息；关闭后不可恢复。所有操作都会记入治理审计。</p></div><button type="button" class="chat-admin-refresh" data-chat-admin-refresh>刷新</button></section>
            <section class="chat-admin-layout">
              <div class="dash-card chat-admin-card"><header><h2>群聊状态</h2><span id="chatAdminGroupCount">--</span></header><div id="chatAdminGroups" class="chat-admin-list"><p>正在加载群聊…</p></div></div>
              <div class="dash-card chat-admin-card"><header><h2>解冻申诉</h2><span id="chatAdminAppealCount">--</span></header><div id="chatAdminAppeals" class="chat-admin-list"><p>正在加载申诉…</p></div></div>
            </section>
            <section class="dash-card chat-admin-card"><header><h2>治理审计</h2><span>最近 100 条</span></header><div id="chatAdminLogs" class="chat-admin-log"><p>正在加载审计记录…</p></div></section>
          </section>`,
        afterRender() {
          const page = document.querySelector("#chatAdminPage");
          const groupsNode = page.querySelector("#chatAdminGroups");
          const appealsNode = page.querySelector("#chatAdminAppeals");
          const logsNode = page.querySelector("#chatAdminLogs");
          const groupCount = page.querySelector("#chatAdminGroupCount");
          const appealCount = page.querySelector("#chatAdminAppealCount");
          const formatStatus = { active: "正常", frozen: "冻结", closed: "已关闭", submitted: "待处理", reviewing: "审核中", approved: "已通过", rejected: "已驳回" };
          const renderGroups = (groups) => {
            groupCount.textContent = `${groups.length} 个`;
            groupsNode.innerHTML = groups.map((group) => {
              const actions = group.status === "active"
                ? '<button data-chat-admin-status="frozen">冻结</button>'
                : group.status === "frozen"
                  ? '<button data-chat-admin-status="active">恢复</button><button class="danger" data-chat-admin-status="closed">关闭</button>'
                  : '<span class="chat-admin-closed">不可恢复</span>';
              return `<article class="chat-admin-row" data-chat-admin-group="${safe(group.id, escapeHtml)}"><div><strong>${safe(group.name, escapeHtml)}</strong><small>${group.type === "class" ? "班级群" : `群号 ${safe(group.publicNo || "--", escapeHtml)}`} · ${formatStatus[group.status] || group.status}</small></div><div class="chat-admin-actions">${actions}</div></article>`;
            }).join("") || '<p class="chat-admin-empty">暂无可治理群聊。</p>';
          };
          const renderAppeals = (appeals) => {
            appealCount.textContent = `${appeals.length} 条`;
            appealsNode.innerHTML = appeals.map((appeal) => `<article class="chat-admin-row" data-chat-admin-appeal="${safe(appeal.id, escapeHtml)}"><div><strong>${safe(appeal.reason, escapeHtml)}</strong><small>${formatStatus[appeal.status] || appeal.status} · 群聊 ${safe(appeal.groupId, escapeHtml)}</small></div><div class="chat-admin-actions">${appeal.status === "submitted" ? '<button data-chat-admin-appeal-status="reviewing">受理</button>' : ""}${appeal.status === "reviewing" ? '<button data-chat-admin-appeal-status="approved">恢复群聊</button><button class="danger" data-chat-admin-appeal-status="rejected">驳回</button>' : ""}</div></article>`).join("") || '<p class="chat-admin-empty">暂无待处理申诉。</p>';
          };
          const renderLogs = (logs) => {
            logsNode.innerHTML = logs.map((log) => `<div><strong>${safe(log.action, escapeHtml)}</strong><span>${safe(log.targetType, escapeHtml)} · ${safe(log.targetId, escapeHtml)} · ${safe(log.createdAt || "", escapeHtml)}</span></div>`).join("") || '<p class="chat-admin-empty">暂无治理记录。</p>';
          };
          const load = async () => {
            try {
              const [payload, audit] = await Promise.all([api("/api/admin/chat/groups"), api("/api/admin/chat/audit-logs?limit=100")]);
              renderGroups(Array.isArray(payload.groups) ? payload.groups : []);
              renderAppeals(Array.isArray(payload.appeals) ? payload.appeals : []);
              renderLogs(Array.isArray(audit.logs) ? audit.logs : []);
            } catch (error) {
              const message = safe(error.message || "群聊治理数据加载失败", escapeHtml);
              groupsNode.innerHTML = `<p class="chat-admin-empty">${message}</p>`;
              appealsNode.innerHTML = `<p class="chat-admin-empty">${message}</p>`;
            }
          };
          page.addEventListener("click", async (event) => {
            if (event.target.closest("[data-chat-admin-refresh]")) return load();
            const groupButton = event.target.closest("[data-chat-admin-status]");
            if (groupButton) {
              const row = groupButton.closest("[data-chat-admin-group]");
              groupButton.disabled = true;
              try {
                await api(`/api/admin/chat/groups/${encodeURIComponent(row.dataset.chatAdminGroup)}/status`, { method: "PUT", body: JSON.stringify({ status: groupButton.dataset.chatAdminStatus }) });
                toast("群聊状态已更新");
                await load();
              } catch (error) { groupButton.disabled = false; toast(error.message || "更新失败"); }
              return;
            }
            const appealButton = event.target.closest("[data-chat-admin-appeal-status]");
            if (appealButton) {
              const row = appealButton.closest("[data-chat-admin-appeal]");
              appealButton.disabled = true;
              try {
                await api(`/api/admin/chat/appeals/${encodeURIComponent(row.dataset.chatAdminAppeal)}`, { method: "PUT", body: JSON.stringify({ status: appealButton.dataset.chatAdminAppealStatus }) });
                toast("申诉状态已更新");
                await load();
              } catch (error) { appealButton.disabled = false; toast(error.message || "处理失败"); }
            }
          });
          load();
        }
      };
    }
  };
})(window);
