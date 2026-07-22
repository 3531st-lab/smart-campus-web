const XLSX = require("xlsx");
const { getQualityRuleVersion } = require("./quality-rules");

const SHEET_NAMES = Object.freeze(["学年汇总表", "学期汇总表", "学期情况一览表", "学期登记表"]);
const EXPORT_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MODULES = Object.entries(getQualityRuleVersion().modules).map(([id, module]) => ({ id, ...module }));

const TITLE_FILL = "1F4E79";
const HEADER_FILL = "D9EAF7";
const MODULE_FILLS = ["FCE4D6", "E2F0D9", "DDEBF7", "E4DFEC", "FFF2CC"];
const THIN_BORDER = { style: "thin", color: { rgb: "B7C9D6" } };

function cell(value, style = {}) {
  const valueType = typeof value === "number" ? "n" : "s";
  return { v: value, t: valueType, s: style };
}

function formula(expression, style = {}) {
  return { f: expression, t: "n", s: style };
}

function titleStyle() {
  return {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
    fill: { fgColor: { rgb: TITLE_FILL } },
    alignment: { horizontal: "center", vertical: "center" }
  };
}

function headerStyle(fill = HEADER_FILL) {
  return {
    font: { bold: true, color: { rgb: "163A56" } },
    fill: { fgColor: { rgb: fill } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER }
  };
}

function dataStyle() {
  return {
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
    border: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER }
  };
}

function moduleNumber(record, moduleId, field) {
  const value = record?.calculationSnapshot?.calculation?.[moduleId]?.[field]
    ?? record?.calculationSnapshot?.[moduleId]?.[field]
    ?? record?.moduleScores?.[moduleId]?.[field]
    ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStudent(student = {}, index) {
  return {
    id: String(student.id || student.studentId || `student-${index + 1}`),
    name: String(student.name || "未命名学生"),
    studentNo: String(student.studentNo || student.student_no || student.studentId || ""),
    className: String(student.className || student.class_name || student.classId || "未分班")
  };
}

function collectRows({ students = [], records = [] }) {
  const studentMap = new Map(students.map((student, index) => {
    const normalized = normalizeStudent(student, index);
    return [normalized.id, normalized];
  }));
  return records.map((record, index) => {
    const student = studentMap.get(String(record.studentId || record.student_id)) || normalizeStudent({
      id: record.studentId || record.student_id,
      name: record.studentName || record.student_name,
      studentNo: record.studentNo || record.student_no,
      className: record.className || record.class_name || record.classId
    }, index);
    const modules = Object.fromEntries(MODULES.map((module) => [module.id, {
      base: moduleNumber(record, module.id, "base"),
      bonus: moduleNumber(record, module.id, "bonus"),
      deduction: moduleNumber(record, module.id, "deduction")
    }]));
    return { student, record, modules };
  });
}

function setRow(sheet, rowNumber, values, styles = []) {
  values.forEach((value, columnIndex) => {
    const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: columnIndex });
    sheet[address] = value && value.f ? formula(value.f, styles[columnIndex] || dataStyle()) : cell(value, styles[columnIndex] || dataStyle());
  });
}

function finalizeSheet(sheet, range, columns, rowHeights = {}) {
  sheet["!ref"] = range;
  sheet["!cols"] = columns.map((width) => ({ wch: width }));
  sheet["!rows"] = Object.entries(rowHeights).map(([row, hpt]) => ({ hpt, level: Number(row) - 1 }));
  sheet["!view"] = [{ showGridLines: false }];
  sheet["!autofilter"] = { ref: range };
}

