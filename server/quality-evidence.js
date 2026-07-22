const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const defaultStore = require("./quality-store");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/png", { extension: ".png", signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/jpeg", { extension: ".jpg", signature: (bytes) => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) }],
  ["image/webp", { extension: ".webp", signature: (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" }],
  ["application/pdf", { extension: ".pdf", signature: (bytes) => bytes.subarray(0, 5).toString("ascii") === "%PDF-" }]
]);

function qualityEvidenceError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function safeFileName(value, mimeType) {
  const raw = path.basename(String(value || "").trim()).replace(/[\x00-\x1f<>:"/\\|?*]/g, "_");
  const configured = ALLOWED.get(mimeType);
  if (!raw || raw.length > 180 || !configured) throw qualityEvidenceError("Evidence file name is invalid");
  const extension = path.extname(raw).toLowerCase();
  const jpegExtension = mimeType === "image/jpeg" && [".jpg", ".jpeg"].includes(extension);
  if ((!jpegExtension && extension !== configured.extension) || raw.startsWith(".")) throw qualityEvidenceError("Evidence file extension does not match its declared type");
  return raw;
}

function validateFile(file = {}) {
  const mimeType = String(file.mimeType || "").trim().toLowerCase() === "image/jpg" ? "image/jpeg" : String(file.mimeType || "").trim().toLowerCase();
  const configured = ALLOWED.get(mimeType);
  const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes || "");
  if (!configured || !bytes.length || bytes.length > MAX_FILE_BYTES || !configured.signature(bytes)) {
    throw qualityEvidenceError("Evidence file type or content is invalid");
  }
  return {
    name: safeFileName(file.name, mimeType),
    mimeType,
    bytes,
    digest: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

async function bodyToBuffer(body) {
  const dataUrl = String(body?.dataUrl || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (match) return { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
  const base64 = String(body?.base64 || "").replace(/\s/g, "");
  if (!base64) throw qualityEvidenceError("Evidence file data is required");
  return { mimeType: String(body?.mimeType || "").toLowerCase(), bytes: Buffer.from(base64, "base64") };
}

function toPublicEvidence(evidence) {
  return {
    id: evidence.id,
    itemId: evidence.itemId,
    recordId: evidence.recordId,
    name: evidence.name,
    mimeType: evidence.mimeType,
    size: evidence.size,
    createdAt: evidence.createdAt
  };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createQualityEvidenceService(options = {}) {
  const store = options.store || defaultStore;
  const rootDir = options.rootDir || path.join(__dirname, "runtime", "quality-evidence");
  const objectPrefix = String(options.objectPrefix || process.env.R2_QUALITY_EVIDENCE_PREFIX || "quality-evidence").replace(/^\/+|\/+$/g, "");
  const r2Endpoint = String(options.r2Endpoint || process.env.R2_QUALITY_EVIDENCE_ENDPOINT || "").trim();
  const r2Bucket = String(options.r2Bucket || process.env.R2_QUALITY_EVIDENCE_BUCKET || "").trim();
  const r2Client = options.r2Client || (r2Endpoint && r2Bucket
    ? new S3Client({
      region: "auto",
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: String(options.r2AccessKeyId || process.env.R2_QUALITY_EVIDENCE_ACCESS_KEY_ID || ""),
        secretAccessKey: String(options.r2SecretAccessKey || process.env.R2_QUALITY_EVIDENCE_SECRET_ACCESS_KEY || "")
      }
    })
    : null);

  async function put(storageKey, bytes, mimeType) {
    if (r2Client) {
      await r2Client.send(new PutObjectCommand({ Bucket: r2Bucket, Key: storageKey, Body: bytes, ContentType: mimeType, CacheControl: "private, no-store" }));
      return;
    }
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, path.basename(storageKey)), bytes, { flag: "wx" });
  }

  async function read(storageKey) {
    if (r2Client) {
      const response = await r2Client.send(new GetObjectCommand({ Bucket: r2Bucket, Key: storageKey }));
      return streamToBuffer(response.Body);
    }
    return fs.readFile(path.join(rootDir, path.basename(storageKey)));
  }

  async function remove(storageKey) {
    if (r2Client) {
      await r2Client.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: storageKey }));
      return;
    }
    await fs.rm(path.join(rootDir, path.basename(storageKey)), { force: true });
  }

  async function saveEvidence({ recordId, itemId, owner, file }) {
    const normalized = validateFile(file);
    await store.authorizeEvidenceWrite(recordId, itemId, owner);
    const id = `quality-evidence-${crypto.randomUUID()}`;
    const storageKey = `${objectPrefix}/${id}${path.extname(normalized.name).toLowerCase()}`;
    await put(storageKey, normalized.bytes, normalized.mimeType);
    try {
      const evidence = await store.createEvidenceMetadata({
        id,
        recordId,
        itemId,
        name: normalized.name,
        mimeType: normalized.mimeType,
        size: normalized.bytes.length,
        digest: normalized.digest,
        storageKey
      }, owner);
      return toPublicEvidence(evidence);
    } catch (error) {
      await remove(storageKey).catch(() => {});
      throw error;
    }
  }

  async function listEvidence(recordId, user) {
    return (await store.listEvidence(recordId, user)).map(toPublicEvidence);
  }

  async function readEvidence(evidenceId, user) {
    const evidence = await store.getEvidenceForRead(evidenceId, user);
    return { ...toPublicEvidence(evidence), bytes: await read(evidence.storageKey) };
  }

  async function deleteEvidence(evidenceId, user) {
    const evidence = await store.deleteEvidence(evidenceId, user);
    await remove(evidence.storageKey).catch(() => {});
    return toPublicEvidence(evidence);
  }

  return { store, saveEvidence, listEvidence, readEvidence, deleteEvidence };
}

const defaultService = createQualityEvidenceService();

module.exports = { ...defaultService, createQualityEvidenceService, validateFile, bodyToBuffer, toPublicEvidence, MAX_FILE_BYTES };
