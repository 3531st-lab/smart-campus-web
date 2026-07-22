const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createMemoryQualityStore } = require("../server/quality-store");
const { createQualityEvidenceService } = require("../server/quality-evidence");
const { handleQualityRoute } = require("../server/quality-routes");

const users = {
  student: { id: "evidence-student", role: "student", classId: "evidence-class", school: "Campus A", college: "College A" },
  monitor: { id: "evidence-monitor", role: "student", classId: "evidence-class", school: "Campus A", college: "College A" },
  outsider: { id: "evidence-outsider", role: "student", classId: "other-class", school: "Campus A", college: "College A" },
  admin: { id: "evidence-admin", role: "admin", school: "Campus A", college: "College A" }
};

async function fixtures() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "quality-evidence-"));
  const record = {
    id: "evidence-record",
    periodId: "evidence-period",
    studentId: users.student.id,
    classId: "evidence-class",
    school: "Campus A",
    college: "College A",
    ruleVersion: "2025-economics-management",
    status: "draft",
    moduleScores: {},
    totalScore: 0,
    calculationSnapshot: {},
    riskFlags: [],
    version: 1
  };
  const item = { id: "evidence-item", recordId: record.id, module: "moral", type: "bonus", ruleCode: "MORAL_ACTIVITY", claimedScore: 1, evidenceRequired: true };
  const store = createMemoryQualityStore({
    periods: [{ id: "evidence-period", name: "Evidence period", status: "open", ruleVersion: "2025-economics-management" }],
    records: [record],
    items: [item],
    classAssignments: [{ id: "evidence-duty", classId: "evidence-class", userId: users.monitor.id, duty: "monitor", active: true }]
  });
  return { rootDir, record, item, service: createQualityEvidenceService({ store, rootDir }) };
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const pdf = Buffer.from("%PDF-1.7\nquality evidence\n", "ascii");

async function callRoute(service, route, user, body = {}) {
  const url = new URL(`http://campus.test${route.replace(/^\w+\s+/, "")}`);
  const response = {};
  await handleQualityRoute({
    route,
    url,
    store: service.store,
    evidenceService: service,
    req: {},
    res: {},
    requireUser: async () => user,
    parseBody: async () => body,
    sendJson: (_res, status, payload) => Object.assign(response, { status, payload }),
    sendError: (_res, status, error) => Object.assign(response, { status, payload: { error } })
  });
  return response;
}

test("accepts private PNG and PDF evidence within ten megabytes", async (t) => {
  const { rootDir, record, item, service } = await fixtures();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));

  const image = await service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "certificate.png", mimeType: "image/png", bytes: png } });
  const document = await service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "certificate.pdf", mimeType: "application/pdf", bytes: pdf } });
  assert.equal(image.mimeType, "image/png");
  assert.equal(document.mimeType, "application/pdf");
  assert.equal("storageKey" in image, false);
  assert.equal((await service.listEvidence(record.id, users.student)).length, 2);
});

test("rejects mismatched executable content and unrelated readers", async (t) => {
  const { rootDir, record, item, service } = await fixtures();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    () => service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "dangerous.pdf", mimeType: "application/pdf", bytes: Buffer.from("MZ executable", "ascii") } }),
    (error) => error.statusCode === 400
  );
  const saved = await service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "certificate.png", mimeType: "image/png", bytes: png } });
  await assert.rejects(() => service.readEvidence(saved.id, users.outsider), (error) => error.statusCode === 403);
  assert.equal((await service.readEvidence(saved.id, users.monitor)).bytes.length, png.length);
  assert.equal((await service.readEvidence(saved.id, users.admin)).name, "certificate.png");
});

test("evidence stops at ten active files and cannot be changed after submission", async (t) => {
  const { rootDir, record, item, service } = await fixtures();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  for (let index = 0; index < 10; index += 1) {
    await service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: `certificate-${index}.png`, mimeType: "image/png", bytes: png } });
  }
  await assert.rejects(
    () => service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "eleventh.png", mimeType: "image/png", bytes: png } }),
    (error) => error.statusCode === 409
  );
  await service.store.submitRecord(record.id, users.student);
  await assert.rejects(
    () => service.saveEvidence({ recordId: record.id, itemId: item.id, owner: users.student, file: { name: "late.png", mimeType: "image/png", bytes: png } }),
    (error) => error.statusCode === 409
  );
});

test("quality evidence API uploads, lists, downloads, and deletes a private file", async (t) => {
  const { rootDir, record, item, service } = await fixtures();
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

  const uploaded = await callRoute(service, `POST /api/quality/records/${record.id}/items/${item.id}/evidence`, users.student, {
    name: "award.png",
    dataUrl
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.payload.evidence.name, "award.png");

  const listed = await callRoute(service, `GET /api/quality/records/${record.id}/evidence`, users.student);
  assert.equal(listed.status, 200);
  assert.equal(listed.payload.evidence.length, 1);

  const downloaded = await callRoute(service, `GET /api/quality/evidence/${uploaded.payload.evidence.id}`, users.student);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.payload.evidence.base64, png.toString("base64"));

  const deleted = await callRoute(service, `DELETE /api/quality/evidence/${uploaded.payload.evidence.id}`, users.student);
  assert.equal(deleted.status, 200);
  assert.equal((await service.listEvidence(record.id, users.student)).length, 0);
});
