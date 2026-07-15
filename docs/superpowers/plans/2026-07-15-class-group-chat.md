# 班级分组与校园群聊 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立按“学校 + 学院 + 班级”分组的身份库、必建班级群、普通群聊、可靠消息、实时传输、随机二维码、冻结申诉和表情体系。

**Architecture:** MySQL 是班级、群、成员、消息和治理记录的唯一数据源；现有 Node REST API 负责鉴权与可靠写入，独立 Cloudflare Worker/Durable Object 负责 WebSocket 广播，客户端在实时通道不可用时使用消息序号增量轮询。服务端按领域拆分为班级存储、群聊存储、路由和实时发布模块，前端群聊页面与传输逻辑使用独立 ES 模块接入现有 SPA。

**Tech Stack:** Node.js 22、原生 HTTP/REST、MySQL 8/TiDB MySQL 协议、原生 JavaScript ES modules、Node test、Cloudflare Workers Durable Objects、Cloudflare R2 S3 API、现有 Vercel API 与 Cloudflare Pages 前端。

## Global Constraints

- 班级唯一键只使用规范化后的学校、学院和班级名称，专业不参与唯一性判断。
- 学生按身份信息自动归班；老师只有明确分配为班主任、任课老师或班级管理员后才入群。
- 平台角色、班级职务和群角色相互独立。
- 班级群不可由普通成员退出、转让或解散。
- 平台管理员治理班级群时不写入成员表，也不出现在成员名单和系统消息中。
- 所有状态正常的正式非游客账号都能创建普通群。
- 群号和随机二维码申请必须经群主或群管理员审核；指定邀请必须由被邀请人确认。
- 手机号、密码状态和内部管理字段不得通过群聊接口返回。
- 所有消息写入必须幂等，WebSocket 失败时自动降级为增量轮询。
- 基础表情使用 Unicode；网络图片表情只接入许可明确的来源并保存来源与许可信息。
- 每项任务只提交列出的文件，不提交现有无关未跟踪文件。

---

## File Structure

- Create `server/class-domain.js`: 班级键规范化、职务常量和稳定排序规则。
- Create `server/class-store.js`: 班级、班级分配、班级群同步和内存回退实现。
- Create `server/chat-store.js`: 群、成员、申请、邀请、消息、已读、申诉与表情持久化。
- Create `server/chat-routes.js`: 用户群聊和管理员治理 REST 路由，依赖注入现有 HTTP 辅助函数。
- Create `server/chat-realtime.js`: 实时连接令牌、内部事件签名和网关发布；未配置时安全跳过。
- Create `server/media-store.js`: 图片表情和附件对象存储接口，本地测试使用内存/临时文件适配器。
- Create `public/chat-client.js`: 群聊 API、WebSocket、轮询降级、重连和消息去重。
- Create `public/chat-page.js`: 群聊三栏/移动端页面、群创建、申请、成员和消息交互。
- Create `public/assets/chat.css`: 群聊独立主题、响应式布局和可访问状态。
- Create `realtime/wrangler.toml`: Cloudflare 实时网关配置。
- Create `realtime/src/index.js`: Durable Object WebSocket 频道与内部发布端点。
- Create `tests/class-domain.test.js`: 班级键、归班、职务和排序测试。
- Create `tests/chat-store.test.js`: 群成员、邀请、幂等消息、冻结申诉和游标测试。
- Create `tests/chat-api.test.js`: HTTP 鉴权、隐私、跨班隔离和降级测试。
- Create `tests/chat-frontend-contract.test.js`: 导航、模块接入、移动端结构和传输契约测试。
- Modify `server/schema.sql`: 新增班级与群聊相关表和索引。
- Modify `server/student-store.js`: 稳定班级排序、班级职务输入和同步钩子。
- Modify `server/index.js`: 初始化新存储、挂载群聊路由和调用班级同步。
- Modify `server/data.js`: 增加测试/本地内存群聊容器。
- Modify `public/app.js`: 新增“群聊”和管理员“群聊管理”导航，调用独立页面模块。
- Modify `public/index.html`: 加载群聊 ES 模块和样式版本。
- Modify `public/_headers`: 允许配置后的实时网关 `connect-src` 与对象存储图片域名。
- Modify `tests/run-all.js`: 注册新增测试。
- Modify `package.json`: 增加实时网关校验/部署脚本和对象存储依赖。
- Modify `.env.example`: 记录实时网关、内部签名和对象存储变量。

