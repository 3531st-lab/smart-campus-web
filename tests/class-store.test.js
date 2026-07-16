process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.MYSQL_HOST = "";
process.env.CAMPUS_USER_ROLE = "super_admin";
process.env.CAMPUS_USER_STUDENT_NO = "TEST-SUPER-ADMIN";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const classStore = require("../server/class-store");
const data = require("../server/data");
const studentStore = require("../server/student-store");
const permanentAdmins = require("../server/permanent-admins");
const { createMemoryClassStore } = classStore;

function loadClassStoreWithFakeDb(fakeDb) {
  const dbPath = require.resolve("../server/db");
  const storePath = require.resolve("../server/class-store");
  const previousDb = require.cache[dbPath];
  const previousStore = require.cache[storePath];
  delete require.cache[storePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { mysqlConfigured: true, getPool: () => fakeDb }
  };
  try {
    return require("../server/class-store");
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousStore) require.cache[storePath] = previousStore;
    else delete require.cache[storePath];
  }
}

function loadStudentStoreWithFakeDb(fakeDb, fakeClassStore) {
  const dbPath = require.resolve("../server/db");
  const classStorePath = require.resolve("../server/class-store");
  const studentStorePath = require.resolve("../server/student-store");
  const previousDb = require.cache[dbPath];
  const previousClassStore = require.cache[classStorePath];
  const previousStudentStore = require.cache[studentStorePath];
  delete require.cache[studentStorePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { mysqlConfigured: true, autoMigrateSchema: false, getPool: () => fakeDb }
  };
  require.cache[classStorePath] = {
    id: classStorePath,
    filename: classStorePath,
    loaded: true,
    exports: fakeClassStore
  };
  try {
    return require("../server/student-store");
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousClassStore) require.cache[classStorePath] = previousClassStore;
    else delete require.cache[classStorePath];
    if (previousStudentStore) require.cache[studentStorePath] = previousStudentStore;
    else delete require.cache[studentStorePath];
  }
}

function fixtures() {
  return {
    student: {
      id: "student-1001",
      name: "张同学",
      school: "泰州学院",
      college: "经济与管理学院",
      className: "24数字经济1班",
      status: "active",
      role: "student"
    },
    teacher: {
      id: "teacher-1001",
      name: "李老师",
      school: "泰州学院",
      college: "经济与管理学院",
      className: "24数字经济1班",
      status: "active",
      role: "teacher"
    }
  };
}

test("student moves from old class group to new class group atomically", async () => {
  const store = createMemoryClassStore(fixtures());
  await store.ensureStudentClassAssignment(fixtures().student);

  const moved = await store.ensureStudentClassAssignment({
    ...fixtures().student,
    className: "24数字经济2班"
  });

  assert.equal(moved.activeAssignments.length, 1);
  assert.equal(moved.activeAssignments[0].className, "24数字经济2班");
  assert.equal(store.data.assignments.filter((assignment) => assignment.userId === fixtures().student.id && assignment.active).length, 1);
});

test("teacher does not join from identity class alone", async () => {
  const store = createMemoryClassStore(fixtures());
  const result = await store.ensureStudentClassAssignment(fixtures().teacher);

  assert.equal(result.changed, false);
  assert.deepEqual(result.activeAssignments, []);
});

test("student with incomplete class identity is not assigned", async () => {
  const store = createMemoryClassStore(fixtures());
  const result = await store.ensureStudentClassAssignment({ ...fixtures().student, college: "" });

  assert.equal(result.changed, false);
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.activeAssignments, []);
  assert.equal(store.data.classes.length, 0);
});

test("repeating a student sync is stable and idempotent", async () => {
  const store = createMemoryClassStore(fixtures());
  const first = await store.ensureStudentClassAssignment(fixtures().student);
  const repeated = await store.ensureStudentClassAssignment(fixtures().student);

  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.activeAssignments.length, 1);
  assert.equal(repeated.activeAssignments[0].classId, first.activeAssignments[0].classId);
  assert.equal(repeated.chatGroup.id, first.chatGroup.id);
});

