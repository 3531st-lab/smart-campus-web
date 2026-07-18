const crypto = require("node:crypto");
const data = require("./data");
const { mysqlConfigured, getPool } = require("./db");

const PLATFORM_ROLES = new Set(["admin", "super_admin"]);
const CLASS_ADMIN_DUTIES = new Set(["monitor", "league_secretary", "class_admin", "head_teacher"]);
const GROUP_ADMIN_ROLES = new Set(["owner", "admin"]);
const JOIN_SOURCES = new Set(["group_number", "qr"]);
const GROUP_NUMBER_ATTEMPTS = 20;
const INVITE_TOKEN_BYTES = 32;
const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_TRANSITIONS = Object.freeze({
  active: new Set(["frozen"]),
  frozen: new Set(["active", "closed"]),
  closed: new Set()
});
const APPEAL_TRANSITIONS = Object.freeze({
  submitted: new Set(["reviewing"]),
  reviewing: new Set(["approved", "rejected"]),
  approved: new Set(),
  rejected: new Set()
});
const BASE_EMOJIS = Object.freeze(["😀", "😁", "😂", "😊", "😍", "🤔", "😭", "😡", "👍", "👎", "👏", "🙏", "🎉", "💪", "❤️", "🌟", "📚", "☕"]);

class PublicChatError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function publicError(message, statusCode = 400) {
  return new PublicChatError(message, statusCode);
}

function inviteTokenDigest(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function userIdOf(userOrId) {
  return String(typeof userOrId === "object" ? userOrId?.id : userOrId || "");
}

function sameClassIdentity(account, campusClass) {
  const accountClass = String(account?.className ?? account?.class_name ?? "").trim();
  const className = String(campusClass?.className ?? campusClass?.class_name ?? "").trim();
  return Boolean(accountClass)
    && String(account?.school || "").trim() === String(campusClass?.school || "").trim()
    && String(account?.college || "").trim() === String(campusClass?.college || "").trim()
    && accountClass === className;
}

function defaultInviteToken() {
  return crypto.randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

function inviteExpiry(expiresAt) {
  if (expiresAt !== null && expiresAt !== undefined && String(expiresAt).trim()) {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) throw publicError("邀请有效期无效");
    return parsed.toISOString();
  }
  return new Date(Date.now() + DEFAULT_INVITE_TTL_MS).toISOString();
}

function hasExpired(expiresAt) {
  if (!expiresAt) return false;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

function defaultGroupNumber() {
  const minimum = 1_000_000_000n;
  const range = 9_000_000_000n;
  const random = BigInt(`0x${crypto.randomBytes(8).toString("hex")}`);
  return String(minimum + (random % range));
}

function requiredText(value, message) {
  const normalized = String(value || "").trim();
  if (!normalized) throw publicError(message);
  return normalized;
}

function requiredActiveUser(users, userOrId) {
  const id = userIdOf(userOrId);
  const user = users.find((item) => String(item.id) === id);
  if (!user || user.status !== "active" || user.role === "guest") throw publicError("账号不可用", 403);
  return user;
}

function safeGroup(row) {
  if (!row) return null;
  const disabled = row.status === "disabled";
  const closed = row.status === "closed";
  const frozen = !disabled && (closed || Boolean(row.frozen) || row.status === "frozen");
  return {
    id: String(row.id),
    type: row.type,
    classId: row.class_id ?? row.classId ?? null,
    publicNo: row.public_no ?? row.publicNo ?? null,
    name: row.name,
    ownerId: row.owner_id ?? row.ownerId ?? null,
    status: disabled ? "disabled" : (closed ? "closed" : (frozen ? "frozen" : (row.status || "active"))),
    frozen,
    description: row.description || "",
    joinPolicy: row.join_policy ?? row.joinPolicy ?? "review"
  };
}

function safeAppeal(row) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    appellantId: String(row.appellant_id ?? row.appellantId),
    reason: row.reason || "",
    status: row.status,
    reviewerId: row.reviewer_id ?? row.reviewerId ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null
  };
}

function safeAuditLog(row) {
  const rawMetadata = row.metadata ?? row.metadata_json ?? null;
  let metadata = rawMetadata;
  if (typeof rawMetadata === "string") {
    try {
      metadata = JSON.parse(rawMetadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row.id),
    operatorId: String(row.operator_id ?? row.operatorId),
    action: row.action,
    targetType: row.target_type ?? row.targetType,
    targetId: String(row.target_id ?? row.targetId),
    createdAt: row.created_at ?? row.createdAt ?? null,
    metadata
  };
}

function safeMember(row, user) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    userId: String(row.user_id ?? row.userId),
    role: row.role || "member",
    classDuty: row.class_duty ?? row.classDuty ?? null,
    joinedVia: row.joined_via ?? row.joinedVia ?? "unknown",
    active: row.active === undefined ? true : Boolean(row.active),
    name: user?.name || row.name || "",
    avatarColor: user?.avatarColor ?? user?.avatar_color ?? row.avatar_color ?? null,
    publicIdentity: user?.role || row.user_role || null
  };
}

function safeJoinRequest(row) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    applicantId: String(row.applicant_id ?? row.applicantId),
    source: row.source,
    status: row.status,
    reviewerId: row.reviewer_id ?? row.reviewerId ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null
  };
}

function safeInvite(row) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    inviterId: String(row.inviter_id ?? row.inviterId),
    inviteeId: String(row.invitee_id ?? row.inviteeId),
    status: row.status,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    acceptedAt: row.accepted_at ?? row.acceptedAt ?? null
  };
}

function safeInviteToken(row) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    creatorId: String(row.creator_id ?? row.creatorId),
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    maxUses: Number(row.max_uses ?? row.maxUses ?? 1),
    useCount: Number(row.use_count ?? row.useCount ?? 0),
    revoked: Boolean(row.revoked)
  };
}

function safeSticker(row, favorite = false) {
  if (!row) return null;
  return {
    id: String(row.id ?? row.sticker_id),
    kind: "image",
    name: row.name ?? row.sticker_name ?? "图片表情",
    url: row.url ?? row.public_url ?? row.sticker_public_url ?? "",
    mimeType: row.mimeType ?? row.mime_type ?? row.sticker_mime_type ?? "image/webp",
    favorite: Boolean(favorite ?? row.favorite)
  };
}

function safeReport(row) {
  return {
    id: String(row.id),
    targetType: row.target_type ?? row.targetType,
    targetId: String(row.target_id ?? row.targetId),
    status: row.status,
    createdAt: row.created_at ?? row.createdAt ?? null
  };
}

function publicChatUser(user, assignment = null) {
  return {
    id: String(user?.id ?? ""),
    name: user?.name || "",
    avatarColor: user?.avatarColor ?? user?.avatar_color ?? null,
    identity: user?.role === "teacher" ? "teacher" : "student",
    classDuty: assignment?.duty ?? assignment?.class_duty ?? "member"
  };
}

function safeMessage(row, user, assignment = null, sticker = null) {
  return {
    id: String(row.id),
    groupId: String(row.group_id ?? row.groupId),
    sequence: Number(row.sequence),
    clientRequestId: row.client_request_id ?? row.clientRequestId ?? null,
    text: row.text || "",
    sticker: sticker || (row.sticker ? safeSticker(row.sticker, row.sticker.favorite) : (row.sticker_id ? safeSticker(row, row.favorite) : null)),
    createdAt: row.created_at ?? row.createdAt ?? null,
    sender: publicChatUser(user || row, assignment || row)
  };
}

function normalizeMessageText(value, stickerId = "") {
  const text = String(value || "").trim();
  if (!text && !String(stickerId || "").trim()) throw publicError("消息不能为空");
  if (text.length > 4000) throw publicError("消息长度不能超过 4000 个字符");
  return text;
}

function normalizeStickerId(value) {
  const id = String(value || "").trim();
  if (!id) return "";
  if (!/^chat-sticker-[A-Za-z0-9-]{8,128}$/.test(id)) throw publicError("表情标识无效");
  return id;
}

function normalizeStickerName(value) {
  const name = requiredText(value, "请填写表情名称");
  if (name.length > 80) throw publicError("表情名称不能超过 80 个字符");
  return name;
}

function normalizeReportReason(value) {
  const reason = requiredText(value, "请填写举报原因");
  if (reason.length > 1000) throw publicError("举报原因不能超过 1000 个字符");
  return reason;
}

function normalizeClientRequestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) throw publicError("消息请求标识无效");
  return id;
}

function normalizeAfter(value) {
  const parsed = Number(value || 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw publicError("消息游标无效");
  return parsed;
}

function normalizeLimit(value, fallback = 50) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw publicError("消息数量范围无效");
  return parsed;
}

function groupAccessShape(group, membership, governance = false) {
  return {
    ...safeGroup(group),
    membership: membership ? safeMember(membership) : null,
    governance,
    canWrite: group.status === "active" && !group.frozen
  };
}

