const crypto = require("crypto");
const data = require("./data");
const { mysqlConfigured, getPool } = require("./db");
const { CLASS_DUTIES, classKey } = require("./class-domain");

const AUTO_ASSIGNMENT_SOURCE = "student_identity";
const TEACHER_ASSIGNMENT_SOURCE = "teacher_assignment";
const TEACHER_DUTIES = new Set(["head_teacher", "subject_teacher", "class_admin"]);

function classValues(user) {
  return {
    school: String(user.school || "").trim(),
    college: String(user.college || "").trim(),
    className: String(user.className ?? user.class_name ?? "").trim()
  };
}

function classRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    school: row.school,
    college: row.college,
    className: row.class_name ?? row.className,
    classKey: row.class_key ?? row.classKey,
    groupId: row.group_id ?? row.groupId ?? null,
    status: row.status || "active"
  };
}

function assignmentRow(row, campusClass) {
  return {
    id: row.id,
    classId: String(row.class_id ?? row.classId),
    userId: String(row.user_id ?? row.userId),
    duty: row.duty,
    source: row.source,
    active: Boolean(row.active),
    operatorId: row.assigned_by ?? row.operator_id ?? row.operatorId ?? null,
    className: campusClass?.className ?? row.class_name ?? row.className,
    school: campusClass?.school ?? row.school,
    college: campusClass?.college ?? row.college,
    groupId: campusClass?.groupId ?? row.group_id ?? row.groupId ?? null
  };
}

function groupRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    type: row.type,
    classId: String(row.class_id ?? row.classId),
    name: row.name,
    status: row.status || "active"
  };
}

function validDuty(duty) {
  if (!CLASS_DUTIES.includes(duty)) throw new Error("班级职务无效");
  return duty;
}

function incompleteResult() {
  return { changed: false, incomplete: true, activeAssignments: [] };
}

function inactiveResult(changed = false) {
  return { changed, activeAssignments: [] };
}

function activeMemoryAssignments(store, userId) {
  return store.data.assignments
    .filter((assignment) => assignment.userId === userId && assignment.active)
    .map((assignment) => assignmentRow(assignment, store.data.classes.find((item) => item.id === assignment.classId)));
}

function cloneMemoryRows(rows) {
  return JSON.parse(JSON.stringify(rows));
}