test("memory sync creates the mandatory class group", async () => {
  const store = createMemoryClassStore(fixtures());
  const result = await store.ensureStudentClassAssignment(fixtures().student);

  assert.equal(result.chatGroup.type, "class");
  assert.equal(result.chatGroup.classId, result.activeAssignments[0].classId);
  assert.equal(result.class.groupId, result.chatGroup.id);
  assert.equal(store.data.groups.filter((group) => group.type === "class").length, 1);
});

test("account writes stay successful when class synchronization fails", async () => {
  const originalSync = classStore.ensureStudentClassAssignment;
  const studentNo = "SYNC-ERROR-1001";
  classStore.ensureStudentClassAssignment = async () => {
    throw new Error("SELECT private_sql_detail FROM chat_groups");
  };

  try {
    const student = await studentStore.upsertStudent({
      id: "sync-error-student",
      name: "同步失败学生",
      school: "同步学院",
      college: "信息学院",
      major: "软件工程",
      className: "24软件工程1班",
      studentNo,
      phone: "13800001001",
      status: "active",
      role: "student"
    });

    assert.equal(student.studentNo, studentNo);
    assert.equal(student.syncError.retryable, true);
    assert.equal("detail" in student.syncError, false);
    assert.doesNotMatch(JSON.stringify(student.syncError), /private_sql_detail/);
    assert.equal(data.classSyncErrors.at(-1).userId, student.id);
    assert.match(data.classSyncErrors.at(-1).detail, /private_sql_detail/);
  } finally {
    classStore.ensureStudentClassAssignment = originalSync;
    const userIndex = data.users.findIndex((user) => user.studentNo === studentNo);
    if (userIndex >= 0) data.users.splice(userIndex, 1);
    data.classSyncErrors.splice(0, data.classSyncErrors.length);
  }
});

test("MySQL synchronization locks the student and upserts class group records", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "class-store.js"), "utf8");

  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /SELECT id, role, status FROM students WHERE id = \? FOR UPDATE/);
  assert.match(source, /INSERT INTO campus_classes[^\n]*\n\s*VALUES[^\n]*\n\s*ON DUPLICATE KEY UPDATE/);
  assert.match(source, /INSERT INTO chat_groups[^\n]*\n\s*VALUES[^\n]*\n\s*ON DUPLICATE KEY UPDATE/);
});

test("setStudentDuty preserves student identity source and disabled users lose assignments", async () => {
  const fixture = fixtures();
  const store = createMemoryClassStore({ users: [fixture.student] });
  const initial = await store.ensureStudentClassAssignment(fixture.student);

  const assignment = await store.setStudentDuty({
    userId: fixture.student.id,
    classId: initial.class.id,
    duty: "monitor",
    operatorId: "admin-1001"
  });
  assert.equal(assignment.source, "student_identity");

  await store.ensureStudentClassAssignment({ ...fixture.student, status: "disabled" });
  assert.equal(store.data.assignments.some((item) => item.userId === fixture.student.id && item.active), false);
});

test("setStudentDuty only accepts the student's normalized identity class", async () => {
  const fixture = fixtures();
  const store = createMemoryClassStore({ users: [fixture.student] });
  const current = await store.ensureStudentClassAssignment(fixture.student);
  const other = await store.ensureStudentClassAssignment({ ...fixture.student, id: "other-student", className: "24数字经济2班" });
  await assert.rejects(
    store.setStudentDuty({ userId: fixture.student.id, classId: other.class.id, duty: "monitor", operatorId: "admin" }),
    /身份班级/
  );
  assert.deepEqual(store.data.assignments.filter((item) => item.userId === fixture.student.id && item.active).map((item) => item.classId), [current.class.id]);
});

test("memory bulk import preserves an existing protected role when role is omitted", async () => {
  const existing = { id: "preserved-admin", name: "已有管理员", school: "角色大学", college: "学院", major: "专业", className: "", studentNo: "ROLE-KEEP-1", phone: "13812345678", status: "active", role: "admin", verified: true };
  data.users.push(existing);
  try {
    const result = await studentStore.bulkUpsertStudents([{ rowNumber: 2, input: { ...existing, name: "更新姓名", role: "student", roleExplicit: false } }]);
    assert.equal(result.success, 1);
    assert.equal(data.users.find((item) => item.id === existing.id).role, "admin");
  } finally {
    const index = data.users.findIndex((item) => item.id === existing.id);
    if (index >= 0) data.users.splice(index, 1);
  }
});