function buildTermDetailSheet(rows, periodName) {
  const sheet = {};
  const headers = ["序号", "学号", "姓名"];
  MODULES.forEach((module) => headers.push(`${module.label}基础分`, `${module.label}加分`, `${module.label}扣分`, `${module.label}得分`));
  headers.push("总分", "排名");
  setRow(sheet, 1, [`${periodName} 综合素质测评学期情况一览表`], [titleStyle()]);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  setRow(sheet, 3, headers, headers.map((_, index) => headerStyle(index >= 3 ? MODULE_FILLS[Math.floor((index - 3) / 4)] : HEADER_FILL)));
  rows.forEach((entry, index) => {
    const rowNumber = index + 4;
    const values = [index + 1, entry.student.studentNo, entry.student.name];
    const totalColumns = [];
    MODULES.forEach((module, moduleIndex) => {
      const startColumn = 3 + moduleIndex * 4;
      const excelRow = rowNumber;
      values.push(entry.modules[module.id].base, entry.modules[module.id].bonus, entry.modules[module.id].deduction, { f: `${XLSX.utils.encode_col(startColumn)}${excelRow}+${XLSX.utils.encode_col(startColumn + 1)}${excelRow}-${XLSX.utils.encode_col(startColumn + 2)}${excelRow}` });
      totalColumns.push(`${XLSX.utils.encode_col(startColumn + 3)}${excelRow}`);
    });
    values.push({ f: totalColumns.join("+") }, { f: `RANK(${XLSX.utils.encode_col(headers.length - 2)}${rowNumber},$${XLSX.utils.encode_col(headers.length - 2)}$4:$${XLSX.utils.encode_col(headers.length - 2)}$${Math.max(4, rows.length + 3)},0)` });
    setRow(sheet, rowNumber, values);
  });
  const end = Math.max(4, rows.length + 3);
  finalizeSheet(sheet, `A1:${XLSX.utils.encode_col(headers.length - 1)}${end}`, [7, 15, 14, ...Array(20).fill(11), 11, 9], { 1: 24, 3: 36 });
  return sheet;
}

function buildTermSummarySheet(rows, periodName) {
  const sheet = {};
  const headers = ["序号", "班级", "学号", "姓名", ...MODULES.map((module) => `${module.label}得分`), "总分", "排名"];
  setRow(sheet, 1, [`${periodName} 综合素质测评学期汇总表`], [titleStyle()]);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  setRow(sheet, 3, headers, headers.map((_, index) => headerStyle(index >= 4 && index < 9 ? MODULE_FILLS[index - 4] : HEADER_FILL)));
  rows.forEach((entry, index) => {
    const rowNumber = index + 4;
    const values = [index + 1, entry.student.className, entry.student.studentNo, entry.student.name];
    const summaryColumns = [];
    MODULES.forEach((module, moduleIndex) => {
      const startColumn = 4 + moduleIndex;
      const detailColumn = XLSX.utils.encode_col(6 + moduleIndex * 4);
      values.push({ f: `'学期情况一览表'!${detailColumn}${rowNumber}` });
      summaryColumns.push(`${XLSX.utils.encode_col(startColumn)}${rowNumber}`);
    });
    values.push({ f: summaryColumns.join("+") }, { f: `RANK(${XLSX.utils.encode_col(headers.length - 2)}${rowNumber},$${XLSX.utils.encode_col(headers.length - 2)}$4:$${XLSX.utils.encode_col(headers.length - 2)}$${Math.max(4, rows.length + 3)},0)` });
    setRow(sheet, rowNumber, values);
  });
  finalizeSheet(sheet, `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(4, rows.length + 3)}`, [7, 16, 15, 14, ...Array(7).fill(12)], { 1: 24, 3: 26 });
  return sheet;
}