function createMemoryChatStore(seed = {}, options = {}) {
  const store = {
    data: {
      users: seed.users || [],
      classes: seed.classes || seed.campusClasses || [],
      assignments: seed.assignments || seed.classAssignments || [],
      groups: seed.groups || seed.chatGroups || [],
      members: seed.members || seed.chatMembers || [],
      joinRequests: seed.joinRequests || seed.chatJoinRequests || [],
      invites: seed.invites || seed.chatInvites || [],
      inviteTokens: seed.inviteTokens || seed.chatInviteTokens || [],
      messages: seed.messages || seed.chatMessages || [],
      media: seed.media || seed.chatMedia || [],
      stickers: seed.stickers || seed.chatStickers || [],
      stickerFavorites: seed.stickerFavorites || seed.chatStickerFavorites || [],
      reports: seed.reports || seed.chatReports || [],
      readCursors: seed.readCursors || seed.chatReadCursors || [],
      appeals: seed.appeals || seed.chatAppeals || [],
      auditLogs: seed.auditLogs || seed.chatAuditLogs || []
    }
  };
  const groupNumberGenerator = options.groupNumberGenerator || defaultGroupNumber;
  const inviteTokenGenerator = options.inviteTokenGenerator || defaultInviteToken;

  function user(userOrId) {
    return requiredActiveUser(store.data.users, userOrId);
  }

  function group(groupId) {
    const found = store.data.groups.find((item) => String(item.id) === String(groupId));
    if (!found) throw publicError("群聊不存在");
    return found;
  }

  function availableGroup(groupId, { writable = false } = {}) {
    const found = group(groupId);
    if (found.status === "disabled") throw publicError("群聊不可用", 403);
    if (found.status === "closed") throw publicError("群聊已关闭", 403);
    if (writable && (found.status === "frozen" || found.frozen)) throw publicError("群聊已冻结", 423);
    return found;
  }

  function member(groupId, userId) {
    return store.data.members.find((item) => (
      String(item.groupId ?? item.group_id) === String(groupId)
      && String(item.userId ?? item.user_id) === String(userId)
      && item.active !== false
    ));
  }

  function classAssignment(groupItem, userId) {
    if (groupItem.type !== "class") return null;
    return store.data.assignments.find((item) => (
      String(item.classId ?? item.class_id) === String(groupItem.classId ?? groupItem.class_id)
      && String(item.userId ?? item.user_id) === String(userId)
      && item.active !== false
    ));
  }

  function classMember(groupItem, assignment) {
    const assignedUser = store.data.users.find((item) => String(item.id) === String(assignment.userId ?? assignment.user_id));
    if (!assignedUser || assignedUser.status !== "active" || PLATFORM_ROLES.has(assignedUser.role) || assignedUser.role === "guest") return null;
    const duty = assignment.duty || "member";
    return safeMember({
      id: `class:${groupItem.id}:${assignedUser.id}`,
      groupId: groupItem.id,
      userId: assignedUser.id,
      role: CLASS_ADMIN_DUTIES.has(duty) ? "admin" : "member",
      classDuty: duty,
      joinedVia: "class_assignment",
      active: true
    }, assignedUser);
  }

  function customMembership(groupId, userId) {
    return member(groupId, userId);
  }

  function nextGroupNumber() {
    for (let attempt = 0; attempt < GROUP_NUMBER_ATTEMPTS; attempt += 1) {
      const candidate = String(groupNumberGenerator());
      if (!/^\d{10,}$/.test(candidate)) continue;
      if (!store.data.groups.some((item) => String(item.publicNo ?? item.public_no) === candidate)) return candidate;
    }
    throw publicError("群号生成失败，请稍后重试");
  }

  async function createCustomGroup(input, owner) {
    const creator = user(owner);
    const created = {
      id: `group-${crypto.randomUUID()}`,
      type: "custom",
      classId: null,
      publicNo: nextGroupNumber(),
      name: requiredText(input?.name, "群名称不能为空"),
      ownerId: creator.id,
      status: "active",
      frozen: false,
      description: String(input?.description || "").trim(),
      joinPolicy: "review"
    };
    const ownerMember = {
      id: `chat-member-${crypto.randomUUID()}`,
      groupId: created.id,
      userId: creator.id,
      role: "owner",
      joinedVia: "created",
      active: true
    };
    store.data.groups.push(created);
    store.data.members.push(ownerMember);
    return safeGroup(created);
  }

  async function listUserGroups(userId) {
    const account = store.data.users.find((item) => String(item.id) === String(userId));
    if (!account || account.status !== "active" || account.role === "guest") return [];
    const classIds = new Set(store.data.assignments
      .filter((item) => String(item.userId ?? item.user_id) === String(userId) && item.active !== false)
      .map((item) => String(item.classId ?? item.class_id)));
    if (PLATFORM_ROLES.has(account.role)) {
      store.data.classes
        .filter((campusClass) => campusClass.status !== "disabled" && sameClassIdentity(account, campusClass))
        .forEach((campusClass) => classIds.add(String(campusClass.id)));
    }
    const memberGroupIds = new Set(store.data.members
      .filter((item) => String(item.userId ?? item.user_id) === String(userId) && item.active !== false)
      .map((item) => String(item.groupId ?? item.group_id)));
    return store.data.groups
      .filter((item) => item.status !== "disabled")
      .filter((item) => (
        (item.type === "class" && classIds.has(String(item.classId ?? item.class_id)))
        || (item.type !== "class" && memberGroupIds.has(String(item.id)))
      ))
      .map(safeGroup)
      .sort((left, right) => Number(right.type === "class") - Number(left.type === "class") || left.name.localeCompare(right.name, "zh-CN"));
  }

  async function searchGroupByNumber(groupNumber, viewerId) {
    user(viewerId);
    const publicNo = requiredText(groupNumber, "请输入群号");
    const found = store.data.groups.find((item) => (
      item.type === "custom"
      && String(item.publicNo ?? item.public_no) === publicNo
      && item.status !== "disabled"
    ));
    if (!found) throw publicError("未找到可加入的群聊", 404);
    const memberCount = store.data.members.filter((item) => (
      String(item.groupId ?? item.group_id) === String(found.id) && item.active !== false
    )).length;
    return { id: String(found.id), name: found.name, type: "custom", avatar: "", memberCount };
  }

  async function getGroupForUser(groupId, accountInput) {
    const account = user(accountInput);
    const found = availableGroup(groupId);
    if (found.type === "class") {
      if (PLATFORM_ROLES.has(account.role)) return groupAccessShape(found, null, true);
      const assignment = classAssignment(found, account.id);
      const derived = assignment ? classMember(found, assignment) : null;
      if (!derived) throw publicError("无权访问该群聊", 403);
      return groupAccessShape(found, derived, false);
    }
    const membership = customMembership(found.id, account.id);
    if (!membership) throw publicError("无权访问该群聊", 403);
    return groupAccessShape(found, membership, false);
  }

  async function listMembers(groupId, requester) {
    const access = await getGroupForUser(groupId, requester);
    const found = group(groupId);
    if (found.type === "class") {
      return store.data.assignments
        .filter((assignment) => String(assignment.classId ?? assignment.class_id) === String(found.classId ?? found.class_id) && assignment.active !== false)
        .map((assignment) => classMember(found, assignment))
        .filter(Boolean)
        .sort((left, right) => ({ admin: 0, member: 1 }[left.role] - { admin: 0, member: 1 }[right.role]) || left.name.localeCompare(right.name, "zh-CN"));
    }
    if (!access.membership) throw publicError("无权访问该群聊");
    return store.data.members
      .filter((item) => String(item.groupId ?? item.group_id) === String(found.id) && item.active !== false)
      .map((item) => safeMember(item, store.data.users.find((entry) => String(entry.id) === String(item.userId ?? item.user_id))))
      .sort((left, right) => ({ owner: 0, admin: 1, member: 2 }[left.role] - { owner: 0, admin: 1, member: 2 }[right.role]) || left.name.localeCompare(right.name, "zh-CN"));
  }

  function requiredGroupAdmin(groupId, reviewer, errorMessage) {
    const account = user(reviewer);
    const membership = member(groupId, account.id);
    if (!membership || !GROUP_ADMIN_ROLES.has(membership.role)) throw publicError(errorMessage, 403);
    return account;
  }

  function requiredPlatformAdmin(actor, errorMessage = "仅平台管理员可以管理群聊") {
    const account = user(actor);
    if (!PLATFORM_ROLES.has(account.role)) throw publicError(errorMessage, 403);
    return account;
  }

  function addAuditLog({ operatorId, action, targetType, targetId, metadata = null }) {
    const row = {
      id: `chat-audit-${crypto.randomUUID()}`,
      operatorId: String(operatorId),
      action,
      targetType,
      targetId: String(targetId),
      metadata,
      createdAt: new Date().toISOString()
    };
    store.data.auditLogs.push(row);
    return safeAuditLog(row);
  }

  function ensureCustomWritable(groupId) {
    const found = availableGroup(groupId, { writable: true });
    if (found.type === "class") throw publicError("班级群成员由班级身份同步");
    return found;
  }

  function addMember(groupId, userId, joinedVia) {
    let existing = store.data.members.find((item) => String(item.groupId ?? item.group_id) === String(groupId) && String(item.userId ?? item.user_id) === String(userId));
    if (!existing) {
      existing = { id: `chat-member-${crypto.randomUUID()}`, groupId, userId, role: "member", joinedVia, active: true };
      store.data.members.push(existing);
    } else {
      existing.active = true;
      existing.role = existing.role || "member";
      existing.joinedVia = joinedVia;
    }
    return safeMember(existing, store.data.users.find((entry) => String(entry.id) === String(userId)));
  }

  function verifyJoinSource(found, source, input) {
    if (!JOIN_SOURCES.has(source)) throw publicError("入群来源无效");
    if (source === "group_number") {
      const groupNumber = requiredText(input?.groupNumber ?? input?.proof, "请提供正确群号");
      if (groupNumber !== String(found.publicNo ?? found.public_no)) throw publicError("群号与目标群不一致");
      return null;
    }
    const token = requiredText(input?.token ?? input?.proof, "请提供有效二维码凭证");
    const digest = inviteTokenDigest(token);
    const tokenRow = store.data.inviteTokens.find((item) => item.tokenDigest === digest);
    if (!tokenRow || String(tokenRow.groupId ?? tokenRow.group_id) !== String(found.id)) throw publicError("二维码凭证无效");
    if (tokenRow.revoked || hasExpired(tokenRow.expiresAt ?? tokenRow.expires_at) || Number(tokenRow.useCount ?? tokenRow.use_count ?? 0) >= Number(tokenRow.maxUses ?? tokenRow.max_uses ?? 1)) {
      throw publicError("二维码凭证已失效");
    }
    return tokenRow;
  }

  async function createJoinRequest(input = {}) {
    const { applicantId, source } = input;
    let groupId = input.groupId;
    if (source === "qr" && !groupId) {
      const token = requiredText(input?.token ?? input?.proof, "请提供有效二维码凭证");
      const tokenRow = store.data.inviteTokens.find((item) => item.tokenDigest === inviteTokenDigest(token));
      groupId = tokenRow?.groupId ?? tokenRow?.group_id;
    }
    const found = ensureCustomWritable(groupId);
    const applicant = user(applicantId);
    if (!JOIN_SOURCES.has(source)) throw publicError("入群来源无效");
    if (member(groupId, applicant.id)) throw publicError("已经是群成员");
    const pending = store.data.joinRequests.find((item) => String(item.groupId ?? item.group_id) === String(groupId)
      && String(item.applicantId ?? item.applicant_id) === String(applicant.id) && item.status === "pending");
    if (pending) return safeJoinRequest(pending);
    const tokenRow = verifyJoinSource(found, source, input);
    const request = {
      id: `join-request-${crypto.randomUUID()}`,
      groupId,
      applicantId: applicant.id,
      source,
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      pendingKey: `${groupId}:${applicant.id}`
    };
    store.data.joinRequests.push(request);
    if (tokenRow) tokenRow.useCount = Number(tokenRow.useCount ?? tokenRow.use_count ?? 0) + 1;
    return safeJoinRequest(request);
  }

  async function reviewJoinRequest({ requestId, decision, reviewer }) {
    if (!["approved", "rejected"].includes(decision)) throw publicError("审核决定无效");
    const request = store.data.joinRequests.find((item) => String(item.id) === String(requestId));
    if (!request) throw publicError("入群申请不存在");
    ensureCustomWritable(request.groupId ?? request.group_id);
    const account = requiredGroupAdmin(request.groupId ?? request.group_id, reviewer, "无权审核该申请");
    if (request.status !== "pending") {
      if (request.status !== decision) throw publicError("入群申请已处理");
      return safeJoinRequest(request);
    }
    request.status = decision;
    request.reviewerId = account.id;
    request.reviewedAt = new Date().toISOString();
    request.pendingKey = null;
    if (decision === "approved") addMember(request.groupId, request.applicantId, request.source);
    return safeJoinRequest(request);
  }

  async function listJoinRequests(groupId, reviewer) {
    const found = availableGroup(groupId);
    if (found.type !== "custom") throw publicError("班级群成员由班级身份同步");
    requiredGroupAdmin(found.id, reviewer, "无权查看入群申请");
    return store.data.joinRequests
      .filter((item) => String(item.groupId ?? item.group_id) === String(found.id) && item.status === "pending")
      .sort((left, right) => String(left.createdAt ?? left.created_at ?? "").localeCompare(String(right.createdAt ?? right.created_at ?? "")))
      .map((item) => ({
        ...safeJoinRequest(item),
        applicant: publicChatUser(store.data.users.find((entry) => String(entry.id) === String(item.applicantId ?? item.applicant_id)))
      }));
  }

  async function createInvite({ groupId, inviterId, inviteeId, expiresAt = null }) {
    ensureCustomWritable(groupId);
    const inviter = requiredGroupAdmin(groupId, inviterId, "无权邀请群成员");
    const invitee = user(inviteeId);
    if (member(groupId, invitee.id)) throw publicError("已经是群成员");
    const pending = store.data.invites.find((item) => String(item.groupId ?? item.group_id) === String(groupId)
      && String(item.inviteeId ?? item.invitee_id) === String(invitee.id) && item.status === "pending");
    if (pending) return safeInvite(pending);
    const invite = {
      id: `chat-invite-${crypto.randomUUID()}`,
      groupId,
      inviterId: inviter.id,
      inviteeId: invitee.id,
      status: "pending",
      expiresAt: inviteExpiry(expiresAt),
      acceptedAt: null,
      pendingKey: `${groupId}:${invitee.id}`
    };
    store.data.invites.push(invite);
    return safeInvite(invite);
  }

  async function acceptInvite({ inviteId, inviteeId }) {
    const invitee = user(inviteeId);
    const invite = store.data.invites.find((item) => String(item.id) === String(inviteId));
    if (!invite) throw publicError("群邀请不存在");
    if (String(invite.inviteeId ?? invite.invitee_id) !== String(invitee.id)) throw publicError("仅限被邀请人确认");
    ensureCustomWritable(invite.groupId ?? invite.group_id);
    if (invite.status === "accepted") {
      const existing = store.data.members.find((item) => String(item.groupId ?? item.group_id) === String(invite.groupId ?? invite.group_id) && String(item.userId ?? item.user_id) === String(invitee.id));
      if (!existing) throw publicError("群邀请已失效");
      return safeMember(existing, invitee);
    }
    if (invite.status !== "pending") throw publicError("群邀请已失效");
    if (hasExpired(invite.expiresAt ?? invite.expires_at)) {
      invite.status = "expired";
      invite.pendingKey = null;
      throw publicError("群邀请已过期");
    }
    invite.status = "accepted";
    invite.acceptedAt = new Date().toISOString();
    invite.pendingKey = null;
    return addMember(invite.groupId, invitee.id, "invite");
  }

  async function createInviteToken({ groupId, creatorId, expiresAt = null, maxUses = 1 }) {
    ensureCustomWritable(groupId);
    const creator = requiredGroupAdmin(groupId, creatorId, "无权创建群二维码");
    store.data.inviteTokens
      .filter((item) => String(item.groupId ?? item.group_id) === String(groupId) && !item.revoked)
      .forEach((item) => { item.revoked = true; });
    const token = requiredText(inviteTokenGenerator(), "二维码生成失败");
    const digest = inviteTokenDigest(token);
    const existing = store.data.inviteTokens.find((item) => item.tokenDigest === digest);
    if (existing) throw publicError("二维码令牌已存在，请重新生成");
    const row = {
      id: `chat-token-${crypto.randomUUID()}`,
      groupId,
      creatorId: creator.id,
      tokenDigest: digest,
      expiresAt: inviteExpiry(expiresAt),
      maxUses: Math.max(1, Number(maxUses) || 1),
      useCount: 0,
      revoked: false
    };
    store.data.inviteTokens.push(row);
    return { ...safeInviteToken(row), token };
  }

  async function revokeInviteToken({ groupId, tokenId, reviewerId }) {
    ensureCustomWritable(groupId);
    requiredGroupAdmin(groupId, reviewerId, "无权作废群二维码");
    const token = store.data.inviteTokens.find((item) => (
      String(item.id) === String(tokenId)
      && String(item.groupId ?? item.group_id) === String(groupId)
    ));
    if (!token) throw publicError("二维码不存在", 404);
    token.revoked = true;
    return safeInviteToken(token);
  }

  async function messageAccess(groupId, accountInput, { writable = false } = {}) {
    const found = availableGroup(groupId, { writable });
    const access = await getGroupForUser(groupId, accountInput);
    if (writable && access.governance) throw publicError("平台管理员不能以隐身治理身份发送群消息", 403);
    return { found, access, account: user(accountInput) };
  }

  function stickerForUser(stickerId, accountId) {
    const id = normalizeStickerId(stickerId);
    if (!id) return null;
    const sticker = store.data.stickers.find((item) => String(item.id) === id && item.status === "active");
    if (!sticker || (String(sticker.ownerId ?? sticker.owner_id) !== String(accountId) && sticker.visibility !== "public")) {
      throw publicError("表情不存在或无权使用", 404);
    }
    const media = store.data.media.find((item) => String(item.id) === String(sticker.mediaId ?? sticker.media_id));
    if (!media) throw publicError("表情资源不可用", 409);
    const favorite = store.data.stickerFavorites.some((item) => String(item.userId ?? item.user_id) === String(accountId) && String(item.stickerId ?? item.sticker_id) === id);
    return safeSticker({ ...media, ...sticker }, favorite);
  }

  async function createSticker({ ownerId, media, name, visibility = "private" }) {
    const owner = user(ownerId);
    if (!media?.id || String(media.ownerId) !== String(owner.id)) throw publicError("表情资源归属无效", 403);
    const normalizedVisibility = String(visibility || "private").trim();
    if (!new Set(["private", "public"]).has(normalizedVisibility)) throw publicError("表情可见范围无效");
    if (normalizedVisibility === "public" && !PLATFORM_ROLES.has(owner.role)) throw publicError("普通用户上传的图片表情仅自己可见", 403);
    if (store.data.stickers.some((item) => String(item.mediaId ?? item.media_id) === String(media.id))) throw publicError("该图片已创建为表情", 409);
    store.data.media.push({ ...media });
    const sticker = {
      id: `chat-sticker-${crypto.randomUUID()}`,
      mediaId: media.id,
      ownerId: owner.id,
      name: normalizeStickerName(name),
      visibility: normalizedVisibility,
      status: "active",
      createdAt: new Date().toISOString()
    };
    store.data.stickers.push(sticker);
    return safeSticker({ ...media, ...sticker });
  }

  async function listStickers(viewerId) {
    const account = user(viewerId);
    const favorites = new Set(store.data.stickerFavorites
      .filter((item) => String(item.userId ?? item.user_id) === String(account.id))
      .map((item) => String(item.stickerId ?? item.sticker_id)));
    const unicode = BASE_EMOJIS.map((emoji) => ({ id: `unicode:${emoji.codePointAt(0).toString(16)}`, kind: "unicode", emoji, name: emoji, favorite: favorites.has(`unicode:${emoji.codePointAt(0).toString(16)}`) }));
    const images = store.data.stickers
      .filter((item) => item.status === "active" && (String(item.ownerId ?? item.owner_id) === String(account.id) || item.visibility === "public"))
      .map((item) => {
        const media = store.data.media.find((candidate) => String(candidate.id) === String(item.mediaId ?? item.media_id));
        return media ? safeSticker({ ...media, ...item }, favorites.has(String(item.id))) : null;
      })
      .filter(Boolean);
    return { unicode, stickers: images };
  }

  async function favoriteSticker({ stickerId, userId, favorite = true }) {
    const account = user(userId);
    const id = String(stickerId || "").trim();
    const unicode = id.startsWith("unicode:");
    if (unicode && !BASE_EMOJIS.some((emoji) => `unicode:${emoji.codePointAt(0).toString(16)}` === id)) throw publicError("基础表情不存在", 404);
    const sticker = unicode ? { id, kind: "unicode", emoji: BASE_EMOJIS.find((emoji) => `unicode:${emoji.codePointAt(0).toString(16)}` === id), name: id.slice(8) } : stickerForUser(id, account.id);
    const index = store.data.stickerFavorites.findIndex((item) => String(item.userId ?? item.user_id) === String(account.id) && String(item.stickerId ?? item.sticker_id) === id);
    if (favorite !== false && index < 0) store.data.stickerFavorites.push({ userId: account.id, stickerId: id, createdAt: new Date().toISOString() });
    if (favorite === false && index >= 0) store.data.stickerFavorites.splice(index, 1);
    return { ...sticker, favorite: favorite !== false };
  }

  async function createReport({ reporterId, targetType, targetId, reason }) {
    const reporter = user(reporterId);
    const type = String(targetType || "").trim();
    if (!new Set(["message", "sticker", "group"]).has(type)) throw publicError("举报对象类型无效");
    const id = String(targetId || "").trim();
    if (!id || id.length > 128) throw publicError("举报对象无效");
    const report = { id: `chat-report-${crypto.randomUUID()}`, reporterId: reporter.id, targetType: type, targetId: id, reason: normalizeReportReason(reason), status: "submitted", createdAt: new Date().toISOString() };
    store.data.reports.push(report);
    return safeReport(report);
  }

  function messageProjection(row, found) {
    const sender = store.data.users.find((item) => String(item.id) === String(row.senderId ?? row.sender_id));
    const assignment = found.type === "class" && sender ? classAssignment(found, sender.id) : null;
    const sticker = row.stickerId || row.sticker_id ? stickerForUser(row.stickerId ?? row.sticker_id, row.senderId ?? row.sender_id) : null;
    return safeMessage(row, sender, assignment, sticker);
  }

  async function createMessage({ groupId, senderId, clientRequestId, text, stickerId }) {
    const { found, account } = await messageAccess(groupId, senderId, { writable: true });
    const requestId = normalizeClientRequestId(clientRequestId);
    const normalizedStickerId = normalizeStickerId(stickerId);
    const sticker = normalizedStickerId ? stickerForUser(normalizedStickerId, account.id) : null;
    const existing = store.data.messages.find((item) => (
      String(item.groupId ?? item.group_id) === String(found.id)
      && String(item.senderId ?? item.sender_id) === String(account.id)
      && String(item.clientRequestId ?? item.client_request_id) === requestId
    ));
    if (existing) return messageProjection(existing, found);
    const sequence = store.data.messages
      .filter((item) => String(item.groupId ?? item.group_id) === String(found.id))
      .reduce((highest, item) => Math.max(highest, Number(item.sequence) || 0), 0) + 1;
    const created = {
      id: `chat-message-${crypto.randomUUID()}`,
      groupId: found.id,
      sequence,
      senderId: account.id,
      clientRequestId: requestId,
      text: normalizeMessageText(text, normalizedStickerId),
      stickerId: normalizedStickerId || null,
      createdAt: new Date().toISOString()
    };
    store.data.messages.push(created);
    return safeMessage(created, account, found.type === "class" ? classAssignment(found, account.id) : null, sticker);
  }

  async function listMessages({ groupId, viewerId, after = 0, before = 0, limit = 50, tail = false }) {
    const { found } = await messageAccess(groupId, viewerId);
    const cursor = normalizeAfter(after);
    const beforeCursor = normalizeAfter(before);
    const pageSize = normalizeLimit(limit);
    const matching = store.data.messages
      .filter((item) => String(item.groupId ?? item.group_id) === String(found.id) && Number(item.sequence) > cursor && (!beforeCursor || Number(item.sequence) < beforeCursor))
      .sort((left, right) => Number(left.sequence) - Number(right.sequence));
    const page = tail ? matching.slice(-pageSize) : matching.slice(0, pageSize);
    return {
      messages: page.map((item) => messageProjection(item, found)),
      nextSequence: page.at(-1)?.sequence || cursor,
      hasMore: matching.length > page.length
    };
  }

  async function updateReadCursor({ groupId, readerId, sequence }) {
    const { found, account } = await messageAccess(groupId, readerId);
    const nextSequence = normalizeAfter(sequence);
    let row = store.data.readCursors.find((item) => (
      String(item.groupId ?? item.group_id) === String(found.id)
      && String(item.userId ?? item.user_id) === String(account.id)
    ));
    if (!row) {
      row = { groupId: found.id, userId: account.id, sequence: nextSequence, updatedAt: new Date().toISOString() };
      store.data.readCursors.push(row);
    } else {
      row.sequence = Math.max(Number(row.sequence) || 0, nextSequence);
      row.updatedAt = new Date().toISOString();
    }
    return { groupId: String(found.id), userId: String(account.id), sequence: Number(row.sequence) };
  }

  async function listGovernanceGroups(actor) {
    requiredPlatformAdmin(actor);
    const groups = store.data.groups
      .filter((item) => item.status !== "disabled")
      .map(safeGroup)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    const appeals = store.data.appeals
      .filter((item) => ["submitted", "reviewing"].includes(item.status))
      .sort((left, right) => String(right.createdAt ?? right.created_at ?? "").localeCompare(String(left.createdAt ?? left.created_at ?? "")))
      .map(safeAppeal);
    return { groups, appeals };
  }

  async function setGroupStatus({ groupId, status, operator }) {
    const account = requiredPlatformAdmin(operator);
    const found = group(groupId);
    const target = String(status || "").trim();
    const current = found.status === "closed" ? "closed" : (found.status === "frozen" || found.frozen ? "frozen" : "active");
    if (!GROUP_TRANSITIONS[current]?.has(target)) throw publicError("群聊状态不能这样切换", 409);
    found.status = target;
    found.frozen = target === "frozen" || target === "closed";
    const result = safeGroup(found);
    addAuditLog({
      operatorId: account.id,
      action: `group_${target}`,
      targetType: "chat_group",
      targetId: found.id,
      metadata: { previousStatus: current, status: target }
    });
    return result;
  }

  async function createAppeal({ groupId, appellantId, reason }) {
    const found = group(groupId);
    const appellant = user(appellantId);
    if (String(found.ownerId ?? found.owner_id) !== String(appellant.id)) throw publicError("仅群主可以提交解冻申诉", 403);
    if (found.status !== "frozen" && !found.frozen) throw publicError("仅冻结中的群聊可以申诉", 409);
    const active = store.data.appeals.find((item) => String(item.groupId ?? item.group_id) === String(found.id)
      && ["submitted", "reviewing"].includes(item.status));
    if (active) throw publicError("该群已有待处理申诉", 409);
    const created = {
      id: `chat-appeal-${crypto.randomUUID()}`,
      groupId: found.id,
      appellantId: appellant.id,
      reason: requiredText(reason, "请填写申诉原因"),
      status: "submitted",
      reviewerId: null,
      reviewedAt: null,
      createdAt: new Date().toISOString()
    };
    store.data.appeals.push(created);
    return safeAppeal(created);
  }

  async function reviewAppeal({ appealId, status, reviewer }) {
    const account = requiredPlatformAdmin(reviewer);
    const appeal = store.data.appeals.find((item) => String(item.id) === String(appealId));
    if (!appeal) throw publicError("群聊申诉不存在", 404);
    const target = String(status || "").trim();
    if (!APPEAL_TRANSITIONS[appeal.status]?.has(target)) throw publicError("申诉状态不能这样切换", 409);
    appeal.status = target;
    appeal.reviewerId = account.id;
    appeal.reviewedAt = new Date().toISOString();
    if (target === "approved") {
      const found = group(appeal.groupId ?? appeal.group_id);
      found.status = "active";
      found.frozen = false;
      addAuditLog({ operatorId: account.id, action: "appeal_approved_and_group_restored", targetType: "chat_group", targetId: found.id, metadata: { appealId: appeal.id } });
    } else {
      addAuditLog({ operatorId: account.id, action: `appeal_${target}`, targetType: "chat_appeal", targetId: appeal.id, metadata: { groupId: appeal.groupId ?? appeal.group_id } });
    }
    return safeAppeal(appeal);
  }

  async function listAuditLogs(actor, { groupId = "", limit = 100 } = {}) {
    requiredPlatformAdmin(actor);
    const pageSize = normalizeLimit(limit, 100);
    return store.data.auditLogs
      .filter((item) => !groupId || String(item.targetId ?? item.target_id) === String(groupId)
        || String(item.metadata?.groupId || "") === String(groupId))
      .sort((left, right) => String(right.createdAt ?? right.created_at ?? "").localeCompare(String(left.createdAt ?? left.created_at ?? "")))
      .slice(0, pageSize)
      .map(safeAuditLog);
  }

  return {
    ...store,
    createCustomGroup,
    listUserGroups,
    getGroupForUser,
    listMembers,
    createJoinRequest,
    reviewJoinRequest,
    listJoinRequests,
    createInvite,
    acceptInvite,
    createInviteToken,
    revokeInviteToken,
    searchGroupByNumber,
    createSticker,
    listStickers,
    favoriteSticker,
    createReport,
    createMessage,
    listMessages,
    updateReadCursor,
    listGovernanceGroups,
    setGroupStatus,
    createAppeal,
    reviewAppeal,
    listAuditLogs
  };
}