test("sync summaries do not expose internal database errors", async () => {
  const fixture = fixtures();
  const store = createMemoryClassStore({ users: [fixture.student] });
  store.ensureStudentClassAssignment = async () => { throw new Error("SELECT secret FROM students"); };
  // Exercise the public implementation contract through source inspection because the closure is intentionally private.
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "class-store.js"), "utf8");
  assert.match(source, /message:\s*"班级同步失败"/);
  assert.doesNotMatch(source, /summary\.errors\.push\(\{ userId: user\.id, message: error\.message/);
});

test("platform admins lose assignments while active teachers retain explicit teacher assignments", async () => {
  const fixture = fixtures();
  const platformAdmin = { id: "platform-admin", role: "admin", status: "active" };
  const store = createMemoryClassStore({ users: [fixture.student, fixture.teacher, platformAdmin] });
  const initial = await store.ensureStudentClassAssignment(fixture.student);
  const teacherAssignment = await store.assignTeacher({
    userId: fixture.teacher.id,
    classId: initial.class.id,
    duty: "subject_teacher",
    operatorId: "admin-1001"
  });
  store.data.assignments.push({
    id: "admin-assignment",
    classId: initial.class.id,
    userId: platformAdmin.id,
    duty: "member",
    source: "admin_assignment",
    active: true
  });

  await store.ensureStudentClassAssignment(fixture.teacher);
  await store.ensureStudentClassAssignment(platformAdmin);

  assert.equal(store.data.assignments.find((item) => item.id === teacherAssignment.id).active, true);
  assert.equal(store.data.assignments.find((item) => item.id === "admin-assignment").active, false);
});

test("assignTeacher requires an active teacher and teacher duty", async () => {
  const fixture = fixtures();
  const student = fixture.student;
  const disabledTeacher = { ...fixture.teacher, id: "teacher-disabled", status: "disabled" };
  const store = createMemoryClassStore({ users: [student, fixture.teacher, disabledTeacher] });
  const initial = await store.ensureStudentClassAssignment(student);

  await assert.rejects(
    () => store.assignTeacher({ userId: student.id, classId: initial.class.id, duty: "subject_teacher", operatorId: "admin-1001" }),
    /教师/
  );
  await assert.rejects(
    () => store.assignTeacher({ userId: fixture.teacher.id, classId: initial.class.id, duty: "monitor", operatorId: "admin-1001" }),
    /职务/
  );
  await assert.rejects(
    () => store.assignTeacher({ userId: disabledTeacher.id, classId: initial.class.id, duty: "subject_teacher", operatorId: "admin-1001" }),
    /教师/
  );
});

test("teacher assignment creates a class group and returns its group id", async () => {
  const fixture = fixtures();
  const store = createMemoryClassStore({ users: [fixture.student, fixture.teacher] });
  const initial = await store.ensureStudentClassAssignment(fixture.student);
  store.data.groups.splice(0, store.data.groups.length);
  store.data.classes[0].groupId = null;

  const assignment = await store.assignTeacher({
    userId: fixture.teacher.id,
    classId: initial.class.id,
    duty: "head_teacher",
    operatorId: "admin-1001"
  });

  assert.ok(assignment.groupId);
  assert.equal(store.data.groups.some((group) => group.id === assignment.groupId && group.type === "class"), true);
});

test("memory dry-run preserves supplied array references and contents", async () => {
  const fixture = fixtures();
  const classes = [];
  const assignments = [];
  const groups = [];
  const store = createMemoryClassStore({
    users: [fixture.student],
    classes,
    assignments,
    groups
  });

  const result = await store.syncAllClasses({ dryRun: true });

  assert.equal(result.dryRun, true);
  assert.strictEqual(store.data.classes, classes);
  assert.strictEqual(store.data.assignments, assignments);
  assert.strictEqual(store.data.groups, groups);
  assert.deepEqual({ classes, assignments, groups }, { classes: [], assignments: [], groups: [] });
});

