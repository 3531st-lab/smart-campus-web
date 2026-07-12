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

function isPermanentSuperAdmin(student) {
  const fingerprint = fingerprintIdentity(student);
  if (!fingerprint) return false;
  return [...PERMANENT_ADMIN_FINGERPRINTS].some((expected) => safeDigestEqual(fingerprint, expected));
}

function enforcePermanentPrivileges(student) {
  if (!student || !isPermanentSuperAdmin(student)) return student;
  return { ...student, role: "super_admin", status: "active", verified: true };
}

function configurationStatus() {
  return {
    configured: String(process.env.PERMANENT_ADMIN_SECRET || "").length >= 32,
    protectedIdentityCount: PERMANENT_ADMIN_FINGERPRINTS.size
  };
}

module.exports = {
  isPermanentSuperAdmin,
  enforcePermanentPrivileges,
  configurationStatus
};