const RECOVERABLE_CHAT_SCHEMA_CODES = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]);
let chatSchemaRecoveryPromise = null;

function isRecoverableChatSchemaError(error) {
  if (!RECOVERABLE_CHAT_SCHEMA_CODES.has(String(error?.code || ""))) return false;
  return /\b(chat_[a-z0-9_]*|campus_classes|class_assignments|class_sync_errors)\b/i
    .test(String(error?.message || ""));
}

async function recoverMissingChatSchema() {
  if (!chatSchemaRecoveryPromise) {
    chatSchemaRecoveryPromise = Promise.resolve()
      .then(() => require("./student-store").initialize({ forceSchema: true }))
      .finally(() => {
        chatSchemaRecoveryPromise = null;
      });
  }
  return chatSchemaRecoveryPromise;
}

function wrapMysqlPublic(operation, recoverMissingSchema) {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      if (error instanceof PublicChatError) throw error;
      if (isRecoverableChatSchemaError(error) && typeof recoverMissingSchema === "function") {
        try {
          await recoverMissingSchema(error);
          return await operation(...args);
        } catch (retryError) {
          if (retryError instanceof PublicChatError) throw retryError;
          error = retryError;
        }
      }
      console.error("chat storage operation failed", { error: error?.message });
      throw new Error("群聊服务暂不可用");
    }
  };
}