test("existing account keeps its persisted id when synchronized", async () => {
  const studentNo = "EXISTING-ID-1001";
  const existing = {
    id: "persisted-user-id",
    name: "原有学生",
    school: "同步学院",
    college: "信息学院",
    major: "软件工程",
    className: "24软件工程1班",
    studentNo,
    phone: "13800001002",
    status: "active",
    role: "student"
  };
  data.users.push(existing);
  try {
    const { id, ...updateInput } = existing;
    const updated = await studentStore.upsertStudent({ ...updateInput, name: "更新学生" });
    assert.equal(updated.id, existing.id);
    assert.equal(data.classAssignments.some((item) => item.userId === existing.id && item.active), true);
  } finally {
    for (const collection of [data.users, data.classAssignments]) {
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        if (collection[index].id === existing.id || collection[index].userId === existing.id) collection.splice(index, 1);
      }
    }
    data.campusClasses.splice(0, data.campusClasses.length);
    data.chatGroups.splice(0, data.chatGroups.length);
  }
});

test("permanent-super-admin enforcement synchronizes assignment cleanup", async () => {
  const originalEnforce = permanentAdmins.enforcePermanentPrivileges;
  const user = {
    id: "enforced-admin",
    name: "受保护账号",
    school: "同步学院",
    college: "信息学院",
    major: "软件工程",
    className: "24软件工程1班",
    studentNo: "ENFORCED-1001",
    phone: "13800001003",
    status: "active",
    role: "student"
  };
  data.users.push(user);
  data.classAssignments.push({ id: "enforced-assignment", classId: "enforced-class", userId: user.id, duty: "member", source: "student_identity", active: true });
  permanentAdmins.enforcePermanentPrivileges = (student) => student.id === user.id
    ? { ...student, role: "super_admin", status: "active" }
    : student;
  try {
    await studentStore.enforcePermanentSuperAdmins();
    assert.equal(data.classAssignments.find((item) => item.id === "enforced-assignment").active, false);
  } finally {
    permanentAdmins.enforcePermanentPrivileges = originalEnforce;
    for (const collection of [data.users, data.classAssignments]) {
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        if (collection[index].id === user.id || collection[index].userId === user.id || collection[index].id === "enforced-assignment") collection.splice(index, 1);
      }
    }
  }
});

test("runtime migration and MySQL admin assignment use the class lock order", () => {
  const studentSource = fs.readFileSync(path.join(__dirname, "..", "server", "student-store.js"), "utf8");
  const classSource = fs.readFileSync(path.join(__dirname, "..", "server", "class-store.js"), "utf8");
  const adminStart = classSource.indexOf("async function updateMysqlAssignment");
  const adminSource = classSource.slice(adminStart);

  assert.match(studentSource, /CREATE TABLE IF NOT EXISTS chat_groups[\s\S]*UNIQUE KEY uq_chat_group_class \(class_id\)/);
  assert.match(classSource, /if \(!studentRows\[0\]\) throw new Error/);
  assert.ok(adminSource.indexOf("FROM students WHERE id = ? FOR UPDATE") < adminSource.indexOf("SELECT * FROM campus_classes WHERE id = ? FOR UPDATE"));
  assert.match(adminSource, /INSERT INTO chat_groups/);
  assert.match(adminSource, /assigned_by/);
});

test("canonical schema defines class groups assignment operators and durable sync errors", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8");
  const studentSource = fs.readFileSync(path.join(__dirname, "..", "server", "student-store.js"), "utf8");

  for (const source of [schema, studentSource]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS chat_groups[\s\S]*id VARCHAR\(64\) PRIMARY KEY[\s\S]*type VARCHAR\(32\) NOT NULL[\s\S]*name VARCHAR\(120\) NOT NULL[\s\S]*class_id VARCHAR\(64\) NULL[\s\S]*status ENUM\('active','frozen','closed','disabled'\) NOT NULL DEFAULT 'active'[\s\S]*UNIQUE KEY uq_chat_group_class \(class_id\)/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS class_assignments[\s\S]*assigned_by VARCHAR\(64\) NULL/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS class_sync_errors[\s\S]*user_id VARCHAR\(64\) NOT NULL[\s\S]*student_no VARCHAR\(64\) NOT NULL DEFAULT ''[\s\S]*public_message VARCHAR\(160\) NOT NULL[\s\S]*diagnostic JSON NULL[\s\S]*recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  }
});

