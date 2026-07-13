const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SlidingWindowRegistry,
  publicRequestError
} = require("../server/security-policy.js");

const ROOT = path.resolve(__dirname, "..");

test("masks production server and database errors", () => {
  const databaseError = new Error("Access denied for user campus_app using password: YES");
  assert.deepEqual(publicRequestError(databaseError, true), {
    status: 503,
    message: "数据库服务暂时不可用，请稍后重试"
  });

  const internalError = new Error("secret filesystem path C:/private/config.json");
  assert.deepEqual(publicRequestError(internalError, true), {
    status: 500,
    message: "服务器暂时无法处理请求，请稍后重试"
  });
});

test("preserves safe client errors and bounds sliding-window state", () => {
  const validationError = new Error("JSON 格式错误");
  validationError.statusCode = 400;
  assert.deepEqual(publicRequestError(validationError, true), {
    status: 400,
    message: "JSON 格式错误"
  });

  const registry = new SlidingWindowRegistry({ maxKeys: 2, maxEventsPerKey: 3 });
  registry.record("one", 1_000, 10_000);
  registry.record("two", 2_000, 10_000);
  registry.record("three", 3_000, 10_000);
  assert.equal(registry.size, 2);
  assert.deepEqual(registry.recent("three", 3_500, 10_000), [3_000]);
  registry.prune(20_000, 10_000);
  assert.equal(registry.size, 0);
});

test("keeps edge proxy errors private and authenticated responses uncached", () => {
  const proxySource = fs.readFileSync(path.join(ROOT, "functions", "api", "[[path]].js"), "utf8");
  assert.doesNotMatch(proxySource, /detail\s*:/);
  assert.match(proxySource, /AbortSignal\.timeout/);
  assert.match(proxySource, /headers\.has\("authorization"\)/);
  assert.match(proxySource, /x-request-id/);

  const edgeHeaders = fs.readFileSync(path.join(ROOT, "public", "_headers"), "utf8");
  assert.match(edgeHeaders, /style-src 'self' 'unsafe-inline'/);
  assert.match(edgeHeaders, /frame-src 'none'/);
});
