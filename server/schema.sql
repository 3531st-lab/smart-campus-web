CREATE DATABASE IF NOT EXISTS smart_campus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_campus;

CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  school VARCHAR(120) NOT NULL,
  college VARCHAR(120) NOT NULL DEFAULT '',
  major VARCHAR(120) NOT NULL,
  student_no VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  role ENUM('student','teacher','admin','super_admin') NOT NULL DEFAULT 'student',
  verified TINYINT(1) NOT NULL DEFAULT 1,
  avatar_color VARCHAR(24) NOT NULL DEFAULT '#1f7a6d',
  password_hash VARCHAR(255) NULL,
  password_must_change TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_student_no (school, student_no),
  KEY idx_identity (school, major, student_no, phone),
  KEY idx_status (status)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(80) NOT NULL,
  target_student_no VARCHAR(64) NOT NULL DEFAULT '',
  detail JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
