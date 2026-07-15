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
  assert.ok(adminSource.indexOf("SELECT id, role, status FROM students WHERE id = ? FOR UPDATE") < adminSource.indexOf("SELECT * FROM campus_classes WHERE id = ? FOR UPDATE"));
  assert.match(adminSource, /INSERT INTO chat_groups/);
  assert.match(adminSource, /assigned_by/);
});
