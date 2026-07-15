const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CLASS_DUTIES, classDutyRank, classKey, compareIdentityByClass } = require("../server/class-domain");

const ROOT = path.resolve(__dirname, "..");

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

test("class duty ranks use the defined duty order and default to member", () => {
  assert.deepEqual(CLASS_DUTIES, ["member", "monitor", "league_secretary", "class_admin", "head_teacher", "subject_teacher"]);
  assert.equal(classDutyRank("member"), 0);
  assert.equal(classDutyRank("subject_teacher"), 5);
  assert.equal(classDutyRank("unknown"), 0);
});

test("identity sort orders platform roles within the same class", () => {
  const rows = [
    { school: "泰州学院", college: "经济与管理学院", className: "24数字经济", role: "super_admin", name: "丁" },
    { school: "泰州学院", college: "经济与管理学院", className: "24数字经济", role: "admin", name: "丙" },
    { school: "泰州学院", college: "经济与管理学院", className: "24数字经济", role: "teacher", name: "乙" },
    { school: "泰州学院", college: "经济与管理学院", className: "24数字经济", role: "student", name: "甲" }
  ].sort(compareIdentityByClass);
  assert.deepEqual(rows.map((row) => row.role), ["student", "teacher", "admin", "super_admin"]);
});

test("automatic migration provisions class tables and class ordering index", () => {
  const source = fs.readFileSync(path.join(ROOT, "server", "student-store.js"), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS campus_classes/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS class_assignments/);
  assert.match(source, /ADD INDEX idx_class_identity_order \(school, college, class_name, role, name, student_no\)/);
  assert.match(source, /DROP INDEX uq_class_identity/);
});

test("schema enforces class identity through the normalized class key only", () => {
  const schema = fs.readFileSync(path.join(ROOT, "server", "schema.sql"), "utf8");
  assert.match(schema, /UNIQUE KEY uq_class_key \(class_key\)/);
  assert.doesNotMatch(schema, /UNIQUE KEY uq_class_identity \(school, college, class_name\)/);
});