function createMemoryClassStore(seed = {}) {
  const store = {
    data: {
      users: seed.users || [],
      classes: seed.classes || seed.campusClasses || [],
      assignments: seed.assignments || seed.classAssignments || [],
      groups: seed.groups || seed.chatGroups || [],
      syncErrors: seed.syncErrors || []
    }
  };

  function ensureClass(values) {
    const key = classKey(values);
    let campusClass = store.data.classes.find((item) => item.classKey === key || item.class_key === key);
    let created = false;
    if (!campusClass) {
      campusClass = {
        id: `class-${crypto.randomUUID()}`,
        ...values,
        classKey: key,
        groupId: null,
        status: "active"
      };
      store.data.classes.push(campusClass);
      created = true;
    }
    return { campusClass, created };
  }

  function ensureGroup(campusClass) {
    let group = store.data.groups.find((item) => item.type === "class" && item.classId === campusClass.id);
    let created = false;
    if (!group) {
      group = {
        id: `class-group-${crypto.randomUUID()}`,
        type: "class",
        classId: campusClass.id,
        name: campusClass.className,
        status: "active"
      };
      store.data.groups.push(group);
      created = true;
    }
    if (campusClass.groupId !== group.id) {
      campusClass.groupId = group.id;
      created = true;
    }
    return { group, created };
  }

  function deactivateAssignments(userId, predicate = () => true) {
    let changed = false;
    for (const assignment of store.data.assignments) {
      if (assignment.userId === userId && assignment.active && predicate(assignment)) {
        assignment.active = false;
        changed = true;
      }
    }
    return changed;
  }

  function requiredUser(userId, role) {
    const user = store.data.users.find((item) => item.id === userId);
    if (!user || user.status !== "active" || user.role !== role) throw new Error("账号不是有效教师");
    return user;
  }

  async function ensureStudentClassAssignment(user) {
    const values = classValues(user);
    if (user.status !== "active" || ["admin", "super_admin", "guest"].includes(user.role)) {
      return inactiveResult(deactivateAssignments(user.id));
    }
    if (user.role === "teacher") {
      const changed = deactivateAssignments(user.id, (assignment) => assignment.source !== TEACHER_ASSIGNMENT_SOURCE);
      return { changed, activeAssignments: activeMemoryAssignments(store, user.id) };
    }
    if (user.role !== "student") return inactiveResult(deactivateAssignments(user.id));
    if (![values.school, values.college, values.className].every(Boolean)) return incompleteResult();

    const { campusClass, created: classCreated } = ensureClass(values);
    const { group, created: groupCreated } = ensureGroup(campusClass);
    let changed = classCreated || groupCreated;
    for (const assignment of store.data.assignments) {
      if (assignment.userId === user.id && assignment.classId !== campusClass.id && assignment.active) {
        assignment.active = false;
        changed = true;
      }
    }
    let assignment = store.data.assignments.find((item) => item.userId === user.id && item.classId === campusClass.id);
    if (!assignment) {
      assignment = {
        id: `class-assignment-${crypto.randomUUID()}`,
        classId: campusClass.id,
        userId: user.id,
        duty: "member",
        source: AUTO_ASSIGNMENT_SOURCE,
        active: true,
        operatorId: null
      };
      store.data.assignments.push(assignment);
      changed = true;
    } else if (!assignment.active) {
      assignment.active = true;
      changed = true;
    }
    return {
      changed,
      class: classRow(campusClass),
      chatGroup: groupRow(group),
      activeAssignments: activeMemoryAssignments(store, user.id)
    };
  }

  function assignmentForAdmin({ userId, classId, duty, operatorId, source, role }) {
    validDuty(duty);
    let user;
    if (role === "teacher") {
      user = requiredUser(userId, "teacher");
      if (!TEACHER_DUTIES.has(duty)) throw new Error("教师班级职务无效");
    } else {
      user = requiredUser(userId, "student");
    }
    const campusClass = store.data.classes.find((item) => item.id === classId);
    if (!campusClass) throw new Error("班级不存在");
    if (role === "student" && classKey(classValues(user)) !== (campusClass.classKey ?? campusClass.class_key)) {
      throw new Error("所选班级与学生身份班级不一致");
    }
    const { group } = ensureGroup(campusClass);
    if (role === "student") deactivateAssignments(userId, (item) => item.classId !== classId);
    let assignment = store.data.assignments.find((item) => item.userId === userId && item.classId === classId);
    if (!assignment) {
      assignment = {
        id: `class-assignment-${crypto.randomUUID()}`,
        classId,
        userId,
        duty,
        source,
        active: true,
        operatorId: operatorId || null
      };
      store.data.assignments.push(assignment);
    } else {
      assignment.duty = duty;
      assignment.source = role === "student" ? AUTO_ASSIGNMENT_SOURCE : source;
      assignment.active = true;
      assignment.operatorId = operatorId || null;
    }
    campusClass.groupId = group.id;
    return assignmentRow(assignment, campusClass);
  }

  async function assignTeacher({ userId, classId, duty = "subject_teacher", operatorId }) {
    return assignmentForAdmin({ userId, classId, duty, operatorId, source: TEACHER_ASSIGNMENT_SOURCE, role: "teacher" });
  }

  async function setStudentDuty({ userId, classId, duty, operatorId }) {
    return assignmentForAdmin({ userId, classId, duty, operatorId, source: AUTO_ASSIGNMENT_SOURCE, role: "student" });
  }

  async function removeTeacherAssignment({ userId, classId }) {
    requiredUser(userId, "teacher");
    return { removed: deactivateAssignments(userId, (item) => item.classId === classId && item.source === TEACHER_ASSIGNMENT_SOURCE) };
  }

  async function syncAllClasses({ dryRun = false } = {}) {
    if (dryRun) {
      const simulation = createMemoryClassStore({
        users: cloneMemoryRows(store.data.users),
        classes: cloneMemoryRows(store.data.classes),
        assignments: cloneMemoryRows(store.data.assignments),
        groups: cloneMemoryRows(store.data.groups),
        syncErrors: cloneMemoryRows(store.data.syncErrors)
      });
      const summary = await simulation.syncAllClasses();
      return { ...summary, dryRun: true };
    }
    const summary = { checked: 0, changed: 0, incomplete: 0, errors: [], dryRun: Boolean(dryRun) };
    for (const user of store.data.users) {
      if (user.role !== "student") continue;
      summary.checked += 1;
      try {
        const result = await ensureStudentClassAssignment(user);
        if (result.changed) summary.changed += 1;
        if (result.incomplete) summary.incomplete += 1;
      } catch (error) {
        console.error("class synchronization failed", { userId: user.id, error: error.message });
        summary.errors.push({ userId: user.id, message: "班级同步失败", retryable: true });
      }
    }
    return summary;
  }

  return { ...store, ensureStudentClassAssignment, assignTeacher, setStudentDuty, removeTeacherAssignment, syncAllClasses };
}

