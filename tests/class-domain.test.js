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