---

### Task 1: 班级领域规则与数据库迁移

**Files:**
- Create: `server/class-domain.js`
- Create: `tests/class-domain.test.js`
- Modify: `server/schema.sql`
- Modify: `server/student-store.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `normalizeClassPart(value): string`
- Produces: `classKey({ school, college, className }): string`
- Produces: `compareIdentityByClass(a, b): number`
- Produces: `CLASS_DUTIES` and `classDutyRank(duty): number`

- [ ] **Step 1: Write failing class-key and sort tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { classKey, compareIdentityByClass } = require("../server/class-domain");

test("class key ignores major and normalizes whitespace", () => {
  const a = classKey({ school: "泰州学院", college: "经济与管理学院", className: "24 数字经济", major: "数字经济" });
  const b = classKey({ school: " 泰州学院 ", college: "经济与管理学院", className: "24数字经济", major: "物流管理" });
  assert.equal(a, b);
});

test("identity sort keeps one class adjacent", () => {
  const rows = [
    { school: "泰州学院", college: "经济与管理学院", className: "B班", name: "乙", role: "student" },
    { school: "泰州学院", college: "经济与管理学院", className: "A班", name: "甲", role: "student" },
    { school: "泰州学院", college: "经济与管理学院", className: "A班", name: "丙", role: "student" }
  ].sort(compareIdentityByClass);
  assert.deepEqual(rows.map((row) => row.className), ["A班", "A班", "B班"]);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/class-domain.test.js`

Expected: FAIL with `Cannot find module '../server/class-domain'`.

- [ ] **Step 3: Implement class-domain helpers and schema**

```js
const CLASS_DUTIES = Object.freeze(["member", "monitor", "league_secretary", "class_admin", "head_teacher", "subject_teacher"]);
const DUTY_RANK = new Map(CLASS_DUTIES.map((duty, index) => [duty, index]));

function normalizeClassPart(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function classKey({ school, college, className }) {
  return [school, college, className].map(normalizeClassPart).join("\u001f");
}

function classDutyRank(duty) {
  return DUTY_RANK.get(duty) ?? DUTY_RANK.get("member");
}
```

Add `campus_classes`, `class_assignments`, and indexes to `server/schema.sql`. Change MySQL `listStudents` ordering from `updated_at DESC` to `school, college, class_name, role, name, student_no` with an explicit platform-role `CASE`; Task 3 will join the assignment table and add class-duty ordering after assignments exist.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/class-domain.test.js && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/class-domain.js server/schema.sql server/student-store.js tests/class-domain.test.js tests/run-all.js
git commit -m "feat: add class identity domain"
```

---

### Task 2: 班级存储、自动归班与强制班级群

**Files:**
- Create: `server/class-store.js`
- Create: `tests/class-store.test.js`
- Modify: `server/schema.sql`
- Modify: `server/data.js`
- Modify: `server/student-store.js`
- Modify: `server/index.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Consumes: `classKey`, `CLASS_DUTIES` from `server/class-domain.js`
- Produces: `ensureStudentClassAssignment(user): Promise<ClassSyncResult>`
- Produces: `assignTeacher({ userId, classId, duty, operatorId }): Promise<ClassAssignment>`
- Produces: `setStudentDuty({ userId, classId, duty, operatorId }): Promise<ClassAssignment>`
- Produces: `syncAllClasses({ dryRun }): Promise<ClassSyncSummary>`

- [ ] **Step 1: Write failing transactional sync tests**

```js
test("student moves from old class group to new class group atomically", async () => {
  const store = createMemoryClassStore(fixtures());
  await store.ensureStudentClassAssignment(fixtures().student);
  const moved = await store.ensureStudentClassAssignment({ ...fixtures().student, className: "24数字经济2班" });
  assert.equal(moved.activeAssignments.length, 1);
  assert.equal(moved.activeAssignments[0].className, "24数字经济2班");
});

test("teacher does not join from identity class alone", async () => {
  const store = createMemoryClassStore(fixtures());
  const result = await store.ensureStudentClassAssignment(fixtures().teacher);
  assert.equal(result.changed, false);
});
```

- [ ] **Step 2: Verify focused tests fail**

Run: `node --test tests/class-store.test.js`

Expected: FAIL because `server/class-store.js` does not exist.

- [ ] **Step 3: Implement MySQL and memory class synchronization**

