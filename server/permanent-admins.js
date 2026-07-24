const crypto = require("crypto");

// Only irreversible HMAC fingerprints are committed. The signing secret lives
// in the deployment secret store and is never sent to the browser.
const PERMANENT_ADMIN_FINGERPRINTS = new Set([
  "d69c9f51eaa1005e7adc7267fc013472ecdcde0e6eab5f31ad9bad9cc812e7de"
]);

function normalizeIdentityPart(value) {
  return String(value || "").normalize("NFKC").trim();
}

function canonicalIdentity(student = {}) {
  return [student.school, student.name, student.major, student.studentNo ?? student.student_no]
    .map(normalizeIdentityPart)
    .join("\x1f");
}

function fingerprintIdentity(student) {
  const secret = String(process.env.PERMANENT_ADMIN_SECRET || "");
  if (secret.length < 32) return "";
  return crypto.createHmac("sha256", secret).update(canonicalIdentity(student), "utf8").digest("hex");
}

function safeDigestEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function configuredPermanentProfile() {
  const profile = {
    name: normalizeIdentityPart(process.env.CAMPUS_USER_NAME),
    school: normalizeIdentityPart(process.env.CAMPUS_USER_SCHOOL),
    college: normalizeIdentityPart(process.env.CAMPUS_USER_COLLEGE),
    major: normalizeIdentityPart(process.env.CAMPUS_USER_MAJOR),
    className: normalizeIdentityPart(process.env.CAMPUS_USER_CLASS || process.env.CAMPUS_USER_CLASS_NAME),
    studentNo: normalizeIdentityPart(process.env.CAMPUS_USER_STUDENT_NO),
    phone: normalizeIdentityPart(process.env.CAMPUS_USER_PHONE),
    role: "super_admin",
    status: "active",
    verified: true
  };
  const requiredFields = ["name", "school", "college", "major", "className", "studentNo", "phone"];
  return requiredFields.every((field) => profile[field]) ? profile : null;
}

function matchesConfiguredIdentity(student, profile = configuredPermanentProfile()) {
  if (!student || !profile) return false;
  const school = normalizeIdentityPart(student.school);
  const studentNo = normalizeIdentityPart(student.studentNo ?? student.student_no);
  return school === profile.school && studentNo === profile.studentNo;
}

function isPermanentSuperAdmin(student) {
  if (matchesConfiguredIdentity(student)) return true;
  const fingerprint = fingerprintIdentity(student);
  if (!fingerprint) return false;
  return [...PERMANENT_ADMIN_FINGERPRINTS].some((expected) => safeDigestEqual(fingerprint, expected));
}

function enforcePermanentPrivileges(student) {
  if (!student || !isPermanentSuperAdmin(student)) return student;
  const profile = configuredPermanentProfile();
  return {
    ...student,
    ...(profile || {}),
    role: "super_admin",
    status: "active",
    verified: true
  };
}

function configurationStatus() {
  return {
    configured: String(process.env.PERMANENT_ADMIN_SECRET || "").length >= 32,
    profileConfigured: Boolean(configuredPermanentProfile()),
    protectedIdentityCount: PERMANENT_ADMIN_FINGERPRINTS.size
  };
}

module.exports = {
  isPermanentSuperAdmin,
  enforcePermanentPrivileges,
  configuredPermanentProfile,
  configurationStatus
};
