const crypto = require("crypto");
const data = require("./data");
const { mysqlConfigured, getPool } = require("./db");
const { CLASS_DUTIES, classKey } = require("./class-domain");

const AUTO_ASSIGNMENT_SOURCE = "student_identity";

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
    operatorId: row.operator_id ?? row.operatorId ?? null,
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

  async function ensureStudentClassAssignment(user) {
    const values = classValues(user);
    const automatic = user.role === "student" && user.status === "active";
    if (!automatic) {
      let changed = false;
      for (const assignment of store.data.assignments) {
        if (assignment.userId === user.id && assignment.source === AUTO_ASSIGNMENT_SOURCE && assignment.active) {
          assignment.active = false;
          changed = true;
        }
      }
      return inactiveResult(changed);
    }
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

  function assignmentForAdmin({ userId, classId, duty, operatorId, source }) {
    validDuty(duty);
    const campusClass = store.data.classes.find((item) => item.id === classId);
    if (!campusClass) throw new Error("班级不存在");
    const { group } = ensureGroup(campusClass);
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
      assignment.source = source;
      assignment.active = true;
      assignment.operatorId = operatorId || null;
    }
    campusClass.groupId = group.id;
    return assignmentRow(assignment, campusClass);
  }

  async function assignTeacher({ userId, classId, duty = "subject_teacher", operatorId }) {
    return assignmentForAdmin({ userId, classId, duty, operatorId, source: "teacher_assignment" });
  }

  async function setStudentDuty({ userId, classId, duty, operatorId }) {
    return assignmentForAdmin({ userId, classId, duty, operatorId, source: "admin_assignment" });
  }

  async function syncAllClasses({ dryRun = false } = {}) {
    const snapshot = dryRun ? JSON.stringify(store.data) : "";
    const summary = { checked: 0, changed: 0, incomplete: 0, errors: [], dryRun: Boolean(dryRun) };
    for (const user of store.data.users) {
      if (user.role !== "student") continue;
      summary.checked += 1;
      try {
        const result = await ensureStudentClassAssignment(user);
        if (result.changed) summary.changed += 1;
        if (result.incomplete) summary.incomplete += 1;
      } catch (error) {
        summary.errors.push({ userId: user.id, message: error.message, retryable: true });
      }
    }
    if (dryRun) {
      const restored = JSON.parse(snapshot);
      Object.assign(store.data, restored);
    }
    return summary;
  }

  return { ...store, ensureStudentClassAssignment, assignTeacher, setStudentDuty, syncAllClasses };
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
    await connection.execute("SELECT id FROM students WHERE id = ? FOR UPDATE", [user.id]);
    if (user.role !== "student" || user.status !== "active") {
      const [result] = await connection.execute(
        "UPDATE class_assignments SET active = 0 WHERE user_id = ? AND source = ? AND active = 1",
        [user.id, AUTO_ASSIGNMENT_SOURCE]
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

async function updateMysqlAssignment({ userId, classId, duty, operatorId, source }) {
  validDuty(duty);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [classRows] = await connection.execute("SELECT * FROM campus_classes WHERE id = ? FOR UPDATE", [classId]);
    if (!classRows[0]) throw new Error("班级不存在");
    await connection.execute("SELECT id FROM students WHERE id = ? FOR UPDATE", [userId]);
    await connection.execute(`
      INSERT INTO class_assignments (class_id, user_id, duty, source, active)
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE duty = VALUES(duty), source = VALUES(source), active = 1
    `, [classId, userId, duty, source]);
    const [assignments] = await connection.execute(
      "SELECT * FROM class_assignments WHERE class_id = ? AND user_id = ? FOR UPDATE",
      [classId, userId]
    );
    await connection.commit();
    return assignmentRow(assignments[0], classRow(classRows[0]));
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
    ? updateMysqlAssignment({ ...input, duty: input.duty || "subject_teacher", source: "teacher_assignment" })
    : memoryStore.assignTeacher(input);
}

async function setStudentDuty(input) {
  return mysqlConfigured
    ? updateMysqlAssignment({ ...input, source: "admin_assignment" })
    : memoryStore.setStudentDuty(input);
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
        if (![user.school, user.college, user.className].every((value) => String(value || "").trim())) summary.incomplete += 1;
      } else {
        const result = await syncStudentMysql(user);
        if (result.changed) summary.changed += 1;
        if (result.incomplete) summary.incomplete += 1;
      }
    } catch (error) {
      summary.errors.push({ userId: user.id, message: error.message, retryable: true });
    }
  }
  return summary;
}

module.exports = {
  createMemoryClassStore,
  ensureStudentClassAssignment,
  assignTeacher,
  setStudentDuty,
  syncAllClasses
};
