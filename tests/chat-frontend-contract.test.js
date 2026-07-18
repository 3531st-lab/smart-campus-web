const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("chat assets are loaded before the application shell", () => {
  const html = read("public/index.html");
  const clientIndex = html.indexOf("/chat-client.js");
  const pageIndex = html.indexOf("/chat-page.js");
  const appIndex = html.indexOf("/app.js");

  assert.ok(html.includes("/assets/chat.css"));
  assert.ok(clientIndex >= 0);
  assert.ok(pageIndex > clientIndex);
  assert.ok(appIndex > pageIndex);
});

test("campus-life navigation and route delegate to the chat page", () => {
  const app = read("public/app.js");
  assert.match(app, /id:\s*["']chat["']/);
  assert.match(app, /async chat\(\)\s*\{/);
  assert.match(app, /CampusChatPage\.render/);
  assert.match(app, /id:\s*["']chat-admin["']/);
  assert.match(app, /renderAdmin/);
});

test("chat page keeps group list, messages, and details as independent regions", () => {
  const page = read("public/chat-page.js");
  assert.match(page, /chat-group-list/);
  assert.match(page, /chat-message-stage/);
  assert.match(page, /chat-detail-panel/);
  assert.match(page, /data-chat-send/);
  assert.match(page, /client\.selectGroup/);
  assert.match(page, /data-chat-appeal/);
  assert.match(page, /chat-admin-page/);
  assert.match(page, /data-chat-college-toggle/);
  assert.match(page, /collapsedColleges/);
});

test("chat client supports resilient optimistic delivery and visibility-aware polling", () => {
  const client = read("public/chat-client.js");
  assert.match(client, /clientRequestId/);
  assert.match(client, /optimistic/);
  assert.match(client, /document\.visibilityState/);
  assert.match(client, /5000/);
  assert.match(client, /30000/);
  assert.match(client, /mergeMessages/);
  assert.match(client, /async function markRead/);
  assert.match(client, /MAX_CACHED_MESSAGES/);
  assert.match(client, /tail=1/);
});

test("mobile chat keeps a single active pane instead of forcing a horizontal layout", () => {
  const css = read("public/assets/chat.css");
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /data-mobile-pane/);
});

test("desktop chat keeps a viewport-sized workspace with an independently scrolling college directory", () => {
  const css = read("public/assets/chat.css");
  assert.match(css, /height:\s*clamp\([^;]+100dvh/);
  assert.match(css, /\.chat-group-scroll\s*\{[^}]*flex:\s*1 1 0/s);
  assert.match(css, /\.chat-group-scroll,\s*\.chat-message-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.chat-college-group\.collapsed \.chat-group-items\s*\{\s*display:\s*none/);
});

test("chat view caps render work and keeps dialog focusable", () => {
  const page = read("public/chat-page.js");
  const css = read("public/assets/chat.css");
  assert.match(page, /MAX_RENDERED_MESSAGES/);
  assert.match(page, /tabindex="-1"/);
  assert.match(css, /chat-message-window-notice/);
});

test("chat governance isolates audit failures and keeps long management lists scrollable", () => {
  const page = read("public/chat-page.js");
  const css = read("public/assets/chat.css");
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /governanceResult\.status === "fulfilled"/);
  assert.match(page, /auditResult\.status === "fulfilled"/);
  assert.match(css, /\.chat-admin-list\s*\{[^}]*max-height:\s*460px[^}]*overflow:\s*auto/s);
  assert.match(css, /\.chat-admin-log\s*\{[^}]*max-height:\s*360px[^}]*overflow:\s*auto/s);
});

test("chat sticker panel can be explicitly hidden and dismissed through common controls", () => {
  const html = read("public/index.html");
  const page = read("public/chat-page.js");
  const css = read("public/assets/chat.css");

  assert.match(html, /\/assets\/chat\.css\?v=\d+/);
  assert.match(html, /\/chat-page\.js\?v=\d+/);
  assert.match(page, /function closeStickerPanel\(\)/);
  assert.match(page, /data-chat-sticker-close/);
  assert.match(page, /onStickerEscape/);
  assert.match(css, /\.chat-sticker-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("class member directory labels administrators without hiding their class identity", () => {
  const page = read("public/chat-page.js");
  assert.match(page, /const identityLabel = \{ admin: "普通管理员", super_admin: "总管理员" \}/);
  assert.match(page, /identityLabel\[member\.publicIdentity\]/);
});
