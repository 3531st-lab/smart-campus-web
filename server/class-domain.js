const CLASS_DUTIES = Object.freeze(["member", "monitor", "league_secretary", "class_admin", "head_teacher", "subject_teacher"]);
const DUTY_RANK = new Map(CLASS_DUTIES.map((duty, index) => [duty, index]));
const PLATFORM_ROLE_RANK = new Map(["student", "teacher", "admin", "super_admin"].map((role, index) => [role, index]));

function normalizeClassPart(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function classKey({ school, college, className }) {
  return [school, college, className].map(normalizeClassPart).join("\u001f");
}

function classDutyRank(duty) {
  return DUTY_RANK.get(duty) ?? DUTY_RANK.get("member");
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-CN");
}

function compareIdentityByClass(left, right) {
  const leftClassParts = [left.school, left.college, left.className ?? left.class_name];
  const rightClassParts = [right.school, right.college, right.className ?? right.class_name];
  for (let index = 0; index < leftClassParts.length; index += 1) {
    const comparison = compareText(normalizeClassPart(leftClassParts[index]), normalizeClassPart(rightClassParts[index]));
    if (comparison) return comparison;
  }

  const roleComparison = (PLATFORM_ROLE_RANK.get(left.role) ?? PLATFORM_ROLE_RANK.size)
    - (PLATFORM_ROLE_RANK.get(right.role) ?? PLATFORM_ROLE_RANK.size);
  if (roleComparison) return roleComparison;

  return compareText(left.name, right.name)
    || compareText(left.studentNo ?? left.student_no, right.studentNo ?? right.student_no);
}

module.exports = {
  CLASS_DUTIES,
  normalizeClassPart,
  classKey,
  classDutyRank,
  compareIdentityByClass
};
