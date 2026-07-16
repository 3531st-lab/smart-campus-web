const fs = require("fs");
const path = require("path");

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseOptions(argv = [], env = process.env) {
  const apply = argv.includes("--apply");
  if (apply && env.CONFIRM_CLASS_SYNC !== "YES") {
    throw new Error("Set CONFIRM_CLASS_SYNC=YES before applying class synchronization");
  }
  return { apply, dryRun: !apply };
}

function string(value) {
  return String(value || "").trim();
}

function isCompleteStudent(student) {
  return [student.school, student.college, student.className].every((value) => string(value));
}

function summarizeIdentities(rows) {
  const students = rows.filter((row) => row.role === "student" && row.status === "active");
  const teachers = rows.filter((row) => row.role === "teacher" && row.status === "active");
  const planned = new Map();
  students.filter(isCompleteStudent).forEach((student) => {
    const key = [student.school, student.college, student.className].map(string).join("\u0000");
    const current = planned.get(key) || {
      school: string(student.school),
      college: string(student.college),
      className: string(student.className),
      studentCount: 0
    };
    current.studentCount += 1;
    planned.set(key, current);
  });
  return {
    students: students.length,
    teachers: teachers.length,
    incompleteStudents: students.filter((student) => !isCompleteStudent(student)).length,
    teacherAssignments: teachers.filter(isCompleteStudent).length,
    plannedGroups: [...planned.values()].sort((left, right) => (
      `${left.school}\u0000${left.college}\u0000${left.className}`.localeCompare(`${right.school}\u0000${right.college}\u0000${right.className}`, "zh-CN")
    ))
  };
}

async function listAllStudents(studentStore) {
  const rows = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = await studentStore.listStudents({ limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function run({ argv = process.argv.slice(2), studentStore, classStore } = {}) {
  const options = parseOptions(argv);
  const identities = await listAllStudents(studentStore);
  const sync = await classStore.syncAllClasses({ dryRun: options.dryRun });
  return {
    mode: options.dryRun ? "dry-run" : "apply",
    generatedAt: new Date().toISOString(),
    identities: summarizeIdentities(identities),
    sync
  };
}

async function main() {
  loadLocalEnv();
  const studentStore = require("../server/student-store");
  const classStore = require("../server/class-store");
  const result = await run({ studentStore, classStore });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadLocalEnv, parseOptions, summarizeIdentities, listAllStudents, run };
