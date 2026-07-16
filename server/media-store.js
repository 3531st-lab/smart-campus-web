const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const MAX_INPUT_BYTES = Number(process.env.CHAT_STICKER_MAX_INPUT_BYTES || 4 * 1024 * 1024);
const MAX_OUTPUT_BYTES = Number(process.env.CHAT_STICKER_MAX_OUTPUT_BYTES || 1024 * 1024);
const MAX_PIXELS = 16_777_216;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

class MediaError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mediaError(message, statusCode) {
  return new MediaError(message, statusCode);
}

function normalizedMimeType(value) {
  const mimeType = String(value || "").trim().toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  return mimeType;
}

function detectedMimeType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return "";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function normalizedSource(source = {}) {
  const type = String(source.type || "upload").trim().toLowerCase();
  if (type === "upload") return { type };
  if (type !== "network") throw mediaError("表情来源类型无效");
  const sourceUrl = String(source.sourceUrl || "").trim();
  const author = String(source.author || "").trim();
  const license = String(source.license || "").trim();
  if (!/^https:\/\//i.test(sourceUrl) || sourceUrl.length > 2048) throw mediaError("网络表情必须提供有效的 HTTPS 来源链接");
  if (!author || author.length > 160 || !license || license.length > 160) throw mediaError("网络表情必须填写作者与授权信息");
  return { type, sourceUrl, author, license };
}

function blockedDigests(value = process.env.CHAT_BLOCKED_MEDIA_DIGESTS || "") {
  return new Set(String(value).split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[a-f0-9]{64}$/.test(item)));
}

function parseSourceAdapters(value = process.env.CHAT_STICKER_SOURCE_ALLOWLIST || "") {
  if (!value) return [];
  try {
    const entries = Array.isArray(value) ? value : JSON.parse(value);
    return (Array.isArray(entries) ? entries : []).map((entry) => ({
      id: String(entry.id || "").trim(),
      name: String(entry.name || "").trim(),
      license: String(entry.license || "").trim(),
      searchUrl: String(entry.searchUrl || "").trim(),
      items: Array.isArray(entry.items) ? entry.items : []
    })).filter((entry) => entry.id && entry.name && entry.license && /^https:\/\//i.test(entry.searchUrl));
  } catch {
    return [];
  }
}

function createMediaStore(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, "..", "public", "uploads", "chat-stickers");
  const objectPrefix = String(options.objectPrefix || process.env.R2_CHAT_MEDIA_PREFIX || "chat-stickers").replace(/^\/+|\/+$/g, "");
  const publicBaseUrl = String(options.publicBaseUrl || process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const sourceAdapters = options.sourceAdapters || parseSourceAdapters(options.sourceAdapterConfig);
  const denylist = options.blockedDigests || blockedDigests(options.blockedDigestConfig);
  const r2Endpoint = String(options.r2Endpoint || process.env.R2_ENDPOINT || "").trim();
  const r2Bucket = String(options.r2Bucket || process.env.R2_BUCKET || "").trim();
  const r2Client = options.r2Client || (r2Endpoint && r2Bucket
    ? new S3Client({
      region: "auto",
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: String(options.r2AccessKeyId || process.env.R2_ACCESS_KEY_ID || ""),
        secretAccessKey: String(options.r2SecretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "")
      }
    })
    : null);

  async function persistObject({ key, bytes }) {
    if (r2Client) {
      if (!publicBaseUrl) throw mediaError("图片存储未配置公开访问地址", 503);
      await r2Client.send(new PutObjectCommand({
        Bucket: r2Bucket,
        Key: key,
        Body: bytes,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable"
      }));
      return `${publicBaseUrl}/${key}`;
    }
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, path.basename(key)), bytes, { flag: "wx" });
    return `/uploads/chat-stickers/${path.basename(key)}`;
  }

  async function saveImage({ ownerId, bytes, mimeType, source }) {
    const safeOwnerId = String(ownerId || "").trim();
    if (!safeOwnerId) throw mediaError("缺少表情所属用户", 401);
    if (!Buffer.isBuffer(bytes)) throw mediaError("图片数据无效");
    if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw mediaError("图片大小需在 1 字节到 4MB 之间");
    const declared = normalizedMimeType(mimeType);
    const detected = detectedMimeType(bytes);
    if (!ALLOWED_MIME_TYPES.has(declared) || declared !== detected) throw mediaError("图片格式与文件内容不一致");
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (denylist.has(digest)) throw mediaError("该图片已被平台安全策略拦截", 422);
    const normalized = normalizedSource(source);
    let webp;
    try {
      webp = await sharp(bytes, { animated: true, limitInputPixels: MAX_PIXELS, failOn: "error" })
        .rotate()
        .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw mediaError("图片无法安全解析");
    }
    if (!webp.length || webp.length > MAX_OUTPUT_BYTES) throw mediaError("图片转码后超过 1MB 限制");
    const id = `media-${crypto.randomUUID()}`;
    const key = `${objectPrefix}/${id}.webp`;
    const url = await persistObject({ key, bytes: webp });
    return {
      id,
      ownerId: safeOwnerId,
      key,
      url,
      mimeType: "image/webp",
      size: webp.length,
      digest,
      source: normalized,
      createdAt: new Date().toISOString()
    };
  }

  function searchSources(query) {
    const keyword = String(query || "").trim().toLocaleLowerCase("zh-CN");
    return sourceAdapters.flatMap((adapter) => adapter.items
      .filter((item) => !keyword || `${item.name || ""} ${item.tags || ""}`.toLocaleLowerCase("zh-CN").includes(keyword))
      .slice(0, 20)
      .map((item) => ({
        adapterId: adapter.id,
        name: String(item.name || "").slice(0, 80),
        author: String(item.author || "").slice(0, 160),
        license: adapter.license,
        sourceUrl: adapter.searchUrl,
        previewUrl: String(item.previewUrl || "")
      })));
  }

  return { saveImage, searchSources, normalizedSource, detectedMimeType, MediaError };
}

const defaultStore = createMediaStore();

module.exports = { ...defaultStore, createMediaStore, MediaError, detectedMimeType, normalizedSource };