Use a MySQL transaction with `SELECT ... FOR UPDATE` for a student, upsert the normalized class, deactivate old assignments, activate the new assignment, and ensure one `chat_groups.type='class'` row. Memory mode must expose the same return shape.

```js
async function ensureStudentClassAssignment(user) {
  if (user.role !== "student" || user.status !== "active") return { changed: false, activeAssignments: [] };
  if (![user.school, user.college, user.className].every((value) => String(value || "").trim())) {
    return { changed: false, incomplete: true, activeAssignments: [] };
  }
  return mysqlConfigured ? syncStudentMysql(user) : syncStudentMemory(user);
}
```

Call this hook after single-account upsert, batch import, status changes and class changes. Do not block account writes if synchronization fails; record a retryable sync error and return it to the admin response.

- [ ] **Step 4: Run class and regression tests**

Run: `node --test tests/class-domain.test.js tests/class-store.test.js && npm test`

Expected: PASS, including teacher non-auto-join and student move tests.

- [ ] **Step 5: Commit**

```powershell
git add server/class-store.js server/data.js server/student-store.js server/index.js tests/class-store.test.js tests/run-all.js
git commit -m "feat: synchronize mandatory class groups"
```

---

### Task 3: 身份库班级分组与班级职务管理

**Files:**
- Create: `tests/class-admin-api.test.js`
- Modify: `server/index.js`
- Modify: `server/class-store.js` (review fix: enforce one matching active student class)
- Modify: `server/student-store.js` (review fix: align import identity semantics)
- Modify: `public/app.js`
- Modify: `public/assets/styles.css`
- Modify: `public/assets/styles-v157.css`
- Modify: `tests/run-all.js`

**Interfaces:**
- Consumes: class-store assignment functions from Task 2
- Produces: `GET /api/admin/classes`
- Produces: `PUT /api/admin/classes/assignments`
- Produces: `POST /api/admin/classes/sync`
- Extends: `GET /api/admin/students` with `classId`, `classKey`, `classDuty`, and stable class order

- [ ] **Step 1: Write failing admin API tests**

Test that a normal admin can set student class duties and teacher assignments but cannot grant platform roles; a super admin has the same class-management abilities. Verify student responses remain phone-masked.

```js
assert.equal(updateResponse.status, 200);
assert.equal(updateBody.assignment.duty, "monitor");
assert.equal("phone" in updateBody.assignment.user, false);
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/class-admin-api.test.js`

Expected: FAIL with HTTP 404 for `/api/admin/classes`.

- [ ] **Step 3: Implement APIs and grouped identity UI**

Join the active `class_assignments` row for students and order by class duty before name. Add school/college/class filters, class group headings, counts, “接上页” markers, duty selectors and teacher assignment controls. Extend the import parser to accept `班级职务` and `关联班级`; invalid duty values return row-specific import errors.

```js
const dutyLabels = {
  member: "普通成员",
  monitor: "班长",
  league_secretary: "团支书",
  class_admin: "班级管理员",
  head_teacher: "班主任",
  subject_teacher: "任课老师"
};
```

- [ ] **Step 4: Run API, smoke and full tests**

Run: `node --test tests/class-admin-api.test.js tests/site-smoke.test.js && npm run check`

Expected: all checks PASS and current role filters/pagination remain functional.

- [ ] **Step 5: Commit**

```powershell
git add server/index.js public/app.js public/assets/styles.css public/assets/styles-v157.css tests/class-admin-api.test.js tests/run-all.js
git commit -m "feat: manage identities by class"
```

---

### Task 4: 群、成员、邀请与入群申请存储

