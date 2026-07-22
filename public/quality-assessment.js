(function attachQualityAssessmentPage(global) {
  const MODULES = Object.freeze([
    { id: "moral", label: "德育", max: 28, accent: "moral" },
    { id: "intellectual", label: "智育", max: 48, accent: "intellectual" },
    { id: "physical", label: "体育", max: 8, accent: "physical" },
    { id: "aesthetic", label: "美育", max: 8, accent: "aesthetic" },
    { id: "labor", label: "劳育", max: 8, accent: "labor" }
  ]);
  const EDITABLE_STATUSES = new Set(["draft", "returned"]);
  const WORKFLOW_LABELS = Object.freeze({
    draft: "草稿",
    returned: "退回修改",
    class_review: "班级初审中",
    college_review: "学院复核中",
    pending_publication: "待公示",
    published: "公示中",
    archived: "已归档"
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]));
  }

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isClassReviewer(user) {
    return ["monitor", "league_secretary", "class_admin"].includes(String(user?.classDuty || user?.class_duty || ""));
  }

  function isCollegeReviewer(user) {
    return ["admin", "super_admin"].includes(String(user?.role || "")) || user?.qualityRole === "college_reviewer";
  }

  function render({ user } = {}) {
    const classReview = isClassReviewer(user);
    const collegeReview = isCollegeReviewer(user);
    return `
      <section class="quality-assessment-page" aria-label="综测核算工作台">
        <header class="quality-page-heading">
          <div><span class="quality-eyebrow">2025 新版细则</span><h2>综测核算</h2><p>德智体美劳分项记录、分级审核、公示与申诉都在同一份服务端档案内完成。</p></div>
          <button class="ghost-btn" type="button" data-quality-action="back">返回学习工具中心</button>
        </header>
        <nav class="quality-workspace-tabs" aria-label="综测功能分区">
          <button type="button" class="active" data-quality-workspace="application">个人填报</button>
          ${classReview ? '<button type="button" data-quality-workspace="class">班级初审</button>' : ""}
          ${collegeReview ? '<button type="button" data-quality-workspace="college">学院复核</button>' : ""}
          <button type="button" data-quality-workspace="publication">公示与申诉</button>
        </nav>
        <div id="qualityAssessmentRoot" class="quality-assessment-root" aria-live="polite"><div class="quality-loading">正在读取综测档案...</div></div>
      </section>
    `;
  }

  function moduleCards(record, activeModule) {
    const scores = record?.moduleScores || record?.module_scores || {};
    return `<div class="quality-module-grid">${MODULES.map((module) => `
      <button type="button" class="quality-module-card ${module.accent} ${activeModule === module.id ? "active" : ""}" data-quality-module="${module.id}">
        <span>${module.label}</span><strong>${number(scores[module.id]).toFixed(1)}</strong><em>/ ${module.max} 分</em>
      </button>
    `).join("")}</div>`;
  }

  function itemRows(items, activeModule, editable) {
    const moduleItems = (items || []).filter((item) => String(item.module) === activeModule);
    if (!moduleItems.length) return '<div class="quality-empty">本模块暂未录入项目。</div>';
    return moduleItems.map((item) => `
      <article class="quality-item" data-quality-item-id="${escapeHtml(item.id || "")}">
        <div><strong>${escapeHtml(item.ruleCode || "自定义项目")}</strong><span>${item.type === "base" ? "基础分" : item.type === "bonus" ? "加分" : "扣分"}</span></div>
        <label>申报分<input data-quality-score value="${number(item.claimedScore ?? item.claimed_score)}" type="number" step="0.1" ${editable ? "" : "disabled"} /></label>
        ${editable ? '<button type="button" class="icon-btn" aria-label="删除项目" data-quality-delete-item>×</button>' : ""}
      </article>
    `).join("");
  }

  function renderApplication(state) {
    const { record, activeModule, periods, evidence, saveState } = state;
    if (!record) return '<div class="quality-empty">当前没有可填报的综测周期。</div>';
    const editable = EDITABLE_STATUSES.has(record.status);
    const active = MODULES.find((module) => module.id === activeModule) || MODULES[0];
    const items = record.items || [];
    return `
      <section class="quality-record-shell">
        <div class="quality-record-toolbar">
          <label>评定周期<select data-quality-period>${(periods || []).map((period) => `<option value="${escapeHtml(period.id)}" ${period.id === state.periodId ? "selected" : ""}>${escapeHtml(period.name)}</option>`).join("")}</select></label>
          <div class="quality-status"><span>当前状态</span><strong>${WORKFLOW_LABELS[record.status] || escapeHtml(record.status)}</strong></div>
          <div class="quality-total"><span>综合得分</span><strong>${number(record.totalScore ?? record.total_score).toFixed(1)}</strong><em>/ 100</em></div>
        </div>
        ${moduleCards(record, active.id)}
        ${(record.riskFlags || record.risk_flags || []).length ? `<div class="quality-warning">${(record.riskFlags || record.risk_flags).map(escapeHtml).join("；")}</div>` : ""}
        <div class="quality-entry-grid">
          <section class="quality-entry-card">
            <div class="quality-section-heading"><div><span>${active.label}模块</span><h3>分项填报</h3></div><span>上限 ${active.max} 分</span></div>
            <div class="quality-item-list" id="qualityItemList">${itemRows(items, active.id, editable)}</div>
            ${editable ? `
              <form id="qualityAddItemForm" class="quality-add-item-form">
                <label>类型<select name="type"><option value="base">基础分</option><option value="bonus">加分</option><option value="deduction">扣分</option></select></label>
                <label>项目名称 / 规则编号<input name="ruleCode" maxlength="80" required placeholder="如：社会实践、课程成绩" /></label>
                <label>分值<input name="claimedScore" type="number" step="0.1" required /></label>
                <button type="submit" class="ghost-btn">添加项目</button>
              </form>
            ` : '<p class="quality-readonly-tip">记录已进入审核流程，暂不能修改填报内容。</p>'}
          </section>
          <aside class="quality-evidence-card">
            <div class="quality-section-heading"><div><span>证明材料</span><h3>安全附件</h3></div><span>每项最多 10 份</span></div>
            <p>支持 PNG、JPG、WEBP 和 PDF，单个文件不超过 10MB。材料仅本人和有权限的审核人员可查看。</p>
            <label class="quality-evidence-picker ${editable ? "" : "disabled"}">选择对应项目
              <select id="qualityEvidenceItem" ${editable ? "" : "disabled"}>${items.filter((item) => item.evidenceRequired || item.evidence_required).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(active.label)} · ${escapeHtml(item.ruleCode || "项目")}</option>`).join("") || '<option value="">请先添加需证明的加分或扣分项</option>'}</select>
              <input id="qualityEvidenceFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" ${editable ? "" : "disabled"} />
            </label>
            <div id="qualityEvidenceList" class="quality-evidence-list">${(evidence || []).map((entry) => `<div><button type="button" data-quality-download-evidence="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</button>${editable ? `<button type="button" data-quality-delete-evidence="${escapeHtml(entry.id)}">删除</button>` : ""}</div>`).join("") || '<div class="quality-empty">暂无已上传材料</div>'}</div>
          </aside>
        </div>
        <footer class="quality-action-bar"><span>${escapeHtml(saveState || "未保存的变更会在操作后同步到服务器")}</span>${editable ? '<button type="button" class="ghost-btn" data-quality-action="save">保存草稿</button><button type="button" class="primary-btn" data-quality-action="submit">提交班级初审</button>' : ""}</footer>
      </section>
    `;
  }

  function renderQueue(title, records, kind) {
    return `<section class="quality-review-workspace"><div class="quality-section-heading"><div><span>${kind === "class" ? "班级审核" : "学院审核"}</span><h3>${title}</h3></div><span>${records.length} 条待处理</span></div><div class="quality-review-table-wrap"><table><thead><tr><th>学生</th><th>班级</th><th>总分</th><th>状态</th><th>操作</th></tr></thead><tbody>${records.length ? records.map((record) => `<tr><td>${escapeHtml(record.studentName || record.studentId)}</td><td>${escapeHtml(record.className || record.classId)}</td><td>${number(record.totalScore ?? record.total_score).toFixed(1)}</td><td>${escapeHtml(WORKFLOW_LABELS[record.status] || record.status)}</td><td><button type="button" data-quality-review="${kind}" data-quality-record-id="${escapeHtml(record.id)}" data-quality-version="${number(record.version)}" data-quality-decision="approved">通过</button><button type="button" data-quality-review="${kind}" data-quality-record-id="${escapeHtml(record.id)}" data-quality-version="${number(record.version)}" data-quality-decision="returned">退回</button></td></tr>`).join("") : '<tr><td colspan="5" class="quality-empty">暂无待审核记录</td></tr>'}</tbody></table></div></section>`;
  }

  function renderPublication(state) {
    const record = state.record;
    return `<section class="quality-publication-card"><span>公示与申诉</span><h3>${record ? (WORKFLOW_LABELS[record.status] || record.status) : "暂无综测记录"}</h3><p>公示期不少于 3 个工作日。对审核结果有异议时，可在公示期内提交申诉，处理结果会同步到审核记录。</p>${record?.status === "published" ? '<button type="button" class="primary-btn" data-quality-action="appeal">提交申诉</button>' : ""}</section>`;
  }

  function bind({ api, toast = () => {}, navigate = () => {}, user } = {}) {
    const root = document.querySelector("#qualityAssessmentRoot");
    if (!root || typeof api !== "function") return () => {};
    const controller = new AbortController();
    const state = { periods: [], periodId: "", record: null, evidence: [], activeModule: "moral", workspace: "application", classQueue: [], collegeQueue: [], saveState: "", dirty: false, saveTimer: null };
    const request = (path, options = {}) => api(path, { ...options, signal: controller.signal });
    const setBusy = (message) => { root.innerHTML = `<div class="quality-loading">${escapeHtml(message)}</div>`; };

    async function loadRecord() {
      const current = await request(`/api/quality/records/current?periodId=${encodeURIComponent(state.periodId)}`);
      state.record = current.record;
      const evidence = await request(`/api/quality/records/${encodeURIComponent(state.record.id)}/evidence`);
      state.evidence = evidence.evidence || [];
    }

    async function loadQueues() {
      if (state.workspace === "class") state.classQueue = (await request(`/api/quality/review/class?periodId=${encodeURIComponent(state.periodId)}`)).records || [];
      if (state.workspace === "college") state.collegeQueue = (await request(`/api/admin/quality/review?periodId=${encodeURIComponent(state.periodId)}`)).records || [];
    }

    function paint() {
      if (state.workspace === "application") root.innerHTML = renderApplication(state);
      else if (state.workspace === "class") root.innerHTML = renderQueue("班级初审", state.classQueue, "class");
      else if (state.workspace === "college") root.innerHTML = renderQueue("学院复核", state.collegeQueue, "college");
      else root.innerHTML = renderPublication(state);
      document.querySelectorAll("[data-quality-workspace]").forEach((button) => button.classList.toggle("active", button.dataset.qualityWorkspace === state.workspace));
    }

    function collectItems() {
      const items = (state.record?.items || []).map((item) => ({ ...item }));
      root.querySelectorAll("[data-quality-item-id]").forEach((node) => {
        const target = items.find((item) => String(item.id) === String(node.dataset.qualityItemId));
        const score = node.querySelector("[data-quality-score]");
        if (target && score) target.claimedScore = number(score.value);
      });
      return items;
    }

    async function saveDraft(showToast = false) {
      if (!state.record || !EDITABLE_STATUSES.has(state.record.status)) return;
      state.saveState = "保存中..."; paint();
      try {
        const payload = await request(`/api/quality/records/${encodeURIComponent(state.record.id)}/draft`, { method: "PUT", body: JSON.stringify({ version: state.record.version, items: collectItems() }) });
        state.record = payload.record;
        state.dirty = false;
        state.saveState = "已保存";
        if (showToast) toast("综测草稿已保存");
      } catch (error) {
        state.saveState = "保存失败，已保留当前填写内容";
        if (showToast) toast(error.message || "保存失败");
      }
      paint();
    }

    async function refresh() {
      setBusy("正在同步综测数据...");
      try {
        const periods = await request("/api/quality/periods");
        state.periods = periods.periods || [];
        state.periodId = state.periodId || state.periods.find((period) => period.status === "open")?.id || state.periods[0]?.id || "";
        if (!state.periodId) throw new Error("当前没有可用的综测周期");
        await loadRecord();
        await loadQueues();
        paint();
      } catch (error) {
        root.innerHTML = `<div class="quality-empty"><strong>综测数据暂时无法加载</strong><p>${escapeHtml(error.message || "请稍后重试")}</p><button class="ghost-btn" type="button" data-quality-action="retry">重新加载</button></div>`;
      }
    }

    async function uploadEvidence(file) {
      const itemId = root.querySelector("#qualityEvidenceItem")?.value;
      if (!file || !itemId) { toast("请先选择需要证明的加分或扣分项"); return; }
      if (file.size > 10 * 1024 * 1024) { toast("单个证明材料不能超过 10MB"); return; }
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      await request(`/api/quality/records/${encodeURIComponent(state.record.id)}/items/${encodeURIComponent(itemId)}/evidence`, { method: "POST", body: JSON.stringify({ name: file.name, dataUrl }) });
      state.evidence = (await request(`/api/quality/records/${encodeURIComponent(state.record.id)}/evidence`)).evidence || [];
      paint(); toast("证明材料已安全上传");
    }

    root.addEventListener("click", async (event) => {
      const moduleButton = event.target.closest("[data-quality-module]");
      if (moduleButton) { state.activeModule = moduleButton.dataset.qualityModule; paint(); return; }
      const action = event.target.closest("[data-quality-action]")?.dataset.qualityAction;
      if (action === "back") { navigate("tools"); return; }
      if (action === "retry") { refresh(); return; }
      if (action === "save") { saveDraft(true); return; }
      if (action === "submit") {
        if (!global.confirm("提交后将进入班级初审，确认继续吗？")) return;
        await saveDraft(false);
        const payload = await request(`/api/quality/records/${encodeURIComponent(state.record.id)}/submit`, { method: "POST", body: "{}" });
        state.record = payload.record; state.saveState = "已提交，等待班级初审"; paint(); toast("已提交班级初审"); return;
      }
      if (action === "appeal") {
        const reason = global.prompt("请填写申诉理由");
        if (!reason?.trim()) return;
        await request("/api/quality/appeals", { method: "POST", body: JSON.stringify({ recordId: state.record.id, reason: reason.trim() }) });
        toast("申诉已提交"); return;
      }
      const deleteItem = event.target.closest("[data-quality-delete-item]");
      if (deleteItem) {
        const itemNode = deleteItem.closest("[data-quality-item-id]");
        state.record.items = (state.record.items || []).filter((item) => String(item.id) !== String(itemNode.dataset.qualityItemId));
        state.dirty = true; state.saveState = "待保存"; paint(); return;
      }
      const download = event.target.closest("[data-quality-download-evidence]");
      if (download) {
        const evidenceId = download.dataset.qualityDownloadEvidence;
        const entry = (state.evidence || []).find((item) => String(item.id) === String(evidenceId));
        const blob = await request(`/api/quality/evidence/${encodeURIComponent(evidenceId)}`, { responseType: "blob" });
        const url = global.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = entry?.name || "综测证明材料";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => global.URL.revokeObjectURL(url), 1_000);
        return;
      }
      const deleteEvidence = event.target.closest("[data-quality-delete-evidence]");
      if (deleteEvidence) { await request(`/api/quality/evidence/${encodeURIComponent(deleteEvidence.dataset.qualityDeleteEvidence)}`, { method: "DELETE", body: "{}" }); await loadRecord(); paint(); return; }
      const review = event.target.closest("[data-quality-review]");
      if (review) {
        const kind = review.dataset.qualityReview;
        const decision = review.dataset.qualityDecision;
        if (!global.confirm(decision === "approved" ? "确认审核通过？" : "确认退回该记录？")) return;
        const prefix = kind === "class" ? "/api/quality/review/class/" : "/api/admin/quality/review/";
        await request(`${prefix}${encodeURIComponent(review.dataset.qualityRecordId)}`, { method: "POST", body: JSON.stringify({ version: number(review.dataset.qualityVersion), decision, opinion: decision === "approved" ? "审核通过" : "请补充或修正填报内容", itemDecisions: [] }) });
        await loadQueues(); paint(); toast("审核结果已提交");
      }
    });

    root.addEventListener("change", async (event) => {
      if (event.target.matches("[data-quality-period]")) { state.periodId = event.target.value; await refresh(); return; }
      if (event.target.matches("#qualityEvidenceFile")) {
        try { await uploadEvidence(event.target.files?.[0]); } catch (error) { toast(error.message || "证明材料上传失败"); }
      }
    });

    root.addEventListener("input", (event) => {
      if (!event.target.closest(".quality-record-shell")) return;
      state.dirty = true; state.saveState = "待保存";
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => saveDraft(false), 800);
    });

    root.addEventListener("submit", (event) => {
      if (!event.target.matches("#qualityAddItemForm")) return;
      event.preventDefault();
      const form = new FormData(event.target);
      state.record.items = [...(state.record.items || []), { id: `local-${Date.now()}`, module: state.activeModule, type: form.get("type"), ruleCode: form.get("ruleCode"), claimedScore: number(form.get("claimedScore")), evidenceRequired: form.get("type") !== "base" }];
      state.dirty = true; state.saveState = "待保存"; paint();
    });

    document.querySelectorAll("[data-quality-workspace]").forEach((button) => button.addEventListener("click", async () => { state.workspace = button.dataset.qualityWorkspace; await refresh(); }));
    refresh();
    return () => { controller.abort(); clearTimeout(state.saveTimer); };
  }

  global.QualityAssessmentPage = { render, bind, MODULES };
}(window));