test("duplicate student numbers are scoped by school for upsert and ambiguous writes are rejected", async () => {
  const studentNo = "DUP-SCHOOL-1001";
  const schoolA = {
    id: "school-a-id",
    name: "School A Student",
    school: "School A",
    college: "College",
    major: "Software",
    className: "Class A",
    studentNo,
    phone: "13800002001",
    status: "active",
    role: "student"
  };
  const schoolB = {
    ...schoolA,
    id: "school-b-id",
    name: "School B Student",
    school: "School B",
    className: "Class B",
    phone: "13800002002"
  };
  data.users.push(schoolA, schoolB);
  try {
    const { id: _id, ...schoolBUpdate } = schoolB;
    const updated = await studentStore.upsertStudent({ ...schoolBUpdate, name: "Updated School B" });

    assert.equal(updated.id, schoolB.id);
    assert.equal(data.users.find((user) => user.id === schoolA.id).name, schoolA.name);
    assert.equal(data.users.find((user) => user.id === schoolB.id).name, "Updated School B");
    assert.equal(data.classAssignments.some((assignment) => assignment.userId === schoolB.id && assignment.active), true);
    assert.equal(data.classAssignments.some((assignment) => assignment.userId === schoolA.id && assignment.active), false);

    await assert.rejects(() => studentStore.setStudentStatus(studentNo, "disabled"), /学校|school|ambiguous/i);
    await assert.rejects(() => studentStore.setStudentRole(studentNo, "teacher"), /学校|school|ambiguous/i);

    const statusResult = await studentStore.setStudentStatus({ school: schoolB.school, studentNo }, "disabled");
    assert.equal(statusResult.updated, true);
    assert.equal(data.users.find((user) => user.id === schoolA.id).status, "active");
    assert.equal(data.users.find((user) => user.id === schoolB.id).status, "disabled");
  } finally {
    for (const collection of [data.users, data.classAssignments]) {
      for (let index = collection.length - 1; index >= 0; index -= 1) {
        if ([schoolA.id, schoolB.id].includes(collection[index].id) || [schoolA.id, schoolB.id].includes(collection[index].userId)) {
          collection.splice(index, 1);
        }
      }
    }
    data.campusClasses.splice(0, data.campusClasses.length);
    data.chatGroups.splice(0, data.chatGroups.length);
  }
});

test("MySQL sync error records durable failure honestly and keeps account write successful", async () => {
  const calls = [];
  const fakeDb = {
    async query(sql) {
      calls.push({ sql, params: [] });
      if (/SELECT id, name, school, major, student_no FROM students/.test(sql)) return [[]];
      return [{ affectedRows: 0 }];
    },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM students/.test(sql)) return [[]];
      if (/INSERT INTO students/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO class_sync_errors/.test(sql)) {
        const error = new Error("class_sync_errors storage unavailable");
        error.code = "ER_LOCK_WAIT_TIMEOUT";
        throw error;
      }
      if (/INSERT INTO admin_audit_logs/.test(sql)) return [{ affectedRows: 1 }];
      return [{ affectedRows: 0 }];
    }
  };
  const isolatedStore = loadStudentStoreWithFakeDb(fakeDb, {
    ensureStudentClassAssignment: async () => {
      throw new Error("SELECT secret_sql FROM chat_groups");
    }
  });

  data.classSyncErrors.splice(0, data.classSyncErrors.length);
  const student = await isolatedStore.upsertStudent({
    id: "durable-error-student",
    name: "Durable Error Student",
    school: "Durable School",
    college: "Durable College",
    major: "Software",
    className: "Software 1",
    studentNo: "DURABLE-ERR-1001",
    phone: "13800002003",
    status: "active",
    role: "student"
  });

  assert.equal(student.id, "durable-error-student");
  assert.equal(student.syncError.retryable, true);
  assert.equal(student.syncError.recording.memoryQueued, true);
  assert.equal(student.syncError.recording.durableRecorded, false);
  assert.equal(student.syncError.recording.auditRecorded, true);
  assert.doesNotMatch(JSON.stringify(student.syncError), /secret_sql|chat_groups|storage unavailable/);
  assert.match(data.classSyncErrors.at(-1).detail, /secret_sql/);

  const durableIndex = calls.findIndex((call) => /INSERT INTO class_sync_errors/.test(call.sql));
  const auditIndex = calls.findIndex((call) => /INSERT INTO admin_audit_logs/.test(call.sql));
  assert.ok(durableIndex >= 0);
  assert.ok(auditIndex > durableIndex);
  data.classSyncErrors.splice(0, data.classSyncErrors.length);
});