async function activeMysqlAssignments(connection, userId) {
  const [rows] = await connection.execute(`
    SELECT ca.*, cc.school, cc.college, cc.class_name, cc.group_id
    FROM class_assignments ca
    INNER JOIN campus_classes cc ON cc.id = ca.class_id
    WHERE ca.user_id = ? AND ca.active = 1
    FOR UPDATE
  `, [userId]);
  return rows.map((row) => assignmentRow(row, classRow(row)));
}

async function syncStudentMysql(user) {
  const values = classValues(user);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [studentRows] = await connection.execute("SELECT id, role, status FROM students WHERE id = ? FOR UPDATE", [user.id]);
    if (!studentRows[0]) throw new Error("学生账号不存在");
    if (user.status !== "active" || ["admin", "super_admin", "guest"].includes(user.role)) {
      const [result] = await connection.execute(
        "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND active = 1",
        [user.id]
      );
      await connection.commit();
      return inactiveResult(result.affectedRows > 0);
    }
    if (user.role === "teacher") {
      const [result] = await connection.execute(
        "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND source <> ? AND active = 1",
        [user.id, TEACHER_ASSIGNMENT_SOURCE]
      );
      const activeAssignments = await activeMysqlAssignments(connection, user.id);
      await connection.commit();
      return { changed: result.affectedRows > 0, activeAssignments };
    }
    if (user.role !== "student") {
      const [result] = await connection.execute(
        "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND active = 1",
        [user.id]
      );
      await connection.commit();
      return inactiveResult(result.affectedRows > 0);
    }
    if (![values.school, values.college, values.className].every(Boolean)) {
      await connection.commit();
      return incompleteResult();
    }

    const key = classKey(values);
    const [classUpsert] = await connection.execute(`
      INSERT INTO campus_classes (id, school, college, class_name, class_key, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE school = VALUES(school), college = VALUES(college), class_name = VALUES(class_name), status = 'active'
    `, [`class-${crypto.randomUUID()}`, values.school, values.college, values.className, key]);
    const [classRows] = await connection.execute("SELECT * FROM campus_classes WHERE class_key = ? FOR UPDATE", [key]);
    const classCreated = classUpsert.affectedRows === 1;
    const campusClass = classRow(classRows[0]);
    const [groupUpsert] = await connection.execute(`
      INSERT INTO chat_groups (id, type, name, class_id, status)
      VALUES (?, 'class', ?, ?, 'active')
      ON DUPLICATE KEY UPDATE id = id
    `, [`class-group-${crypto.randomUUID()}`, campusClass.className, campusClass.id]);
    const [groupRows] = await connection.execute(
      "SELECT * FROM chat_groups WHERE type = 'class' AND class_id = ? FOR UPDATE",
      [campusClass.id]
    );
    let groupCreated = groupUpsert.affectedRows === 1;
    const chatGroup = groupRow(groupRows[0]);
    if (campusClass.groupId !== chatGroup.id) {
      await connection.execute("UPDATE campus_classes SET group_id = ? WHERE id = ?", [chatGroup.id, campusClass.id]);
      campusClass.groupId = chatGroup.id;
      groupCreated = true;
    }

    const activeBefore = await activeMysqlAssignments(connection, user.id);
    const [deactivated] = await connection.execute(
      "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND class_id <> ? AND active = 1",
      [user.id, campusClass.id]
    );
    const current = activeBefore.find((assignment) => assignment.classId === campusClass.id);
    await connection.execute(`
      INSERT INTO class_assignments (class_id, user_id, duty, source, active)
      VALUES (?, ?, 'member', ?, 1)
      ON DUPLICATE KEY UPDATE active = 1
    `, [campusClass.id, user.id, AUTO_ASSIGNMENT_SOURCE]);
    const activeAssignments = await activeMysqlAssignments(connection, user.id);
    await connection.commit();
    return {
      changed: classCreated || groupCreated || deactivated.affectedRows > 0 || !current,
      class: campusClass,
      chatGroup,
      activeAssignments
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateMysqlAssignment({ userId, classId, duty, operatorId, source, role }) {
  validDuty(duty);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [studentRows] = await connection.execute("SELECT id, role, status, school, college, class_name FROM students WHERE id = ? FOR UPDATE", [userId]);
    if (!studentRows[0]) throw new Error("账号不存在");
    if (studentRows[0].status !== "active" || studentRows[0].role !== role) {
      throw new Error(role === "teacher" ? "账号不是有效教师" : "账号不是有效学生");
    }
    if (role === "teacher" && !TEACHER_DUTIES.has(duty)) throw new Error("教师班级职务无效");
    const [classRows] = await connection.execute("SELECT * FROM campus_classes WHERE id = ? FOR UPDATE", [classId]);
    if (!classRows[0]) throw new Error("班级不存在");
    const campusClass = classRow(classRows[0]);
    if (role === "student" && classKey(classValues({ ...studentRows[0], className: studentRows[0].class_name })) !== campusClass.classKey) {
      throw new Error("所选班级与学生身份班级不一致");
    }
    const [groupUpsert] = await connection.execute(`
      INSERT INTO chat_groups (id, type, name, class_id, status)
      VALUES (?, 'class', ?, ?, 'active')
      ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'active'
    `, [`class-group-${crypto.randomUUID()}`, campusClass.className, campusClass.id]);
    const [groupRows] = await connection.execute(
      "SELECT * FROM chat_groups WHERE type = 'class' AND class_id = ? FOR UPDATE",
      [campusClass.id]
    );
    const chatGroup = groupRow(groupRows[0]);
    if (chatGroup && (campusClass.groupId !== chatGroup.id || groupUpsert.affectedRows > 0)) {
      await connection.execute("UPDATE campus_classes SET group_id = ? WHERE id = ?", [chatGroup.id, campusClass.id]);
      campusClass.groupId = chatGroup.id;
    }
    try {
      if (role === "student") {
        await connection.execute(
          "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND class_id <> ? AND active = 1",
          [userId, classId]
        );
      }
      await connection.execute(`
        INSERT INTO class_assignments (class_id, user_id, duty, source, active, assigned_by)
        VALUES (?, ?, ?, ?, 1, ?)
        ON DUPLICATE KEY UPDATE duty = VALUES(duty), source = VALUES(source), active = 1, assigned_by = VALUES(assigned_by)
      `, [classId, userId, duty, source, operatorId || null]);
    } catch (error) {
      if (error.code !== "ER_BAD_FIELD_ERROR" || !String(error.message || "").includes("assigned_by")) throw error;
      await connection.execute(`
        INSERT INTO class_assignments (class_id, user_id, duty, source, active)
        VALUES (?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE duty = VALUES(duty), source = VALUES(source), active = 1
      `, [classId, userId, duty, source]);
    }
    const [assignments] = await connection.execute(
      "SELECT * FROM class_assignments WHERE class_id = ? AND user_id = ? FOR UPDATE",
      [classId, userId]
    );
    await connection.commit();
    return assignmentRow(assignments[0], campusClass);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const memoryStore = createMemoryClassStore({
  users: data.users,
  campusClasses: data.campusClasses,
  classAssignments: data.classAssignments,
  chatGroups: data.chatGroups,
  syncErrors: data.classSyncErrors
});

async function ensureStudentClassAssignment(user) {
  return mysqlConfigured ? syncStudentMysql(user) : memoryStore.ensureStudentClassAssignment(user);
}

async function assignTeacher(input) {
  return mysqlConfigured
    ? updateMysqlAssignment({ ...input, duty: input.duty || "subject_teacher", source: TEACHER_ASSIGNMENT_SOURCE, role: "teacher" })
    : memoryStore.assignTeacher(input);
}

async function setStudentDuty(input) {
  return mysqlConfigured
    ? updateMysqlAssignment({ ...input, source: AUTO_ASSIGNMENT_SOURCE, role: "student" })
    : memoryStore.setStudentDuty(input);
}

async function removeTeacherAssignment(input) {
  if (!mysqlConfigured) return memoryStore.removeTeacherAssignment(input);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute("SELECT id, role, status FROM students WHERE id = ? FOR UPDATE", [input.userId]);
    if (!users[0] || users[0].role !== "teacher" || users[0].status !== "active") throw new Error("账号不是有效教师");
    const [result] = await connection.execute(
      "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND class_id = ? AND source = ? AND active = 1",
      [input.userId, input.classId, TEACHER_ASSIGNMENT_SOURCE]
    );
    await connection.commit();
    return { removed: result.affectedRows > 0 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function previewMysqlStudentSync(user) {
  const values = classValues(user);
  if (user.status !== "active" || user.role !== "student") {
    const [activeRows] = await getPool().execute(
      "SELECT * FROM class_assignments WHERE user_id = ? AND active = 1",
      [user.id]
    );
    return { changed: activeRows.length > 0, incomplete: false };
  }
  if (![values.school, values.college, values.className].every(Boolean)) {
    return { changed: false, incomplete: true };
  }

  const key = classKey(values);
  const [classRows] = await getPool().execute("SELECT * FROM campus_classes WHERE class_key = ?", [key]);
  if (!classRows[0]) return { changed: true, incomplete: false };

  const campusClass = classRow(classRows[0]);
  const [groupRows] = await getPool().execute(
    "SELECT * FROM chat_groups WHERE type = 'class' AND class_id = ?",
    [campusClass.id]
  );
  const [activeRows] = await getPool().execute(
    "SELECT * FROM class_assignments WHERE user_id = ? AND active = 1",
    [user.id]
  );
  const hasClassGroup = Boolean(groupRows[0]) && campusClass.groupId === String(groupRows[0].id);
  const hasCurrentAssignment = activeRows.some((assignment) => (
    String(assignment.class_id ?? assignment.classId) === campusClass.id
    && (assignment.source ?? AUTO_ASSIGNMENT_SOURCE) === AUTO_ASSIGNMENT_SOURCE
  ));
  const hasStaleAssignment = activeRows.some((assignment) => String(assignment.class_id ?? assignment.classId) !== campusClass.id);
  return {
    changed: !hasClassGroup || !hasCurrentAssignment || hasStaleAssignment,
    incomplete: false
  };
}

async function syncAllClasses(options = {}) {
  if (!mysqlConfigured) return memoryStore.syncAllClasses(options);
  const [users] = await getPool().execute("SELECT * FROM students WHERE role = 'student'");
  const summary = { checked: 0, changed: 0, incomplete: 0, errors: [], dryRun: Boolean(options.dryRun) };
  for (const row of users) {
    const user = {
      id: row.id,
      school: row.school,
      college: row.college,
      className: row.class_name,
      role: row.role,
      status: row.status
    };
    summary.checked += 1;
    try {
      if (options.dryRun) {
        const result = await previewMysqlStudentSync(user);
        if (result.changed) summary.changed += 1;
        if (result.incomplete) summary.incomplete += 1;
      } else {
        const result = await syncStudentMysql(user);
        if (result.changed) summary.changed += 1;
        if (result.incomplete) summary.incomplete += 1;
      }
    } catch (error) {
      console.error("class synchronization failed", { userId: user.id, error: error.message });
      summary.errors.push({ userId: user.id, message: "班级同步失败", retryable: true });
    }
  }
  return summary;
}

module.exports = {
  createMemoryClassStore,
  ensureStudentClassAssignment,
  assignTeacher,
  setStudentDuty,
  removeTeacherAssignment,
  syncAllClasses
};
