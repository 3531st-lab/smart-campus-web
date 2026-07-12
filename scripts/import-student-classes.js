const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadLocalEnv();

const studentStore = require("../server/student-store");

function value(row, keys) {
  for (const key of keys) {
    const foundKey = Object.keys(row).find((item) => item.trim() === key);
    const raw = foundKey ? row[foundKey] : undefined;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      return String(raw).replace(/\.0$/, "").trim();
    }
  }
  return "";
}

function roleValue(row, existingRole = "student") {
  const role = value(row, ["角色", "身份", "账号角色", "role"]);
  if (["总管理员", "super_admin"].includes(role)) return "super_admin";
  if (["管理员", "普通管理员", "admin"].includes(role)) return "admin";
  if (["老师", "教师", "teacher"].includes(role)) return "teacher";
  if (["学生", "student"].includes(role)) return "student";
  return existingRole || "student";
}

function statusValue(row, existingStatus = "active") {
  const status = value(row, ["状态", "账号状态", "status"]);
  if (["停用", "禁用", "disabled"].includes(status)) return "disabled";
  if (["正常", "启用", "active"].includes(status)) return "active";
  return existingStatus || "active";
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("请提供 Excel 文件路径");
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);

  const workbook = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  if (!rows.length) throw new Error("Excel 第一张工作表没有可导入数据");

  const result = { total: rows.length, updated: 0, skipped: 0, errors: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const studentNo = value(row, ["学号", "工号", "学号/工号", "学生学号", "studentNo", "student_no"]);
    const className = value(row, ["班级", "行政班", "班级名称", "所在班级", "className", "class_name"]);
    if (!studentNo || !className) {
      result.skipped += 1;
      result.errors.push(`第 ${index + 2} 行：缺少学号/工号或班级`);
      continue;
    }

    const existing = await studentStore.findByStudentNo(studentNo);
    const rowPhone = value(row, ["手机号", "手机", "联系电话", "phone"]);
    const input = {
      id: existing?.id,
      name: value(row, ["姓名", "学生姓名", "教师姓名", "name"]) || existing?.name || "",
      school: value(row, ["学校", "school"]) || existing?.school || "泰州学院",
      college: value(row, ["学院", "院系", "二级学院", "college"]) || existing?.college || "",
      major: value(row, ["专业", "专业名称", "major"]) || existing?.major || "",
      className,
      studentNo,
      phone: /^1\d{10}$/.test(rowPhone) ? rowPhone : existing?.phone || rowPhone,
      status: statusValue(row, existing?.status),
      role: roleValue(row, existing?.role),
      verified: existing?.verified ?? true,
      avatarColor: existing?.avatarColor || "#1f7a6d"
    };

    try {
      await studentStore.upsertStudent(input);
      result.updated += 1;
      if (result.updated % 200 === 0) console.error(`已导入 ${result.updated} 条...`);
    } catch (error) {
      result.skipped += 1;
      result.errors.push(`第 ${index + 2} 行：${error.message}`);
    }
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
