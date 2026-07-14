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
