CREATE DATABASE IF NOT EXISTS smart_campus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_campus;

CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  school VARCHAR(120) NOT NULL,
  college VARCHAR(120) NOT NULL DEFAULT '',
  major VARCHAR(120) NOT NULL,
  class_name VARCHAR(120) NOT NULL DEFAULT '',
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
  KEY idx_class (school, college, major, class_name),
  KEY idx_class_identity_order (school, college, class_name, role, name, student_no),
  KEY idx_role_updated (role, updated_at),
  KEY idx_status (status)
);

CREATE TABLE IF NOT EXISTS campus_classes (
  id VARCHAR(64) PRIMARY KEY,
  school VARCHAR(120) NOT NULL,
  college VARCHAR(120) NOT NULL,
  class_name VARCHAR(120) NOT NULL,
  class_key VARCHAR(400) NOT NULL,
  group_id VARCHAR(64) NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_class_key (class_key),
  KEY idx_class_status (status)
);

CREATE TABLE IF NOT EXISTS class_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  duty VARCHAR(32) NOT NULL DEFAULT 'member',
  source VARCHAR(32) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_class_assignment (class_id, user_id),
  KEY idx_assignment_user_active (user_id, active),
  KEY idx_assignment_class_active (class_id, active)
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  public_no VARCHAR(32) NULL,
  name VARCHAR(120) NOT NULL,
  owner_id VARCHAR(64) NULL,
  class_id VARCHAR(64) NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  frozen TINYINT(1) NOT NULL DEFAULT 0,
  next_message_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  description VARCHAR(500) NOT NULL DEFAULT '',
  join_policy VARCHAR(32) NOT NULL DEFAULT 'review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_group_class (class_id),
  UNIQUE KEY uq_chat_group_public_no (public_no),
  KEY idx_chat_group_owner (owner_id, status),
  KEY idx_chat_group_type_status (type, status)
);

ALTER TABLE chat_groups
  ADD COLUMN IF NOT EXISTS public_no VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS owner_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS frozen TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_message_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS join_policy VARCHAR(32) NOT NULL DEFAULT 'review';

ALTER TABLE chat_groups
  ADD UNIQUE INDEX IF NOT EXISTS uq_chat_group_public_no (public_no),
  ADD INDEX IF NOT EXISTS idx_chat_group_owner (owner_id, status);

CREATE TABLE IF NOT EXISTS chat_members (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  joined_via VARCHAR(32) NOT NULL,
  muted_until TIMESTAMP NULL,
  last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_member (group_id, user_id),
  KEY idx_chat_member_user_active (user_id, active, group_id),
  KEY idx_chat_member_group_role (group_id, active, role, user_id)
);

CREATE TABLE IF NOT EXISTS chat_join_requests (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL,
  applicant_id VARCHAR(64) NOT NULL,
  source ENUM('group_number','qr') NOT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  pending_key VARCHAR(160) NULL,
  reviewer_id VARCHAR(64) NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_join_pending (pending_key),
  KEY idx_chat_join_group_status (group_id, status, created_at),
  KEY idx_chat_join_applicant (applicant_id, created_at)
);

CREATE TABLE IF NOT EXISTS chat_invites (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL,
  inviter_id VARCHAR(64) NOT NULL,
  invitee_id VARCHAR(64) NOT NULL,
  status ENUM('pending','accepted','rejected','expired','cancelled') NOT NULL DEFAULT 'pending',
  pending_key VARCHAR(160) NULL,
  expires_at TIMESTAMP NULL,
  accepted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_invite_pending (pending_key),
  KEY idx_chat_invite_group_status (group_id, status, created_at),
  KEY idx_chat_invite_invitee_status (invitee_id, status, created_at)
);

ALTER TABLE chat_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL,
  ADD INDEX IF NOT EXISTS idx_chat_invite_expiry (expires_at, status);

CREATE TABLE IF NOT EXISTS chat_invite_tokens (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL,
  creator_id VARCHAR(64) NOT NULL,
  token_digest CHAR(64) NOT NULL,
  expires_at TIMESTAMP NULL,
  max_uses INT UNSIGNED NOT NULL DEFAULT 1,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_invite_token_digest (token_digest),
  KEY idx_chat_token_group_active (group_id, revoked, expires_at),
  KEY idx_chat_token_creator (creator_id, created_at),
  CONSTRAINT chk_chat_token_usage CHECK (use_count <= max_uses)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR(64) PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  client_request_id VARCHAR(128) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_message_sequence (group_id, sequence),
  UNIQUE KEY uq_chat_message_request (group_id, sender_id, client_request_id),
  KEY idx_chat_message_group_sequence (group_id, sequence),
  KEY idx_chat_message_sender_created (sender_id, created_at)
);

CREATE TABLE IF NOT EXISTS chat_read_cursors (
  group_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  KEY idx_chat_read_cursor_user (user_id, updated_at)
);

CREATE TABLE IF NOT EXISTS class_sync_errors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  student_no VARCHAR(64) NOT NULL DEFAULT '',
  public_message VARCHAR(160) NOT NULL,
  retryable TINYINT(1) NOT NULL DEFAULT 1,
  diagnostic JSON NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_class_sync_errors_user (user_id, recorded_at),
  KEY idx_class_sync_errors_student_no (student_no, recorded_at)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(80) NOT NULL,
  target_student_no VARCHAR(64) NOT NULL DEFAULT '',
  detail JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_timetable_courses (
  owner_key VARCHAR(80) NOT NULL,
  course_id VARCHAR(160) NOT NULL,
  course_data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_key, course_id),
  KEY idx_timetable_owner (owner_key)
);

CREATE TABLE IF NOT EXISTS user_timetable_preferences (
  owner_key VARCHAR(80) PRIMARY KEY,
  semester VARCHAR(120) NOT NULL DEFAULT '',
  week TINYINT UNSIGNED NOT NULL DEFAULT 0,
  schedule VARCHAR(20) NOT NULL DEFAULT '',
  hidden_course_ids JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_global_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id VARCHAR(80) PRIMARY KEY,
  user_id VARCHAR(80) NOT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT '',
  scene VARCHAR(160) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'cny',
  status VARCHAR(40) NOT NULL DEFAULT 'created',
  stripe_session_id VARCHAR(160) NULL,
  checkout_url TEXT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_payment_user (user_id, created_at),
  UNIQUE KEY uq_stripe_session (stripe_session_id)
);

CREATE TABLE IF NOT EXISTS campus_news_cache (
  cache_key VARCHAR(40) PRIMARY KEY,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