**Files:**
- Create: `server/chat-store.js`
- Create: `tests/chat-store.test.js`
- Modify: `server/schema.sql`
- Modify: `server/data.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `createCustomGroup(input, owner): Promise<ChatGroup>`
- Produces: `listUserGroups(userId): Promise<ChatGroupSummary[]>`
- Produces: `getGroupForUser(groupId, user): Promise<AuthorizedGroup>`
- Produces: `createJoinRequest({ groupId, applicantId, source }): Promise<JoinRequest>`
- Produces: `reviewJoinRequest({ requestId, decision, reviewer }): Promise<JoinRequest>`
- Produces: `createInvite({ groupId, inviterId, inviteeId }): Promise<ChatInvite>`
- Produces: `acceptInvite({ inviteId, inviteeId }): Promise<ChatMember>`

- [ ] **Step 1: Write failing group permission tests**

Cover mandatory class membership, admin absence from class member rows, ordinary-group ownership, invitation confirmation, group-number review and cross-group denial.

```js
const classMembers = await store.listMembers(classGroup.id, classStudent);
assert.equal(classMembers.some((member) => member.userId === platformAdmin.id), false);
await assert.rejects(() => store.getGroupForUser(classGroup.id, otherClassStudent), /无权访问/);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/chat-store.test.js`

Expected: FAIL because chat storage is missing.

- [ ] **Step 3: Add schema and implement stores**

Create `chat_groups`, `chat_members`, `chat_join_requests`, `chat_invites`, and `chat_invite_tokens`. Generate public group numbers with at least 10 decimal digits and a uniqueness retry. Invitation tokens store only SHA-256 digests.

```js
function inviteTokenDigest(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/chat-store.test.js && npm test`

Expected: PASS in memory mode; schema contract checks PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/chat-store.js server/schema.sql server/data.js tests/chat-store.test.js tests/run-all.js
git commit -m "feat: add campus chat groups"
```

---

### Task 5: 消息、已读游标与可靠轮询 API

**Files:**
- Create: `server/chat-routes.js`
- Create: `tests/chat-api.test.js`
- Modify: `server/chat-store.js`
- Modify: `server/index.js`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `handleChatRoute(context): Promise<boolean>`
- Produces: `POST /api/chat/groups/:id/messages`
- Produces: `GET /api/chat/groups/:id/messages?after=<sequence>&limit=<1..100>`
- Produces: `PUT /api/chat/groups/:id/read-cursor`
- Produces: `GET /api/chat/groups`

- [ ] **Step 1: Write failing HTTP privacy and idempotency tests**

Test unauthenticated 401, cross-class 403, no phone leakage, duplicate `clientRequestId`, cursor pagination and frozen-group 423.

```js
const first = await postMessage({ clientRequestId: "req-001", text: "你好" });
const retry = await postMessage({ clientRequestId: "req-001", text: "你好" });
assert.equal(first.message.id, retry.message.id);
assert.equal(first.message.sequence, retry.message.sequence);
```

- [ ] **Step 2: Verify API tests fail**

Run: `node --test tests/chat-api.test.js`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement route module and message persistence**

Use a unique key on `(group_id, sender_id, client_request_id)` and allocate group sequence inside a transaction. Return member-safe user projections only.

```js
function publicChatUser(user, assignment) {
  return {
    id: user.id,
    name: user.name,
    avatarColor: user.avatarColor,
    identity: user.role === "teacher" ? "teacher" : "student",
    classDuty: assignment?.duty || "member"
  };
}
```

- [ ] **Step 4: Run API and full checks**

Run: `node --test tests/chat-api.test.js && npm run check`

Expected: PASS with no sensitive fields in chat responses.

- [ ] **Step 5: Commit**

```powershell
git add server/chat-routes.js server/chat-store.js server/index.js tests/chat-api.test.js tests/run-all.js
git commit -m "feat: add reliable group messaging api"
```

---

### Task 6: 群聊页面、导航与近实时客户端

**Files:**
- Create: `public/chat-client.js`
- Create: `public/chat-page.js`
- Create: `public/assets/chat.css`
- Create: `tests/chat-frontend-contract.test.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `window.CampusChatPage.render(context): PageResult`
- Produces: `createChatClient({ api, token, realtimeUrl, onEvent }): ChatClient`
- Consumes: Task 5 chat REST endpoints

- [ ] **Step 1: Write failing frontend contract tests**

Check that “群聊” appears under “校园生活”, class groups render before ordinary groups, the page contains independent list/message/detail regions, message stage uses cursor history, and mobile CSS switches to one active pane.

```js
assert.match(appSource, /id:\s*["']chat["']/);
assert.match(chatPageSource, /chat-group-list/);
assert.match(chatPageSource, /chat-message-stage/);
assert.match(chatCss, /@media\s*\(max-width:\s*760px\)/);
```

- [ ] **Step 2: Verify contract tests fail**

Run: `node --test tests/chat-frontend-contract.test.js`

Expected: FAIL because chat frontend files are absent.

- [ ] **Step 3: Implement desktop and mobile chat UI**

Implement optimistic messages, failure retry, top-scroll history loading, read cursor updates, independent pane scrolling and visibility-aware polling. The client must merge by message ID and sequence.

```js
function pollDelay() {
  return document.visibilityState === "visible" ? 5000 : 30000;
}
```

Load `/chat-client.js` and `/chat-page.js` before `/app.js`, and delegate the `chat` route to `window.CampusChatPage.render`.

- [ ] **Step 4: Run contract and full checks**

Run: `node --test tests/chat-frontend-contract.test.js tests/site-smoke.test.js && npm run check`

Expected: PASS; no missing assets or syntax errors.

- [ ] **Step 5: Commit**

```powershell
git add public/chat-client.js public/chat-page.js public/assets/chat.css public/app.js public/index.html tests/chat-frontend-contract.test.js tests/run-all.js
git commit -m "feat: add campus group chat interface"
```

---

### Task 7: 普通群创建、群号搜索与随机二维码

**Files:**
- Modify: `server/chat-routes.js`
- Modify: `server/chat-store.js`
- Modify: `public/chat-page.js`
- Modify: `public/assets/chat.css`
- Modify: `tests/chat-api.test.js`

**Interfaces:**
- Produces: `POST /api/chat/groups`
- Produces: `GET /api/chat/search?groupNo=<value>`
- Produces: `POST /api/chat/groups/:id/invite-token`
- Produces: `DELETE /api/chat/groups/:id/invite-token/:tokenId`
- Produces: `POST /api/chat/join-requests`
- Produces: `PUT /api/chat/join-requests/:id`

- [ ] **Step 1: Add failing invite lifecycle tests**

Cover 7-day expiry, one-time token consumption, token refresh invalidating the previous token, application review and limited group search response.

```js
assert.deepEqual(Object.keys(searchResult.group).sort(), ["avatar", "id", "memberCount", "name", "type"]);
assert.equal(oldTokenResponse.status, 404);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test --test-name-pattern="invite|二维码|群号" tests/chat-api.test.js`

Expected: FAIL with missing endpoints.

- [ ] **Step 3: Implement group creation and join flows**

Use the audited `qrcode` npm package in the Node API to return a sanitized SVG generated from the opaque invite URL; the browser never builds a QR from member data. Add create-group, group-number search, invitation inbox and request-review dialogs.

```js
const svg = await QRCode.toString(inviteUrl, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  width: 320
});
```

- [ ] **Step 4: Run chat tests and full checks**

Run: `node --test tests/chat-api.test.js tests/chat-frontend-contract.test.js && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/chat-routes.js server/chat-store.js public/chat-page.js public/assets/chat.css tests/chat-api.test.js package.json package-lock.json
git commit -m "feat: add reviewed group joining"
```

---

### Task 8: 冻结、申诉与隐身治理后台

**Files:**
- Modify: `server/schema.sql`
- Modify: `server/chat-store.js`
- Modify: `server/chat-routes.js`
- Modify: `public/app.js`
- Modify: `public/chat-page.js`
- Modify: `public/assets/chat.css`
- Modify: `tests/chat-api.test.js`

**Interfaces:**
- Produces: `PUT /api/admin/chat/groups/:id/status`
- Produces: `GET /api/admin/chat/groups`
- Produces: `POST /api/chat/groups/:id/appeals`
- Produces: `PUT /api/admin/chat/appeals/:id`
- Produces: `GET /api/admin/chat/audit-logs`

- [ ] **Step 1: Add failing freeze and invisible-admin tests**

Test that frozen groups reject message/invite writes, preserve history, accept one active appeal, and never add the reviewing platform administrator to members or system messages.

- [ ] **Step 2: Verify tests fail**

Run: `node --test --test-name-pattern="冻结|申诉|隐身" tests/chat-api.test.js`

Expected: FAIL with missing governance routes.

- [ ] **Step 3: Implement governance state machine and pages**

Allowed transitions are `active -> frozen -> active|closed`; appeals use `submitted -> reviewing -> approved|rejected`. Reject invalid transitions with HTTP 409. Add “群聊管理” under permission management and an appeal panel for frozen group owners.

```js
const GROUP_TRANSITIONS = Object.freeze({ active: new Set(["frozen"]), frozen: new Set(["active", "closed"]), closed: new Set() });
const APPEAL_TRANSITIONS = Object.freeze({ submitted: new Set(["reviewing"]), reviewing: new Set(["approved", "rejected"]), approved: new Set(), rejected: new Set() });
```

- [ ] **Step 4: Run governance and regression tests**

Run: `node --test tests/chat-api.test.js && npm run check`

Expected: PASS and audit rows contain operator, action, target and timestamp.

- [ ] **Step 5: Commit**

```powershell
git add server/schema.sql server/chat-store.js server/chat-routes.js public/app.js public/chat-page.js public/assets/chat.css tests/chat-api.test.js
git commit -m "feat: add chat governance and appeals"
```

---

### Task 9: 基础表情、图片表情与合规来源

**Files:**
- Create: `server/media-store.js`
- Modify: `server/schema.sql`
- Modify: `server/chat-store.js`
- Modify: `server/chat-routes.js`
- Modify: `public/chat-page.js`
- Modify: `public/assets/chat.css`
- Modify: `tests/chat-api.test.js`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `saveImage({ ownerId, bytes, mimeType, source }): Promise<MediaObject>`
- Produces: `POST /api/chat/stickers`
- Produces: `GET /api/chat/stickers`
- Produces: `POST /api/chat/stickers/:id/favorite`
- Produces: `GET /api/chat/sticker-sources/search?q=<query>`
- Produces: `POST /api/chat/reports`

- [ ] **Step 1: Add failing media safety tests**

Test MIME spoofing, size limits, blocked SHA-256 digest, source-license requirement, favorites ownership and no direct remote hotlinks.

- [ ] **Step 2: Verify media tests fail**

Run: `node --test --test-name-pattern="表情|图片|许可" tests/chat-api.test.js`

Expected: FAIL with missing sticker endpoints.

- [ ] **Step 3: Implement media adapter and emoji panels**

Use Unicode data for base emoji. Use `sharp` to convert accepted raster uploads to a maximum 512x512 WebP with metadata removed. Store objects through `@aws-sdk/client-s3` against the R2 S3 endpoint, save only metadata in MySQL, and require `{ sourceUrl, author, license }` for network stickers. Only configured allowlisted source adapters can return search results.

```js
const webp = await sharp(bytes, { animated: true, limitInputPixels: 16_777_216 })
  .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82 })
  .toBuffer();
