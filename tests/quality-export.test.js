const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { buildQualityWorkbook } = require("../server/quality-export");

test("export preserves five modules with positive deduction inputs and formulas", () => {
  const workbookBuffer = buildQualityWorkbook({
    period: { id: "period-demo", name: "2025-2026学年第一学期" },
    students: [{ id: "student-demo", name: "示例学生", studentNo: "DEMO2025001", className: "24数字经济班" }],
    records: [{
      id: "record-demo",
      studentId: "student-demo",
      calculationSnapshot: { calculation: {
        moral: { base: 18, bonus: 2.3, deduction: 0.5 },
        intellectual: { base: 36, bonus: 1.2, deduction: 0.2 },
        physical: { base: 4, bonus: 0.5, deduction: 0.2 },
        aesthetic: { base: 3, bonus: 1, deduction: 0.3 },
        labor: { base: 4, bonus: 1.5, deduction: 0.5 }
      }}
    }]
  });
  const workbook = XLSX.read(workbookBuffer, { type: "buffer", cellFormula: true });
  assert.deepEqual(workbook.SheetNames, ["学年汇总表", "学期汇总表", "学期情况一览表", "学期登记表"]);
  const detail = workbook.Sheets["学期情况一览表"];
  assert.equal(detail.F4.v, 0.5);
  assert.match(detail.G4.f, /D4\+E4-F4/);
  assert.match(detail.X4.f, /G4\+K4\+O4\+S4\+W4/);
});
