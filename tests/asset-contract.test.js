const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("keeps every software catalog icon available in the deployed public tree", () => {
  const catalogPath = path.join(root, "public", "assets", "software-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.ok(catalog.length >= 100, "the full software catalog should be present");

  const missing = catalog
    .filter((item) => !item.icon || !fs.existsSync(path.join(root, "public", String(item.icon).replace(/^\//, ""))))
    .map((item) => `${item.id}:${item.name}`);
  assert.deepEqual(missing, []);
});

test("keeps client API calls connected to server route handlers", () => {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server", "index.js"), "utf8");
  const clientPaths = [...app.matchAll(/(?:adminApi|api)\(\s*[`'"](\/api\/[^`'"?$]+(?:\?[^`'"]*)?)/g)]
    .map((match) => match[1].split("?")[0]);
  const serverPaths = [...server.matchAll(/(?:route\s*===|route\.startsWith\()\s*[`'"](?:GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^`'"]+)/g)]
    .map((match) => match[1]);
  const known = new Set(serverPaths.filter((route) => !route.includes("${")));
  const missing = [...new Set(clientPaths)].filter((clientPath) => (
    !known.has(clientPath) && ![...known].some((serverPath) => clientPath.startsWith(serverPath))
  ));
  assert.deepEqual(missing, []);
});

test("paginates campus news without pre-rendering the full catalog", () => {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  assert.match(app, /id="campusNewsPagination"/);
  assert.match(app, /const pageSize = 12;/);
  assert.match(app, /pollForRefreshedNews/);
  assert.doesNotMatch(app, /id="campusNewsLoadMore"/);
  assert.doesNotMatch(app, /document\.querySelectorAll\("\.news-item"\)/);
});

test("ships cache-safe assets and paginates the exam catalog", () => {
  const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const canonicalStyles = fs.readFileSync(path.join(root, "public", "assets", "styles.css"), "utf8");
  const releaseStylesPath = path.join(root, "public", "assets", "styles-v156.css");

  assert.match(index, /\/assets\/styles-v156\.css/);
  assert.match(index, /\/app\.js\?v=156/);
  assert.ok(fs.existsSync(releaseStylesPath), "the release stylesheet should exist");
  assert.equal(fs.readFileSync(releaseStylesPath, "utf8"), canonicalStyles);
  assert.match(app, /id="examResultSummary"/);
  assert.match(app, /id="examPagination"/);
  assert.match(app, /const examPageSize = 12;/);
  assert.match(app, /items\.slice\(start, start \+ examPageSize\)/);
});

test("keeps local runtime data and maintenance scripts out of Vercel uploads", () => {
  const ignore = fs.readFileSync(path.join(root, ".vercelignore"), "utf8");
  assert.match(ignore, /^scripts\/$/m);
  assert.match(ignore, /^server\/lab-reservations\.json$/m);
  assert.match(ignore, /^\.env\.\*$/m);
});
