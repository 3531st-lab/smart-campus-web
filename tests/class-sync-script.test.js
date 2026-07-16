const assert = require("node:assert/strict");
const test = require("node:test");

const { parseOptions, run } = require("../scripts/sync-class-groups");

test("class group synchronization defaults to a dry run and reports planned class work without writes", async () => {
  let synced = null;
  const summary = await run({
    argv: ["--dry-run"],
    studentStore: {
      async listStudents() {
        return [
          { id: "student-1", role: "student", status: "active", school: "Test University", college: "Business", className: "24 Digital Economy" },
          { id: "student-2", role: "student", status: "active", school: "Test University", college: "Business", className: "" },
          { id: "teacher-1", role: "teacher", status: "active", school: "Test University", college: "Business", className: "24 Digital Economy" }
        ];
      }
    },
    classStore: {
      async syncAllClasses(options) {
        synced = options;
        return { checked: 2, changed: 1, incomplete: 1, errors: [], dryRun: options.dryRun };
      }
    }
  });

  assert.deepEqual(synced, { dryRun: true });
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.identities.students, 2);
  assert.equal(summary.identities.teachers, 1);
  assert.equal(summary.identities.incompleteStudents, 1);
  assert.deepEqual(summary.identities.plannedGroups, [{ school: "Test University", college: "Business", className: "24 Digital Economy", studentCount: 1 }]);
});

test("class group synchronization refuses writes without an explicit confirmation", () => {
  assert.throws(() => parseOptions(["--apply"], {}), /CONFIRM_CLASS_SYNC=YES/);
  assert.deepEqual(parseOptions(["--apply"], { CONFIRM_CLASS_SYNC: "YES" }), { apply: true, dryRun: false });
});