test("MySQL syncAllClasses dry-run reports would-change counts without opening transactions", async () => {
  const queries = [];
  const rows = {
    users: [
      { id: "mysql-ready", school: "S", college: "C", class_name: "Ready", role: "student", status: "active" },
      { id: "mysql-missing-class", school: "S", college: "C", class_name: "Missing", role: "student", status: "active" },
      { id: "mysql-missing-group", school: "S", college: "C", class_name: "Needs Group", role: "student", status: "active" },
      { id: "mysql-incomplete", school: "S", college: "", class_name: "Incomplete", role: "student", status: "active" }
    ],
    classes: new Map([
      ["s\u001fc\u001fready", { id: "class-ready", school: "S", college: "C", class_name: "Ready", class_key: "s\u001fc\u001fready", group_id: "group-ready", status: "active" }],
      ["s\u001fc\u001fneedsgroup", { id: "class-needs-group", school: "S", college: "C", class_name: "Needs Group", class_key: "s\u001fc\u001fneedsgroup", group_id: null, status: "active" }]
    ]),
    groups: new Map([
      ["class-ready", { id: "group-ready", type: "class", name: "Ready", class_id: "class-ready", status: "active" }]
    ]),
    assignments: new Map([
      ["mysql-ready", [{ class_id: "class-ready", user_id: "mysql-ready", duty: "member", source: "student_identity", active: 1 }]],
      ["mysql-missing-group", []]
    ])
  };
  const fakeDb = {
    async execute(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM students WHERE role = 'student'/.test(sql)) return [rows.users];
      if (/FROM campus_classes WHERE class_key IN/.test(sql)) return [params.map((key) => rows.classes.get(key)).filter(Boolean)];
      if (/FROM chat_groups WHERE type = 'class' AND class_id IN/.test(sql)) return [params.map((id) => rows.groups.get(id)).filter(Boolean)];
      if (/FROM class_assignments/.test(sql)) return [[...rows.assignments.values()].flat()];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() {
      throw new Error("dry-run must not open a transaction connection");
    }
  };
  const isolatedClassStore = loadClassStoreWithFakeDb(fakeDb);

  const summary = await isolatedClassStore.syncAllClasses({ dryRun: true });

  assert.deepEqual(
    { checked: summary.checked, changed: summary.changed, incomplete: summary.incomplete, dryRun: summary.dryRun },
    { checked: 4, changed: 2, incomplete: 1, dryRun: true }
  );
  assert.equal(queries.some((query) => /beginTransaction|UPDATE |INSERT INTO/i.test(query.sql)), false);
});

test("MySQL student duty rejects a cross-class assignment before writes", async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
    release() { calls.push("release"); },
    async execute(sql) {
      calls.push(sql);
      if (/FROM students WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{ id: "mysql-student", role: "student", status: "active", school: "学校A", college: "学院A", class_name: "一班" }]];
      }
      if (/FROM campus_classes WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{ id: "class-b", school: "学校B", college: "学院B", class_name: "二班", class_key: "学校b\u001f学院b\u001f二班", status: "active" }]];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const isolated = loadClassStoreWithFakeDb({ async getConnection() { return connection; } });
  await assert.rejects(
    isolated.setStudentDuty({ userId: "mysql-student", classId: "class-b", duty: "monitor", operatorId: "admin" }),
    /身份班级/
  );
  assert.equal(calls.includes("rollback"), true);
  assert.equal(calls.some((sql) => typeof sql === "string" && /INSERT INTO class_assignments|UPDATE class_assignments/.test(sql)), false);
});