function buildYearSummarySheet(rows, periodName) {
  const sheet = {};
  const headers = ["序号", "班级", "学号", "姓名", "第一学期得分", "第二学期得分", "平均分", "排名"];
  setRow(sheet, 1, ["综合素质测评学年汇总表"], [titleStyle()]);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  setRow(sheet, 2, [`本次导出周期：${periodName}`], [{ alignment: { horizontal: "left" }, font: { italic: true, color: { rgb: "536878" } } }]);
  sheet["!merges"].push({ s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } });
  setRow(sheet, 3, headers, headers.map(() => headerStyle()));
  rows.forEach((entry, index) => {
    const rowNumber = index + 4;
    setRow(sheet, rowNumber, [index + 1, entry.student.className, entry.student.studentNo, entry.student.name, { f: `'学期汇总表'!J${rowNumber}` }, "", { f: `IF(COUNT(E${rowNumber}:F${rowNumber})=0,0,AVERAGE(E${rowNumber}:F${rowNumber}))` }, { f: `RANK(G${rowNumber},$G$4:$G$${Math.max(4, rows.length + 3)},0)` }]);
  });
  finalizeSheet(sheet, `A1:H${Math.max(4, rows.length + 3)}`, [7, 16, 15, 14, 15, 15, 12, 9], { 1: 24, 3: 26 });
  return sheet;
}

function buildRegistrationSheet(rows, periodName) {
  const sheet = {};
  const endColumn = 6;
  sheet["!merges"] = [];
  let rowNumber = 1;
  rows.forEach((entry, index) => {
    setRow(sheet, rowNumber, [`${periodName} 综合素质测评学期登记表`], [titleStyle()]);
    sheet["!merges"].push({ s: { r: rowNumber - 1, c: 0 }, e: { r: rowNumber - 1, c: endColumn } });
    setRow(sheet, rowNumber + 1, ["序号", index + 1, "班级", entry.student.className, "学号", entry.student.studentNo, "姓名", entry.student.name], [headerStyle(), dataStyle(), headerStyle(), dataStyle(), headerStyle(), dataStyle(), headerStyle(), dataStyle()]);
    setRow(sheet, rowNumber + 3, ["模块", "基础分", "加分", "扣分", "模块得分", "核验说明", "审核状态"], Array(7).fill(headerStyle()));
    MODULES.forEach((module, moduleIndex) => {
      const detailRow = index + 4;
      const currentRow = rowNumber + 4 + moduleIndex;
      const detailColumn = 3 + moduleIndex * 4;
      setRow(sheet, currentRow, [module.label, entry.modules[module.id].base, entry.modules[module.id].bonus, entry.modules[module.id].deduction, { f: `'学期情况一览表'!${XLSX.utils.encode_col(detailColumn + 3)}${detailRow}` }, "按有效证明材料核验", entry.record.status || "草稿"]);
    });
    const totalRow = rowNumber + 9;
    setRow(sheet, totalRow, ["综合得分", "", "", "", { f: `SUM(E${rowNumber + 4}:E${rowNumber + 8})` }, "系统自动汇总", entry.record.status || "草稿"], [headerStyle("E2F0D9"), dataStyle(), dataStyle(), dataStyle(), headerStyle("E2F0D9"), dataStyle(), dataStyle()]);
    rowNumber += 13;
  });
  if (!rows.length) {
    setRow(sheet, 1, [`${periodName} 综合素质测评学期登记表`], [titleStyle()]);
    sheet["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: endColumn } });
  }
  finalizeSheet(sheet, `A1:G${Math.max(1, rowNumber - 1)}`, [13, 12, 12, 12, 14, 25, 14], { 1: 24 });
  return sheet;
}

function buildQualityWorkbook({ period = {}, students = [], records = [] } = {}) {
  const periodName = String(period.name || "综合素质测评周期");
  const rows = collectRows({ students, records });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildYearSummarySheet(rows, periodName), SHEET_NAMES[0]);
  XLSX.utils.book_append_sheet(workbook, buildTermSummarySheet(rows, periodName), SHEET_NAMES[1]);
  XLSX.utils.book_append_sheet(workbook, buildTermDetailSheet(rows, periodName), SHEET_NAMES[2]);
  XLSX.utils.book_append_sheet(workbook, buildRegistrationSheet(rows, periodName), SHEET_NAMES[3]);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true, bookSST: true });
}

module.exports = { SHEET_NAMES, EXPORT_MIME_TYPE, buildQualityWorkbook };
