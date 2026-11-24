-- Reel Gen V2 — Cloudflare D1 (SQLite) Migration 0001: Core Studio Schema
-- Pure SQLite / Cloudflare D1 syntax.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_kit_json TEXT NOT NULL DEFAULT '{}',
  output_defaults_json TEXT NOT NULL DEFAULT '{"durationSec":30,"aspectRatio":"9:16","resolution":"1080p","mode":"autopilot"}',
  retention_days INTEGER NOT NULL DEFAULT 30,
  biometric_retention_hours INTEGER NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'sharepoint', 'dropbox', 'box', 's3', 's3_compatible')),
  account_email TEXT,
  account_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'needs_authorization', 'expired', 'permission_denied', 'syncing', 'failed')),
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_source_connections_ws ON source_connections(workspace_id);

CREATE TABLE IF NOT EXISTS source_folders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES source_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  external_folder_id TEXT,
  folder_path TEXT,
  access_status TEXT NOT NULL DEFAULT 'pending_auth',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS shoots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_name TEXT,
  event_type TEXT,
  location TEXT,
  shoot_date TEXT,
  cameras_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_shoots_ws ON shoots(workspace_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'ready', 'needs_clarification', 'failed')),
  brief TEXT NOT NULL DEFAULT '',
  target_duration_sec INTEGER NOT NULL DEFAULT 30,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  mode TEXT NOT NULL DEFAULT 'autopilot' CHECK (mode IN ('autopilot', 'copilot', 'manual')),
  style TEXT NOT NULL DEFAULT 'smart',
  settings_json TEXT NOT NULL DEFAULT '{}',
  active_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_ws_updated ON projects(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS creative_briefs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_prompt TEXT NOT NULL,
  cloud_links_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_creative_briefs_project ON creative_briefs(project_id);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  shoot_id TEXT REFERENCES shoots(id) ON DELETE SET NULL,
  source_folder_id TEXT REFERENCES source_folders(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT,
  mime_type TEXT NOT NULL,
  detected_kind TEXT NOT NULL CHECK (detected_kind IN ('video', 'image', 'audio', 'document', 'archive', 'unknown')),
  decodable INTEGER NOT NULL DEFAULT 0 CHECK (decodable IN (0, 1)),
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256_hash TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  proxy_r2_key TEXT,
  thumbnail_r2_key TEXT,
  source_provider TEXT NOT NULL DEFAULT 'local_upload',
  external_file_id TEXT,
  capture_timestamp TEXT,
  camera_label TEXT,
  location_label TEXT,
  availability_status TEXT NOT NULL DEFAULT 'ready',
  probe_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_media_assets_ws ON media_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_project ON media_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_assets(workspace_id, sha256_hash);

CREATE TABLE IF NOT EXISTS media_segments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  shot_type TEXT,
  motion_energy REAL NOT NULL DEFAULT 0,
  visual_quality REAL NOT NULL DEFAULT 0,
  emotional_impact REAL NOT NULL DEFAULT 0,
  audio_quality REAL NOT NULL DEFAULT 0,
  is_blurry INTEGER NOT NULL DEFAULT 0 CHECK (is_blurry IN (0, 1)),
  is_duplicate INTEGER NOT NULL DEFAULT 0 CHECK (is_duplicate IN (0, 1)),
  transcript_text TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_media_segments_asset ON media_segments(asset_id);

CREATE TABLE IF NOT EXISTS story_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  arc_beats_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  edl_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_timelines_project ON timelines(project_id, version_number DESC);

CREATE TABLE IF NOT EXISTS timeline_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  edl_json TEXT NOT NULL,
  created_by_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_timeline_versions_project ON timeline_versions(project_id, version_number DESC);

CREATE TABLE IF NOT EXISTS ai_processing_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'CREATED', 'VALIDATING_SOURCES', 'WAITING_FOR_AUTH', 'INDEXING',
    'ANALYZING', 'SELECTING_HIGHLIGHTS', 'PLANNING', 'EDITING',
    'RENDERING', 'VALIDATING_OUTPUT', 'COMPLETED', 'RETRYING',
    'PAUSED', 'CANCELLED', 'FAILED'
  )),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  stage_detail TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_project ON ai_processing_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rendering_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_version INTEGER NOT NULL,
  worker_id TEXT,
  state TEXT NOT NULL DEFAULT 'CREATED',
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  resolution TEXT NOT NULL DEFAULT '720p',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rendering_jobs_project ON rendering_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rendered_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES rendering_jobs(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'mp4',
  video_codec TEXT NOT NULL DEFAULT 'h264',
  audio_codec TEXT,
  resolution TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 720,
  height INTEGER NOT NULL DEFAULT 1280,
  duration_sec REAL NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_object_key TEXT NOT NULL,
  qa_passed INTEGER NOT NULL DEFAULT 0 CHECK (qa_passed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_rendered_artifacts_project ON rendered_artifacts(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS export_validations (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES rendered_artifacts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  qa_checks_json TEXT NOT NULL,
  compliance_report_json TEXT NOT NULL,
  ffprobe_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_events_ws ON activity_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ws ON audit_logs(workspace_id, created_at DESC);