```

- [ ] **Step 4: Run media, security and full checks**

Run: `node --test tests/chat-api.test.js tests/security-policy.test.js && npm run check`

Expected: PASS with no hotlinked third-party image URL in message responses.

- [ ] **Step 5: Commit**

```powershell
git add server/media-store.js server/schema.sql server/chat-store.js server/chat-routes.js public/chat-page.js public/assets/chat.css tests/chat-api.test.js .env.example package.json package-lock.json
git commit -m "feat: add safe campus chat stickers"
```

---

### Task 10: Cloudflare WebSocket 实时网关

**Files:**
- Create: `server/chat-realtime.js`
- Create: `realtime/wrangler.toml`
- Create: `realtime/src/index.js`
- Create: `tests/chat-realtime.test.js`
- Modify: `server/chat-routes.js`
- Modify: `server/index.js`
- Modify: `public/chat-client.js`
- Modify: `public/_headers`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `tests/run-all.js`

**Interfaces:**
- Produces: `createRealtimeToken({ userId, groupId, expiresAt }): string`
- Produces: `publishRealtimeEvent(groupId, event): Promise<{ delivered: boolean }>`
- Produces: Worker `GET /groups/:groupId/connect?token=...`
- Produces: Worker `POST /internal/groups/:groupId/events`

- [ ] **Step 1: Write failing token and fallback tests**

Test token expiry, group binding, internal signature replay protection, WebSocket reconnect and polling fallback without duplicate events.

```js
assert.equal(verifyRealtimeToken(token, { groupId: "wrong-group" }), null);
assert.deepEqual(mergeEvents(existing, [duplicate, newEvent]).map((event) => event.sequence), [1, 2]);
```

- [ ] **Step 2: Verify realtime tests fail**

Run: `node --test tests/chat-realtime.test.js`

Expected: FAIL because realtime modules do not exist.

- [ ] **Step 3: Implement signed gateway and hibernatable Durable Object**

The REST API signs short-lived connection tokens and internal publish requests with separate secrets. The Durable Object accepts authenticated sockets, broadcasts persisted events, and never writes chat content as the source of truth. The client uses exponential reconnect and resumes from the last confirmed sequence.

```js
export class ChatRoom {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.headers.get("upgrade") !== "WebSocket") return new Response("Upgrade required", { status: 426 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
```

- [ ] **Step 4: Validate worker and fallback**

Run: `npx wrangler deploy --dry-run --config realtime/wrangler.toml && node --test tests/chat-realtime.test.js && npm run check`

Expected: worker dry-run succeeds and all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/chat-realtime.js server/chat-routes.js server/index.js public/chat-client.js public/_headers realtime .env.example package.json package-lock.json tests/chat-realtime.test.js tests/run-all.js
git commit -m "feat: add realtime chat gateway"
```

---

### Task 11: 性能、移动端视觉与完整回归

**Files:**
- Create: `tests/chat-load.test.js`
- Modify: `public/chat-page.js`
- Modify: `public/assets/chat.css`
- Modify: `server/chat-store.js`
- Modify: `tests/site-smoke.test.js`
- Modify: `tests/run-all.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: all chat APIs and client modules
- Produces: bounded message rendering, documented deployment variables and operational checks

- [ ] **Step 1: Add failing load and browser-contract tests**

Create 10,000 in-memory messages and assert a 50-message cursor page, stable sequence order and no offset-based query contract. Add mobile/desktop DOM assertions for one active pane and independent scroll containers.

- [ ] **Step 2: Verify load tests expose remaining issues**

Run: `node --test tests/chat-load.test.js tests/chat-frontend-contract.test.js`

Expected: initial FAIL until cursor and render-window limits are enforced.

- [ ] **Step 3: Apply performance and accessibility fixes**

Limit DOM messages to the active window plus buffer, use `IntersectionObserver` for top-history loading, pause background media, keep focus in dialogs, add live regions for send status, and document deployment variables and migration order.

```js
const MAX_RENDERED_MESSAGES = 160;
function boundedMessages(messages) {
  return messages.slice(Math.max(0, messages.length - MAX_RENDERED_MESSAGES));
}
```

- [ ] **Step 4: Run complete validation**

Run: `npm run check`

Expected: syntax checks and all Node tests PASS.

Run: `npx playwright test` if the repository browser suite is available; otherwise use the existing in-app browser to verify `#student-admin`, `#chat`, and `#chat-admin` at 390x844 and 1440x900.

Expected: no overlap, horizontal page scroll, inaccessible dialog or blank panel.

- [ ] **Step 5: Commit**

```powershell
git add tests/chat-load.test.js tests/site-smoke.test.js tests/run-all.js public/chat-page.js public/assets/chat.css server/chat-store.js README.md
git commit -m "test: harden campus chat workflows"
```

---

### Task 12: 数据迁移、灰度发布与部署验证

**Files:**
- Create: `scripts/sync-class-groups.js`
- Create: `docs/operations/class-chat-rollout.md`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `npm run classes:sync -- --dry-run`
- Produces: `npm run classes:sync -- --apply`
- Produces: deployment and rollback runbook

- [ ] **Step 1: Write failing dry-run contract test**

Assert that dry-run reports classes, students, teacher assignments, incomplete identities and planned groups without writing state.

- [ ] **Step 2: Implement migration script and runbook**

Require explicit `--apply` for writes. The runbook must list schema deployment, dry run, approval, class sync, REST release, realtime release, media release, monitoring and rollback commands.

```js
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run") || !apply;
if (apply && process.env.CONFIRM_CLASS_SYNC !== "YES") throw new Error("Set CONFIRM_CLASS_SYNC=YES before applying class synchronization");
```

- [ ] **Step 3: Run local dry run and complete checks**

Run: `npm run classes:sync -- --dry-run && npm run check`

Expected: summary prints without data mutation and all checks PASS.

- [ ] **Step 4: Deploy in dependency order**

Run the schema migration, deploy Vercel API, deploy Cloudflare realtime Worker, deploy Cloudflare Pages frontend, then set `CHAT_REALTIME_URL` and internal secrets. Keep polling enabled until the realtime health check passes.

- [ ] **Step 5: Verify production**

Verify one student class group, one teacher assignment, one custom group, invitation review, duplicate send retry, WebSocket disconnect fallback, freeze appeal and member privacy. Record URLs, build IDs and smoke results in the runbook.

- [ ] **Step 6: Commit operational artifacts**

```powershell
git add scripts/sync-class-groups.js docs/operations/class-chat-rollout.md package.json .env.example
git commit -m "ops: add class chat rollout tooling"
```
