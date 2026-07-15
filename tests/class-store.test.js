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
    throw new Error("class group unavailable");
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
    assert.equal(data.classSyncErrors.at(-1).userId, student.id);
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
  assert.match(source, /SELECT id FROM students WHERE id = \? FOR UPDATE/);
  assert.match(source, /INSERT INTO campus_classes[^\n]*\n\s*VALUES[^\n]*\n\s*ON DUPLICATE KEY UPDATE/);
  assert.match(source, /INSERT INTO chat_groups[^\n]*\n\s*VALUES[^\n]*\n\s*ON DUPLICATE KEY UPDATE/);
});
