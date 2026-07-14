const { mysqlConfigured, autoMigrateSchema, getPool } = require("./db");

const NEWS_CACHE_MS = 15 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 5000;
const MAX_ITEMS_PER_SOURCE = 12;
const MAX_ITEMS = 160;

const sources = [
  { id: "school-news", name: "泰州学院官网·新闻中心", category: "学校要闻", url: "https://www.tzu.edu.cn/39/list.htm" },
  { id: "school-notices", name: "泰州学院官网·通知公告", category: "通知公告", url: "https://www.tzu.edu.cn/3071/list.htm" },
  { id: "school-academic", name: "泰州学院官网·学术报告", category: "学术报告", url: "https://www.tzu.edu.cn/3073/list.htm" },
  { id: "school-campus", name: "泰州学院官网·校园动态", category: "校园动态", url: "https://www.tzu.edu.cn/3074/list.htm" },
  { id: "humanities", name: "人文学院", category: "二级学院", url: "https://renwen.tzu.edu.cn/" },
  { id: "math", name: "数理学院", category: "二级学院", url: "https://slxx.tzu.edu.cn/" },
  { id: "information", name: "信息工程学院", category: "二级学院", url: "https://jsj.tzu.edu.cn/" },
  { id: "education", name: "教育科学学院", category: "二级学院", url: "https://jy.tzu.edu.cn/" },
  { id: "foreign-language", name: "外国语学院", category: "二级学院", url: "https://eng.tzu.edu.cn/" },
  { id: "economics", name: "经济与管理学院", category: "二级学院", url: "https://jjgl.tzu.edu.cn/" },
  { id: "mechanical", name: "机电工程学院", category: "二级学院", url: "https://jdgc.tzu.edu.cn/" },
  { id: "music", name: "音乐学院", category: "二级学院", url: "https://yinyue.tzu.edu.cn/" },
  { id: "art", name: "美术学院", category: "二级学院", url: "https://msx.tzu.edu.cn/" },
  { id: "pharmacy", name: "药学院", category: "二级学院", url: "https://yxy.tzu.edu.cn/" },
  { id: "chemistry", name: "化学化工与材料工程学院", category: "二级学院", url: "https://hcxy.tzu.edu.cn/" },
  { id: "marxism", name: "马克思主义学院", category: "二级学院", url: "https://marx.tzu.edu.cn/" },
  { id: "sports", name: "公共体育部", category: "二级学院", url: "https://tyx.tzu.edu.cn/" },
  { id: "youth", name: "校团委", category: "团委社团", url: "https://tuanwei.tzu.edu.cn/gzdt/list.htm" },
  { id: "academic-affairs", name: "教务处", category: "职能部门", url: "https://jwc.tzu.edu.cn/" },
  { id: "admissions", name: "招生信息网", category: "招生就业", url: "https://zsb.tzu.edu.cn/" },
  { id: "international", name: "国际交流与合作处", category: "职能部门", url: "https://wsb.tzu.edu.cn/" },
  { id: "information-disclosure", name: "信息公开网", category: "职能部门", url: "https://xxgk.tzu.edu.cn/" }
];

let cache = null;
let pendingRefresh = null;
let persistentCacheInitialized = false;
let persistentCacheHydrated = false;

function emptyCache() {
  return {
    source: "https://www.tzu.edu.cn/",
    sourceStatus: "warming",
    updatedAt: "",
    cacheSeconds: NEWS_CACHE_MS / 1000,
    sources: sources.map(({ id, name, category, url }) => ({ id, name, category, url, status: "pending", count: 0 })),
    items: [],
    expiresAt: 0
  };
}

