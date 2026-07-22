const defaultStore = require("./quality-store");
const defaultEvidenceService = require("./quality-evidence");

function routeId(pathname, prefix) {
  const match = String(pathname || "").match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^/]+)$`));
  return match ? decodeURIComponent(match[1]) : "";
}

function evidenceUploadTarget(pathname) {
  const match = String(pathname || "").match(/^\/api\/quality\/records\/([^/]+)\/items\/([^/]+)\/evidence$/);
  return match
    ? { recordId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]) }
    : null;
}

function requireStudent(user) {
  if (user?.role !== "student") {
    const error = new Error("Only students can manage personal assessment records");
    error.statusCode = 403;
    throw error;
  }
}

function requireOperator(user) {
  if (!["admin", "super_admin"].includes(user?.role)) {
    const error = new Error("Only administrators can access this assessment operation");
    error.statusCode = 403;
    throw error;
  }
}

function requireNotGuest(user) {
  if (user?.role === "guest") {
    const error = new Error("Guest accounts cannot access quality assessment workflows");
    error.statusCode = 403;
    throw error;
  }
}

function pageQueue(payload, url) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "30", 10) || 30));
  const status = String(url.searchParams.get("status") || "").trim();
  const query = String(url.searchParams.get("query") || "").trim().toLowerCase();
  const records = (payload.records || []).filter((record) => {
    if (status && String(record.status) !== status) return false;
    if (!query) return true;
    return [record.id, record.studentId, record.classId, record.school, record.college, record.status]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  return {
    records: records.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    total,
    page: currentPage,
    pageSize,
    pageCount
  };
}

function qualityError(error, sendError, res) {
  const status = Number(error?.statusCode);
  sendError(res, status >= 400 && status <= 599 ? status : 500, status ? error.message : "Quality assessment service is temporarily unavailable");
}

async function handleQualityRoute(context) {
  const { route, url, req, res, requireUser, parseBody, sendJson, sendError } = context;
  if (!route.includes(" /api/quality") && !route.includes(" /api/admin/quality")) return false;

  const user = await requireUser(req, res);
  if (!user) return true;
  const store = context.store || defaultStore;
  const evidenceService = context.evidenceService || defaultEvidenceService;
  const routeName = `${String(route).split(" ")[0]} ${url.pathname}`;

  try {
    requireNotGuest(user);

    if (routeName === "GET /api/quality/periods") {
      sendJson(res, 200, { periods: await store.listPeriods(user) });
      return true;
    }

    if (routeName === "GET /api/quality/records/current") {
      requireStudent(user);
      const periods = await store.listPeriods(user);
      const periodId = String(url.searchParams.get("periodId") || "").trim()
        || String(periods.find((period) => period.status === "open")?.id || periods[0]?.id || "");
      if (!periodId) {
        const error = new Error("No available assessment period");
        error.statusCode = 404;
        throw error;
      }
      sendJson(res, 200, { record: await store.getOrCreateRecord(periodId, user) });
      return true;
    }

    if (route.startsWith("PUT /api/quality/records/") && url.pathname.endsWith("/draft")) {
      requireStudent(user);
      const recordId = decodeURIComponent(url.pathname.slice("/api/quality/records/".length, -"/draft".length));
      sendJson(res, 200, { record: await store.saveDraft(recordId, await parseBody(req), user) });
      return true;
    }

    if (route.startsWith("POST /api/quality/records/") && url.pathname.endsWith("/submit")) {
      requireStudent(user);
      const recordId = decodeURIComponent(url.pathname.slice("/api/quality/records/".length, -"/submit".length));
      sendJson(res, 200, { record: await store.submitRecord(recordId, user) });
      return true;
    }

    const evidenceTarget = evidenceUploadTarget(url.pathname);
    if (route.startsWith("POST /api/quality/records/") && evidenceTarget) {
      requireStudent(user);
      const body = await parseBody(req, { limitBytes: 14 * 1024 * 1024 });
      const file = await defaultEvidenceService.bodyToBuffer(body);
      const evidence = await evidenceService.saveEvidence({
        recordId: evidenceTarget.recordId,
        itemId: evidenceTarget.itemId,
        owner: user,
        file: { name: body.name, mimeType: file.mimeType || body.mimeType, bytes: file.bytes }
      });
      sendJson(res, 201, { evidence });
      return true;
    }

    if (route.startsWith("GET /api/quality/records/") && url.pathname.endsWith("/evidence")) {
      const recordId = decodeURIComponent(url.pathname.slice("/api/quality/records/".length, -"/evidence".length));
      sendJson(res, 200, { evidence: await evidenceService.listEvidence(recordId, user) });
      return true;
    }

    if (route.startsWith("GET /api/quality/evidence/")) {
      const evidenceId = routeId(url.pathname, "/api/quality/evidence/");
      const evidence = await evidenceService.readEvidence(evidenceId, user);
      if (typeof context.sendEvidence === "function") {
        context.sendEvidence(res, evidence);
      } else {
        sendJson(res, 200, {
          evidence: {
            ...defaultEvidenceService.toPublicEvidence(evidence),
            base64: evidence.bytes.toString("base64")
          }
        });
      }
      return true;
    }

    if (route.startsWith("DELETE /api/quality/evidence/")) {
      requireStudent(user);
      const evidenceId = routeId(url.pathname, "/api/quality/evidence/");
      sendJson(res, 200, { evidence: await evidenceService.deleteEvidence(evidenceId, user) });
      return true;
    }

    if (routeName === "GET /api/quality/review/class") {
      const queue = await store.listClassQueue({ periodId: url.searchParams.get("periodId") || "" }, user);
      sendJson(res, 200, pageQueue(queue, url));
      return true;
    }

    if (route.startsWith("POST /api/quality/review/class/")) {
      const recordId = routeId(url.pathname, "/api/quality/review/class/");
      sendJson(res, 200, { record: await store.reviewClassRecord(recordId, await parseBody(req), user) });
      return true;
    }

    if (routeName === "GET /api/admin/quality/review") {
      requireOperator(user);
      const queue = await store.listCollegeQueue({ periodId: url.searchParams.get("periodId") || "" }, user);
      sendJson(res, 200, pageQueue(queue, url));
      return true;
    }

    if (route.startsWith("POST /api/admin/quality/review/")) {
      requireOperator(user);
      const recordId = routeId(url.pathname, "/api/admin/quality/review/");
      sendJson(res, 200, { record: await store.reviewCollegeRecord(recordId, await parseBody(req), user) });
      return true;
    }

    if (routeName === "POST /api/admin/quality/periods") {
      const period = await store.createPeriod(await parseBody(req), user);
      sendJson(res, 201, { period });
      return true;
    }

    if (route.startsWith("POST /api/admin/quality/periods/") && url.pathname.endsWith("/publish")) {
      const periodId = decodeURIComponent(url.pathname.slice("/api/admin/quality/periods/".length, -"/publish".length));
      sendJson(res, 200, { period: await store.publishPeriod(periodId, await parseBody(req), user) });
      return true;
    }

    if (route.startsWith("POST /api/admin/quality/periods/") && url.pathname.endsWith("/archive")) {
      const periodId = decodeURIComponent(url.pathname.slice("/api/admin/quality/periods/".length, -"/archive".length));
      sendJson(res, 200, { period: await store.archivePeriod(periodId, user) });
      return true;
    }

    if (routeName === "POST /api/quality/appeals") {
      requireStudent(user);
      sendJson(res, 201, { appeal: await store.createAppeal(await parseBody(req), user) });
      return true;
    }

    if (route.startsWith("POST /api/admin/quality/appeals/") && url.pathname.endsWith("/review")) {
      requireOperator(user);
      const appealId = decodeURIComponent(url.pathname.slice("/api/admin/quality/appeals/".length, -"/review".length));
      sendJson(res, 200, { appeal: await store.reviewAppeal(appealId, await parseBody(req), user) });
      return true;
    }

    if (routeName === "GET /api/admin/quality/audit") {
      requireOperator(user);
      const logs = await store.listAuditLogs({
        targetId: url.searchParams.get("recordId") || "",
        limit: url.searchParams.get("limit") || 100
      }, user);
      sendJson(res, 200, { logs: logs.slice(0, Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)))) });
      return true;
    }

    if (routeName === "GET /api/admin/quality/export-data") {
      requireOperator(user);
      const payload = await store.listExportRecords({
        periodId: url.searchParams.get("periodId") || "",
        classId: url.searchParams.get("classId") || ""
      }, user);
      sendJson(res, 200, payload);
      return true;
    }

    sendError(res, 404, "Quality assessment API route does not exist");
    return true;
  } catch (error) {
    qualityError(error, sendError, res);
    return true;
  }
}

module.exports = { handleQualityRoute };