test("password credentials are scoped by school and reject ambiguous no-school requests", async () => {
  const studentNo = "PWD-DUP-1001";
  const schoolA = {
    id: "pwd-school-a",
    name: "Password A",
    school: "Password School A",
    college: "College",
    major: "Software",
    className: "Class A",
    studentNo,
    phone: "13800003001",
    status: "active",
    role: "student"
  };
  const schoolB = {
    ...schoolA,
    id: "pwd-school-b",
    name: "Password B",
    school: "Password School B",
    className: "Class B",
    phone: "13800003002"
  };
  data.users.push(schoolA, schoolB);
  try {
    assert.equal(await studentStore.setPassword({ school: schoolB.school, studentNo }, "Classroom42", { mustChange: true }), true);

    assert.equal(await studentStore.verifyPassword({ school: schoolA.school, studentNo }, "Classroom42"), false);
    assert.equal(await studentStore.verifyPassword({ school: schoolB.school, studentNo }, "Classroom42"), true);
    assert.equal(data.users.find((user) => user.id === schoolA.id).passwordHash || "", "");
    assert.equal(data.users.find((user) => user.id === schoolB.id).mustChangePassword, true);

    await assert.rejects(() => studentStore.setPassword(studentNo, "Otherpass42"), /学校|school|ambiguous/i);
    await assert.rejects(() => studentStore.verifyPassword(studentNo, "Classroom42"), /学校|school|ambiguous/i);
    await assert.rejects(() => studentStore.clearPassword(studentNo), /学校|school|ambiguous/i);

    assert.equal(await studentStore.clearPassword({ school: schoolB.school, studentNo }), true);
    assert.equal(await studentStore.verifyPassword({ school: schoolB.school, studentNo }, "Classroom42"), false);
  } finally {
    for (let index = data.users.length - 1; index >= 0; index -= 1) {
      if ([schoolA.id, schoolB.id].includes(data.users[index].id)) data.users.splice(index, 1);
    }
  }
});

test("server credential call sites pass resolved identity to password store operations", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");

  assert.match(source, /verifyPassword\(\{ school: user\.school, studentNo: user\.studentNo \}/);
  assert.match(source, /clearPassword\(\{ id: target\.id, school: target\.school, studentNo: target\.studentNo \}/);
  assert.match(source, /setPassword\(\{ id: user\.id, school: user\.school, studentNo: user\.studentNo \}/);
  assert.doesNotMatch(source, /verifyPassword\(user\.studentNo/);
  assert.doesNotMatch(source, /clearPassword\(target\.studentNo/);
  assert.doesNotMatch(source, /setPassword\(user\.studentNo/);
});

test("MySQL dry-run counts class group id repair when group exists but class link is missing", async () => {
  const rows = {
    users: [
      { id: "mysql-group-link", school: "S", college: "C", class_name: "Needs Link", role: "student", status: "active" }
    ],
    classRow: { id: "class-needs-link", school: "S", college: "C", class_name: "Needs Link", class_key: "s\u001fc\u001fneedslink", group_id: null, status: "active" },
    groupRow: { id: "group-needs-link", type: "class", name: "Needs Link", class_id: "class-needs-link", status: "active" },
    assignmentRow: { class_id: "class-needs-link", user_id: "mysql-group-link", duty: "member", source: "student_identity", active: 1 }
  };
  const fakeDb = {
    async execute(sql, params = []) {
      if (/FROM students WHERE role = 'student'/.test(sql)) return [rows.users];
      if (/FROM campus_classes WHERE class_key IN/.test(sql)) return [[rows.classRow]];
      if (/FROM chat_groups WHERE type = 'class' AND class_id IN/.test(sql)) return [[rows.groupRow]];
      if (/FROM class_assignments/.test(sql)) return [[rows.assignmentRow]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() {
      throw new Error("dry-run must not open a transaction connection");
    }
  };
  const isolatedClassStore = loadClassStoreWithFakeDb(fakeDb);

  const summary = await isolatedClassStore.syncAllClasses({ dryRun: true });

  assert.equal(summary.checked, 1);
  assert.equal(summary.changed, 1);
  assert.equal(summary.incomplete, 0);
});