async function initializePersistentCache() {
  if (!mysqlConfigured || persistentCacheInitialized) return;
  if (!autoMigrateSchema) {
    persistentCacheInitialized = true;
    return;
  }
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS campus_news_cache (
      cache_key VARCHAR(40) PRIMARY KEY,
      payload JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  persistentCacheInitialized = true;
}

async function hydratePersistentCache() {
  if (!mysqlConfigured || persistentCacheHydrated) return cache;
  persistentCacheHydrated = true;
  await initializePersistentCache();
  const [rows] = await getPool().execute("SELECT payload FROM campus_news_cache WHERE cache_key = 'campus' LIMIT 1");
  if (!rows[0]) return cache;
  try {
    const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    if (payload && Array.isArray(payload.items)) cache = payload;
  } catch {
    cache = null;
  }
  return cache;
}

async function persistCache(value) {
  if (!mysqlConfigured) return;
  await initializePersistentCache();
  await getPool().execute(
    "INSERT INTO campus_news_cache (cache_key, payload) VALUES ('campus', ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP",
    [JSON.stringify(value)]
  );
}

function decodeEntities(value = "") {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function cleanText(value = "") {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(?:MORE|More|more)\b/g, " ")
    .replace(/(?:查看详细|详细信息|阅读全文|点击查看)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attributeValue(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeEntities(match[2]).trim() : "";
}

function articleDate(url) {
  const match = String(url).match(/\/(20\d{2})\/(\d{2})(\d{2})\//);
  if (!match) return { fullDate: "", date: "" };
  return { fullDate: `${match[1]}-${match[2]}-${match[3]}`, date: `${match[2]}-${match[3]}` };
}

function titleFromAnchor(attributes, innerHtml) {
  const titleAttribute = attributeValue(attributes, "title");
  let title = cleanText(titleAttribute || innerHtml)
    .replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*/, "")
    .replace(/^\d{1,2}[-/.]\d{1,2}\s*/, "")
    .replace(/\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*$/, "")
    .trim();
  if (title.length > 100) title = `${title.slice(0, 97).trim()}...`;
  return title;
}

function extractItems(html, source) {
  const items = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)href\s*=\s*(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    let url;
    try {
      url = new URL(decodeEntities(match[3]), source.url);
    } catch (error) {
      continue;
    }
    if (!/(^|\.)tzu\.edu\.cn$/i.test(url.hostname)) continue;
    if (!/\/20\d{2}\/\d{4}\/c\d+a\d+\/page\.htm$/i.test(url.pathname)) continue;
    const canonicalUrl = `${url.origin}${url.pathname}`;
    if (seen.has(canonicalUrl)) continue;
    const attributes = `${match[1]} ${match[4]}`;
    const title = titleFromAnchor(attributes, match[5]);
    if (!title || title.length < 4) continue;
    const date = articleDate(canonicalUrl);
    seen.add(canonicalUrl);
    items.push({
      id: `${source.id}-${items.length + 1}`,
      title,
      source: source.name,
      category: source.category,
      date: date.date,
      fullDate: date.fullDate,
      url: canonicalUrl
    });
    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return items;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SmartCampusNews/1.0; +https://www.tzu.edu.cn/)",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const items = extractItems(html, source);
    return { ...source, status: "live", count: items.length, items };
  } catch (error) {
    return { ...source, status: "error", count: 0, error: error.name === "AbortError" ? "请求超时" : error.message, items: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshCampusNews() {
  const results = await Promise.all(sources.map(fetchSource));
  const deduped = new Map();
  for (const item of results.flatMap((result) => result.items)) {
    if (!deduped.has(item.url)) deduped.set(item.url, item);
  }
  const failedSources = new Set(results.filter((source) => source.status !== "live").map((source) => source.name));
  for (const item of cache?.items || []) {
    if (failedSources.has(item.source) && !deduped.has(item.url)) deduped.set(item.url, item);
  }
  const items = [...deduped.values()]
    .sort((a, b) => String(b.fullDate).localeCompare(String(a.fullDate)) || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, MAX_ITEMS);
  const liveCount = results.filter((source) => source.status === "live").length;
  cache = {
    source: "https://www.tzu.edu.cn/",
    sourceStatus: liveCount === results.length ? "live" : liveCount ? "partial-no-official" : items.length ? "stale" : "fallback",
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    cacheSeconds: NEWS_CACHE_MS / 1000,
    sources: results.map(({ items: ignored, ...source }) => source),
    items,
    expiresAt: Date.now() + (liveCount ? NEWS_CACHE_MS : 2 * 60 * 1000)
  };
  try {
    await persistCache(cache);
  } catch (error) {
    console.warn("Failed to persist campus news cache:", error.message);
  }
  return cache;
}

function startRefresh() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = refreshCampusNews().finally(() => {
    pendingRefresh = null;
  });
  return pendingRefresh;
}

async function getCampusNews(forceRefresh = false, { preferCache = false } = {}) {
  if (forceRefresh) return startRefresh();
  if (cache && cache.expiresAt > Date.now()) return { ...cache, refreshing: false };
  try {
    await hydratePersistentCache();
  } catch (error) {
    console.warn("Failed to hydrate campus news cache:", error.message);
  }
  if (cache) {
    if (cache.expiresAt <= Date.now()) startRefresh();
    return { ...cache, refreshing: Boolean(pendingRefresh) };
  }
  if (preferCache) {
    startRefresh();
    return { ...emptyCache(), refreshing: true };
  }
  return startRefresh();
}

module.exports = { getCampusNews, sources, refreshCampusNews };