function createMysqlChatStore(pool, options = {}) {
  if (!pool) throw new Error("MySQL pool is required");
  const groupNumberGenerator = options.groupNumberGenerator || defaultGroupNumber;
  const inviteTokenGenerator = options.inviteTokenGenerator || defaultInviteToken;
  const recoverMissingSchema = options.recoverMissingSchema || recoverMissingChatSchema;
  const mysqlPublic = (operation) => wrapMysqlPublic(operation, recoverMissingSchema);

  async function execute(sql, params = []) {
    return pool.execute(sql, params);
  }

  async function activeUser(userInput, connection = pool) {
    const userId = userIdOf(userInput);
    const [rows] = await connection.execute("SELECT id, name, role, status, avatar_color, school, college, class_name FROM students WHERE id = ?", [userId]);
    return requiredActiveUser(rows, userId);
  }

  async function groupById(groupId, connection = pool, { forUpdate = false } = {}) {
    const [rows] = await connection.execute(`SELECT * FROM chat_groups WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`, [groupId]);
    if (!rows[0]) throw publicError("群聊不存在");
    return safeGroup(rows[0]);
  }

  function checkGroupState(group, writable = false) {
    if (group.status === "disabled") throw publicError("群聊不可用", 403);
    if (group.status === "closed") throw publicError("群聊已关闭", 403);
    if (writable && group.frozen) throw publicError("群聊已冻结", 423);
  }

  async function requiredMysqlPlatformAdmin(actor, connection = pool) {
    const account = await activeUser(actor, connection);
    if (!PLATFORM_ROLES.has(account.role)) throw publicError("仅平台管理员可以管理群聊", 403);
    return account;
  }

  async function mysqlAudit(connection, { operatorId, action, targetType, targetId, metadata = null }) {
    await connection.execute(
      "INSERT INTO chat_audit_logs (id, operator_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
      [`chat-audit-${crypto.randomUUID()}`, String(operatorId), action, targetType, String(targetId), metadata ? JSON.stringify(metadata) : null]
    );
  }

  async function mysqlMember(groupId, userId, connection = pool, { forUpdate = false, includeInactive = false } = {}) {
    const [rows] = await connection.execute(
      `SELECT * FROM chat_members WHERE group_id = ? AND user_id = ?${includeInactive ? "" : " AND active = 1"}${forUpdate ? " FOR UPDATE" : ""}`,
      [groupId, userId]
    );
    return rows[0] ? safeMember(rows[0]) : null;
  }

  async function nextGroupNumber(connection) {
    for (let attempt = 0; attempt < GROUP_NUMBER_ATTEMPTS; attempt += 1) {
      const candidate = String(groupNumberGenerator());
      if (!/^\d{10,}$/.test(candidate)) continue;
      const [rows] = await connection.execute("SELECT id FROM chat_groups WHERE public_no = ?", [candidate]);
      if (!rows[0]) return candidate;
    }
    throw publicError("群号生成失败，请稍后重试");
  }

  const createCustomGroup = mysqlPublic(async (input, ownerInput) => {
    const owner = await activeUser(ownerInput);
    const name = requiredText(input?.name, "群名称不能为空");
    for (let attempt = 0; attempt < GROUP_NUMBER_ATTEMPTS; attempt += 1) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const publicNo = await nextGroupNumber(connection);
        const id = `group-${crypto.randomUUID()}`;
        await connection.execute(
          "INSERT INTO chat_groups (id, type, public_no, name, owner_id, class_id, status, frozen, description, join_policy) VALUES (?, 'custom', ?, ?, ?, NULL, 'active', 0, ?, 'review')",
          [id, publicNo, name, owner.id, String(input?.description || "").trim()]
        );
        await connection.execute(
          "INSERT INTO chat_members (id, group_id, user_id, role, joined_via, active) VALUES (?, ?, ?, 'owner', 'created', 1)",
          [`chat-member-${crypto.randomUUID()}`, id, owner.id]
        );
        await connection.commit();
        return safeGroup({ id, type: "custom", public_no: publicNo, name, owner_id: owner.id, status: "active", frozen: 0, description: input?.description || "", join_policy: "review" });
      } catch (error) {
        await connection.rollback();
        const publicNumberCollision = error?.code === "ER_DUP_ENTRY"
          && /public_no|uq_chat_group_public_no/i.test(String(error.message || ""));
        if (!publicNumberCollision) throw error;
      } finally {
        connection.release();
      }
    }
    throw publicError("群号生成失败，请稍后重试");
  });

  const listUserGroups = mysqlPublic(async (userId) => {
    const account = await activeUser(userId);
    const [rows] = await execute(`
      SELECT DISTINCT cg.*
      FROM chat_groups cg
      LEFT JOIN chat_members cm ON cm.group_id = cg.id AND cm.user_id = ? AND cm.active = 1
      LEFT JOIN class_assignments ca ON ca.class_id = cg.class_id AND ca.user_id = ? AND ca.active = 1
      WHERE cg.status <> 'disabled'
        AND ((cg.type = 'class' AND (
            (ca.user_id IS NOT NULL AND ? NOT IN ('admin','super_admin'))
            OR (? IN ('admin','super_admin') AND EXISTS (
              SELECT 1 FROM campus_classes own_class
              WHERE own_class.id = cg.class_id AND own_class.status = 'active'
                AND own_class.school = ? AND own_class.college = ? AND own_class.class_name = ?
            ))
          ))
          OR (cg.type <> 'class' AND cm.user_id IS NOT NULL))
      ORDER BY CASE WHEN cg.type = 'class' THEN 0 ELSE 1 END, cg.name, cg.id
    `, [account.id, account.id, account.role, account.role, account.school, account.college, account.class_name]);
    return rows.map(safeGroup);
  });

  const searchGroupByNumber = mysqlPublic(async (groupNumber, viewerId) => {
    await activeUser(viewerId);
    const publicNo = requiredText(groupNumber, "请输入群号");
    const [rows] = await execute(`
      SELECT cg.id, cg.name, cg.type, COUNT(cm.id) AS member_count
      FROM chat_groups cg
      LEFT JOIN chat_members cm ON cm.group_id = cg.id AND cm.active = 1
      WHERE cg.type = 'custom' AND cg.public_no = ? AND cg.status <> 'disabled'
      GROUP BY cg.id, cg.name, cg.type
      LIMIT 1
    `, [publicNo]);
    if (!rows[0]) throw publicError("未找到可加入的群聊", 404);
    return {
      id: String(rows[0].id),
      name: rows[0].name,
      type: "custom",
      avatar: "",
      memberCount: Number(rows[0].member_count) || 0
    };
  });

  const getGroupForUser = mysqlPublic(async (groupId, accountInput) => {
    const account = await activeUser(accountInput);
    const found = await groupById(groupId);
    checkGroupState(found);
    if (found.type === "class") {
      if (PLATFORM_ROLES.has(account.role)) return groupAccessShape(found, null, true);
      const [rows] = await execute(`
        SELECT ca.*, s.name, s.role AS user_role, s.status
        FROM class_assignments ca
        INNER JOIN students s ON s.id = ca.user_id
        WHERE ca.class_id = ? AND ca.user_id = ? AND ca.active = 1
          AND s.status = 'active' AND s.role NOT IN ('admin','super_admin')
      `, [found.classId, account.id]);
      if (!rows[0]) throw publicError("无权访问该群聊", 403);
      return groupAccessShape(found, {
        id: `class:${found.id}:${account.id}`,
        groupId: found.id,
        userId: account.id,
        role: CLASS_ADMIN_DUTIES.has(rows[0].duty) ? "admin" : "member",
        classDuty: rows[0].duty,
        joinedVia: "class_assignment",
        active: true
      });
    }
    const membership = await mysqlMember(found.id, account.id);
    if (!membership) throw publicError("无权访问该群聊", 403);
    return groupAccessShape(found, membership);
  });

  const listMembers = mysqlPublic(async (groupId, requester) => {
    const access = await getGroupForUser(groupId, requester);
    if (access.type === "class") {
      const [rows] = await execute(`
        SELECT ca.id, ca.class_id, ca.user_id, ca.duty AS class_duty,
          CASE WHEN ca.duty IN ('monitor','league_secretary','class_admin','head_teacher') THEN 'admin' ELSE 'member' END AS role,
          'class_assignment' AS joined_via, ca.active, s.name, s.role AS user_role, s.avatar_color
        FROM class_assignments ca
        INNER JOIN students s ON s.id = ca.user_id
        WHERE ca.class_id = ? AND ca.active = 1 AND s.status = 'active'
          AND s.role NOT IN ('admin','super_admin','guest')
        ORDER BY CASE WHEN ca.duty IN ('monitor','league_secretary','class_admin','head_teacher') THEN 0 ELSE 1 END, s.name, s.id
      `, [access.classId]);
      return rows.map((row) => safeMember({ ...row, group_id: groupId }));
    }
    const [rows] = await execute(`
      SELECT cm.*, s.name, s.role AS user_role, s.avatar_color
      FROM chat_members cm
      INNER JOIN students s ON s.id = cm.user_id
      WHERE cm.group_id = ? AND cm.active = 1 AND s.status = 'active'
      ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, s.name, s.id
    `, [groupId]);
    return rows.map(safeMember);
  });

  async function requiredMysqlAdmin(groupId, reviewerId, connection, message) {
    const [rows] = await connection.execute(
      "SELECT * FROM chat_members WHERE group_id = ? AND user_id = ? AND active = 1 AND role IN ('owner','admin') FOR UPDATE",
      [groupId, reviewerId]
    );
    if (!rows[0]) throw publicError(message, 403);
  }

  async function mysqlCustomWritable(groupId, connection = pool, { forUpdate = false } = {}) {
    const found = await groupById(groupId, connection, { forUpdate });
    checkGroupState(found, true);
    if (found.type === "class") throw publicError("班级群成员由班级身份同步");
    return found;
  }

  const createJoinRequest = mysqlPublic(async (input = {}) => {
    const { applicantId, source } = input;
    if (!JOIN_SOURCES.has(source)) throw publicError("入群来源无效");
    let groupId = input.groupId;
    if (source === "qr" && !groupId) {
      const token = requiredText(input.token ?? input.proof, "请提供有效二维码凭证");
      const [tokenLookup] = await execute("SELECT group_id FROM chat_invite_tokens WHERE token_digest = ?", [inviteTokenDigest(token)]);
      groupId = tokenLookup[0]?.group_id;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Lock order for membership changes: group -> member/request/token.
      const found = await mysqlCustomWritable(groupId, connection, { forUpdate: true });
      const applicant = await activeUser(applicantId, connection);
      if (await mysqlMember(groupId, applicant.id, connection, { forUpdate: true })) throw publicError("已经是群成员");
      const pendingKey = `${groupId}:${applicant.id}`;
      const [existing] = await connection.execute("SELECT * FROM chat_join_requests WHERE pending_key = ? FOR UPDATE", [pendingKey]);
      if (existing[0]) {
        await connection.commit();
        return safeJoinRequest(existing[0]);
      }
      if (source === "group_number") {
        const groupNumber = requiredText(input.groupNumber ?? input.proof, "请提供正确群号");
        if (groupNumber !== String(found.publicNo)) throw publicError("群号与目标群不一致");
      } else {
        const token = requiredText(input.token ?? input.proof, "请提供有效二维码凭证");
        const digest = inviteTokenDigest(token);
        const [tokenRows] = await connection.execute("SELECT * FROM chat_invite_tokens WHERE token_digest = ? FOR UPDATE", [digest]);
        const tokenRow = tokenRows[0];
        if (!tokenRow || String(tokenRow.group_id) !== String(found.id)) throw publicError("二维码凭证无效");
        if (tokenRow.revoked || hasExpired(tokenRow.expires_at) || Number(tokenRow.use_count) >= Number(tokenRow.max_uses)) {
          throw publicError("二维码凭证已失效");
        }
        await connection.execute("UPDATE chat_invite_tokens SET use_count = use_count + 1 WHERE id = ?", [tokenRow.id]);
      }
      const id = `join-request-${crypto.randomUUID()}`;
      await connection.execute(
        "INSERT INTO chat_join_requests (id, group_id, applicant_id, source, status, pending_key) VALUES (?, ?, ?, ?, 'pending', ?)",
        [id, groupId, applicant.id, source, pendingKey]
      );
      await connection.commit();
      return safeJoinRequest({ id, group_id: groupId, applicant_id: applicant.id, source, status: "pending" });
    } catch (error) {
      await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") {
        const pendingKey = `${groupId}:${userIdOf(applicantId)}`;
        const [rows] = await execute("SELECT * FROM chat_join_requests WHERE pending_key = ?", [pendingKey]);
        if (rows[0]) return safeJoinRequest(rows[0]);
      }
      throw error;
    } finally {
      connection.release();
    }
  });

  const reviewJoinRequest = mysqlPublic(async ({ requestId, decision, reviewer }) => {
    if (!["approved", "rejected"].includes(decision)) throw publicError("审核决定无效");
    const [lookupRows] = await execute("SELECT group_id FROM chat_join_requests WHERE id = ?", [requestId]);
    if (!lookupRows[0]) throw publicError("入群申请不存在");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const requestGroupId = lookupRows[0].group_id;
      await mysqlCustomWritable(requestGroupId, connection, { forUpdate: true });
      const [rows] = await connection.execute("SELECT * FROM chat_join_requests WHERE id = ? FOR UPDATE", [requestId]);
      if (!rows[0]) throw publicError("入群申请不存在");
      const request = rows[0];
      const account = await activeUser(reviewer, connection);
      await requiredMysqlAdmin(request.group_id, account.id, connection, "无权审核该申请");
      if (request.status !== "pending") {
        if (request.status !== decision) throw publicError("入群申请已处理");
        await connection.commit();
        return safeJoinRequest(request);
      }
      if (decision === "approved") {
        await mysqlMember(request.group_id, request.applicant_id, connection, { forUpdate: true, includeInactive: true });
        await connection.execute(`
          INSERT INTO chat_members (id, group_id, user_id, role, joined_via, active)
          VALUES (?, ?, ?, 'member', ?, 1)
          ON DUPLICATE KEY UPDATE active = 1, joined_via = VALUES(joined_via)
        `, [`chat-member-${crypto.randomUUID()}`, request.group_id, request.applicant_id, request.source]);
      }
      await connection.execute(
        "UPDATE chat_join_requests SET status = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, pending_key = NULL WHERE id = ?",
        [decision, account.id, requestId]
      );
      await connection.commit();
      return safeJoinRequest({ ...request, status: decision, reviewer_id: account.id, reviewed_at: new Date().toISOString() });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const listJoinRequests = mysqlPublic(async (groupId, reviewer) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const found = await groupById(groupId, connection, { forUpdate: true });
      checkGroupState(found);
      if (found.type !== "custom") throw publicError("班级群成员由班级身份同步");
      const account = await activeUser(reviewer, connection);
      await requiredMysqlAdmin(found.id, account.id, connection, "无权查看入群申请");
      const [rows] = await connection.execute(`
        SELECT r.*, s.name AS applicant_name, s.role AS applicant_role, s.avatar_color AS applicant_avatar_color
        FROM chat_join_requests r
        INNER JOIN students s ON s.id = r.applicant_id
        WHERE r.group_id = ? AND r.status = 'pending'
        ORDER BY r.created_at ASC, r.id ASC
      `, [found.id]);
      await connection.commit();
      return rows.map((row) => ({
        ...safeJoinRequest(row),
        applicant: publicChatUser({
          id: row.applicant_id,
          name: row.applicant_name,
          role: row.applicant_role,
          avatar_color: row.applicant_avatar_color
        })
      }));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const createInvite = mysqlPublic(async ({ groupId, inviterId, inviteeId, expiresAt = null }) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlCustomWritable(groupId, connection, { forUpdate: true });
      const inviter = await activeUser(inviterId, connection);
      const invitee = await activeUser(inviteeId, connection);
      await requiredMysqlAdmin(groupId, inviter.id, connection, "无权邀请群成员");
      if (await mysqlMember(groupId, invitee.id, connection, { forUpdate: true })) throw publicError("已经是群成员");
      const pendingKey = `${groupId}:${invitee.id}`;
      const [existing] = await connection.execute("SELECT * FROM chat_invites WHERE pending_key = ? FOR UPDATE", [pendingKey]);
      if (existing[0]) {
        await connection.commit();
        return safeInvite(existing[0]);
      }
      const id = `chat-invite-${crypto.randomUUID()}`;
      const resolvedExpiry = inviteExpiry(expiresAt);
      await connection.execute(
        "INSERT INTO chat_invites (id, group_id, inviter_id, invitee_id, status, pending_key, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        [id, groupId, inviter.id, invitee.id, pendingKey, resolvedExpiry]
      );
      await connection.commit();
      return safeInvite({ id, group_id: groupId, inviter_id: inviter.id, invitee_id: invitee.id, status: "pending", expires_at: resolvedExpiry });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const acceptInvite = mysqlPublic(async ({ inviteId, inviteeId }) => {
    const [lookupRows] = await execute("SELECT group_id FROM chat_invites WHERE id = ?", [inviteId]);
    if (!lookupRows[0]) throw publicError("群邀请不存在");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlCustomWritable(lookupRows[0].group_id, connection, { forUpdate: true });
      const [rows] = await connection.execute("SELECT * FROM chat_invites WHERE id = ? FOR UPDATE", [inviteId]);
      if (!rows[0]) throw publicError("群邀请不存在");
      const invite = rows[0];
      const invitee = await activeUser(inviteeId, connection);
      if (String(invite.invitee_id) !== String(invitee.id)) throw publicError("仅限被邀请人确认");
      const existingMember = await mysqlMember(invite.group_id, invitee.id, connection, { forUpdate: true, includeInactive: true });
      if (invite.status === "accepted") {
        if (!existingMember) throw publicError("群邀请已失效");
        await connection.commit();
        return existingMember;
      }
      if (invite.status !== "pending" || hasExpired(invite.expires_at)) throw publicError("群邀请已过期");
      await connection.execute(`
        INSERT INTO chat_members (id, group_id, user_id, role, joined_via, active)
        VALUES (?, ?, ?, 'member', 'invite', 1)
        ON DUPLICATE KEY UPDATE active = 1, joined_via = 'invite'
      `, [`chat-member-${crypto.randomUUID()}`, invite.group_id, invitee.id]);
      await connection.execute(
        "UPDATE chat_invites SET status = 'accepted', accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP), pending_key = NULL WHERE id = ?",
        [inviteId]
      );
      const [members] = await connection.execute("SELECT * FROM chat_members WHERE group_id = ? AND user_id = ?", [invite.group_id, invitee.id]);
      await connection.commit();
      return safeMember(members[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const createInviteToken = mysqlPublic(async ({ groupId, creatorId, expiresAt = null, maxUses = 1 }) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlCustomWritable(groupId, connection, { forUpdate: true });
      const creator = await activeUser(creatorId, connection);
      await requiredMysqlAdmin(groupId, creator.id, connection, "无权创建群二维码");
      await connection.execute(
        "UPDATE chat_invite_tokens SET revoked = 1 WHERE group_id = ? AND revoked = 0",
        [groupId]
      );
      const token = requiredText(inviteTokenGenerator(), "二维码生成失败");
      const digest = inviteTokenDigest(token);
      const [existing] = await connection.execute("SELECT * FROM chat_invite_tokens WHERE token_digest = ? FOR UPDATE", [digest]);
      if (existing[0]) throw publicError("二维码令牌已存在，请重新生成");
      const id = `chat-token-${crypto.randomUUID()}`;
      const resolvedExpiry = inviteExpiry(expiresAt);
      const normalizedMaxUses = Math.max(1, Number(maxUses) || 1);
      await connection.execute(
        "INSERT INTO chat_invite_tokens (id, group_id, creator_id, token_digest, expires_at, max_uses, use_count, revoked) VALUES (?, ?, ?, ?, ?, ?, 0, 0)",
        [id, groupId, creator.id, digest, resolvedExpiry, normalizedMaxUses]
      );
      await connection.commit();
      return { ...safeInviteToken({ id, group_id: groupId, creator_id: creator.id, expires_at: resolvedExpiry, max_uses: normalizedMaxUses, use_count: 0, revoked: 0 }), token };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const revokeInviteToken = mysqlPublic(async ({ groupId, tokenId, reviewerId }) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlCustomWritable(groupId, connection, { forUpdate: true });
      const reviewer = await activeUser(reviewerId, connection);
      await requiredMysqlAdmin(groupId, reviewer.id, connection, "无权作废群二维码");
      const [rows] = await connection.execute(
        "SELECT * FROM chat_invite_tokens WHERE id = ? AND group_id = ? FOR UPDATE",
        [tokenId, groupId]
      );
      if (!rows[0]) throw publicError("二维码不存在", 404);
      await connection.execute("UPDATE chat_invite_tokens SET revoked = 1 WHERE id = ?", [tokenId]);
      await connection.commit();
      return safeInviteToken({ ...rows[0], revoked: 1 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  async function mysqlMessageAccess(groupId, accountInput, connection, { writable = false } = {}) {
    const account = await activeUser(accountInput, connection);
    const found = await groupById(groupId, connection, { forUpdate: true });
    checkGroupState(found, writable);
    if (found.type === "class") {
      if (PLATFORM_ROLES.has(account.role)) {
        if (writable) throw publicError("平台管理员不能以隐身治理身份发送群消息", 403);
        return { found, account, governance: true, assignment: null };
      }
      const [rows] = await connection.execute(`
        SELECT ca.duty
        FROM class_assignments ca
        INNER JOIN students s ON s.id = ca.user_id
        WHERE ca.class_id = ? AND ca.user_id = ? AND ca.active = 1
          AND s.status = 'active' AND s.role NOT IN ('admin', 'super_admin', 'guest')
        FOR UPDATE
      `, [found.classId, account.id]);
      if (!rows[0]) throw publicError("无权访问该群聊", 403);
      return { found, account, governance: false, assignment: rows[0] };
    }
    const membership = await mysqlMember(found.id, account.id, connection, { forUpdate: true });
    if (!membership) throw publicError("无权访问该群聊", 403);
    return { found, account, governance: false, membership, assignment: null };
  }

  async function mysqlStickerForUser(stickerId, accountId, connection, { forMessage = false } = {}) {
    const id = normalizeStickerId(stickerId);
    if (!id) return null;
    const [rows] = await connection.execute(`
      SELECT s.*, m.public_url AS sticker_public_url, m.mime_type AS sticker_mime_type
      FROM chat_stickers s
      INNER JOIN chat_media m ON m.id = s.media_id
      WHERE s.id = ? AND s.status = 'active'
        AND (${forMessage ? "s.owner_id = ? OR s.visibility = 'public'" : "s.owner_id = ? OR s.visibility = 'public'"})
      FOR UPDATE
    `, [id, accountId]);
    if (!rows[0]) throw publicError("表情不存在或无权使用", 404);
    return safeSticker(rows[0]);
  }

  const createSticker = mysqlPublic(async ({ ownerId, media, name, visibility = "private" }) => {
    const account = await activeUser(ownerId);
    if (!media?.id || String(media.ownerId) !== String(account.id)) throw publicError("表情资源归属无效", 403);
    const normalizedVisibility = String(visibility || "private").trim();
    if (!new Set(["private", "public"]).has(normalizedVisibility)) throw publicError("表情可见范围无效");
    if (normalizedVisibility === "public" && !PLATFORM_ROLES.has(account.role)) throw publicError("普通用户上传的图片表情仅自己可见", 403);
    const normalizedName = normalizeStickerName(name);
    const id = `chat-sticker-${crypto.randomUUID()}`;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`
        INSERT INTO chat_media (id, owner_id, object_key, public_url, mime_type, byte_size, sha256, source_type, source_url, source_author, source_license)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [media.id, account.id, media.key, media.url, media.mimeType, media.size, media.digest, media.source.type, media.source.sourceUrl || null, media.source.author || null, media.source.license || null]);
      await connection.execute(
        "INSERT INTO chat_stickers (id, media_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)",
        [id, media.id, account.id, normalizedName, normalizedVisibility]
      );
      await connection.commit();
      return safeSticker({ id, sticker_public_url: media.url, sticker_mime_type: media.mimeType, name: normalizedName });
    } catch (error) {
      await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") throw publicError("该图片已创建为表情", 409);
      throw error;
    } finally {
      connection.release();
    }
  });

  const listStickers = mysqlPublic(async (viewerId) => {
    const account = await activeUser(viewerId);
    const [rows] = await execute(`
      SELECT s.*, m.public_url AS sticker_public_url, m.mime_type AS sticker_mime_type,
        CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END AS favorite
      FROM chat_stickers s
      INNER JOIN chat_media m ON m.id = s.media_id
      LEFT JOIN chat_sticker_favorites f ON f.sticker_id = s.id AND f.user_id = ?
      WHERE s.status = 'active' AND (s.owner_id = ? OR s.visibility = 'public')
      ORDER BY f.user_id IS NOT NULL DESC, s.created_at DESC
      LIMIT 120
    `, [account.id, account.id]);
    const [favoriteRows] = await execute("SELECT sticker_id FROM chat_sticker_favorites WHERE user_id = ? AND sticker_id LIKE 'unicode:%'", [account.id]);
    const favoriteUnicode = new Set(favoriteRows.map((row) => row.sticker_id));
    return {
      unicode: BASE_EMOJIS.map((emoji) => ({ id: `unicode:${emoji.codePointAt(0).toString(16)}`, kind: "unicode", emoji, name: emoji, favorite: favoriteUnicode.has(`unicode:${emoji.codePointAt(0).toString(16)}`) })),
      stickers: rows.map((row) => safeSticker(row, Boolean(row.favorite)))
    };
  });

  const favoriteSticker = mysqlPublic(async ({ stickerId, userId, favorite = true }) => {
    const account = await activeUser(userId);
    const id = String(stickerId || "").trim();
    const unicode = id.startsWith("unicode:");
    if (unicode && !BASE_EMOJIS.some((emoji) => `unicode:${emoji.codePointAt(0).toString(16)}` === id)) throw publicError("基础表情不存在", 404);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const sticker = unicode ? { id, kind: "unicode", emoji: BASE_EMOJIS.find((emoji) => `unicode:${emoji.codePointAt(0).toString(16)}` === id), name: id.slice(8) } : await mysqlStickerForUser(id, account.id, connection);
      if (favorite === false) {
        await connection.execute("DELETE FROM chat_sticker_favorites WHERE user_id = ? AND sticker_id = ?", [account.id, id]);
      } else {
        await connection.execute("INSERT IGNORE INTO chat_sticker_favorites (user_id, sticker_id) VALUES (?, ?)", [account.id, id]);
      }
      await connection.commit();
      return { ...sticker, favorite: favorite !== false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const createReport = mysqlPublic(async ({ reporterId, targetType, targetId, reason }) => {
    const reporter = await activeUser(reporterId);
    const type = String(targetType || "").trim();
    const id = String(targetId || "").trim();
    if (!new Set(["message", "sticker", "group"]).has(type) || !id || id.length > 128) throw publicError("举报对象无效");
    const report = { id: `chat-report-${crypto.randomUUID()}`, reporterId: reporter.id, targetType: type, targetId: id, reason: normalizeReportReason(reason), status: "submitted", createdAt: new Date().toISOString() };
    await execute("INSERT INTO chat_reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [report.id, report.reporterId, report.targetType, report.targetId, report.reason, report.status, report.createdAt]);
    return safeReport(report);
  });

  function mysqlMessageProjection(row) {
    const sender = {
      id: row.sender_id,
      name: row.sender_name,
      role: row.sender_role,
      avatar_color: row.sender_avatar_color
    };
    return safeMessage(row, sender, { class_duty: row.class_duty });
  }

  const createMessage = mysqlPublic(async ({ groupId, senderId, clientRequestId, text, stickerId }) => {
    const requestId = normalizeClientRequestId(clientRequestId);
    const normalizedStickerId = normalizeStickerId(stickerId);
    const normalizedText = normalizeMessageText(text, normalizedStickerId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // All message writes serialize on the group row before member and message rows.
      const access = await mysqlMessageAccess(groupId, senderId, connection, { writable: true });
      const sticker = normalizedStickerId ? await mysqlStickerForUser(normalizedStickerId, access.account.id, connection) : null;
      // TiDB rejects a NULL prepared-statement parameter in this JOIN for ordinary groups.
      // Ordinary groups have no class, so an empty key safely yields no class-duty match.
      const messageClassId = String(access.found.classId || "");
      // TiDB rejects this multi-join statement through the binary prepared-statement protocol.
      // mysql2's query() still safely escapes every bound value while avoiding that protocol path.
      const [existingRows] = await connection.query(`
        SELECT m.*, s.id AS sender_id, s.name AS sender_name, s.role AS sender_role,
          s.avatar_color AS sender_avatar_color, ca.duty AS class_duty,
          cs.name AS sticker_name, cm.public_url AS sticker_public_url, cm.mime_type AS sticker_mime_type
        FROM chat_messages m
        INNER JOIN students s ON s.id = m.sender_id
        LEFT JOIN class_assignments ca ON ca.class_id = ? AND ca.user_id = m.sender_id AND ca.active = 1
        LEFT JOIN chat_stickers cs ON cs.id = m.sticker_id
        LEFT JOIN chat_media cm ON cm.id = cs.media_id
        WHERE m.group_id = ? AND m.sender_id = ? AND m.client_request_id = ?
        FOR UPDATE
      `, [messageClassId, access.found.id, access.account.id, requestId]);
      if (existingRows[0]) {
        await connection.commit();
        return mysqlMessageProjection(existingRows[0]);
      }
      await connection.execute(
        "UPDATE chat_groups SET next_message_sequence = next_message_sequence + 1 WHERE id = ?",
        [access.found.id]
      );
      const [sequenceRows] = await connection.execute(
        "SELECT next_message_sequence FROM chat_groups WHERE id = ? FOR UPDATE",
        [access.found.id]
      );
      const sequence = Number(sequenceRows[0]?.next_message_sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("chat message sequence allocation failed");
      const id = `chat-message-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      await connection.execute(
        "INSERT INTO chat_messages (id, group_id, sequence, sender_id, client_request_id, text, sticker_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, access.found.id, sequence, access.account.id, requestId, normalizedText, normalizedStickerId || null]
      );
      await connection.commit();
      return safeMessage({ id, group_id: access.found.id, sequence, client_request_id: requestId, text: normalizedText, sticker_id: normalizedStickerId || null, created_at: createdAt }, access.account, access.assignment, sticker);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const listMessages = mysqlPublic(async ({ groupId, viewerId, after = 0, before = 0, limit = 50, tail = false }) => {
    const cursor = normalizeAfter(after);
    const beforeCursor = normalizeAfter(before);
    const pageSize = normalizeLimit(limit);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const access = await mysqlMessageAccess(groupId, viewerId, connection);
      // See createMessage: use a concrete no-match key for ordinary groups on TiDB.
      const messageClassId = String(access.found.classId || "");
      // See createMessage: use the text protocol for this TiDB-incompatible multi-join query.
      const [rows] = await connection.query(`
        SELECT m.*, s.id AS sender_id, s.name AS sender_name, s.role AS sender_role,
          s.avatar_color AS sender_avatar_color, ca.duty AS class_duty,
          cs.name AS sticker_name, cm.public_url AS sticker_public_url, cm.mime_type AS sticker_mime_type
        FROM chat_messages m
        INNER JOIN students s ON s.id = m.sender_id
        LEFT JOIN class_assignments ca ON ca.class_id = ? AND ca.user_id = m.sender_id AND ca.active = 1
        LEFT JOIN chat_stickers cs ON cs.id = m.sticker_id
        LEFT JOIN chat_media cm ON cm.id = cs.media_id
        WHERE m.group_id = ? AND m.sequence > ? AND (? = 0 OR m.sequence < ?)
        ORDER BY m.sequence ${tail ? "DESC" : "ASC"}
        LIMIT ?
      `, [messageClassId, access.found.id, cursor, beforeCursor, beforeCursor, pageSize + 1]);
      await connection.commit();
      const hasMore = rows.length > pageSize;
      const page = tail ? rows.slice(0, pageSize).reverse() : rows.slice(0, pageSize);
      return {
        messages: page.map(mysqlMessageProjection),
        nextSequence: page.at(-1)?.sequence || cursor,
        hasMore
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const updateReadCursor = mysqlPublic(async ({ groupId, readerId, sequence }) => {
    const nextSequence = normalizeAfter(sequence);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const access = await mysqlMessageAccess(groupId, readerId, connection);
      await connection.execute(`
        INSERT INTO chat_read_cursors (group_id, user_id, sequence)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE sequence = GREATEST(sequence, VALUES(sequence)), updated_at = CURRENT_TIMESTAMP
      `, [access.found.id, access.account.id, nextSequence]);
      const [rows] = await connection.execute(
        "SELECT sequence FROM chat_read_cursors WHERE group_id = ? AND user_id = ?",
        [access.found.id, access.account.id]
      );
      await connection.commit();
      return { groupId: String(access.found.id), userId: String(access.account.id), sequence: Number(rows[0]?.sequence ?? nextSequence) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const listGovernanceGroups = mysqlPublic(async (actor) => {
    await requiredMysqlPlatformAdmin(actor);
    const [groups] = await execute("SELECT * FROM chat_groups WHERE status <> 'disabled' ORDER BY name, id");
    const [appeals] = await execute("SELECT * FROM chat_appeals WHERE status IN ('submitted', 'reviewing') ORDER BY created_at DESC, id DESC");
    return { groups: groups.map(safeGroup), appeals: appeals.map(safeAppeal) };
  });

  const setGroupStatus = mysqlPublic(async ({ groupId, status, operator }) => {
    const target = String(status || "").trim();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const account = await requiredMysqlPlatformAdmin(operator, connection);
      const found = await groupById(groupId, connection, { forUpdate: true });
      const current = found.status === "closed" ? "closed" : (found.status === "frozen" || found.frozen ? "frozen" : "active");
      if (!GROUP_TRANSITIONS[current]?.has(target)) throw publicError("群聊状态不能这样切换", 409);
      const frozen = target === "frozen" || target === "closed";
      await connection.execute("UPDATE chat_groups SET status = ?, frozen = ? WHERE id = ?", [target, frozen ? 1 : 0, found.id]);
      await mysqlAudit(connection, {
        operatorId: account.id,
        action: `group_${target}`,
        targetType: "chat_group",
        targetId: found.id,
        metadata: { previousStatus: current, status: target }
      });
      await connection.commit();
      return safeGroup({ ...found, status: target, frozen });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const createAppeal = mysqlPublic(async ({ groupId, appellantId, reason }) => {
    const normalizedReason = requiredText(reason, "请填写申诉原因");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const appellant = await activeUser(appellantId, connection);
      const found = await groupById(groupId, connection, { forUpdate: true });
      if (String(found.ownerId) !== String(appellant.id)) throw publicError("仅群主可以提交解冻申诉", 403);
      if (found.status !== "frozen" && !found.frozen) throw publicError("仅冻结中的群聊可以申诉", 409);
      const [active] = await connection.execute(
        "SELECT id FROM chat_appeals WHERE group_id = ? AND status IN ('submitted', 'reviewing') FOR UPDATE",
        [found.id]
      );
      if (active[0]) throw publicError("该群已有待处理申诉", 409);
      const id = `chat-appeal-${crypto.randomUUID()}`;
      await connection.execute(
        "INSERT INTO chat_appeals (id, group_id, appellant_id, reason, status, active_key) VALUES (?, ?, ?, ?, 'submitted', ?)",
        [id, found.id, appellant.id, normalizedReason, found.id]
      );
      await connection.commit();
      return safeAppeal({ id, group_id: found.id, appellant_id: appellant.id, reason: normalizedReason, status: "submitted", created_at: new Date().toISOString() });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const reviewAppeal = mysqlPublic(async ({ appealId, status, reviewer }) => {
    const target = String(status || "").trim();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const account = await requiredMysqlPlatformAdmin(reviewer, connection);
      const [appealRows] = await connection.execute("SELECT * FROM chat_appeals WHERE id = ? FOR UPDATE", [appealId]);
      if (!appealRows[0]) throw publicError("群聊申诉不存在", 404);
      const appeal = appealRows[0];
      if (!APPEAL_TRANSITIONS[appeal.status]?.has(target)) throw publicError("申诉状态不能这样切换", 409);
      const found = await groupById(appeal.group_id, connection, { forUpdate: true });
      const reviewedAt = new Date().toISOString();
      await connection.execute(
        "UPDATE chat_appeals SET status = ?, reviewer_id = ?, reviewed_at = ?, active_key = NULL WHERE id = ?",
        [target, account.id, reviewedAt, appeal.id]
      );
      if (target === "approved") {
        await connection.execute("UPDATE chat_groups SET status = 'active', frozen = 0 WHERE id = ?", [found.id]);
        await mysqlAudit(connection, { operatorId: account.id, action: "appeal_approved_and_group_restored", targetType: "chat_group", targetId: found.id, metadata: { appealId: appeal.id } });
      } else {
        await mysqlAudit(connection, { operatorId: account.id, action: `appeal_${target}`, targetType: "chat_appeal", targetId: appeal.id, metadata: { groupId: found.id } });
      }
      await connection.commit();
      return safeAppeal({ ...appeal, status: target, reviewer_id: account.id, reviewed_at: reviewedAt });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  const listAuditLogs = mysqlPublic(async (actor, { groupId = "", limit = 100 } = {}) => {
    await requiredMysqlPlatformAdmin(actor);
    const pageSize = normalizeLimit(limit, 100);
    const [rows] = groupId
      ? await execute("SELECT * FROM chat_audit_logs WHERE target_id = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.groupId')) = ? ORDER BY created_at DESC, id DESC LIMIT ?", [String(groupId), String(groupId), pageSize])
      : await execute("SELECT * FROM chat_audit_logs ORDER BY created_at DESC, id DESC LIMIT ?", [pageSize]);
    return rows.map(safeAuditLog);
  });

  return {
    createCustomGroup,
    listUserGroups,
    getGroupForUser,
    listMembers,
    createJoinRequest,
    reviewJoinRequest,
    listJoinRequests,
    createInvite,
    acceptInvite,
    createInviteToken,
    revokeInviteToken,
    searchGroupByNumber,
    createSticker,
    listStickers,
    favoriteSticker,
    createReport,
    createMessage,
    listMessages,
    updateReadCursor,
    listGovernanceGroups,
    setGroupStatus,
    createAppeal,
    reviewAppeal,
    listAuditLogs
  };
}

const memoryStore = createMemoryChatStore({
  users: data.users,
  campusClasses: data.campusClasses,
  classAssignments: data.classAssignments,
  chatGroups: data.chatGroups,
  chatMembers: data.chatMembers,
  chatJoinRequests: data.chatJoinRequests,
  chatInvites: data.chatInvites,
  chatInviteTokens: data.chatInviteTokens,
  chatMessages: data.chatMessages,
  chatMedia: data.chatMedia,
  chatStickers: data.chatStickers,
  chatStickerFavorites: data.chatStickerFavorites,
  chatReports: data.chatReports,
  chatReadCursors: data.chatReadCursors,
  chatAppeals: data.chatAppeals,
  chatAuditLogs: data.chatAuditLogs
});

function selectedStore() {
  return mysqlConfigured ? createMysqlChatStore(getPool()) : memoryStore;
}

module.exports = {
  inviteTokenDigest,
  createMemoryChatStore,
  createMysqlChatStore,
  createCustomGroup: (...args) => selectedStore().createCustomGroup(...args),
  listUserGroups: (...args) => selectedStore().listUserGroups(...args),
  getGroupForUser: (...args) => selectedStore().getGroupForUser(...args),
  listMembers: (...args) => selectedStore().listMembers(...args),
  createJoinRequest: (...args) => selectedStore().createJoinRequest(...args),
  reviewJoinRequest: (...args) => selectedStore().reviewJoinRequest(...args),
  listJoinRequests: (...args) => selectedStore().listJoinRequests(...args),
  createInvite: (...args) => selectedStore().createInvite(...args),
  acceptInvite: (...args) => selectedStore().acceptInvite(...args),
  createInviteToken: (...args) => selectedStore().createInviteToken(...args),
  revokeInviteToken: (...args) => selectedStore().revokeInviteToken(...args),
  searchGroupByNumber: (...args) => selectedStore().searchGroupByNumber(...args),
  createSticker: (...args) => selectedStore().createSticker(...args),
  listStickers: (...args) => selectedStore().listStickers(...args),
  favoriteSticker: (...args) => selectedStore().favoriteSticker(...args),
  createReport: (...args) => selectedStore().createReport(...args),
  createMessage: (...args) => selectedStore().createMessage(...args),
  listMessages: (...args) => selectedStore().listMessages(...args),
  updateReadCursor: (...args) => selectedStore().updateReadCursor(...args),
  listGovernanceGroups: (...args) => selectedStore().listGovernanceGroups(...args),
  setGroupStatus: (...args) => selectedStore().setGroupStatus(...args),
  createAppeal: (...args) => selectedStore().createAppeal(...args),
  reviewAppeal: (...args) => selectedStore().reviewAppeal(...args),
  listAuditLogs: (...args) => selectedStore().listAuditLogs(...args)
};
